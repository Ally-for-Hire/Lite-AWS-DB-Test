import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HttpError } from "./errors.js";

const EMPTY_DB = { notes: {} };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isoNow() {
  return new Date().toISOString();
}

function sortByUpdatedAtDesc(a, b) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export class JsonNoteStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.initialized = false;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    if (this.initialized) {
      return;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        await writeFile(this.filePath, JSON.stringify(EMPTY_DB, null, 2));
      } else {
        throw error;
      }
    }

    this.initialized = true;
  }

  async listNotes() {
    const db = await this.#readDb();

    return Object.values(db.notes)
      .map((note) => clone(note.meta))
      .sort(sortByUpdatedAtDesc);
  }

  async createNote({ title, content }) {
    return this.#withWriteLock(async (db) => {
      const noteId = randomUUID();
      const createdAt = isoNow();
      const version = {
        version: 1,
        title,
        content,
        editedAt: createdAt,
        source: "create",
        baseVersion: null
      };

      db.notes[noteId] = {
        meta: {
          noteId,
          title,
          currentVersion: 1,
          createdAt,
          updatedAt: createdAt
        },
        versions: [version]
      };

      return {
        noteId,
        currentVersion: 1,
        title,
        content
      };
    });
  }

  async getNote(noteId) {
    const db = await this.#readDb();
    const note = this.#getRequiredNote(db, noteId);
    const currentVersion = this.#getRequiredVersion(note, note.meta.currentVersion);

    return this.#buildCurrentSnapshot(note, currentVersion);
  }

  async updateNote(noteId, { title, content, expectedCurrentVersion }) {
    return this.#withWriteLock(async (db) => {
      const note = this.#getRequiredNote(db, noteId);

      if (note.meta.currentVersion !== expectedCurrentVersion) {
        throw new HttpError(409, "Conflict", "Version mismatch");
      }

      const nextVersionNumber = note.versions.at(-1).version + 1;
      const editedAt = isoNow();

      note.versions.push({
        version: nextVersionNumber,
        title,
        content,
        editedAt,
        source: "edit",
        baseVersion: expectedCurrentVersion
      });

      note.meta.title = title;
      note.meta.currentVersion = nextVersionNumber;
      note.meta.updatedAt = editedAt;

      return {
        noteId,
        currentVersion: nextVersionNumber
      };
    });
  }

  async listVersions(noteId) {
    const db = await this.#readDb();
    const note = this.#getRequiredNote(db, noteId);

    return note.versions
      .map((version) => ({
        version: version.version,
        editedAt: version.editedAt,
        source: version.source,
        title: version.title,
        baseVersion: version.baseVersion
      }))
      .sort((a, b) => b.version - a.version);
  }

  async getVersion(noteId, versionNumber) {
    const db = await this.#readDb();
    const note = this.#getRequiredNote(db, noteId);
    const version = this.#getRequiredVersion(note, versionNumber);

    return {
      noteId,
      version: version.version,
      title: version.title,
      content: version.content,
      editedAt: version.editedAt,
      source: version.source,
      baseVersion: version.baseVersion,
      isCurrent: note.meta.currentVersion === version.version
    };
  }

  async undo(noteId) {
    return this.#withWriteLock(async (db) => {
      const note = this.#getRequiredNote(db, noteId);

      if (note.meta.currentVersion <= 1) {
        throw new HttpError(409, "Conflict", "Cannot undo past version 1");
      }

      note.meta.currentVersion -= 1;
      note.meta.updatedAt = isoNow();
      note.meta.title = this.#getRequiredVersion(note, note.meta.currentVersion).title;

      return {
        noteId,
        currentVersion: note.meta.currentVersion
      };
    });
  }

  async redo(noteId) {
    return this.#withWriteLock(async (db) => {
      const note = this.#getRequiredNote(db, noteId);
      const nextVersionNumber = note.meta.currentVersion + 1;
      const targetVersion = note.versions.find((version) => version.version === nextVersionNumber);

      if (!targetVersion) {
        throw new HttpError(409, "Conflict", "Cannot redo because no newer version exists");
      }

      note.meta.currentVersion = nextVersionNumber;
      note.meta.updatedAt = isoNow();
      note.meta.title = targetVersion.title;

      return {
        noteId,
        currentVersion: note.meta.currentVersion
      };
    });
  }

  async restoreVersion(noteId, versionNumber) {
    return this.#withWriteLock(async (db) => {
      const note = this.#getRequiredNote(db, noteId);
      const restoredVersion = this.#getRequiredVersion(note, versionNumber);
      const nextVersionNumber = note.versions.at(-1).version + 1;
      const editedAt = isoNow();

      note.versions.push({
        version: nextVersionNumber,
        title: restoredVersion.title,
        content: restoredVersion.content,
        editedAt,
        source: "restore",
        baseVersion: versionNumber
      });

      note.meta.title = restoredVersion.title;
      note.meta.currentVersion = nextVersionNumber;
      note.meta.updatedAt = editedAt;

      return {
        noteId,
        currentVersion: nextVersionNumber,
        restoredFrom: versionNumber
      };
    });
  }

  #buildCurrentSnapshot(note, currentVersion) {
    return {
      noteId: note.meta.noteId,
      title: currentVersion.title,
      content: currentVersion.content,
      currentVersion: note.meta.currentVersion,
      updatedAt: note.meta.updatedAt
    };
  }

  #getRequiredNote(db, noteId) {
    const note = db.notes[noteId];

    if (!note) {
      throw new HttpError(404, "NotFound", "Note not found");
    }

    return note;
  }

  #getRequiredVersion(note, versionNumber) {
    const version = note.versions.find((entry) => entry.version === versionNumber);

    if (!version) {
      throw new HttpError(404, "NotFound", "Version not found");
    }

    return version;
  }

  async #readDb(waitForPendingWrites = true) {
    if (waitForPendingWrites) {
      await this.writeQueue;
    }

    await this.init();
    const raw = await readFile(this.filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : clone(EMPTY_DB);
  }

  async #writeDb(db) {
    await writeFile(this.filePath, JSON.stringify(db, null, 2));
  }

  async #withWriteLock(operation) {
    const nextRun = this.writeQueue.then(async () => {
      const db = await this.#readDb(false);
      const result = await operation(db);
      await this.#writeDb(db);
      return result;
    });

    this.writeQueue = nextRun.then(
      () => undefined,
      () => undefined
    );

    return nextRun;
  }
}
