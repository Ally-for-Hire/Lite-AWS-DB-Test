const state = {
  notes: [],
  currentNoteId: null,
  currentNote: null,
  versions: [],
  previewVersion: null,
  toastTimer: null
};

const API_BASE_URL = String(window.APP_CONFIG?.API_BASE_URL || "/api").replace(/\/+$/, "");

const elements = {
  createForm: document.querySelector("#create-form"),
  newTitle: document.querySelector("#new-title"),
  newContent: document.querySelector("#new-content"),
  refreshNotes: document.querySelector("#refresh-notes"),
  notesList: document.querySelector("#notes-list"),
  notesEmpty: document.querySelector("#notes-empty"),
  notesCount: document.querySelector("#notes-count"),
  versionsCount: document.querySelector("#versions-count"),
  editorHeading: document.querySelector("#editor-heading"),
  noteStatus: document.querySelector("#note-status"),
  editorForm: document.querySelector("#editor-form"),
  editorTitle: document.querySelector("#editor-title"),
  editorContent: document.querySelector("#editor-content"),
  saveNote: document.querySelector("#save-note"),
  undoNote: document.querySelector("#undo-note"),
  redoNote: document.querySelector("#redo-note"),
  refreshHistory: document.querySelector("#refresh-history"),
  historyList: document.querySelector("#history-list"),
  historyEmpty: document.querySelector("#history-empty"),
  previewLabel: document.querySelector("#preview-label"),
  previewEmpty: document.querySelector("#preview-empty"),
  previewBody: document.querySelector("#preview-body"),
  previewTitle: document.querySelector("#preview-title"),
  previewMeta: document.querySelector("#preview-meta"),
  previewContent: document.querySelector("#preview-content"),
  toast: document.querySelector("#toast")
};

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "Request failed");
  }

  return payload;
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2400);
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function formatSourceLabel(value) {
  if (!value) {
    return "Version";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function setCounts() {
  elements.notesCount.textContent = String(state.notes.length);
  elements.versionsCount.textContent = state.currentNote ? String(state.versions.length) : "0";
}

function setEditorEnabled(enabled) {
  elements.editorTitle.disabled = !enabled;
  elements.editorContent.disabled = !enabled;
  elements.saveNote.disabled = !enabled;
  elements.undoNote.disabled = !enabled;
  elements.redoNote.disabled = !enabled;
  elements.refreshHistory.disabled = !enabled;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderNotes() {
  elements.notesList.innerHTML = "";
  elements.notesEmpty.hidden = state.notes.length > 0;
  setCounts();

  state.notes.forEach((note) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "note-item";

    if (note.noteId === state.currentNoteId) {
      button.classList.add("is-active");
    }

    button.innerHTML = `
      <div class="note-item__head">
        <div>
          <p class="note-item__eyebrow">Current head</p>
          <h3>${escapeHtml(note.title)}</h3>
        </div>
        <span class="meta-chip meta-chip--accent">v${note.currentVersion}</span>
      </div>
      <div class="meta-row">
        <span>Updated ${escapeHtml(formatDate(note.updatedAt))}</span>
      </div>
    `;

    button.addEventListener("click", () => {
      void selectNote(note.noteId);
    });

    elements.notesList.appendChild(button);
  });
}

function renderEditor() {
  const note = state.currentNote;

  if (!note) {
    elements.editorHeading.textContent = "Select a note";
    elements.noteStatus.textContent = "No note selected";
    elements.editorTitle.value = "";
    elements.editorContent.value = "";
    setEditorEnabled(false);
    return;
  }

  elements.editorHeading.textContent = note.title;
  elements.noteStatus.textContent = `Current version v${note.currentVersion}`;
  elements.editorTitle.value = note.title;
  elements.editorContent.value = note.content;
  setEditorEnabled(true);
}

function renderPreview() {
  const preview = state.previewVersion;

  if (!preview) {
    elements.previewLabel.textContent = "No preview";
    elements.previewEmpty.hidden = false;
    elements.previewBody.hidden = true;
    elements.previewTitle.textContent = "";
    elements.previewMeta.textContent = "";
    elements.previewContent.textContent = "";
    return;
  }

  elements.previewLabel.textContent = `Preview v${preview.version}`;
  elements.previewEmpty.hidden = true;
  elements.previewBody.hidden = false;
  elements.previewTitle.textContent = preview.title;
  elements.previewMeta.textContent = `${formatSourceLabel(preview.source)} | ${formatDate(preview.editedAt)}`;
  elements.previewContent.textContent = preview.content || "(No content)";
}

function renderHistory() {
  elements.historyList.innerHTML = "";
  elements.historyEmpty.hidden = state.versions.length > 0;
  setCounts();

  state.versions.forEach((entry) => {
    const container = document.createElement("article");
    container.className = "history-item";

    if (state.currentNote && entry.version === state.currentNote.currentVersion) {
      container.classList.add("is-current");
    }

    const restoreDisabled = !state.currentNote || entry.version === state.currentNote.currentVersion;

    container.innerHTML = `
      <div class="history-topline">
        <div>
          <h3>Version ${entry.version}</h3>
          <p class="history-subtitle">${escapeHtml(entry.title)}</p>
        </div>
        <span class="source-badge">${escapeHtml(formatSourceLabel(entry.source))}</span>
      </div>
      <div class="meta-row">
        <span>${escapeHtml(formatDate(entry.editedAt))}</span>
        ${entry.baseVersion ? `<span>Base v${entry.baseVersion}</span>` : ""}
      </div>
      <div class="history-actions">
        <button class="button button--ghost history-preview" type="button">Preview</button>
        <button class="button history-restore" type="button" ${restoreDisabled ? "disabled" : ""}>Restore</button>
      </div>
    `;

    container.querySelector(".history-preview").addEventListener("click", async () => {
      try {
        state.previewVersion = await api(`/notes/${state.currentNoteId}/versions/${entry.version}`);
        renderPreview();
        showToast(`Loaded version ${entry.version} into preview`);
      } catch (error) {
        showToast(error.message);
      }
    });

    container.querySelector(".history-restore").addEventListener("click", () => {
      void restoreVersion(entry.version);
    });

    elements.historyList.appendChild(container);
  });
}

async function refreshNotes() {
  const data = await api("/notes");
  state.notes = data.notes;
  renderNotes();
}

async function loadHistory() {
  if (!state.currentNoteId) {
    state.versions = [];
    state.previewVersion = null;
    renderPreview();
    renderHistory();
    return;
  }

  const data = await api(`/notes/${state.currentNoteId}/versions`);
  state.versions = data.versions;
  renderHistory();
}

async function selectNote(noteId) {
  state.currentNoteId = noteId;
  state.currentNote = await api(`/notes/${noteId}`);
  state.previewVersion = null;
  renderPreview();
  renderNotes();
  renderEditor();
  await loadHistory();
}

async function createNote(event) {
  event.preventDefault();

  try {
    const created = await api("/notes", {
      method: "POST",
      body: JSON.stringify({
        title: elements.newTitle.value,
        content: elements.newContent.value
      })
    });

    elements.createForm.reset();
    await refreshNotes();
    await selectNote(created.noteId);
    showToast("Note created");
  } catch (error) {
    showToast(error.message);
  }
}

async function saveNote(event) {
  event.preventDefault();

  if (!state.currentNote) {
    return;
  }

  try {
    await api(`/notes/${state.currentNoteId}`, {
      method: "PUT",
      body: JSON.stringify({
        title: elements.editorTitle.value,
        content: elements.editorContent.value,
        expectedCurrentVersion: state.currentNote.currentVersion
      })
    });

    await refreshNotes();
    await selectNote(state.currentNoteId);
    showToast("Saved as a new version");
  } catch (error) {
    showToast(error.message);
  }
}

async function movePointer(action) {
  if (!state.currentNoteId) {
    return;
  }

  try {
    await api(`/notes/${state.currentNoteId}/${action}`, {
      method: "POST"
    });

    await refreshNotes();
    await selectNote(state.currentNoteId);
    showToast(action === "undo" ? "Moved back one version" : "Moved forward one version");
  } catch (error) {
    showToast(error.message);
  }
}

async function restoreVersion(versionNumber) {
  if (!state.currentNoteId) {
    return;
  }

  try {
    await api(`/notes/${state.currentNoteId}/restore/${versionNumber}`, {
      method: "POST"
    });

    await refreshNotes();
    await selectNote(state.currentNoteId);
    showToast(`Restored version ${versionNumber} as a new head`);
  } catch (error) {
    showToast(error.message);
  }
}

elements.createForm.addEventListener("submit", createNote);
elements.editorForm.addEventListener("submit", saveNote);
elements.refreshNotes.addEventListener("click", () => {
  void refreshNotes().catch((error) => showToast(error.message));
});
elements.refreshHistory.addEventListener("click", () => {
  void loadHistory().catch((error) => showToast(error.message));
});
elements.undoNote.addEventListener("click", () => {
  void movePointer("undo");
});
elements.redoNote.addEventListener("click", () => {
  void movePointer("redo");
});

setEditorEnabled(false);
renderPreview();
setCounts();

void refreshNotes().catch((error) => showToast(error.message));
