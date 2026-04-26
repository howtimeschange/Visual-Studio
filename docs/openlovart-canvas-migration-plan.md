# OpenLovart Canvas Migration Plan

## Scope

This plan migrates the usable OpenLovart canvas experience into the current Cloudflare Pages SPA while keeping this project's API, key handling, asset storage, and model relay.

Out of scope for this pass:

- OpenLovart's Clerk authentication
- OpenLovart's Supabase project tables
- OpenLovart's third-party Sora-style video generation flow
- Any Next.js or React rewrite

The current project remains a native HTML/CSS/JavaScript SPA backed by Cloudflare Pages Functions.

## Source Findings

OpenLovart's `/lovart/canvas` is implemented with React state plus positioned `div` elements and an SVG connector layer. It does not use Fabric, Konva, or ReactFlow.

Relevant source files:

- `/Users/xingyicheng/Downloads/openlovart/src/app/lovart/canvas/page.tsx`
- `/Users/xingyicheng/Downloads/openlovart/src/components/lovart/CanvasArea.tsx`
- `/Users/xingyicheng/Downloads/openlovart/src/components/lovart/FloatingToolbar.tsx`
- `/Users/xingyicheng/Downloads/openlovart/src/components/lovart/ContextToolbar.tsx`
- `/Users/xingyicheng/Downloads/openlovart/src/components/lovart/ImageGeneratorPanel.tsx`
- `/Users/xingyicheng/Downloads/openlovart/src/components/lovart/AiDesignerPanel.tsx`

Current project anchors:

- `public/index.html`
- `public/styles.css`
- `public/app.js`
- `functions/api/generate-direct.ts`
- `functions/api/assets/upload.ts`
- `functions/_lib/v2-store.ts`

## P0 - Canvas Interaction Parity

Goal: bring the core OpenLovart editing feel into the current native canvas engine.

Tasks:

- Extend canvas element schema in `public/app.js` to support `shape`, `path`, `fontSize`, `fontFamily`, `strokeWidth`, `groupId`, `linkedElements`, and `connectorStyle`.
- Add shape rendering for square, circle, triangle, message, arrow-left, and arrow-right.
- Add path/free-draw support using SVG paths stored as point arrays.
- Add hand tool, box selection, shift multi-select, and multi-select movement.
- Upgrade resize handles from four corners to eight handles.
- Add linked-element highlight for image-to-generator connector groups.
- Keep all existing `/api/generate-direct` and `/api/assets/upload` behavior unchanged.

Acceptance:

- Upload, drag, resize, delete, zoom, and pan still work.
- Multiple elements can be selected and moved together.
- Shapes and drawn paths persist through refresh.
- Existing image generation flow still replaces generator cards with result images.

## P1 - Generation And Panel Styling

Goal: make the generation surface visually match OpenLovart while still supporting the current dark professional UI.

Tasks:

- Restyle the floating image generation panel to support two modes:
  - Dark mode: current Visual Studio dark workbench style.
  - Light mode: OpenLovart-like white panel with rounded surfaces, subtle border, and dark primary action.
- Add page theme setting in the settings panel: `dark` and `light`.
- Store theme preference in the existing preferences storage.
- Apply theme through CSS variables rather than duplicating markup.
- Keep generation API calls on `POST /api/generate-direct`.
- Keep reference images uploaded through `POST /api/assets/upload` and passed to generation by `assetId`.
- Restyle AI side panel to follow the selected theme while preserving current "chat -> generate image -> add to canvas" behavior.

Acceptance:

- Switching theme changes the full workbench and canvas panels without reload.
- Dark mode keeps the existing production workbench feel.
- Light mode uses white OpenLovart-style panels and bright canvas surfaces.
- API keys and model behavior remain unchanged.

## P2 - Project Persistence For This Stack

Goal: replace local-only canvas state with this project's own persisted canvas project layer.

Tasks:

- Define project and element records in `packages/contracts/v2.ts`.
- Add store helpers in `functions/_lib/v2-store.ts` for canvas projects and serialized elements.
- Add Pages Functions:
  - `GET /api/canvas/projects`
  - `POST /api/canvas/projects`
  - `GET /api/canvas/projects/:id`
  - `PUT /api/canvas/projects/:id`
  - `GET /api/canvas/projects/:id/elements`
  - `PUT /api/canvas/projects/:id/elements`
- Keep asset blobs in the existing asset pipeline.
- Persist element data as JSON and image references as `assetId`.
- Continue using localStorage as a fast local cache and recovery fallback.

Acceptance:

- A canvas has a stable project id and editable title.
- Refresh restores from project storage when project id is present.
- Assets are not duplicated when saving project element JSON.
- The implementation does not depend on Clerk, Supabase, or OpenLovart's database schema.

## Explicitly Deferred

Video generation is not part of this migration pass. The UI may later support uploaded videos as canvas elements, but OpenLovart's `generate-video` and `video-status` implementation should not be ported until this project has a chosen video provider and key model.
