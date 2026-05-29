# Canvas Poster Banner Composition Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Canvas AI sidebar "海报/banner" mode that generates a visual base image and then locally composites crisp poster/banner text and layout onto the final PNG.

**Architecture:** The Canvas sidebar gets a mode selector. In poster/banner mode, the frontend sends a structured `creativeMode` + `posterBrief` to `/api/canvas/agent`. The agent returns one independent `generate_image` action per requested output, each with a text-free visual-base prompt plus a normalized `posterBrief`. After each image job completes, the browser draws the generated base onto a canvas and overlays headline, subheadline, CTA, badges, and scrim using deterministic local composition before saving the final PNG back as a result asset and placing it on the canvas.

**Tech Stack:** Cloudflare Pages Functions, vanilla JS frontend, browser Canvas 2D composition, existing image-generation job queue, Node test runner.

---

### Task 1: Add Canvas AI Mode UI And State

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Test: `node --check public/app.js`

- [ ] **Step 1: Add a mode select to the AI sidebar**

Inside `public/index.html` `.ai-sidebar-controls`, insert this before `#g-ai-model`:

```html
<select id="g-ai-mode" class="input ai-sidebar-select ai-sidebar-mode" aria-label="AI 工作流模式">
  <option value="image">普通图</option>
  <option value="poster_banner">海报/banner</option>
</select>
```

- [ ] **Step 2: Add mode state and DOM binding**

In `public/app.js`, add `gAiMode: $('#g-ai-mode')` to the DOM map and `aiMode: 'image'` to `state.generate`.

Add:

```js
function normalizeCanvasCreativeMode(value) {
  return String(value || '') === 'poster_banner' ? 'poster_banner' : 'image'
}
```

- [ ] **Step 3: Persist mode preference**

In `sanitizeGeneratePrefs(raw)`, return:

```js
aiMode: normalizeCanvasCreativeMode(raw.aiMode || state.generate.aiMode),
```

In `savePrefs()`, include:

```js
aiMode: state.generate.aiMode,
```

- [ ] **Step 4: Wire mode select and defaults**

In `bindAiSidebar()`, add a `gAiMode` change handler that updates state, applies defaults, saves prefs, and rerenders:

```js
dom.gAiMode?.addEventListener('change', () => {
  state.generate.aiMode = normalizeCanvasCreativeMode(dom.gAiMode.value)
  applyCanvasCreativeModeDefaults()
  savePrefs()
  renderGenerate()
})
```

Add `applyCanvasCreativeModeDefaults()` so poster/banner mode switches `1:1` to `16:9` once:

```js
function applyCanvasCreativeModeDefaults() {
  if (state.generate.aiMode !== 'poster_banner') return
  if (normalizeAspectRatio(state.generate.genRatio) !== '1:1') return
  state.generate.genRatio = '16:9'
  if (dom.gAiRatio) dom.gAiRatio.value = '16:9'
  if (dom.gGenRatio) dom.gGenRatio.value = '16:9'
}
```

- [ ] **Step 5: Reflect mode in render**

In `renderGenerate()`, set the mode select and sidebar dataset:

```js
if (dom.gAiMode) dom.gAiMode.value = normalizeCanvasCreativeMode(state.generate.aiMode)
if (dom.gAiSidebar) dom.gAiSidebar.dataset.aiMode = normalizeCanvasCreativeMode(state.generate.aiMode)
```

- [ ] **Step 6: Update CSS grid**

Update `.ai-sidebar-controls`:

```css
.ai-sidebar-controls {
  display: grid;
  grid-template-columns: minmax(86px, 0.8fr) minmax(118px, 1.1fr) 58px 52px 64px;
  align-items: center;
  gap: 6px;
  padding: var(--space-sm) var(--space-lg) var(--space-xs);
}

.ai-sidebar-mode {
  font-weight: 600;
}
```

Update the small-screen grid to avoid cramped text:

```css
@media (max-width: 380px) {
  .ai-sidebar-controls {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 56px;
  }

  .ai-sidebar-upload-btn {
    grid-column: 1 / -1;
  }
}
```

### Task 2: Add Poster Brief Contract To Agent

**Files:**
- Modify: `public/app.js`
- Modify: `functions/api/canvas/agent.ts`
- Test: `node --check functions/api/canvas/agent.ts`

- [ ] **Step 1: Build frontend poster brief**

Add `buildCanvasPosterBrief(requestText, aspectRatio, resolution)`:

```js
function buildCanvasPosterBrief(requestText, aspectRatio, resolution) {
  return {
    format: aspectRatio === '9:16' || aspectRatio === '3:4' ? 'poster' : 'banner',
    headline: inferPosterHeadline(requestText),
    subheadline: '',
    cta: '',
    badges: [],
    layout: aspectRatio === '9:16' || aspectRatio === '3:4' ? 'bottom' : 'left',
    copySafeArea: aspectRatio === '9:16' || aspectRatio === '3:4' ? 'bottom 35%' : 'left 42%',
    aspectRatio,
    resolution,
    sourceRequest: requestText,
  }
}
```

`inferPosterHeadline()` should take the first Chinese/English phrase before punctuation and cap at 28 characters.

- [ ] **Step 2: Send contract to agent**

In both `sendCanvasAiMessage()` and the `genUseAgent` branch of `executeCanvasGenerate()`, send:

```js
creativeMode: aiMode,
posterBrief: aiMode === 'poster_banner' ? buildCanvasPosterBrief(requestText, aiAspectRatio, aiResolution) : null,
```

Keep default mode as `image`.

- [ ] **Step 3: Update backend system prompt**

In `functions/api/canvas/agent.ts`, read:

```ts
const creativeMode = normalizeCreativeMode(body?.creativeMode)
const posterBrief = normalizePosterBrief(body?.posterBrief)
```

Pass `creativeMode` and `posterBrief` in the model user payload.

Update the strict JSON action schema to allow:

```json
"creativeMode": "poster_banner",
"promptStyle": "visual_base",
"posterBrief": {
  "headline": "short exact local overlay headline",
  "subheadline": "short exact local overlay subheadline",
  "cta": "short CTA",
  "badges": ["badge 1"],
  "layout": "left|right|top|bottom|center",
  "copySafeArea": "left 42%"
}
```

Prompt rule: in poster/banner mode, action prompts are for text-free visual bases only; no readable words, pseudo-text, watermarks, borders, or UI chrome. The local compositor handles Chinese/English text.

- [ ] **Step 4: Normalize backend metadata**

Export helper functions used by tests:

```ts
export function normalizeCreativeMode(value: unknown): 'image' | 'poster_banner'
export function normalizePosterBrief(value: any): PosterBrief
export function buildPosterBannerBasePrompt(message: string, brief: PosterBrief, aspectRatio: string, resolution: string): string
export function buildPassthroughAgentResult(body: any, message: string)
```

In poster/banner passthrough, keep the default-mode raw prompt behavior unchanged. Only poster/banner mode should create a text-free visual-base prompt and include `posterBrief`.

### Task 3: Compose Poster Banner Locally In Browser

**Files:**
- Modify: `public/app.js`
- Test: `tests/canvas-generate-routing.test.mjs`
- Test: `tests/canvas-ai-history.test.mjs`

- [ ] **Step 1: Preserve action metadata in frontend**

Update `normalizeCanvasAgentAction()` to retain:

```js
creativeMode: normalizeCanvasCreativeMode(action?.creativeMode || action?.mode),
promptStyle: action?.promptStyle === 'visual_base' ? 'visual_base' : '',
posterBrief: normalizeCanvasPosterBrief(action?.posterBrief || action?.brief),
```

- [ ] **Step 2: Add local composition helpers**

Add pure helpers:

```js
function normalizeCanvasPosterBrief(value = {}) { ... }
function getPosterCanvasOutputSize(aspectRatio, resolution) { ... }
function resolvePosterOverlayText(action, fallbackRequest) { ... }
```

Add browser helper:

```js
async function composePosterBannerImage(baseDataUrl, action, fallbackRequest) {
  // Load base image.
  // Create fixed output canvas from aspect ratio/resolution.
  // Cover-crop base image.
  // Draw subtle scrim in the requested copy safe area.
  // Draw headline, subheadline, badges, CTA with wrapped text.
  // Return { dataUrl, width, height, mime: 'image/png', brief }.
}
```

Use system fonts: `Noto Sans SC`, `Geist`, `Arial`. Keep text inside safe margins, no negative letter spacing, no viewport font scaling.

- [ ] **Step 3: Connect composition into generation loop**

In `sendCanvasAiMessage()`, after `requestCanvasGenerate()` returns:

```js
const composed = action.creativeMode === 'poster_banner'
  ? await composePosterBannerImage(data.resultDataUrl, action, requestText)
  : null
const resultDataUrl = composed?.dataUrl || data.resultDataUrl
```

Store/upload the composed image as `canvas_ai_poster_banner` and replace the pending element with the final composed PNG. Keep the original base asset id only in metadata if needed; display/save the composed result as the main image.

- [ ] **Step 4: Add mode badge and history fields**

Persist `creativeMode`, `promptStyle`, and `posterBrief` on message images and workflow items. Render a `海报/banner` badge in chat when applicable.

### Task 4: Tests

**Files:**
- Modify: `tests/canvas-generate-routing.test.mjs`
- Modify: `tests/canvas-ai-history.test.mjs`
- Add: `tests/canvas-agent-poster-brief.test.mjs`

- [ ] **Step 1: Frontend helper tests**

Extend `tests/canvas-generate-routing.test.mjs` harness to extract:

```js
normalizeCanvasCreativeMode
buildCanvasPosterBrief
normalizeCanvasPosterBrief
getPosterCanvasOutputSize
normalizeCanvasAgentActions
```

Add assertions that poster/banner mode creates a poster brief and action metadata survives normalization.

- [ ] **Step 2: History tests**

Extend `tests/canvas-ai-history.test.mjs` so `serializeAiMessage()` and `sanitizeAiMessages()` preserve `creativeMode`, `promptStyle`, and `posterBrief` on generated images/workflow.

- [ ] **Step 3: Backend helper tests**

Create `tests/canvas-agent-poster-brief.test.mjs` using esbuild import pattern to test:

- default passthrough action prompt equals raw message
- poster/banner passthrough prompt includes text-free/no pseudo-text/copy-space rules
- `normalizePosterBrief()` clamps badges and layout values

### Task 5: Final Validation

**Files:**
- Validate: `public/app.js`
- Validate: `functions/api/canvas/agent.ts`
- Validate: targeted tests

- [ ] **Step 1: Syntax checks**

Run:

```bash
node --check public/app.js
node --check functions/api/canvas/agent.ts
```

- [ ] **Step 2: Targeted tests**

Run:

```bash
node --test tests/canvas-generate-routing.test.mjs tests/canvas-ai-history.test.mjs tests/canvas-agent-poster-brief.test.mjs tests/runtime-storage.test.mjs
```

- [ ] **Step 3: Manual smoke**

Run local Pages + queue worker and reuse the previous smoke structure with `creativeMode: "poster_banner"` to verify that the final displayed asset is the composed PNG, not the raw model base.

