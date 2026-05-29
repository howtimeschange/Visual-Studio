# Async Image Concurrency 10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all async image job concurrency default to 10 images and cap at 10 images across supported models and batch features.

**Architecture:** Centralize the async image concurrency contract in backend runner constants, then mirror the same contract in frontend state, preference sanitization, restored job snapshots, and submit payloads. Single-image direct generation and turn generation remain one-item jobs, while batch-capable translate and outfit flows use the shared 10-image default and cap without exposing a user-facing concurrency control.

**Tech Stack:** Cloudflare Pages Functions, queue worker runner, browser JavaScript frontend, Node test runner with esbuild-bundled modules.

---

### Task 1: Backend Async Job Concurrency Contract

**Files:**
- Modify: `functions/_lib/v2-runner.ts`
- Test: `tests/v2-runner-queue-credentials.test.mjs`

- [ ] **Step 1: Write failing backend tests**

Add assertions that `submitTranslateBatch` and `submitOutfitBatch` store concurrency `10` when omitted, and clamp oversized request values to `10`.

- [ ] **Step 2: Run backend test to verify it fails**

Run: `node --test tests/v2-runner-queue-credentials.test.mjs`

Expected before implementation: default assertions fail with old value `3`, and oversized values are not capped to `10` consistently.

- [ ] **Step 3: Implement shared backend constants**

Add `DEFAULT_ASYNC_IMAGE_JOB_CONCURRENCY = 10` and `MAX_ASYNC_IMAGE_JOB_CONCURRENCY = 10`, use them for translate and outfit submit/runtime clamps.

- [ ] **Step 4: Run backend test to verify it passes**

Run: `node --test tests/v2-runner-queue-credentials.test.mjs`

Expected after implementation: all backend runner tests pass.

### Task 2: Frontend Fixed Concurrency And Persistence

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Test: `tests/runtime-storage.test.mjs`

- [ ] **Step 1: Write failing frontend tests**

Update runtime tests so initial translate/outfit state defaults to `10`, sanitized preferences ignore old stored values and stay fixed at `10`, restored job snapshots clamp to `10`, and the batch translation/outfit pages do not expose concurrency inputs.

- [ ] **Step 2: Run frontend test to verify it fails**

Run: `node --test tests/runtime-storage.test.mjs`

Expected before implementation: state defaults and old `1..4/6` clamps fail the new `10` contract.

- [ ] **Step 3: Implement frontend shared constants**

Add `DEFAULT_ASYNC_IMAGE_JOB_CONCURRENCY = 10` and `MAX_ASYNC_IMAGE_JOB_CONCURRENCY = 10` in `public/app.js`; use them for initial state, preference sanitization, job snapshot hydration, and submitted job payloads. Remove the translate and outfit concurrency inputs from `public/index.html` and remove their DOM bindings/rendering code from `public/app.js`.

- [ ] **Step 4: Run frontend test to verify it passes**

Run: `node --test tests/runtime-storage.test.mjs`

Expected after implementation: all runtime storage tests pass.

### Task 3: Coverage Search And Targeted Verification

**Files:**
- Inspect: `functions/`, `workers/`, `public/`, `tests/`

- [ ] **Step 1: Search for old concurrency caps**

Run: `rg -n "tConcurrency|oConcurrency|#t-concurrency|#o-concurrency|id=\"t-concurrency\"|id=\"o-concurrency\"|concurrency-field|>并发<|并发" public/index.html public/app.js`

Expected: no remaining user-facing batch concurrency controls.

- [ ] **Step 2: Run focused test suite**

Run: `node --test tests/v2-runner-queue-credentials.test.mjs tests/runtime-storage.test.mjs tests/job-consumer-bridge.test.mjs tests/v2-queue.test.mjs`

Expected: focused async job and runtime tests pass.
