# Agent Guide

## Project

Visual Studio is a Cloudflare Pages visual production workspace for ecommerce and brand teams. The user-facing app is a plain HTML/CSS/JavaScript SPA under `public/`; API, storage, auth, queue dispatch, and model orchestration run through Cloudflare Pages Functions plus a separate Queue worker.

Use the current implementation as the source of truth. `README.md`, `wrangler.toml`, `wrangler.queue.toml`, `public/*`, `functions/api/*`, and `functions/_lib/*` are more current than older planning docs under `docs/`.

## Navigation

- `public/`: SPA entry points, admin UI, canvas/AI/batch workflow state, CSS, static assets, and vendored PSD browser bundle.
- `public/styles.css`: shared visual tokens, page layouts, themes, and responsive UI. `public/css/workflows.css` holds upload/result/canvas-object/dialog component geometry; `public/js/workspace-ui.js` holds presentation helpers.
- `functions/api/`: Cloudflare Pages Function route handlers.
- `functions/_lib/`: shared auth, permissions, D1/R2 storage, events, queue dispatch, and job runner logic.
- `functions/_shared.ts`: model relay helpers, env contract, CORS/JSON helpers, timeout/retry normalization, and image task helpers.
- `workers/job-consumer.ts`: Cloudflare Queue consumer, scheduled job recovery, and local queue bridge endpoint.
- `packages/contracts/v2.ts`: shared V2 record and status types.
- `packages/core/`: pure helpers for IDs, crypto, hashing, outfit looks, and AI test prompt expansion.
- `migrations/`: D1 schema migrations. Add new migrations; do not rewrite applied migrations casually.
- `tests/`: Node test suite for routes, job runner, queue behavior, frontend parsing, and workflow contracts.
- `docs/agent-code-map.md`: deeper map for future agents.

## Commands

- Install: `npm install`
- Start Pages locally: `npm run dev`
- Start local queue worker: `npm run dev:queue`
- Start Pages with local queue bridge: `npm run dev:local-queue`
- Check main frontend syntax: `node --check public/app.js`
- Check shared frontend syntax: `node --check public/js/shared.js`
- Check workspace helpers: `node --check public/js/workspace-ui.js`
- Run tests: `node --test tests/*.test.mjs`
- Build Pages Functions: `npx wrangler pages functions build --outdir /tmp/image-translator-functions-check`
- Queue worker dry run: `npx wrangler deploy --config wrangler.queue.toml --dry-run`
- Whitespace check: `git diff --check`
- Deploy Pages: `npm run deploy`
- Deploy queue worker: `npm run deploy:queue`

There are no dedicated npm scripts for test, lint, typecheck, build, or format at the time of this guide. Prefer the explicit commands above unless package scripts are added later.

## Working Rules

- Keep secrets out of git. `.env`, `.env.*`, and `.wrangler/` are ignored and should stay local.
- Do not edit `node_modules/`, `.wrangler/`, `dist/`, or generated runtime output.
- Treat `public/vendor/ag-psd/` as vendored browser dependency code. Only change it when intentionally updating the dependency.
- Be careful with binary/static image assets under `public/model-library/`; avoid churn unless the requested change is asset-related.
- Keep frontend view changes in sync across `public/index.html`, `public/app.js`, and `public/styles.css`.
- Keep API and persistence changes aligned across `functions/api/*`, `functions/_lib/v2-store.ts`, `packages/contracts/v2.ts`, `migrations/`, and matching tests.
- Queue-backed job behavior usually spans `functions/_lib/v2-runner.ts`, `functions/_lib/v2-queue.ts`, `workers/job-consumer.ts`, route handlers under `functions/api/jobs/`, and tests named around `job`, `queue`, or `runner`.
- The image model path uses the 1xm / ModelJetty async task contract. Canvas Agent orchestration lives in `functions/_lib/canvas-agent-runner.ts`; preserve deterministic child IDs, request intents, scoped credentials, and concurrent canvas save protection. Do not replace batch image work with long synchronous request flows.
- D1/R2 bindings are optional locally; when missing, some server code falls back to in-memory storage. Do not treat that fallback as production persistence.
- `public/app.js` is large. Use `rg` to find the smallest relevant section before editing, and run focused tests after changes.
- Design Agent lifecycle and receipts live in `public/js/design-agent-harness.js`; keep DOM and provider calls in view/host adapters. Keep server policy and workflow constraints aligned in `functions/_lib/design-agent-{policy,skills}.ts`. See `docs/design-agent-harness.md` for recovery boundaries and OpenDesign provenance.

## Verification

- UI-only changes: run `node --check public/app.js`, `node --check public/js/shared.js`, and `git diff --check`; inspect the affected route with `npm run dev` when behavior or layout changes.
- API/storage/job changes: run targeted tests first, then `node --test tests/*.test.mjs`.
- Queue worker changes: run queue/runner tests plus `npx wrangler deploy --config wrangler.queue.toml --dry-run`.
- Cloudflare Pages Function changes: run `npx wrangler pages functions build --outdir /tmp/image-translator-functions-check`.
- Schema changes: add a new file under `migrations/`, update store/contracts/tests together, and verify local D1 migration commands from `README.md` when persistence behavior changes.

## Maintenance

Review this guide and `docs/agent-code-map.md` after major feature branches, Cloudflare binding changes, or every 3-6 months. Keep this root guide short; put detailed subsystem notes in docs or local guides only when they prevent real mistakes.
