# Visual Studio frontend rewrite

## Composition

Apply the Stageshow skill to the real application, using its panel-annotation gold and Figma canvas study as composition references. This is a functional production workspace: real content, accessible controls, existing authentication, async generation and persistence remain connected.

- Medium: live desktop workspace, with a separate compact layout at 390px.
- Ground: warm neutral canvas, white working surfaces, charcoal text and a restrained terracotta accent. Dark mode uses stepped graphite surfaces.
- Focal object: the actual artwork, followed by the active task. Navigation is quiet; the Agent is a full-height working panel.
- Action: describe an idea, enter a canvas, work with references and Agent, inspect or download results. Existing billable actions only run after explicit user interaction.
- Payoff: the resulting image and a readable, persisted Agent conversation.
- Omit: invented metrics, fake projects, decorative AI sparkles, emoji toolbar icons and duplicate product chrome.

## Scope

Rebuild application navigation, home, project collection, canvas chrome and Agent composition; unify batch tools, account, dialogs and administration. Keep the vanilla JS architecture and API contracts. Extract reusable workflow geometry from the old stylesheet; replace the application design system and page layouts. Add project search, useful prompt starters and keyboard help without changing paid request behavior.

## Verification

Inspect actual local routes and meaningful control states at desktop and compact widths; check both themes and reduced motion. Verify project readback and existing conversations without new paid model requests. Run frontend syntax checks, the existing Node suite and whitespace validation. Capture results and record scope/limitations in REHEARSAL.md.
