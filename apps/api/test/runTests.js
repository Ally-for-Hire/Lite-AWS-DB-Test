import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { JsonNoteStore } from "../src/jsonNoteStore.js";

async function createStore() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lite-aws-db-test-"));
  const store = new JsonNoteStore(path.join(tempDir, "notes.json"));
  await store.init();

  return {
    store,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    }
  };
}

async function runTest(name, callback) {
  try {
    await callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await runTest("create note stores version 1 as the current snapshot", async () => {
  const { store, cleanup } = await createStore();

  try {
    const created = await store.createNote({
      title: "First note",
      content: "hello world"
    });

    assert.equal(created.currentVersion, 1);

    const snapshot = await store.getNote(created.noteId);
    assert.equal(snapshot.title, "First note");
    assert.equal(snapshot.content, "hello world");
    assert.equal(snapshot.currentVersion, 1);
  } finally {
    await cleanup();
  }
});

await runTest("update appends a new immutable version and checks expectedCurrentVersion", async () => {
  const { store, cleanup } = await createStore();

  try {
    const created = await store.createNote({
      title: "Draft",
      content: "one"
    });

    const updated = await store.updateNote(created.noteId, {
      title: "Draft",
      content: "two",
      expectedCurrentVersion: 1
    });

    assert.equal(updated.currentVersion, 2);

    const current = await store.getNote(created.noteId);
    assert.equal(current.content, "two");
    assert.equal(current.currentVersion, 2);

    const original = await store.getVersion(created.noteId, 1);
    assert.equal(original.content, "one");

    await assert.rejects(
      () =>
        store.updateNote(created.noteId, {
          title: "Draft",
          content: "three",
          expectedCurrentVersion: 1
        }),
      /Version mismatch/
    );
  } finally {
    await cleanup();
  }
});

await runTest("undo and redo move the pointer without deleting history", async () => {
  const { store, cleanup } = await createStore();

  try {
    const created = await store.createNote({
      title: "Pointer test",
      content: "v1"
    });

    await store.updateNote(created.noteId, {
      title: "Pointer test",
      content: "v2",
      expectedCurrentVersion: 1
    });

    await store.updateNote(created.noteId, {
      title: "Pointer test",
      content: "v3",
      expectedCurrentVersion: 2
    });

    const undone = await store.undo(created.noteId);
    assert.equal(undone.currentVersion, 2);
    assert.equal((await store.getNote(created.noteId)).content, "v2");

    const redone = await store.redo(created.noteId);
    assert.equal(redone.currentVersion, 3);
    assert.equal((await store.getNote(created.noteId)).content, "v3");

    const versions = await store.listVersions(created.noteId);
    assert.equal(versions.length, 3);
  } finally {
    await cleanup();
  }
});

await runTest("restore copies an old version into a new head version", async () => {
  const { store, cleanup } = await createStore();

  try {
    const created = await store.createNote({
      title: "History",
      content: "alpha"
    });

    await store.updateNote(created.noteId, {
      title: "History",
      content: "beta",
      expectedCurrentVersion: 1
    });

    const restored = await store.restoreVersion(created.noteId, 1);
    assert.equal(restored.currentVersion, 3);
    assert.equal(restored.restoredFrom, 1);

    const current = await store.getNote(created.noteId);
    assert.equal(current.content, "alpha");
    assert.equal(current.currentVersion, 3);

    const headVersion = await store.getVersion(created.noteId, 3);
    assert.equal(headVersion.source, "restore");
    assert.equal(headVersion.baseVersion, 1);
  } finally {
    await cleanup();
  }
});

console.log("All tests passed.");
