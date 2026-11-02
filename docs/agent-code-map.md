# Agent Code Map

Last reviewed: 2026-11-01 (frontend layout, design Agent harness and module map)

## Overview

This repository is a Cloudflare Pages app with a browser SPA, Pages Functions, a D1/R2-backed job system, and a Queue worker for durable batch image work. The app surfaces a Lovart-style canvas, project/account sharing, admin views, image translation, outfit swap, style transfer, and AI test workflows.

The main runtime boundary is:

```text
Browser SPA in public/
  -> Cloudflare Pages Functions in functions/api/
  -> shared storage, queue, and runner modules in functions/_lib/
  -> D1, R2, Cloudflare Queues, and the 1xm / ModelJetty async image task relay
  -> workers/job-consumer.ts for queue consumption and recovery
```

## Top-Level Map

| Path | Purpose | Notes for agents |
| --- | --- | --- |
| `.impeccable.md` | Local design/taste guidance. | Read only when doing visual design work. |
| `README.md` | Product overview, architecture, local dev, validation, deployment, and secret setup. | Canonical product and command reference. |
| `AGENTS.md` | Root agent guide. | Keep concise and operational. |
| `docs/` | Planning docs, feature handoffs, and agent-ready docs. | Older specs can lag implementation; verify against current code. |
| `docs/superpowers/plans/` | Historical implementation plans and validation notes. | Useful context, not always current contracts. |
| `functions/` | Cloudflare Pages Functions and shared server modules. | Core API/runtime surface. |
| `functions/_shared.ts` | Env type, model relay helpers, common response helpers, image task helpers. | Env contract starts here. |
| `functions/_lib/` | Auth, permissions, user keys, D1/R2 storage, events, queues, job runner. | High-risk shared backend code. |
| `functions/api/` | Route handlers for auth, account keys, admin, canvas, assets, jobs, results, and image workflows. | Pages Functions route paths map from filenames. |
| `migrations/` | D1 schema migrations. | Append new migrations; avoid rewriting applied ones. |
| `packages/contracts/` | Shared V2 record/status TypeScript types. | Update with store/API changes. |
| `packages/core/` | Pure shared business helpers. | Covered by focused tests such as `ai-test-prompt` and outfit tests. |
| `public/` | SPA HTML, JS, CSS, admin UI, assets, and browser PSD export code. | `public/app.js` is the largest UI state file. |
| `public/vendor/ag-psd/` | Vendored browser PSD bundle. | Do not edit unless intentionally updating vendor code. |
| `tests/` | Node tests. | Use targeted files before full `node --test tests/*.test.mjs`. |
| `workers/` | Cloudflare Queue worker entry. | Consumes queues, runs recovery cron, and exposes local queue bridge. |
| `wrangler.toml` | Pages app bindings, vars, D1/R2/Queue producers. | Production Pages config. |
| `wrangler.queue.toml` | Queue worker bindings, consumers, cron trigger, vars. | Worker deploy/dry-run config. |

## Important Entry Points

| Area | Entry points | Notes |
| --- | --- | --- |
| Main SPA | `public/index.html`, `public/app.js`, `public/styles.css` | Core workbench, canvas, batch flows, AI test UI, and localStorage state. |
| Workspace presentation | `public/css/workflows.css`, `public/js/workspace-ui.js`, `public/icons.svg` | Reusable workflow component geometry, project search, fit-to-content helpers, and local Lucide sprite. Themes and page composition remain in `public/styles.css`. See `REHEARSAL.md` for rewrite verification. |
| Design Agent harness | `public/js/design-agent-harness.js`, `public/js/design-agent-view.js`, `public/css/design-agent.css`, `functions/_lib/design-agent-policy.ts`, `functions/_lib/design-agent-skills.ts` | Pure lifecycle and receipts, DOM presentation, server execution policy and curated workflows. Host adapters remain in `public/app.js`. See `docs/design-agent-harness.md` for provenance, recovery and validation limits. |
| Durable canvas Agent | `functions/_lib/canvas-agent-runner.ts`, `functions/api/canvas/agent-runs*`, `functions/_lib/image-quality.ts`, `public/js/canvas-agent-client.js`, `public/js/canvas-drafts.js` | Queue owns planning and subsequent image tasks; browser observes. Keep deterministic IDs, unknown-operation intents, scoped drafts and concurrent saves intact. |
| Admin UI | `public/admin/index.html`, `public/admin.js`, `public/admin.css`, `functions/api/admin/*` | Admin auth is enforced server-side. |
| Canvas and projects | `functions/api/canvas/projects.ts`, `functions/api/canvas/agent.ts`, `public/js/canvas-psd-export.js` | Project sharing and PSD flows touch permissions and storage. |
| Direct generation | `functions/api/generate.ts`, `functions/api/generate-direct.ts`, `functions/api/jobs/generate-*` | Uses async image task semantics through shared helpers. |
| Batch jobs | `functions/api/jobs/*-batch.ts`, `functions/_lib/v2-runner.ts`, `functions/_lib/v2-queue.ts` | Job creation, dispatch, retry, polling, pause/resume, and recovery. |
| AI test | `functions/api/ai-test/templates.ts`, `functions/api/jobs/ai-test-batch.ts`, `packages/core/ai-test.ts`, `migrations/0005_ai_test_prompts.sql` | Prompt templates are data-backed and versioned. |
| Storage | `functions/_lib/v2-store.ts`, `migrations/*.sql`, `packages/contracts/v2.ts` | D1 is primary; in-memory fallback is local/dev only. |
| Auth and keys | `functions/_lib/auth.ts`, `functions/_lib/user-api-keys.ts`, `functions/api/auth/*`, `functions/api/account/api-keys.ts` | API keys are sealed; never return full saved keys to frontend. |
| Queue worker | `workers/job-consumer.ts`, `wrangler.queue.toml` | Handles queue batches, scheduled recovery, and local bridge. |

## Core Workflows

| Change type | Likely files | Verification |
| --- | --- | --- |
| UI view or interaction | `public/index.html`, `public/app.js`, `public/styles.css`, relevant `tests/*` | `node --check public/app.js`, targeted frontend tests, manual `npm run dev` check. |
| Admin behavior | `public/admin.*`, `functions/api/admin/*`, `functions/_lib/admin.ts`, auth tests | Target admin/auth tests plus full API checks if permissions changed. |
| Canvas generation or PSD | `public/app.js`, `public/js/canvas-psd-export.js`, `functions/api/canvas/*`, generate APIs | Canvas/generate/PSD tests and manual canvas route check. |
| Batch translation/outfit/style | `functions/api/jobs/*-batch.ts`, `functions/api/translate.ts`, `functions/api/outfit-swap.ts`, `functions/api/style-transfer.ts`, `functions/_lib/v2-runner.ts` | Matching route tests, runner tests, full `node --test tests/*.test.mjs` for shared runner edits. |
| AI test workflow | `public/app.js`, `functions/api/ai-test/templates.ts`, `functions/api/jobs/ai-test-batch.ts`, `packages/core/ai-test.ts`, `migrations/0005_ai_test_prompts.sql` | `tests/ai-test-*.test.mjs`, runner tests if job execution changes. |
| Storage/schema | `functions/_lib/v2-store.ts`, `packages/contracts/v2.ts`, `migrations/*.sql` | Store tests, API tests that read/write records, D1 migration commands from `README.md`. |
| Queue dispatch/recovery | `functions/_lib/v2-queue.ts`, `functions/_lib/v2-runner.ts`, `workers/job-consumer.ts`, `wrangler.queue.toml` | Queue/runner tests and `npx wrangler deploy --config wrangler.queue.toml --dry-run`. |
| Cloudflare bindings/config | `wrangler.toml`, `wrangler.queue.toml`, `functions/_shared.ts`, README/docs | Wrangler build/dry-run and a secrets/bindings audit. |

## Boundaries And Contracts

- Cloudflare bindings currently include `VS_DB`, `VS_INPUTS_BUCKET`, `VS_RESULTS_BUCKET`, `VS_TEMP_BUCKET`, `VS_TRANSLATE_JOBS_QUEUE`, `VS_OUTFIT_JOBS_QUEUE`, and `VS_JOBS_QUEUE`.
- Important secrets/vars include model keys, `RELAY_BASE_URL`, `CREDENTIAL_KEK`, `VS_JOB_CREDENTIAL_KEK`, admin allowlist vars, queue mode vars, timeouts, retry counts, and per-run item caps.
- The 1xm.ai image model path is async task-based: create task, poll task, then read `url` or `b64_json`. Batch work should not wait synchronously for long-running image completion.
- Batch image concurrency is intentionally capped. Check `functions/_lib/v2-runner.ts` before changing defaults or limits.
- Saved user API keys are encrypted/sealed. Frontend should receive saved status and key tails only, not full credentials.
- D1/R2 missing locally can trigger in-memory fallback. That helps development but does not prove production persistence.
- Pages Function filenames are routing contracts. Moving files under `functions/api/` changes HTTP paths.
- `public/_redirects` keeps SPA routes working on Cloudflare Pages.

## Noise And Generated Areas

- Ignore `node_modules/`, `.wrangler/`, `dist/`, `.env`, `.env.*`, `.DS_Store`, and generated runtime artifacts.
- Treat `public/vendor/ag-psd/` as vendored code.
- Treat image assets under `public/model-library/` as binary/static fixtures unless the task specifically asks for asset updates.
- Avoid broad reformatting of `public/app.js`; it creates noisy diffs in the main UI state machine.

## Open Questions

- [ ] Consider adding npm scripts for `test`, `check:frontend`, `check:functions`, and `check:queue` so future agents can discover validation commands through `package.json`.
- [ ] Decide whether `docs/platform-v2-spec.md` should be refreshed or labeled historical, because current README/code are more authoritative.
- [ ] Consider splitting more `public/app.js` workflow logic into `public/js/*` modules after tests cover the target section.
