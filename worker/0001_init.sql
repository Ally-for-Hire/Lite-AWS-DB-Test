CREATE TABLE IF NOT EXISTS notes (
  note_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  latest_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS note_versions (
  note_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  edited_at TEXT NOT NULL,
  source TEXT NOT NULL,
  base_version INTEGER,
  PRIMARY KEY (note_id, version),
  FOREIGN KEY (note_id) REFERENCES notes(note_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_versions_note_id_version ON note_versions(note_id, version DESC);
