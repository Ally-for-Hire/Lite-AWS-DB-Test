import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { HttpError, isHttpError } from "./errors.js";
import { handleApiRequest } from "./apiCore.js";

const MAX_BODY_SIZE = 1024 * 1024;

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(body);
}

async function sendStaticFile(response, publicDir, pathname) {
  const rootPath = path.resolve(publicDir);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(rootPath, relativePath);

  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) {
    return false;
  }

  try {
    const fileInfo = await stat(filePath);

    if (!fileInfo.isFile()) {
      return false;
    }

    const content = await readFile(filePath);
    const extension = path.extname(filePath);

    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES.get(extension) || "application/octet-stream"
    });
    response.end(content);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > MAX_BODY_SIZE) {
      throw new HttpError(413, "ValidationError", "Request body is too large");
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "ValidationError", "Request body must be valid JSON");
  }
}

export function createApp({ publicDir, store }) {
  return async function app(request, response) {
    const url = new URL(request.url || "/", "http://localhost");
    const pathname = url.pathname;

    try {
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS"
        });
        response.end();
        return;
      }

      if (!pathname.startsWith("/api")) {
        const served = await sendStaticFile(response, publicDir, pathname);

        if (!served) {
          sendText(response, 404, "Not found");
        }

        return;
      }

      const body =
        request.method === "POST" || request.method === "PUT" ? await readJsonBody(request) : undefined;
      const result = await handleApiRequest({
        method: request.method || "GET",
        pathname,
        body,
        store
      });

      sendJson(response, result.statusCode, result.body);
    } catch (error) {
      if (isHttpError(error)) {
        sendJson(response, error.status, {
          error: error.error,
          message: error.message
        });
        return;
      }

      console.error(error);
      sendJson(response, 500, {
        error: "InternalError",
        message: "An unexpected error occurred"
      });
    }
  };
}
