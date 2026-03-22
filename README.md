# Versioned Notes

Minimal Cloudflare Worker app for versioned notes.

## Quickstart

```bash
npm install
npm start
```

Open `http://127.0.0.1:8787`.

Create a note in the left panel, select it, edit it, and click `Save Version`.
`Undo` and `Redo` move between saved versions.
`Restore` turns an old version into the newest one.

## Files

- `apps/web/` frontend
- `apps/worker/src/index.js` Worker entrypoint
- `apps/worker/src/api.js` routes and validation
- `apps/worker/src/noteStore.js` D1 note storage
- `apps/worker/migrations/0001_init.sql` D1 schema
- `wrangler.jsonc` Cloudflare config
