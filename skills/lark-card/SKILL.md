---
name: lark-card
description: Review and customize Lark or Feishu card JSON using local previews. Use when changing cards or reviewing their layout.
compatibility: Requires Bun, Chromium (Playwright's, or a path passed with --chrome), and prepared CardKit assets. The optional client renderer also requires a compatible Lark installation.
---

# Review Lark cards

Resolve the project root two directories above this skill. Read its README for setup and renderer limits. Run commands from that root.

## Define coverage

For a request to review all cards, list static JSON files and dynamic card-generation entry points in the business project. Enumerate the states and roles each entry point can produce. Generate JSON from real calls or test data. Do not claim full coverage from representative examples.

Record each case and its generation, PC preview, and iOS preview status. Record every uncovered case and its reason. Dynamic state enumeration belongs to the business project, not this tool.

## Review layout

Render each case with the simulator in both layouts.

```sh
bun src/cli.ts render-batch card-a.json card-b.json --renderer simulator --output-dir previews
```

Read `previews/manifest.json` for each result and warning, then inspect both PNGs for every successful case. A fresh output directory is required. Check text clipping, button width, input-to-action distance, wrapping, and visual hierarchy. Side-by-side placement is an option, not a rule. A shared submit button must not appear to apply to only one field.

For key cards and missing or suspicious components, compare the original JSON, the `compile` output, and a client-renderer preview. The client renderer requires a compatible local Lark installation.

```sh
bun src/cli.ts compile card.json > card-vr.json
bun src/cli.ts render card.json --renderer client --platform pc -o card-client-pc.png
bun src/cli.ts render card.json --renderer client --platform ios -o card-client-ios.png
```

Do not change business cards solely because one renderer omits an element. The local client renderer has omitted Markdown link text, and the simulator has omitted a collapsible panel. Neither renderer replaces a real-client or mobile-device check.

## Migrate V1 cards

```sh
bun src/cli.ts migrate legacy.json > card-v2.json
```

V2 supports only shared cards. If `migrate` fails with `migration_requires_shared`, ask the user before rerunning with `--allow-shared`; it changes how the card is updated. Read the warnings on stderr (layout changes for notes, full-width images, removed fallbacks) and render the result before reporting it as equivalent. `migration_requires_manual` and `migration_locale_structure_mismatch` mean the card needs a human decision; report the path in the message instead of editing around it.

## Handle failures

Errors are JSON on stderr. Branch on `code`:

- `usage_invalid`, `locale_invalid`, `card_json_invalid`: fix the command or input.
- `card_compile_failed`, `card_component_failed`, `simulator_empty_card`, `simulator_render_failed`: the card is invalid or unrenderable. Report `details` (component path, tag, code) and fix the card only if the user asked for changes.
- `assets_unavailable`: `bun run setup-assets` downloads files from Feishu and GitHub. Tell the user before running it.
- `client_unavailable`: use the simulator, or pass `--webcontent` for the installed Lark client.
- `batch_output_exists`: choose a fresh `--output-dir`.
- `compiler_timeout`, `compiler_runtime_failed`, `render_failed`: retry once, then report the message.

## Preserve behavior

When modifying a card, preserve form ownership, control names, button actions and values, links, and role visibility unless the user asks to change them. A preview checks appearance. It does not prove submission, callbacks, or permissions work.

Report PNG paths, renderer, layout, compiler or renderer warnings, and unverified cases. Warnings to relay: `resource_unresolved` (images or people the local host cannot resolve), `simulator_component_count_decreased` (components the simulator dropped, with their paths; compare with the client renderer before touching the card), and `renderer_diagnostic`. A PNG alone does not prove every component rendered. Use only trusted cards and variables. Do not send a card without the user's approval.
