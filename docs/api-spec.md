# API Spec

Base URL: `/api`

## GET /notes
List notes for the frontend note picker.

Response 200:
```json
{
  "notes": [
    {
      "noteId": "uuid",
      "title": "My Note",
      "currentVersion": 3,
      "updatedAt": "2026-03-10T18:00:00Z"
    }
  ]
}
```

## POST /notes
Create a note.

Request:
```json
{ "title": "My Note", "content": "Hello" }
```

Response 201:
```json
{
  "noteId": "uuid",
  "currentVersion": 1,
  "title": "My Note",
  "content": "Hello"
}
```

## GET /notes/{noteId}
Get the current note snapshot.

Response 200:
```json
{
  "noteId": "uuid",
  "title": "My Note",
  "content": "Hello",
  "currentVersion": 3,
  "updatedAt": "2026-03-10T18:00:00Z"
}
```

## PUT /notes/{noteId}
Create a new version from updated content.

Request:
```json
{
  "title": "My Note v2",
  "content": "Updated text",
  "expectedCurrentVersion": 3
}
```

Response 200:
```json
{
  "noteId": "uuid",
  "currentVersion": 4
}
```

## GET /notes/{noteId}/versions
List versions in newest-first order.

Response 200:
```json
{
  "versions": [
    { "version": 4, "editedAt": "...", "source": "edit" },
    { "version": 3, "editedAt": "...", "source": "restore" }
  ]
}
```

## GET /notes/{noteId}/versions/{version}
Get a specific historical version.

## POST /notes/{noteId}/undo
Move the current pointer from `N` to `N - 1` when possible.

Response 200:
```json
{ "noteId": "uuid", "currentVersion": 3 }
```

## POST /notes/{noteId}/redo
Move the current pointer from `N` to `N + 1` when possible.

## POST /notes/{noteId}/restore/{version}
Copy a historical version into a new head version.

Response 200:
```json
{ "noteId": "uuid", "currentVersion": 7, "restoredFrom": 2 }
```

## GET /health
Simple health check for local verification.

Response 200:
```json
{ "ok": true }
```

## Error Model
```json
{ "error": "Conflict", "message": "Version mismatch" }
```

Common statuses:
- `400` validation
- `404` note or version not found
- `409` expected version mismatch or invalid undo/redo state
- `500` internal error
