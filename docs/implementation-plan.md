# Implementation Plan

## Phase 0 — Project bootstrap (Day 0)
- Decide IaC tool: SAM (recommended for speed) or CDK
- Create repo structure:
  - `/frontend`
  - `/backend`
  - `/infra`
- Configure AWS profile and region
- Create billing alarm + budget first

## Phase 1 — Backend MVP (Day 1)
- Create DynamoDB table `NotesApp`
- Build Lambda handlers:
  - createNote
  - getNote
  - updateNote (new version)
  - listVersions
  - undo
  - redo
  - restoreVersion
- Add API Gateway routes + CORS
- Validate with Postman/curl

## Phase 2 — Frontend MVP (Day 2)
- Simple static app (vanilla/React)
- Connect to API base URL
- Implement core UX:
  - create/select note
  - edit/save
  - show history
  - undo/redo/restore actions

## Phase 3 — Hardening (Day 3)
- Add input validation (max title/content sizes)
- Add error handling with clear messages
- Add basic integration tests for version logic
- Add optimistic concurrency checks

## Phase 4 — Deployment & docs (Day 3-4)
- Deploy backend stack
- Deploy frontend to S3
- Document setup and environment variables
- Add architecture and API diagrams

## Definition of Done (MVP)
- A user can create and edit notes
- Each save creates immutable version records
- Undo/redo works reliably by version pointer
- Restore creates a new head version from historical data
- App runs in AWS Free Tier footprint
