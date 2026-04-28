ALTER TABLE note_versions ADD COLUMN parent_version INTEGER;
ALTER TABLE note_versions ADD COLUMN restored_from_version INTEGER;

UPDATE note_versions
SET parent_version = base_version
WHERE parent_version IS NULL AND source = 'edit';

UPDATE note_versions
SET restored_from_version = base_version
WHERE restored_from_version IS NULL AND source = 'restore';

CREATE INDEX IF NOT EXISTS idx_note_versions_note_id_parent_version
ON note_versions(note_id, parent_version, version DESC);
