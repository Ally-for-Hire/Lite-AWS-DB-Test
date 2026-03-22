import test from "node:test";
import assert from "node:assert/strict";

import { handleApiRequest } from "../src/api.js";
import { D1NoteStore } from "../src/noteStore.js";

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
        baseVersion: null
      }
    ]);

    return { noteId, currentVersion: 1, title, content };
  }

  async getNote(noteId) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    const version = this.getVersions(noteId).find((entry) => entry.version === note.currentVersion);

    return {
      noteId,
      title: version.title,
      content: version.content,
      currentVersion: note.currentVersion,
      latestVersion: note.latestVersion,
      updatedAt: note.updatedAt
    };
  }

  async updateNote(noteId, { title, content, expectedCurrentVersion }) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    assert.equal(note.currentVersion, expectedCurrentVersion, "version mismatch in test store");

    const nextVersion = note.latestVersion + 1;
    const timestamp = this.now();
    this.getVersions(noteId).push({
      noteId,
      version: nextVersion,
      title,
      content,
      editedAt: timestamp,
      source: "edit",
      baseVersion: expectedCurrentVersion
    });

    note.title = title;
    note.currentVersion = nextVersion;
    note.latestVersion = nextVersion;
    note.updatedAt = timestamp;

    return { noteId, currentVersion: nextVersion };
  }

  async listVersions(noteId) {
    return [...this.getVersions(noteId)]
      .sort((left, right) => right.version - left.version)
      .map(({ version, editedAt, source, title, baseVersion }) => ({
        version,
        editedAt,
        source,
        title,
        baseVersion
      }));
  }

  async getVersion(noteId, versionNumber) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    const version = this.getVersions(noteId).find((entry) => entry.version === versionNumber);
    assert.ok(version, "version should exist");
    return { ...version, isCurrent: note.currentVersion === versionNumber };
  }

  async undo(noteId) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    note.currentVersion -= 1;
    note.title = this.getVersions(noteId).find((entry) => entry.version === note.currentVersion).title;
    note.updatedAt = this.now();
    return { noteId, currentVersion: note.currentVersion };
  }

  async redo(noteId) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    note.currentVersion += 1;
    note.title = this.getVersions(noteId).find((entry) => entry.version === note.currentVersion).title;
    note.updatedAt = this.now();
    return { noteId, currentVersion: note.currentVersion };
  }

  async restoreVersion(noteId, versionNumber) {
    const note = this.notes.get(noteId);
    assert.ok(note, "note should exist");
    const restored = this.getVersions(noteId).find((entry) => entry.version === versionNumber);
    assert.ok(restored, "version should exist");

    const nextVersion = note.latestVersion + 1;
    const timestamp = this.now();
    this.getVersions(noteId).push({
      noteId,
      version: nextVersion,
      title: restored.title,
      content: restored.content,
      editedAt: timestamp,
      source: "restore",
      baseVersion: versionNumber
    });

    note.title = restored.title;
    note.currentVersion = nextVersion;
    note.latestVersion = nextVersion;
    note.updatedAt = timestamp;

    return { noteId, currentVersion: nextVersion, restoredFrom: versionNumber };
  }
}

test("handleApiRequest supports create, edit, undo, redo, restore, and version reads", async () => {
  const store = new MemoryNoteStore();

  const created = await handleApiRequest({
    method: "POST",
    pathname: "/api/notes",
    body: { title: "Draft", content: "v1 body" },
    store
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.currentVersion, 1);

  const noteId = created.body.noteId;

  const list = await handleApiRequest({
    method: "GET",
    pathname: "/api/notes",
    store
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.notes.length, 1);

  const firstRead = await handleApiRequest({
    method: "GET",
    pathname: `/api/notes/${noteId}`,
    store
  });
  assert.equal(firstRead.body.latestVersion, 1);

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
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.currentVersion, 2);

  const undone = await handleApiRequest({
    method: "POST",
    pathname: `/api/notes/${noteId}/undo`,
    store
  });
  assert.equal(undone.body.currentVersion, 1);

  const redone = await handleApiRequest({
    method: "POST",
    pathname: `/api/notes/${noteId}/redo`,
    store
  });
  assert.equal(redone.body.currentVersion, 2);

  const restored = await handleApiRequest({
    method: "POST",
    pathname: `/api/notes/${noteId}/restore/1`,
    store
  });
  assert.equal(restored.body.currentVersion, 3);
  assert.equal(restored.body.restoredFrom, 1);

  const versions = await handleApiRequest({
    method: "GET",
    pathname: `/api/notes/${noteId}/versions`,
    store
  });
  assert.deepEqual(
    versions.body.versions.map((entry) => ({
      version: entry.version,
      source: entry.source,
      baseVersion: entry.baseVersion
    })),
    [
      { version: 3, source: "restore", baseVersion: 1 },
      { version: 2, source: "edit", baseVersion: 1 },
      { version: 1, source: "create", baseVersion: null }
    ]
  );

  const currentVersion = await handleApiRequest({
    method: "GET",
    pathname: `/api/notes/${noteId}/versions/3`,
    store
  });
  assert.equal(currentVersion.body.isCurrent, true);
  assert.equal(currentVersion.body.content, "v1 body");
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

test("D1NoteStore.init retries after a failed schema attempt", async () => {
  let runCount = 0;
  let shouldFail = true;

  const db = {
    prepare(statement) {
      return {
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
