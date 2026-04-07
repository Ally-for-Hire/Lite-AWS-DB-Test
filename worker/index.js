class HttpError extends Error {
  constructor(status, error, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.error = error;
  }
}

const TITLE_MAX_LENGTH = 120;
const CONTENT_MAX_LENGTH = 20000;
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notes (
  note_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  latest_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_versions (
  note_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  edited_at TEXT NOT NULL,
  source TEXT NOT NULL,
  base_version INTEGER,
  parent_version INTEGER,
  restored_from_version INTEGER,
  PRIMARY KEY (note_id, version),
  FOREIGN KEY (note_id) REFERENCES notes(note_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_versions_note_id_version ON note_versions(note_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_note_versions_note_id_parent_version ON note_versions(note_id, parent_version, version DESC);
`;

const SCHEMA_STATEMENTS = SCHEMA_SQL
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const schemaPromises = new WeakMap();

function normalizeTitle(value) {
  if (typeof value !== "string") {
    throw new HttpError(400, "ValidationError", "Title must be a string");
  }

  const title = value.trim();

  if (!title) {
    throw new HttpError(400, "ValidationError", "Title is required");
  }

  if (title.length > TITLE_MAX_LENGTH) {
    throw new HttpError(400, "ValidationError", `Title must be ${TITLE_MAX_LENGTH} characters or fewer`);
  }

  return title;
}

function normalizeContent(value) {
  if (typeof value !== "string") {
    throw new HttpError(400, "ValidationError", "Content must be a string");
  }

  if (value.length > CONTENT_MAX_LENGTH) {
    throw new HttpError(400, "ValidationError", `Content must be ${CONTENT_MAX_LENGTH} characters or fewer`);
  }

  return value;
}

function normalizeExpectedCurrentVersion(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "ValidationError", "expectedCurrentVersion must be a positive integer");
  }

  return value;
}

function parseVersion(value) {
  const versionNumber = Number(value);

  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new HttpError(400, "ValidationError", "Version must be a positive integer");
  }

  return versionNumber;
}

function isApiRequest(pathname) {
  return pathname.startsWith("/api");
}

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function isoNow() {
  return new Date().toISOString();
}

function classifyPlatformError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("too many requests") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota") ||
    normalized.includes("daily limit")
  ) {
    return {
      statusCode: 429,
      body: {
        error: "FreeTierLimit",
        code: "FREE_TIER_RATE_LIMIT",
        message: "Temporary free-tier capacity limit reached. Try again later. Your local draft should be kept."
      }
    };
  }

  if (
    normalized.includes("1102") ||
    normalized.includes("resource limits") ||
    normalized.includes("cpu time limit") ||
    normalized.includes("worker exceeded")
  ) {
    return {
      statusCode: 503,
      body: {
        error: "PlatformLimit",
        code: "WORKER_RESOURCE_LIMIT",
        message: "The worker hit a platform resource limit. Try again later. Your local draft should be kept."
      }
    };
  }

  if (
    normalized.includes("storage limit") ||
    normalized.includes("database is full") ||
    normalized.includes("disk full")
  ) {
    return {
      statusCode: 507,
      body: {
        error: "FreeTierLimit",
        code: "D1_STORAGE_LIMIT",
        message: "Database storage is full on the current plan. Your local draft should be kept."
      }
    };
  }

  return null;
}

function isMissingColumnError(error, columnName) {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.toLowerCase().includes(`no such column: ${columnName}`);
}

async function readJsonBody(request) {
  if (request.method !== "POST" && request.method !== "PUT") {
    return undefined;
  }

  const contentType = request.headers.get("Content-Type") || request.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return undefined;
  }

  try {
    return await request.json();
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function handleApiRequest({ method, pathname, body = {}, store }) {
  if (method === "GET" && pathname === "/api/health") {
    return { statusCode: 200, body: { ok: true } };
  }

  if (method === "GET" && pathname === "/api/notes") {
    return { statusCode: 200, body: { notes: await store.listNotes() } };
  }

  if (method === "POST" && pathname === "/api/notes") {
    const note = await store.createNote({
      title: normalizeTitle(body.title),
      content: normalizeContent(body.content)
    });

    return { statusCode: 201, body: note };
  }

  const segments = pathname.split("/").filter(Boolean);

  if (segments.length >= 3 && segments[0] === "api" && segments[1] === "notes") {
    const noteId = segments[2];

    if (method === "GET" && segments.length === 3) {
      return { statusCode: 200, body: await store.getNote(noteId) };
    }

    if (method === "PUT" && segments.length === 3) {
      return {
        statusCode: 200,
        body: await store.updateNote(noteId, {
          title: normalizeTitle(body.title),
          content: normalizeContent(body.content),
          expectedCurrentVersion: normalizeExpectedCurrentVersion(body.expectedCurrentVersion)
        })
      };
    }

    if (method === "GET" && segments.length === 4 && segments[3] === "versions") {
      return { statusCode: 200, body: { versions: await store.listVersions(noteId) } };
    }

    if (method === "GET" && segments.length === 5 && segments[3] === "versions") {
      return { statusCode: 200, body: await store.getVersion(noteId, parseVersion(segments[4])) };
    }

    if (method === "POST" && segments.length === 5 && segments[3] === "current") {
      return { statusCode: 200, body: await store.setCurrentVersion(noteId, parseVersion(segments[4])) };
    }

    if (method === "POST" && segments.length === 4 && segments[3] === "undo") {
      return { statusCode: 200, body: await store.undo(noteId) };
    }

    if (method === "POST" && segments.length === 4 && segments[3] === "redo") {
      return { statusCode: 200, body: await store.redo(noteId) };
    }

    if (method === "POST" && segments.length === 5 && segments[3] === "restore") {
      return { statusCode: 200, body: await store.restoreVersion(noteId, parseVersion(segments[4])) };
    }
  }

  throw new HttpError(404, "NotFound", "Route not found");
}

class D1NoteStore {
  constructor(db) {
    this.db = db;
  }

  async init() {
    let schemaPromise = schemaPromises.get(this.db);

    if (!schemaPromise) {
      schemaPromise = (async () => {
        try {
          for (const statement of SCHEMA_STATEMENTS) {
            await this.db.prepare(statement).run();
          }
          await this.#ensureColumn("parent_version", "ALTER TABLE note_versions ADD COLUMN parent_version INTEGER");
          await this.#ensureColumn("restored_from_version", "ALTER TABLE note_versions ADD COLUMN restored_from_version INTEGER");
          await this.#runBackfill(
            "parent_version",
            `UPDATE note_versions
             SET parent_version = base_version
             WHERE parent_version IS NULL AND source = 'edit'`
          );
          await this.#runBackfill(
            "restored_from_version",
            `UPDATE note_versions
             SET restored_from_version = base_version
             WHERE restored_from_version IS NULL AND source = 'restore'`
          );
        } catch (error) {
          schemaPromises.delete(this.db);
          throw error;
        }
      })();

      schemaPromises.set(this.db, schemaPromise);
    }

    await schemaPromise;
  }

  async listNotes() {
    const { results = [] } = await this.db
      .prepare(
        `SELECT
          note_id AS noteId,
          title,
          current_version AS currentVersion,
          updated_at AS updatedAt
        FROM notes
        ORDER BY updated_at DESC`
      )
      .all();

    return results;
  }

  async createNote({ title, content }) {
    const noteId = crypto.randomUUID();
    const createdAt = isoNow();

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO notes (
            note_id,
            title,
            current_version,
            latest_version,
            created_at,
            updated_at
          ) VALUES (?, ?, 1, 1, ?, ?)`
        )
        .bind(noteId, title, createdAt, createdAt),
      this.db
        .prepare(
          `INSERT INTO note_versions (
            note_id,
            version,
            title,
            content,
            edited_at,
            source,
            base_version,
            parent_version,
            restored_from_version
          ) VALUES (?, 1, ?, ?, ?, 'create', NULL, NULL, NULL)`
        )
        .bind(noteId, title, content, createdAt)
    ]);

    return { noteId, currentVersion: 1, title, content };
  }

  async getNote(noteId) {
    const note = await this.db
      .prepare(
        `SELECT
          n.note_id AS noteId,
          v.title,
          v.content,
          n.current_version AS currentVersion,
          n.latest_version AS latestVersion,
          ${this.#versionParentExpression("v")} AS parentVersion,
          ${this.#versionRestoreExpression("v")} AS restoredFromVersion,
          n.updated_at AS updatedAt
        FROM notes n
        JOIN note_versions v
          ON v.note_id = n.note_id
         AND v.version = n.current_version
        WHERE n.note_id = ?`
      )
      .bind(noteId)
      .first();

    if (!note) {
      throw new HttpError(404, "NotFound", "Note not found");
    }

    return note;
  }

  async updateNote(noteId, { title, content, expectedCurrentVersion }) {
    const note = await this.#getNoteMeta(noteId);

    if (note.currentVersion !== expectedCurrentVersion) {
      throw new HttpError(409, "Conflict", "Version mismatch");
    }

    const nextVersionNumber = note.latestVersion + 1;
    const editedAt = isoNow();

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO note_versions (
            note_id,
            version,
            title,
            content,
            edited_at,
            source,
            base_version,
            parent_version,
            restored_from_version
          ) VALUES (?, ?, ?, ?, ?, 'edit', ?, ?, NULL)`
        )
        .bind(noteId, nextVersionNumber, title, content, editedAt, expectedCurrentVersion, expectedCurrentVersion),
      this.db
        .prepare(
          `UPDATE notes
           SET title = ?, current_version = ?, latest_version = ?, updated_at = ?
           WHERE note_id = ? AND current_version = ?`
        )
        .bind(title, nextVersionNumber, nextVersionNumber, editedAt, noteId, expectedCurrentVersion)
    ]);

    return { noteId, currentVersion: nextVersionNumber, parentVersion: expectedCurrentVersion };
  }

  async listVersions(noteId) {
    const note = await this.#getNoteMeta(noteId);

    const { results = [] } = await this.db
      .prepare(
        `SELECT
          v.version,
          v.edited_at AS editedAt,
          v.source,
          v.title,
          ${this.#versionParentExpression("v")} AS parentVersion,
          ${this.#versionRestoreExpression("v")} AS restoredFromVersion,
          (
            SELECT COUNT(*)
            FROM note_versions child
            WHERE child.note_id = v.note_id AND child.parent_version = v.version
          ) AS childCount
        FROM note_versions v
        WHERE v.note_id = ?
        ORDER BY v.version DESC`
      )
      .bind(noteId)
      .all();

    return results.map((version) => ({
      ...version,
      isCurrent: note.currentVersion === version.version
    }));
  }

  async getVersion(noteId, versionNumber) {
    const note = await this.#getNoteMeta(noteId);
    const version = await this.db
      .prepare(
        `SELECT
          note_id AS noteId,
          version,
          title,
          content,
          edited_at AS editedAt,
          source,
          ${this.#versionParentExpression("note_versions")} AS parentVersion,
          ${this.#versionRestoreExpression("note_versions")} AS restoredFromVersion
        FROM note_versions
        WHERE note_id = ? AND version = ?`
      )
      .bind(noteId, versionNumber)
      .first();

    if (!version) {
      throw new HttpError(404, "NotFound", "Version not found");
    }

    return { ...version, isCurrent: note.currentVersion === version.version };
  }

  async setCurrentVersion(noteId, versionNumber) {
    const note = await this.#getNoteMeta(noteId);
    const targetVersion = await this.getVersion(noteId, versionNumber);

    if (note.currentVersion === versionNumber) {
      return { noteId, currentVersion: versionNumber };
    }

    return this.#moveCurrentVersion(noteId, note.currentVersion, targetVersion.version);
  }

  async undo(noteId) {
    const note = await this.#getNoteMeta(noteId);
    const currentVersion = await this.getVersion(noteId, note.currentVersion);

    if (!Number.isInteger(currentVersion.parentVersion)) {
      throw new HttpError(409, "Conflict", "Cannot undo because this version has no parent");
    }

    return this.#moveCurrentVersion(noteId, note.currentVersion, currentVersion.parentVersion);
  }

  async redo(noteId) {
    const note = await this.#getNoteMeta(noteId);
    const childVersions = await this.#listChildVersions(noteId, note.currentVersion);

    if (childVersions.length === 0) {
      throw new HttpError(409, "Conflict", "Cannot redo because no child version exists");
    }

    if (childVersions.length > 1) {
      throw new HttpError(409, "Conflict", "Cannot redo because multiple branches exist");
    }

    return this.#moveCurrentVersion(noteId, note.currentVersion, childVersions[0].version);
  }

  async restoreVersion(noteId, versionNumber) {
    const note = await this.#getNoteMeta(noteId);
    const restoredVersion = await this.getVersion(noteId, versionNumber);
    const nextVersionNumber = note.latestVersion + 1;
    const editedAt = isoNow();

    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO note_versions (
            note_id,
            version,
            title,
            content,
            edited_at,
            source,
            base_version,
            parent_version,
            restored_from_version
          ) VALUES (?, ?, ?, ?, ?, 'restore', ?, ?, ?)`
        )
        .bind(
          noteId,
          nextVersionNumber,
          restoredVersion.title,
          restoredVersion.content,
          editedAt,
          note.currentVersion,
          note.currentVersion,
          versionNumber
        ),
      this.db
        .prepare(
          `UPDATE notes
           SET title = ?, current_version = ?, latest_version = ?, updated_at = ?
           WHERE note_id = ? AND current_version = ?`
        )
        .bind(restoredVersion.title, nextVersionNumber, nextVersionNumber, editedAt, noteId, note.currentVersion)
    ]);

    return {
      noteId,
      currentVersion: nextVersionNumber,
      parentVersion: note.currentVersion,
      restoredFromVersion: versionNumber
    };
  }

  async #listChildVersions(noteId, parentVersion) {
    const { results = [] } = await this.db
      .prepare(
        `SELECT version
         FROM note_versions
         WHERE note_id = ? AND parent_version = ?
         ORDER BY version DESC`
      )
      .bind(noteId, parentVersion)
      .all();

    return results;
  }

  async #moveCurrentVersion(noteId, currentVersion, nextVersion) {
    const targetVersion = await this.getVersion(noteId, nextVersion);
    const updatedAt = isoNow();

    await this.db
      .prepare(
        `UPDATE notes
         SET title = ?, current_version = ?, updated_at = ?
         WHERE note_id = ? AND current_version = ?`
      )
      .bind(targetVersion.title, targetVersion.version, updatedAt, noteId, currentVersion)
      .run();

    return { noteId, currentVersion: targetVersion.version };
  }

  async #getNoteMeta(noteId) {
    const note = await this.db
      .prepare(
        `SELECT
          note_id AS noteId,
          title,
          current_version AS currentVersion,
          latest_version AS latestVersion,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM notes
        WHERE note_id = ?`
      )
      .bind(noteId)
      .first();

    if (!note) {
      throw new HttpError(404, "NotFound", "Note not found");
    }

    return note;
  }

  async #ensureColumn(columnName, alterStatement) {
    const { results = [] } = await this.db.prepare("PRAGMA table_info(note_versions)").all();
    const hasColumn = results.some((column) => column.name === columnName);

    if (!hasColumn) {
      await this.db.prepare(alterStatement).run();
    }
  }

  async #runBackfill(columnName, statement) {
    try {
      await this.db.prepare(statement).run();
    } catch (error) {
      if (!isMissingColumnError(error, columnName)) {
        throw error;
      }
    }
  }

  #versionParentExpression(alias) {
    return `COALESCE(${alias}.parent_version, CASE WHEN ${alias}.source = 'edit' THEN ${alias}.base_version END)`;
  }

  #versionRestoreExpression(alias) {
    return `COALESCE(${alias}.restored_from_version, CASE WHEN ${alias}.source = 'restore' THEN ${alias}.base_version END)`;
  }
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && isApiRequest(url.pathname)) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS"
        }
      });
    }

    if (!isApiRequest(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    try {
      const body = await readJsonBody(request);
      const store = new D1NoteStore(env.DB);

      await store.init();

      const result = await handleApiRequest({
        method: request.method,
        pathname: url.pathname,
        body,
        store
      });

      return jsonResponse(result.statusCode, result.body);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_JSON") {
        return jsonResponse(400, {
          error: "ValidationError",
          message: "Request body must be valid JSON"
        });
      }

      if (error instanceof HttpError) {
        return jsonResponse(error.status, {
          error: error.error,
          message: error.message
        });
      }

      const classifiedError = classifyPlatformError(error);

      if (classifiedError) {
        return jsonResponse(classifiedError.statusCode, classifiedError.body);
      }

      console.error(error);
      return jsonResponse(500, {
        error: "InternalError",
        message: "An unexpected error occurred"
      });
    }
  }
};

export { D1NoteStore, HttpError, handleApiRequest };
export default worker;
