# Canvas Poster Banner Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Canvas poster/banner mode so it follows the local `banner-generation` and `dasen-ops-image-generation` pattern: unified text-free visual base, reserved copy area, and polished deterministic local typography.

**Architecture:** The agent must plan one coherent hero visual per output, not a collage or contact sheet. The local compositor must render a deliberate poster/banner typography system with scrim, accent rule, badges, CTA, and safe-area-aware sizing. Smoke tests must prove the real queue path still produces a final composited PNG.

**Tech Stack:** Cloudflare Pages Functions, vanilla JS Canvas 2D, Node test runner, local Wrangler Pages + queue worker smoke test, Sharp for smoke-script composition.

---

### Task 1: Harden Agent Visual-Base Planning

**Files:**
- Modify: `functions/api/canvas/agent.ts`
- Test: `tests/canvas-agent-poster-brief.test.mjs`

- [ ] Add poster/banner planning guidance based on the local skills: single coherent hero backdrop, one focal subject, calm copy-safe region, no collage, no grid, no split-screen, no multiple unrelated scenes.
- [ ] Add reusable `getPosterBannerCompositionRules()` so model-returned prompts and passthrough prompts receive the same anti-collage constraints.
- [ ] Add tests asserting poster/banner prompts contain both the text-free rules and anti-collage rules.

### Task 2: Polish Local Canvas Composition

**Files:**
- Modify: `public/app.js`
- Test: `tests/canvas-generate-routing.test.mjs`

- [ ] Add `getPosterCompositionTheme()` and `getPosterAccentColor()` helpers for restrained poster/banner styling.
- [ ] Make `drawPosterScrim()` include a dark veil, focal-safe gradient, subtle accent line, and bottom vignette instead of a flat pasted block.
- [ ] Make `drawPosterText()` use skill-like hierarchy: headline, subheadline, badges, CTA, metadata line, with safer badge wrapping and CTA sizing.
- [ ] Add tests for new helpers where feasible through the existing VM harness.

### Task 3: Update Smoke Script Composition

**Files:**
- Modify: `tmp/canvas-poster-banner-smoke-20260528.mjs`

- [ ] Mirror the improved local compositor style in the smoke script so the tested artifact represents the product behavior.
- [ ] Keep the smoke script under `tmp/`, no production dependency on it.

### Task 4: Verify

**Commands:**
- `node --check public/app.js`
- `node --check functions/api/canvas/agent.ts`
- `node --check tmp/canvas-poster-banner-smoke-20260528.mjs`
- `node --test tests/canvas-generate-routing.test.mjs tests/canvas-ai-history.test.mjs tests/canvas-agent-poster-brief.test.mjs tests/runtime-storage.test.mjs`
- Start local services:
  - `npm run dev:queue`
  - `npm run dev:local-queue`
- Real smoke:
  - `BASE_URL=http://127.0.0.1:8788 MODEL_ID=nano-banana-2 ASPECT_RATIO=3:4 RESOLUTION=1k node tmp/canvas-poster-banner-smoke-20260528.mjs`
- Inspect final PNG and verify `sips -g pixelWidth -g pixelHeight`.
