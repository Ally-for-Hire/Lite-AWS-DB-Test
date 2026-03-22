const apiBase = "/api";

const state = {
  noteId: null,
  note: null,
  notes: [],
  versions: [],
  toastTimer: null
};

const el = {
  createForm: document.querySelector("#create-form"),
  newTitle: document.querySelector("#new-title"),
  newContent: document.querySelector("#new-content"),
  reload: document.querySelector("#reload"),
  notesCount: document.querySelector("#notes-count"),
  notesEmpty: document.querySelector("#notes-empty"),
  notesList: document.querySelector("#notes-list"),
  editorTitleLabel: document.querySelector("#editor-title-label"),
  editorStatus: document.querySelector("#editor-status"),
  editorForm: document.querySelector("#editor-form"),
  editorTitle: document.querySelector("#editor-title"),
  editorContent: document.querySelector("#editor-content"),
  save: document.querySelector("#save"),
  undo: document.querySelector("#undo"),
  redo: document.querySelector("#redo"),
  versionsCount: document.querySelector("#versions-count"),
  versionsEmpty: document.querySelector("#versions-empty"),
  versionsList: document.querySelector("#versions-list"),
  message: document.querySelector("#message")
};

async function api(path, options) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function showMessage(text) {
  clearTimeout(state.toastTimer);
  el.message.textContent = text;
  el.message.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    el.message.hidden = true;
  }, 2000);
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function setEditorDisabled(disabled) {
  el.editorTitle.disabled = disabled;
  el.editorContent.disabled = disabled;
  el.save.disabled = disabled;

  if (disabled) {
    el.undo.disabled = true;
    el.redo.disabled = true;
  }
}

function syncActions() {
  if (!state.note) {
    el.undo.disabled = true;
    el.redo.disabled = true;
    return;
  }

  el.undo.disabled = state.note.currentVersion <= 1;
  el.redo.disabled = state.note.currentVersion >= state.note.latestVersion;
}

function renderNotes() {
  el.notesList.innerHTML = "";
  el.notesCount.textContent = String(state.notes.length);
  el.notesEmpty.hidden = state.notes.length > 0;

  state.notes.forEach((note) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `note-row${note.noteId === state.noteId ? " active" : ""}`;
    row.innerHTML = `
      <div class="note-main">
        <strong>${escapeHtml(note.title)}</strong>
        <span class="muted">v${note.currentVersion} • ${escapeHtml(formatDate(note.updatedAt))}</span>
      </div>
    `;
    row.addEventListener("click", () => {
      void selectNote(note.noteId);
    });
    el.notesList.appendChild(row);
  });
}

function renderEditor() {
  if (!state.note) {
    el.editorTitleLabel.textContent = "Editor";
    el.editorStatus.textContent = "No note selected";
    el.editorTitle.value = "";
    el.editorContent.value = "";
    setEditorDisabled(true);
    return;
  }

  el.editorTitleLabel.textContent = state.note.title;
  el.editorStatus.textContent = `Current version: ${state.note.currentVersion}`;
  el.editorTitle.value = state.note.title;
  el.editorContent.value = state.note.content;
  setEditorDisabled(false);
  syncActions();
}

function renderVersions() {
  el.versionsList.innerHTML = "";
  el.versionsCount.textContent = String(state.versions.length);
  el.versionsEmpty.hidden = state.versions.length > 0;

  state.versions.forEach((version) => {
    const row = document.createElement("div");
    row.className = "version-row";

    const restoreDisabled = !state.note || version.version === state.note.currentVersion;

    row.innerHTML = `
      <div class="version-main">
        <strong>Version ${version.version}</strong>
        <span>${escapeHtml(version.title)}</span>
        <div class="version-meta">
          <span>${escapeHtml(version.source)}</span>
          <span>${escapeHtml(formatDate(version.editedAt))}</span>
        </div>
      </div>
      <div class="actions">
        <button class="preview-button" type="button">Preview</button>
        <button class="restore-button" type="button" ${restoreDisabled ? "disabled" : ""}>Restore</button>
      </div>
    `;

    row.querySelector(".preview-button").addEventListener("click", async () => {
      try {
        const preview = await api(`/notes/${state.noteId}/versions/${version.version}`);
        el.editorTitle.value = preview.title;
        el.editorContent.value = preview.content;
        el.editorStatus.textContent = `Previewing version: ${preview.version}`;
        showMessage(`Previewed version ${preview.version}`);
      } catch (error) {
        showMessage(error.message);
      }
    });

    row.querySelector(".restore-button").addEventListener("click", async () => {
      try {
        await api(`/notes/${state.noteId}/restore/${version.version}`, { method: "POST" });
        await refresh();
        await selectNote(state.noteId);
        showMessage(`Restored version ${version.version}`);
      } catch (error) {
        showMessage(error.message);
      }
    });

    el.versionsList.appendChild(row);
  });
}

async function refresh() {
  const data = await api("/notes");
  state.notes = data.notes;
  renderNotes();

  if (!state.notes.length) {
    state.noteId = null;
    state.note = null;
    state.versions = [];
    renderEditor();
    renderVersions();
    return;
  }

  if (!state.notes.some((note) => note.noteId === state.noteId)) {
    await selectNote(state.notes[0].noteId);
  }
}

async function selectNote(noteId) {
  state.noteId = noteId;
  state.note = await api(`/notes/${noteId}`);
  const versions = await api(`/notes/${noteId}/versions`);
  state.versions = versions.versions;
  renderNotes();
  renderEditor();
  renderVersions();
}

async function createNote(event) {
  event.preventDefault();

  try {
    const created = await api("/notes", {
      method: "POST",
      body: JSON.stringify({
        title: el.newTitle.value,
        content: el.newContent.value
      })
    });
    el.createForm.reset();
    await refresh();
    await selectNote(created.noteId);
    showMessage("Note created");
  } catch (error) {
    showMessage(error.message);
  }
}

async function saveNote(event) {
  event.preventDefault();

  if (!state.note) {
    return;
  }

  try {
    await api(`/notes/${state.noteId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: el.editorTitle.value,
        content: el.editorContent.value,
        expectedCurrentVersion: state.note.currentVersion
      })
    });
    await refresh();
    await selectNote(state.noteId);
    showMessage("Saved");
  } catch (error) {
    showMessage(error.message);
  }
}

async function movePointer(action) {
  if (!state.noteId) {
    return;
  }

  try {
    await api(`/notes/${state.noteId}/${action}`, { method: "POST" });
    await refresh();
    await selectNote(state.noteId);
    showMessage(action);
  } catch (error) {
    showMessage(error.message);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

el.createForm.addEventListener("submit", createNote);
el.editorForm.addEventListener("submit", saveNote);
el.reload.addEventListener("click", () => {
  void refresh().catch((error) => showMessage(error.message));
});
el.undo.addEventListener("click", () => {
  void movePointer("undo");
});
el.redo.addEventListener("click", () => {
  void movePointer("redo");
});

setEditorDisabled(true);
void refresh().catch((error) => showMessage(error.message));
