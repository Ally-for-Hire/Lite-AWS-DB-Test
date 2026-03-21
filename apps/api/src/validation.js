import { HttpError } from "./errors.js";

const TITLE_MAX_LENGTH = 120;
const CONTENT_MAX_LENGTH = 20000;

export function normalizeTitle(value) {
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

export function normalizeContent(value) {
  if (typeof value !== "string") {
    throw new HttpError(400, "ValidationError", "Content must be a string");
  }

  if (value.length > CONTENT_MAX_LENGTH) {
    throw new HttpError(400, "ValidationError", `Content must be ${CONTENT_MAX_LENGTH} characters or fewer`);
  }

  return value;
}

export function normalizeExpectedCurrentVersion(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "ValidationError", "expectedCurrentVersion must be a positive integer");
  }

  return value;
}

export function parseVersion(value) {
  const versionNumber = Number(value);

  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new HttpError(400, "ValidationError", "Version must be a positive integer");
  }

  return versionNumber;
}
