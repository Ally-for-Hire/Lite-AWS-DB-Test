import { HttpError } from "./errors.js";
import {
  normalizeContent,
  normalizeExpectedCurrentVersion,
  normalizeTitle,
  parseVersion
} from "./validation.js";

export async function handleApiRequest({ method, pathname, body = {}, store }) {
  if (method === "GET" && pathname === "/api/health") {
    return {
      statusCode: 200,
      body: { ok: true }
    };
  }

  if (method === "GET" && pathname === "/api/notes") {
    return {
      statusCode: 200,
      body: { notes: await store.listNotes() }
    };
  }

  if (method === "POST" && pathname === "/api/notes") {
    const note = await store.createNote({
      title: normalizeTitle(body.title),
      content: normalizeContent(body.content)
    });

    return {
      statusCode: 201,
      body: note
    };
  }

  const segments = pathname.split("/").filter(Boolean);

  if (segments.length >= 3 && segments[0] === "api" && segments[1] === "notes") {
    const noteId = segments[2];

    if (method === "GET" && segments.length === 3) {
      return {
        statusCode: 200,
        body: await store.getNote(noteId)
      };
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
      return {
        statusCode: 200,
        body: { versions: await store.listVersions(noteId) }
      };
    }

    if (method === "GET" && segments.length === 5 && segments[3] === "versions") {
      return {
        statusCode: 200,
        body: await store.getVersion(noteId, parseVersion(segments[4]))
      };
    }

    if (method === "POST" && segments.length === 4 && segments[3] === "undo") {
      return {
        statusCode: 200,
        body: await store.undo(noteId)
      };
    }

    if (method === "POST" && segments.length === 4 && segments[3] === "redo") {
      return {
        statusCode: 200,
        body: await store.redo(noteId)
      };
    }

    if (method === "POST" && segments.length === 5 && segments[3] === "restore") {
      return {
        statusCode: 200,
        body: await store.restoreVersion(noteId, parseVersion(segments[4]))
      };
    }
  }

  throw new HttpError(404, "NotFound", "Route not found");
}
