import { handleApiRequest } from "./src/apiCore.js";
import { DynamoNoteStore } from "./src/dynamoNoteStore.js";
import { HttpError, isHttpError } from "./src/errors.js";

const store = new DynamoNoteStore({
  tableName: process.env.TABLE_NAME
});

function parseBody(event) {
  if (!event.body) {
    return {};
  }

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, "ValidationError", "Request body must be valid JSON");
  }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  };
}

export async function handler(event) {
  try {
    if (event.requestContext?.http?.method === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS"
        },
        body: ""
      };
    }

    const result = await handleApiRequest({
      method: event.requestContext?.http?.method || event.httpMethod || "GET",
      pathname: event.rawPath || event.path || "/api",
      body: parseBody(event),
      store
    });

    return response(result.statusCode, result.body);
  } catch (error) {
    console.error(error);

    if (isHttpError(error)) {
      return response(error.status, {
        error: error.error,
        message: error.message
      });
    }

    return response(500, {
      error: "InternalError",
      message: "An unexpected error occurred"
    });
  }
}
