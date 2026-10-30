---
name: lark-card
description: Review and customize Lark or Feishu card JSON using local previews. Use when changing cards or reviewing their layout.
compatibility: Requires Bun, Chromium (Playwright's, or a path passed with --chrome), and prepared CardKit assets. The optional client renderer also requires a compatible Lark installation.
---

# Review Lark cards

The project root is two directories above this skill; run commands from there. Setup and options are in its README.

## Define coverage

For "review all cards", list the static JSON files and dynamic card-generation entry points in the business project, and the states and roles each can produce. Generate JSON from real calls or test data. Dynamic state enumeration belongs to the business project, not this tool, so never claim full coverage from representative examples. Record every case with its generation, PC and iOS status, and each uncovered case with its reason.

## Review layout

```sh
bun src/cli.ts render-batch card-a.json card-b.json --output-dir previews
```

The output directory must be fresh. Read `previews/manifest.json` for results and warnings, then inspect both PNGs of every successful case: text clipping, button width, wrapping, hierarchy, and input-to-action distance. A shared submit button must not look like it applies to one field only.

For key cards or suspicious components, compare the source JSON, `compile` output and a client-renderer preview (needs a local Lark install):

```sh
bun src/cli.ts compile card.json > card-vr.json
bun src/cli.ts render card.json --renderer client -o card-client-pc.png
```

The client renderer has omitted Markdown link text and the simulator a collapsible panel. Do not change a business card because one renderer omits something; neither replaces a real-client or device check.

## Migrate V1 cards

```sh
bun src/cli.ts migrate legacy.json > card-v2.json
```

V2 supports only shared cards. On `migration_requires_shared`, ask the user before rerunning with `--allow-shared`; it changes how the card updates. Read the stderr warnings (notes, full-width images, removed fallbacks) and render the result before calling it equivalent. `migration_requires_manual` and `migration_locale_structure_mismatch` need a human decision: report the path, don't edit around it.

## Handle failures

Errors are JSON on stderr; branch on `code`.

- `usage_invalid`, `locale_invalid`, `card_json_invalid`: fix the command or input.
- `card_compile_failed`, `card_component_failed`, `simulator_empty_card`, `simulator_render_failed`: report `details` (component path, tag, code); fix the card only if asked to change it.
- `assets_unavailable`: `bun run setup-assets` downloads from Feishu and GitHub, so tell the user first.
- `client_unavailable`: use the simulator, or pass `--webcontent`.
- `batch_output_exists`: use a fresh `--output-dir`.
- `compiler_timeout`, `compiler_runtime_failed`, `render_failed`: retry once, then report the message.

## Preserve behavior and report

Unless asked, keep form ownership, control names, button actions and values, links and role visibility. A preview shows appearance only; it does not prove submission, callbacks or permissions work. Use only trusted cards and variables, and never send a card without the user's approval.

Report PNG paths, renderer, layout and unverified cases, plus these warnings: `resource_unresolved` (images or people the local host cannot resolve), `simulator_component_count_decreased` (components the simulator dropped, with paths; compare with the client renderer first) and `renderer_diagnostic`. A PNG alone does not prove every component rendered.
