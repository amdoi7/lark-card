---
name: lark-card
description: >-
  Create, edit, review, migrate, and validate Lark or Feishu Card JSON locally.
  Use for card layouts, form and button JSON, V1-to-V2 migration, compiler
  failures, or desktop/mobile preview checks. Follow static checks, compilation,
  and visual verification while preserving callbacks, payloads, links, and permissions.
compatibility: Requires Bun and prepared CardKit assets. Visual verification requires Chromium; the client renderer also requires an installed Lark client.
---

# Lark card execution protocol

Resolve the package root as `../..` relative to this skill directory, then run commands there. Resolve input, variable, and output paths against their owning project before changing the working directory; pass absolute paths when reviewing another project. Installation and environment setup belong to [README](../../README.md#setup). Load [the Card JSON 2.0 reference](references/card-json.md) for field meanings and constraints, not for command instructions.

Loading this skill grants no permission to edit files, download assets, publish cards, or change business behavior. A review is read-only unless the user requests changes. Write derived JSON and PNGs only to fresh, authorized output paths.

## Business invariants

Unless the user explicitly approves a business change:

- **Callback invariant:** preserve form boundaries and interaction component `name` values. A visual label is not a replacement for the submitted field name. Moving a component into another form changes its submission ownership.
- **Action invariant:** preserve `value` and `behaviors`, including nested payloads, JSON-encoded strings, and JSON value types. Component-like keys inside business payloads are not card components to transform.
- **Link invariant:** preserve destinations, platform-specific links, and query parameters.
- **Permission invariant:** preserve role-based visibility and permission configuration. Never remove restrictions to make an element appear in a preview.
- **Preview limitation:** local PNGs verify rendering and layout only. They do not prove real-device behavior, link navigation, callbacks, form submission, network effects, or authorization. Never send a card to an external conversation without explicit confirmation.

## Fail-fast pipeline

Stop at the first failing gate. Fix only within the requested scope, then rerun that gate and affected downstream checks. Do not start Chromium to investigate a card that has not passed compilation.

### Level 0 — Scope and static structure

1. Inventory card files and dynamic generation functions. For each covered case, record generation state, role, locale, and variable fixtures. Use synthetic or authorized sample data. Missing states are uncovered, not implicitly passed.
2. Identify the schema. Missing `schema` means 1.0; do not silently upgrade it during a layout review. Use the reference for 2.0 cards and its official V1 link for 1.0 cards.
3. Check the relevant static constraints: component count, container nesting depth (at most five container levels), form boundaries, required submit controls, and prohibited nesting. A manual check is not a full schema validator.
4. Before editing, capture the business fields covered by the invariants. Change only requested fields; compare their values and form ownership after editing.

### Level 1 — Compiler gate, without a browser

For an ordinary card edit or review:

```sh
bun src/cli/index.ts compile card.json > compiled.json
```

Add `--locale` for each covered language and `--variables variables.json` when the case requires CardKit variables. Read the result's `sourceSchema`, `locale`, and `warnings`. The compiled `card` is CardKit VR for diagnosis, not source Card JSON to edit or feed back into migration. Compilation is cheaper than rendering; do not promise a fixed per-run latency.

For an explicitly requested V1-to-V2 migration:

```sh
bun src/cli/index.ts migrate legacy.json > card-v2.json
```

Migration already compiles the converted card in every declared locale. Inspect its conversion warnings on stderr before proceeding to visual verification. V2 supports shared cards only: on `migration_requires_shared`, obtain consent before adding `--allow-shared`; a request to improve layout does not authorize changing sharing mode. Do not guess fixes for manual-migration or locale-structure errors.

### Level 2 — Scoped visual verification

After compilation succeeds, render cases without external variable fixtures together:

```sh
bun src/cli/index.ts render-batch card-a.json card-b.json --output-dir previews-review
```

Choose a fresh output directory. Read `manifest.json` even after a nonzero exit: `ok`, `error`, and `pending` describe individual layouts. Inspect both PC and iOS PNGs for every claimed case. Check clipping, wrapping, button widths, spacing, visual hierarchy, and submit-button placement. Producing a PNG is not the same as inspecting it.

Batch does not accept `--variables`. For a variable-dependent case, preserve the fixture and render both layouts individually instead of dropping variables:

```sh
bun src/cli/index.ts render card.json --variables variables.json --platform pc -o card-pc.png
bun src/cli/index.ts render card.json --variables variables.json --platform ios -o card-ios.png
```

Set `--locale` and `--theme` consistently with the case inventory. For critical cards or suspected simulator omissions, cross-check against source Card JSON, compiled VR, and an available client preview:

```sh
bun src/cli/index.ts render card.json --renderer client -o card-client-pc.png
```

Carry over the same variables, locale, platform, and theme when comparing renderers. A local renderer's missing component or link text is not sufficient evidence to delete or rewrite business content. Client previews are also adapters, not proof of real-client interaction.

If the user requested only structural or compile validation, skip this level with a reason. If required visual verification cannot run, report it as unverified; do not download browsers or assets without permission or silently substitute a different renderer.

### Level 3 — Invariant check and report

Compare business fields with their pre-edit values. For migrations, report explicitly approved changes to sharing mode and any conversion warnings. Do not claim interaction or permission verification from a screenshot.

Report:

- **Change:** files and requested adjustments; business fields preserved or explicitly authorized to change.
- **Coverage:** card/state/role/locale/variable fixture, renderer, platform, and theme for each covered case.
- **Gates:** static, compile, and visual status as `passed`, `failed`, or `skipped`; a reason for every skip.
- **Evidence:** compiled JSON, manifest, and inspected PNG paths.
- **Warnings:** codes and relevant component/resource details, including unresolved warnings.
- **Residual:** uncovered states and checks still required on real clients or in the business environment.

## Failure decisions

Commands report errors as JSON on stderr. Branch on `code`, not message text; include available `details` in the report without inventing missing component paths. Compile warnings live in stdout JSON, migration/render warnings on stderr, and batch warnings in manifest results.

| Code | Next action |
| --- | --- |
| `usage_invalid`, `locale_invalid`, `card_json_invalid`, `migration_source_invalid` | Correct the command, locale, JSON, variables, or migration source version. Do not launch a renderer first. |
| `card_compile_failed`, `card_component_failed` | Report the compiler diagnostic; for component failures include available path, tag, and component error code. Make a source change only if authorized. |
| `migration_requires_shared` | Ask for consent to shared mode before using `--allow-shared`. |
| `migration_requires_manual`, `migration_locale_structure_mismatch` | Report the affected locale/path and the decision required. Stop automatic migration. |
| `assets_unavailable` | Stop and consult README setup. Ask before running downloads; do not bypass integrity checks. |
| `client_unavailable` | Report missing client prerequisites. Offer the simulator, but do not silently count it as client verification. |
| `batch_output_exists` | Choose a fresh directory; do not delete or overwrite previous evidence. |
| `request_too_large` | Report the preview API's limit. Do not strip business payloads to pass it. |
| `simulator_empty_card`, `simulator_render_failed` | Inspect source and compiler results, and cross-check renderer support where possible. Do not assume the business card is invalid. |
| `compiler_timeout`, `compiler_runtime_failed`, `render_failed` | Inspect input, flags, assets, browser prerequisites, and diagnostics. Rerun once only when there is evidence of a transient cause; otherwise report the blocker. |

Handle warnings without changing business meaning:

- `locale_fallback`: record requested and selected locales; verify that the fallback is acceptable for the case.
- `resource_unresolved`: record unresolved image/user/emoji resource kinds. A PNG with unresolved attachments is not a complete visual pass.
- `simulator_component_count_decreased`: compare component counts and investigate omissions. `candidatePaths` are all input paths for that tag, not a precise list of missing components.
- `renderer_diagnostic`: retain operation and detail for degraded previews. Preserve unfamiliar compiler/migration warnings in the report rather than treating unknown codes as success.
