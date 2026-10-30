---
name: lark-card
description: Review, migrate, and preview Lark and Feishu card JSON files locally. Use when editing card JSON, converting cards from version 1 to version 2, or checking card layout on desktop and mobile.
compatibility: Requires Bun, Chromium, and prepared CardKit assets. The client renderer also requires Lark installed locally.
---

# Review Lark cards

Run commands from the package root, two directories above this file. See `README.md` for installation instructions.

## Define coverage

When reviewing cards across a project, list static card JSON files and dynamic card generation functions, along with the states and user roles that each produces. Generate sample JSON from test data or application logs. Do not claim full coverage from a small sample. Record whether each case rendered in desktop and mobile layouts. Document any missing case and the reason it was not tested.

## Review layout

```sh
bun src/cli.ts render-batch card-a.json card-b.json --output-dir previews
```

The output directory must not exist before the command runs. Read `previews/manifest.json` for execution status and warnings. Open both PNG files for each rendered card. Inspect text clipping, button width, line wrapping, visual hierarchy, and the distance between inputs and buttons. Make sure shared submit buttons do not appear inside individual form fields.

For critical cards or unexpected layouts, compare the input JSON, the compiled output, and a client preview rendered by the local Lark application.

```sh
bun src/cli.ts compile card.json > card-vr.json
bun src/cli.ts render card.json --renderer client -o card-client-pc.png
```

In known local runs, the client renderer has dropped link text inside Markdown, and the simulator has dropped collapsible panels. Do not modify a business card solely because a local renderer drops an element. Local previews do not replace checks on real clients or physical mobile devices.

## Migrate version 1 cards

```sh
bun src/cli.ts migrate legacy.json > card-v2.json
```

Version 2 cards support only shared mode, where actions update the card for every member of a conversation. If `migrate` returns `migration_requires_shared`, confirm with the user before passing `--allow-shared`. Review warnings written to standard error for adjusted notes, cropped images, and removed fallback blocks. Render the migrated card before treating it as equivalent to the original. If migration returns `migration_requires_manual` or `migration_locale_structure_mismatch`, report the field path to the user instead of guessing a fix.

## Handle failures

Failed commands write a JSON object to standard error. Read the `code` field to decide the next action.

- `usage_invalid`, `locale_invalid`, and `card_json_invalid`. Correct the command arguments, locale code, or input JSON.
- `card_compile_failed`, `card_component_failed`, `simulator_empty_card`, and `simulator_render_failed`. The card contains invalid elements or cannot be rendered. Report the component path, tag, and error code from the `details` field. Do not edit the card unless the user requested modifications.
- `assets_unavailable`. Running `bun run setup-assets` downloads files from external servers. Ask the user before starting the download.
- `client_unavailable`. Use the default simulator renderer, or pass `--webcontent` with the path to local Lark archives.
- `batch_output_exists`. Choose an output directory that does not yet exist.
- `compiler_timeout`, `compiler_runtime_failed`, and `render_failed`. Retry the command once. If the command fails again, report the error message.

## Preserve behavior and report

When modifying a card, keep form boundaries, element names, button values, URL links, and role permissions unchanged unless the user asks to alter them. A preview shows layout only. It does not verify button callbacks, form submission, or access control. Never send a card to an external chat without explicit confirmation from the user.

Report image file paths, the renderer used, the layout checked, and any skipped test cases. Include warning details when present. The warning `resource_unresolved` indicates missing image files or unresolved user tokens. The warning `simulator_component_count_decreased` lists elements dropped during simulator conversion, along with their JSON paths. Check dropped elements against the client renderer before changing the source card. The warning `renderer_diagnostic` carries internal runtime notices.
