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

- `web/` frontend
- `worker/index.js` Worker entrypoint
- `worker/api.js` routes and validation
- `worker/noteStore.js` D1 note storage
- `worker/schema.sql` D1 schema
- `wrangler.jsonc` Cloudflare config

## Cloudflare Flow

Wrangler is the local and deploy tool for Cloudflare Workers.

- `npm start` runs `wrangler dev`
- Wrangler reads `wrangler.jsonc`
- `main` points to `worker/index.js`
- `assets.directory` points to `web/`
- `d1_databases` binds the D1 database to `env.DB`

At runtime:

- requests to `/api/*` go to the Worker code
- non-API requests are served from the static files in `web/`
- the Worker uses `env.DB` to read and write note data in D1

For deployment:

- `npm run deploy` publishes the Worker and static assets
- `npm run migrate` applies `worker/schema.sql` to the remote D1 database
