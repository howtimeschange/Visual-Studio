# Agent Readiness

Last reviewed: 2026-06-17

## Status

- Agent guide: present as root `AGENTS.md`.
- Code map: present as `docs/agent-code-map.md`.
- Canonical project summary: `README.md` plus current implementation.
- Local validation commands: clear in `README.md` and `AGENTS.md`, but not exposed as npm scripts except for dev/deploy.
- Noise boundaries: clear in `.gitignore` and documented in `AGENTS.md`.
- Local guides: not added yet. The root guide plus code map should be enough until a subtree develops distinct commands or ownership rules.

## What Was Added

- A concise root guide for immediate agent context.
- A deeper code map with entry points, workflow boundaries, and high-risk contracts.
- This readiness report for follow-up work and validation status.

## Validation Commands

| Command | Purpose | Status |
| --- | --- | --- |
| `npm install` | Install local dependencies. | Existing documented command; not run for this docs-only update. |
| `npm run dev` | Start Cloudflare Pages dev server. | Package script present; not run for this docs-only update. |
| `npm run dev:queue` | Start queue worker on port 8798. | Package script present; not run for this docs-only update. |
| `npm run dev:local-queue` | Start Pages dev with local queue bridge on port 8788. | Package script present; not run for this docs-only update. |
| `node --check public/app.js` | Syntax-check main frontend file. | Verified on 2026-06-17. |
| `node --check public/js/shared.js` | Syntax-check shared frontend helper. | Verified on 2026-06-17. |
| `node --test tests/*.test.mjs` | Run full Node test suite. | Recommended after API/storage/job changes. |
| `npx wrangler pages functions build --outdir /tmp/image-translator-functions-check` | Build Pages Functions. | Recommended after Pages Function changes. |
| `npx wrangler deploy --config wrangler.queue.toml --dry-run` | Validate queue worker deploy shape. | Recommended after queue worker/config changes. |
| `git diff --check` | Check whitespace in local diff. | Run on 2026-06-17; new files were also scanned separately for trailing whitespace. |

## Recommended Follow-Ups

- [ ] Add package scripts for repeated validation, for example `test`, `check:frontend`, `check:functions`, and `check:queue`.
- [ ] Add a short note to old planning docs that says whether they are historical or still authoritative.
- [ ] Consider a local `functions/AGENTS.md` only if backend conventions grow beyond what fits in the root guide.
- [ ] Consider a local `public/AGENTS.md` if `public/app.js` is split into more modules and UI conventions become easier to document locally.

## Maintenance Cadence

Review the agent guide and code map every 3-6 months, after major Cloudflare binding changes, or after significant workflow additions such as billing, realtime collaboration, Durable Objects, or a frontend framework migration.
