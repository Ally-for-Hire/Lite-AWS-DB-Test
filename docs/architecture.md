# Architecture — Versioned Notes with Perfect Undo

## 1) High-Level Design

Client (S3 static site) -> API Gateway -> Lambda -> DynamoDB

No in-place updates to historical content. Versions are append-only.

## 2) Data Model (DynamoDB)

Use single-table design (simple but scalable): `NotesApp`

### Item types

### A) Note Metadata (current pointer)
- `PK = NOTE#<noteId>`
- `SK = META`
- `title`
- `currentVersion` (number)
- `createdAt`
- `updatedAt`

### B) Note Version (append-only)
- `PK = NOTE#<noteId>`
- `SK = VER#<zeroPaddedVersion>`
- `version` (number)
- `title`
- `content`
- `editedAt`
- `editedBy` (optional)
- `source` (`edit | restore | undo | redo`)
- `baseVersion` (optional)

### C) Optional Action Log (audit)
- `PK = NOTE#<noteId>`
- `SK = ACT#<timestamp>#<uuid>`
- `actionType`
- `fromVersion`
- `toVersion`
- `at`

## 3) Undo/Redo Semantics

### Undo
- Read `META.currentVersion = N`
- If `N > 1`, set `currentVersion = N - 1`
- Do not delete version `N`

### Redo
- Read `META.currentVersion = N`
- If version `N + 1` exists, set pointer to `N + 1`

### Restore old version
- Read selected version `K`
- Create new version `N+1` copying content from `K`
- Set `currentVersion = N + 1`
- Keeps immutable history and user intent trace

## 4) Concurrency Safety

Use DynamoDB conditional updates for pointer changes:
- Example: update `currentVersion` only if existing value matches expected version
- Prevents race conditions when two edits arrive at once

## 5) API Shape

See `api-spec.md`.

Core routes:
- `POST /notes`
- `GET /notes/{id}`
- `PUT /notes/{id}` (creates new version)
- `GET /notes/{id}/versions`
- `POST /notes/{id}/undo`
- `POST /notes/{id}/redo`
- `POST /notes/{id}/restore/{version}`

## 6) Frontend MVP

Single-page app with:
- Notes list
- Editor panel
- Save button
- History panel (version list)
- Undo / Redo / Restore buttons

## 7) Cost Controls

- HTTP API (not REST API) for lower cost
- Minimal Lambda memory and timeout
- CloudWatch retention 7 days
- Billing alarm at a very low threshold
- Avoid heavy polling; fetch on demand

## 8) Future Extensions

- Cognito auth
- Rich diffs between versions
- Soft delete + recycle bin
- Sharing/collaboration
- Export/import notes
