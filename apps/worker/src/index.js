import { handleApiRequest } from "../../api/src/apiCore.js";
import { isHttpError } from "../../api/src/errors.js";
import { D1NoteStore } from "./d1NoteStore.js";

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS"
        }
      });
    }

    if (!url.pathname.startsWith("/api")) {
      return env.ASSETS.fetch(request);
    }

    try {
      const body =
        request.method === "POST" || request.method === "PUT" ? await request.json().catch(() => {
          throw new Error("INVALID_JSON");
        }) : undefined;

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

      if (isHttpError(error)) {
        return jsonResponse(error.status, {
          error: error.error,
          message: error.message
        });
      }

      console.error(error);
      return jsonResponse(500, {
        error: "InternalError",
        message: "An unexpected error occurred"
      });
    }
  }
};
