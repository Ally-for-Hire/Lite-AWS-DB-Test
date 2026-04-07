# Versioned Notes

A small notes application built with Cloudflare Workers and D1.

## Quickstart

```bash
npm install
npm start
```

Open `http://127.0.0.1:8787`.

## Tests

Unit and browser tests both run through:

```bash
npx playwright install chromium
npm test
```

This runs:

- `npm run test:unit` for API and storage tests
- `npm run test:e2e` for Playwright browser coverage against a local Wrangler instance
- `npm run smoke:live` for a minimal post-deploy check against the live site

Basic workflow:

- Create a note
- Select it from the list
- Edit the current version
- Save a new version
- Use Undo, Redo, or Restore to move through note history

## Project Structure

- `web/index.html` entire frontend
- `worker/index.js` entire Worker and storage logic
- `worker/0001_init.sql` initial D1 migration
- `wrangler.jsonc` Cloudflare and Wrangler configuration

## Cloudflare Flow

Wrangler is the command-line tool used to run and deploy the app.

- `npm start` runs `wrangler dev`
- Wrangler reads `wrangler.jsonc`
- `main` points to `worker/index.js`
- `assets.directory` points to `web/`
- `d1_databases` binds the D1 database to `env.DB`

At runtime:

- Requests to `/api/*` go to the Worker
- Non-API requests are served from the static files in `web/`
- The Worker uses `env.DB` to read and write note data in D1

For deployment:

- `npm run deploy` publishes the Worker and static assets
- `npm run migrate` applies the numbered migration files in `worker/` to the remote D1 database

## GitHub Actions

This repo includes:

- `.github/workflows/ci.yml` to run tests on pull requests and non-`main` pushes
- `.github/workflows/deploy.yml` to test, deploy, and apply migrations on pushes to `main`

Required GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Persistence

Production data lives in the remote Cloudflare D1 database identified by `database_id` in `wrangler.jsonc`.

- Deploying the Worker does not delete D1 data
- Notes and versions stay in D1 between deploys and restarts
- `npm run migrate` only applies new numbered SQL migrations, which is the intended path for schema changes
