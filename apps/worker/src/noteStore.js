import { HttpError } from "./api.js";

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
  PRIMARY KEY (note_id, version),
  FOREIGN KEY (note_id) REFERENCES notes(note_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_versions_note_id_version ON note_versions(note_id, version DESC);
`;

const SCHEMA_STATEMENTS = SCHEMA_SQL
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const schemaPromises = new WeakMap();

function isoNow() {
  return new Date().toISOString();
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
            base_version
          ) VALUES (?, 1, ?, ?, ?, 'create', NULL)`
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
            base_version
          ) VALUES (?, ?, ?, ?, ?, 'edit', ?)`
        )
        .bind(noteId, nextVersionNumber, title, content, editedAt, expectedCurrentVersion),
      this.db
        .prepare(
          `UPDATE notes
           SET title = ?, current_version = ?, latest_version = ?, updated_at = ?
           WHERE note_id = ? AND current_version = ?`
        )
        .bind(title, nextVersionNumber, nextVersionNumber, editedAt, noteId, expectedCurrentVersion)
    ]);

    return { noteId, currentVersion: nextVersionNumber };
  }

  async listVersions(noteId) {
    await this.#getNoteMeta(noteId);

    const { results = [] } = await this.db
      .prepare(
        `SELECT
          version,
          edited_at AS editedAt,
          source,
          title,
          base_version AS baseVersion
        FROM note_versions
        WHERE note_id = ?
        ORDER BY version DESC`
      )
      .bind(noteId)
      .all();

    return results;
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
          base_version AS baseVersion
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

  async undo(noteId) {
    const note = await this.#getNoteMeta(noteId);

    if (note.currentVersion <= 1) {
      throw new HttpError(409, "Conflict", "Cannot undo past version 1");
    }

    return this.#moveCurrentVersion(noteId, note.currentVersion, note.currentVersion - 1);
  }

  async redo(noteId) {
    const note = await this.#getNoteMeta(noteId);

    if (note.currentVersion >= note.latestVersion) {
      throw new HttpError(409, "Conflict", "Cannot redo because no newer version exists");
    }

    return this.#moveCurrentVersion(noteId, note.currentVersion, note.currentVersion + 1);
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
            base_version
          ) VALUES (?, ?, ?, ?, ?, 'restore', ?)`
        )
        .bind(noteId, nextVersionNumber, restoredVersion.title, restoredVersion.content, editedAt, versionNumber),
      this.db
        .prepare(
          `UPDATE notes
           SET title = ?, current_version = ?, latest_version = ?, updated_at = ?
           WHERE note_id = ? AND current_version = ?`
        )
        .bind(restoredVersion.title, nextVersionNumber, nextVersionNumber, editedAt, noteId, note.currentVersion)
    ]);

    return { noteId, currentVersion: nextVersionNumber, restoredFrom: versionNumber };
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
}

export { D1NoteStore };
