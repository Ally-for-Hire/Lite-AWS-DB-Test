# Versioned Notes

The primary deployment target is now Cloudflare Workers with persistent state in D1, deployed with Wrangler and ready for GitHub-based deployment.

## Repo Layout
- `apps/web/` - static frontend served by the Worker as assets
- `apps/worker/` - Cloudflare Worker entrypoint and D1-backed persistence
- `apps/api/` - shared route logic plus a local Node server for development and tests
- `docs/` - architecture, API spec, and implementation notes
- `infra/` - deployment notes
- `.github/workflows/` - GitHub deployment workflow

## Local Development
Run the local Node app:
```bash
npm start
```

Run the Worker locally with Wrangler:
```bash
npm run dev
```

Run tests:
```bash
npm test
```

Apply local D1 migrations:
```bash
npm run cf:migrate:local
```

## Cloudflare Deploy
Manual deploy:
```bash
npm run deploy
```

That deploys the Worker and then applies remote D1 migrations.

Wrangler config lives in:
- `wrangler.jsonc`

D1 schema lives in:
- `apps/worker/migrations/0001_init.sql`

## GitHub Deploy
This repo includes:
- `.github/workflows/deploy-worker.yml`

Required repository secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The workflow runs:
1. `npx wrangler deploy`
2. `npx wrangler d1 migrations apply versioned-notes-db --remote`

## Persistent State
Persistent state is backed by Cloudflare D1 through:
- `apps/worker/src/d1NoteStore.js`

The Worker also ensures the schema exists on first API use, which makes the first deploy less brittle when D1 is newly provisioned.

## Review Patches
Patched findings relevant to the new target:
1. Removed environment-specific source mutation from the deploy flow.
2. Added a real Worker + D1 persistent-state path.
3. Added a GitHub workflow that deploys through Wrangler.
4. Separated historical preview from the editor so the UI state is clearer.

## Documentation
- `docs/architecture.md`
- `docs/api-spec.md`
- `docs/implementation-plan.md`
