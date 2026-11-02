# Visual Studio frontend rehearsal

Date: 2026-11-01. Scope: the real functional SPA and administration presentation. No production deployment, commit or push.

## Reference and adaptation

Used `/Users/xingyicheng/.codex/skills/stageshow/SKILL.md`, the `panel-annotation` gold, and the Figma canvas study. Copied the gold into `/tmp/visual-studio-stageshow/panel-annotation-reference` and filmed its still before implementation (`gold-panel.png`). Kept its quiet surfaces, full working context, proportions, readable task controls and clear foreground/background hierarchy. Replaced the fictional checkout with real workspace navigation, artwork, account connection and conversations.

This is a working app, so no fictitious data, decorative playback cursor, miniature window chrome or synthetic conversation was shipped. The application has no `.ss-stage`; the skill's host `layout.mjs` auditor and actual browser interaction/screenshots apply. A Stage film gate is not claimed for this SPA. The gold itself produced framing/gutter findings in its reference capture; its image was treated as a composition reference, not a passing application test.

## Changed

- New application shell, home composition, project gallery/search, canvas chrome, compact navigation, and a full-height desktop Agent workspace.
- Warm light and stepped graphite dark themes, a local consistent icon sprite, restrained motion and reduced-motion support.
- Unified translation, outfit, style, AI-test, account, settings, confirmation and admin surfaces.
- Agent controls use progressive disclosure; actual provider/model labels and saved history remain connected.
- Added fit-to-content and documented V/H/T/P shortcuts. Editing shortcuts are ignored while typing, operating a select, or using a dialog.
- Deferred protected AI-test template loading until the relevant authenticated view; anonymous home no longer redirects because of an unrelated eager request.
- Preserved all original HTML control IDs. Existing async generation, OIDC/account, queue and persistence interfaces remain intact.

## Captured and exercised

Evidence root: `/tmp/visual-studio-stageshow/`.

Actual authenticated IAB viewport: 1728px desktop and temporary 390×844 compact override. The override was reset. Verified the real three-image project, persisted Gemini 3.8 Flash replies, project search with matching/empty states, prompt starters, canvas fit, H/V tool switching, shortcut dialog, language menu, Agent opening/closing, and all three image-parameter selects. No model POST was deliberately submitted by the automated frontend checks.

Screens inspected include `home-desktop.png`, `home-dark.png`, `canvas-desktop.png`, `canvas-dark.png`, `canvas-mobile.png`, `translate-desktop.png`, `translate-mobile-authenticated.png`, `outfit-desktop.png`, `style-desktop.png`, `ai-test-desktop.png`, and anonymous compact states from the host auditor. The actual user subsequently began a new Agent conversation in the shared tab. Its draft and active page were left untouched when that activity was observed; no further interactive tests were run in that tab.

Host layout snapshots at 1440px / 390px cover home and batch tools. The layout reports distinguish geometric checks from visual approval. Admin was checked as its real unauthenticated gate; its expected `/api/admin/me` 401 makes that automated audit inconclusive, not a passing authenticated-admin test.

## Findings fixed

- Mobile navigation line boxes exceeded their allocated height: corrected line height and spacing.
- Absolute Agent panel inherited the desktop grid area on compact screens: made its compact containing area explicit.
- Agent grid auto minimum widened content beyond the sidebar, clipping its close/send controls: constrained the track and message minimums and allowed long text to wrap. Rechecked the actual model, ratio, resolution and send-button bounding boxes inside the 370px panel.
- AI-test template select collided with its neighbor: used a three-column desktop form and explicit shrinkable input widths, with a separate one-column compact form.
- Translation had a mostly empty preservation row: grouped preservation, font and color controls on the second desktop row.
- Settings lacked a visible dismiss action on touch layouts: added a close button independent of saving keys.

## Validation and limits

- Node suite: 283/283 passing, zero skipped (`final-tests.log`).
- Syntax: app, shared helpers, workspace helpers and admin script passed. Whitespace check passed.
- No new runtime package or framework dependency in the app. Icon license is included in `public/icons.LICENSE.txt`.
- Both themes were inspected on desktop; authenticated Agent layout and parameters were inspected at 390px. Reduced-motion rules are present, but live preference switching and a physical touch device were not exercised.
- Authenticated admin tables, new paid generation and the entire batch execution lifecycle were not re-run for this presentation rewrite. Prior backend/model acceptance remains documented separately.
- No new API/schema/worker changes in this rewrite. Earlier uncommitted integration and review fixes remain in the checkout.

## Subsequent Design Agent harness acceptance (2026-11-01)

The later Agent change is documented in `docs/design-agent-harness.md`; the limits above describe the earlier presentation rewrite only. The later change adds a pure lifecycle module, DOM view, semantic CSS, server execution policy and curated OpenDesign workflow adaptations. Its Node suite passes 297/297 and its Pages Functions build succeeds.

Authenticated browser checks covered missing-reference clarification, a real ModelJetty Gemini 3.8 Flash plan, reference-role selection, explicit selection attachment, persisted run records, manifest preview/download readback and a real Nano Banana 2 reference edit saved to the canvas. A JPEG MIME mismatch discovered during that run was fixed and regression-tested. The successful artifact was reloaded from project storage; no semantic quality pass is claimed. Mobile checks at 390×844 showed no horizontal clipping of the major controls; the viewport override was reset.

Evidence is under `/tmp/visual-studio-agent-harness/`, including `sidebar-mobile.png`, `sidebar-desktop-final.png`, `live-generation-manifest.json`, test and build logs. The final desktop screenshot also includes subsequent activity observed in the shared page; interactive checks stopped to preserve it. No production deployment was performed.
