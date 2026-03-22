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

export { HttpError, handleApiRequest };
