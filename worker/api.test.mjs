import test from "node:test";
import assert from "node:assert/strict";

import { D1NoteStore, handleApiRequest } from "./index.js";

class MemoryNoteStore {
  constructor() {
    this.notes = new Map();
    this.versions = new Map();
    this.nextId = 1;
    this.tick = 1;
  }

  now() {
    const value = String(this.tick).padStart(2, "0");
    this.tick += 1;
    return `2026-03-21T00:00:${value}.000Z`;
  }

  getVersions(noteId) {
    return this.versions.get(noteId) || [];
  }

  getVersionEntry(noteId, versionNumber) {
    return this.getVersions(noteId).find((entry) => entry.version === versionNumber);
  }

  countChildren(noteId, versionNumber) {
    return this.getVersions(noteId).filter((entry) => entry.parentVersion === versionNumber).length;
  }

  async listNotes() {
    return [...this.notes.values()]
      .map((note) => ({
        noteId: note.noteId,
        title: note.title,
        currentVersion: note.currentVersion,
        updatedAt: note.updatedAt
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createNote({ title, content }) {
    const noteId = `note-${this.nextId}`;
    this.nextId += 1;
    const timestamp = this.now();

    this.notes.set(noteId, {
      noteId,
      title,
      currentVersion: 1,
      latestVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    this.versions.set(noteId, [
      {
        noteId,
        version: 1,
        title,
        content,
        editedAt: timestamp,
        source: "create",
        parentVersion: null,
        restoredFromVersion: null
      }
    ]);

    return { noteId, currentVersion: 1, title, content };
  }

  async getNote(noteId) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    const version = this.getVersionEntry(noteId, note.currentVersion);

    return {
      noteId,
      title: version.title,
      content: version.content,
      currentVersion: note.currentVersion,
      latestVersion: note.latestVersion,
      parentVersion: version.parentVersion,
      restoredFromVersion: version.restoredFromVersion,
      updatedAt: note.updatedAt
    };
  }

  async updateNote(noteId, { title, content, expectedCurrentVersion }) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");

    if (note.currentVersion !== expectedCurrentVersion) {
      const error = new Error("Version mismatch");
      error.status = 409;
      throw error;
    }

    const nextVersion = note.latestVersion + 1;
    const timestamp = this.now();

    this.getVersions(noteId).push({
      noteId,
      version: nextVersion,
      title,
      content,
      editedAt: timestamp,
      source: "edit",
      parentVersion: expectedCurrentVersion,
      restoredFromVersion: null
    });

    note.title = title;
    note.currentVersion = nextVersion;
    note.latestVersion = nextVersion;
    note.updatedAt = timestamp;

    return { noteId, currentVersion: nextVersion, parentVersion: expectedCurrentVersion };
  }

  async listVersions(noteId) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");

    return [...this.getVersions(noteId)]
      .sort((left, right) => right.version - left.version)
      .map(({ version, editedAt, source, title, parentVersion, restoredFromVersion }) => ({
        version,
        editedAt,
        source,
        title,
        parentVersion,
        restoredFromVersion,
        childCount: this.countChildren(noteId, version),
        isCurrent: note.currentVersion === version
      }));
  }

  async getVersion(noteId, versionNumber) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    const version = this.getVersionEntry(noteId, versionNumber);
    assert.ok(version, "version should exist");
    return { ...version, isCurrent: note.currentVersion === versionNumber };
  }

  async setCurrentVersion(noteId, versionNumber) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    const version = this.getVersionEntry(noteId, versionNumber);
    if (!version) {
      const error = new Error("Version not found");
      error.status = 404;
      throw error;
    }
    note.currentVersion = versionNumber;
    note.title = version.title;
    note.updatedAt = this.now();
    return { noteId, currentVersion: versionNumber };
  }

  async undo(noteId) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    const current = this.getVersionEntry(noteId, note.currentVersion);

    if (!Number.isInteger(current.parentVersion)) {
      const error = new Error("Cannot undo because this version has no parent");
      error.status = 409;
      throw error;
    }

    note.currentVersion = current.parentVersion;
    note.title = this.getVersionEntry(noteId, note.currentVersion).title;
    note.updatedAt = this.now();
    return { noteId, currentVersion: note.currentVersion };
  }

  async redo(noteId) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    const children = this.getVersions(noteId).filter((entry) => entry.parentVersion === note.currentVersion);

    if (!children.length) {
      const error = new Error("Cannot redo because no child version exists");
      error.status = 409;
      throw error;
    }

    if (children.length > 1) {
      const error = new Error("Cannot redo because multiple branches exist");
      error.status = 409;
      throw error;
    }

    note.currentVersion = children[0].version;
    note.title = children[0].title;
    note.updatedAt = this.now();
    return { noteId, currentVersion: note.currentVersion };
  }

  async restoreVersion(noteId, versionNumber) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    const restored = this.getVersionEntry(noteId, versionNumber);
    assert.ok(restored, "version should exist");
    const parentVersion = note.currentVersion;

    const nextVersion = note.latestVersion + 1;
    const timestamp = this.now();

    this.getVersions(noteId).push({
      noteId,
      version: nextVersion,
      title: restored.title,
      content: restored.content,
      editedAt: timestamp,
      source: "restore",
      parentVersion,
      restoredFromVersion: versionNumber
    });

    note.title = restored.title;
    note.currentVersion = nextVersion;
    note.latestVersion = nextVersion;
    note.updatedAt = timestamp;

    return {
      noteId,
      currentVersion: nextVersion,
      parentVersion,
      restoredFromVersion: versionNumber
    };
  }
}

test("handleApiRequest supports append-only tree history and branch navigation", async () => {
  const store = new MemoryNoteStore();

  const created = await handleApiRequest({
    method: "POST",
    pathname: "/api/notes",
    body: { title: "Draft", content: "v1 body" },
    store
  });
  assert.equal(created.statusCode, 201);

  const noteId = created.body.noteId;

  const updated = await handleApiRequest({
    method: "PUT",
    pathname: `/api/notes/${noteId}`,
    body: {
      title: "Draft revised",
      content: "v2 body",
      expectedCurrentVersion: 1
    },
    store
  });
  assert.equal(updated.body.currentVersion, 2);
  assert.equal(updated.body.parentVersion, 1);

  const reopenedRoot = await handleApiRequest({
    method: "POST",
    pathname: `/api/notes/${noteId}/current/1`,
    store
  });
  assert.equal(reopenedRoot.body.currentVersion, 1);

  const forked = await handleApiRequest({
    method: "PUT",
    pathname: `/api/notes/${noteId}`,
    body: {
      title: "Forked draft",
      content: "v3 fork body",
      expectedCurrentVersion: 1
    },
    store
  });
  assert.equal(forked.body.currentVersion, 3);
  assert.equal(forked.body.parentVersion, 1);

  const undone = await handleApiRequest({
    method: "POST",
    pathname: `/api/notes/${noteId}/undo`,
    store
  });
  assert.equal(undone.body.currentVersion, 1);

  await assert.rejects(
    () =>
      handleApiRequest({
        method: "POST",
        pathname: `/api/notes/${noteId}/redo`,
        store
      }),
    (error) => error.status === 409 && error.message === "Cannot redo because multiple branches exist"
  );

  const openedBranch = await handleApiRequest({
    method: "POST",
    pathname: `/api/notes/${noteId}/current/2`,
    store
  });
  assert.equal(openedBranch.body.currentVersion, 2);

  const restored = await handleApiRequest({
    method: "POST",
    pathname: `/api/notes/${noteId}/restore/1`,
    store
  });
  assert.equal(restored.body.currentVersion, 4);
  assert.equal(restored.body.parentVersion, 2);
  assert.equal(restored.body.restoredFromVersion, 1);

  const versions = await handleApiRequest({
    method: "GET",
    pathname: `/api/notes/${noteId}/versions`,
    store
  });
  assert.deepEqual(
    versions.body.versions.map((entry) => ({
      version: entry.version,
      source: entry.source,
      parentVersion: entry.parentVersion,
      restoredFromVersion: entry.restoredFromVersion,
      childCount: entry.childCount,
      isCurrent: entry.isCurrent
    })),
    [
      { version: 4, source: "restore", parentVersion: 2, restoredFromVersion: 1, childCount: 0, isCurrent: true },
      { version: 3, source: "edit", parentVersion: 1, restoredFromVersion: null, childCount: 0, isCurrent: false },
      { version: 2, source: "edit", parentVersion: 1, restoredFromVersion: null, childCount: 1, isCurrent: false },
      { version: 1, source: "create", parentVersion: null, restoredFromVersion: null, childCount: 2, isCurrent: false }
    ]
  );

  const currentVersion = await handleApiRequest({
    method: "GET",
    pathname: `/api/notes/${noteId}/versions/4`,
    store
  });
  assert.equal(currentVersion.body.isCurrent, true);
  assert.equal(currentVersion.body.content, "v1 body");
  assert.equal(currentVersion.body.parentVersion, 2);
  assert.equal(currentVersion.body.restoredFromVersion, 1);
});

test("handleApiRequest validates bad inputs and paths", async () => {
  const store = new MemoryNoteStore();

  await assert.rejects(
    () =>
      handleApiRequest({
        method: "POST",
        pathname: "/api/notes",
        body: { title: "   ", content: "" },
        store
      }),
    (error) => error.status === 400 && error.message === "Title is required"
  );

  await assert.rejects(
    () =>
      handleApiRequest({
        method: "GET",
        pathname: "/api/notes/example/versions/not-a-number",
        store
      }),
    (error) => error.status === 400 && error.message === "Version must be a positive integer"
  );

  await assert.rejects(
    () =>
      handleApiRequest({
        method: "GET",
        pathname: "/api/missing",
        store
      }),
    (error) => error.status === 404 && error.message === "Route not found"
  );
});

test("handleApiRequest rejects invalid tree navigation and version conflicts", async () => {
  const store = new MemoryNoteStore();

  const created = await handleApiRequest({
    method: "POST",
    pathname: "/api/notes",
    body: { title: "Draft", content: "v1 body" },
    store
  });

  const noteId = created.body.noteId;

  await assert.rejects(
    () =>
      handleApiRequest({
        method: "POST",
        pathname: `/api/notes/${noteId}/undo`,
        store
      }),
    (error) => error.status === 409 && error.message === "Cannot undo because this version has no parent"
  );

  await assert.rejects(
    () =>
      handleApiRequest({
        method: "POST",
        pathname: `/api/notes/${noteId}/redo`,
        store
      }),
    (error) => error.status === 409 && error.message === "Cannot redo because no child version exists"
  );

  await assert.rejects(
    () =>
      handleApiRequest({
        method: "PUT",
        pathname: `/api/notes/${noteId}`,
        body: {
          title: "Wrong version",
          content: "oops",
          expectedCurrentVersion: 2
        },
        store
      }),
    (error) => error.status === 409 && error.message === "Version mismatch"
  );

  await assert.rejects(
    () =>
      handleApiRequest({
        method: "POST",
        pathname: `/api/notes/${noteId}/current/99`,
        store
      }),
    (error) => error.status === 404 && error.message === "Version not found"
  );
});

test("D1NoteStore.init retries after a failed schema attempt", async () => {
  let runCount = 0;
  let shouldFail = true;

  const db = {
    prepare(statement) {
      return {
        async all() {
          if (statement === "PRAGMA table_info(note_versions)") {
            return { results: [] };
          }

          return { results: [] };
        },
        async run() {
          runCount += 1;
          if (statement.includes("CREATE TABLE IF NOT EXISTS notes") && shouldFail) {
            shouldFail = false;
            throw new Error("init failed");
          }
        }
      };
    }
  };

  const store = new D1NoteStore(db);

  await assert.rejects(() => store.init(), /init failed/);
  await assert.doesNotReject(() => store.init());
  assert.ok(runCount > 1);
});

test("D1NoteStore.updateNote reports guarded zero-row updates as conflicts", async () => {
  const db = {
    prepare(statement) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (statement.includes("FROM notes") && statement.includes("WHERE note_id = ?")) {
            return {
              noteId: "note-1",
              title: "Draft",
              currentVersion: 1,
              latestVersion: 1,
              createdAt: "2026-03-21T00:00:00.000Z",
              updatedAt: "2026-03-21T00:00:00.000Z"
            };
          }
          return null;
        },
        async run() {
          return { meta: { changes: 1 } };
        }
      };
    },
    async batch() {
      return [{ meta: { changes: 1 } }, { meta: { changes: 0 } }];
    }
  };

  const store = new D1NoteStore(db);

  await assert.rejects(
    () =>
      store.updateNote("note-1", {
        title: "Remote collision",
        content: "body",
        expectedCurrentVersion: 1
      }),
    (error) => error.status === 409 && error.message === "Version mismatch"
  );
});
