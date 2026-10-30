# lark-card

Render Lark and Feishu Card JSON locally. The CLI compiles, migrates, and previews cards. The visual editor uses the official CardKit designer and simulator. Neither operation sends a card or executes business callbacks.

## Requirements

- Bun 1.4.4, the tested version
- Playwright Chromium, or a compatible Chromium executable passed with `--chrome`
- CardKit resources prepared with `bun run setup-assets`
- A compatible installed Lark client only when using `--renderer client`

The simulator does not need Lark installed. The current end-to-end tests have run on macOS. Linux and Windows support has not yet been verified.

Resource setup downloads files from Feishu and Go's official repository. It checks SHA-256 hashes and stores the files in `~/.cache/lark-card`. Set `LARK_CARD_CACHE` to choose another directory. Do not redistribute the downloaded assets without confirming their license.

## Setup

```sh
bun install --frozen-lockfile --ignore-scripts
bunx playwright-core install --only-shell chromium
bun run setup-assets
```

Linux may require additional system packages for Chromium. Playwright documents those requirements.

## CLI

```sh
bun src/cli.ts --help
bun src/cli.ts compile examples/basic.card.json > card-vr.json
bun src/cli.ts render examples/basic.card.json --platform pc -o card-pc.png
bun src/cli.ts render examples/basic.card.json --platform ios -o card-ios.png
bun src/cli.ts render-batch card-a.json card-b.json --output-dir previews
bun src/cli.ts migrate legacy.json > card-v2.json
cat legacy.json | bun src/cli.ts migrate - | bun src/cli.ts compile -
```

`compile` writes the official compiled VR and warnings as JSON to stdout. `migrate` writes Card JSON to stdout and warnings as JSON to stderr. `render` writes PNG bytes to stdout unless `--output` is set; compilation and simulator conversion warnings go to stderr. Errors are JSON on stderr and cause a nonzero exit status. `--variables` accepts a CardKit variables JSON array. The default locale is `zh_cn`; `--theme dark` renders the dark palette. `migrate` refuses an independent (non-shared) V1 card unless `--allow-shared` is passed, because V2 supports only shared cards.

`render-batch` renders every listed file in PC and iOS layouts. It writes `manifest.json` in the output directory and the same JSON to stdout; each result includes the input, renderer, platform, output, status, warnings, and any error. A failed result makes the command exit nonzero. The manifest is updated after each result; after interruption, `pending` entries are not confirmed complete and may have a partial output. The manifest and PNGs are created exclusively, not overwritten; use a fresh output directory for another run. Batch accepts files only, not stdin or `--variables`.

The default renderer is `simulator`. Use `--renderer client` for the installed Lark client renderer. On macOS the client renderer uses the default Lark application path. On other systems pass `--webcontent` with the directory containing the compatible client archives. Use `--chrome` to select a Chromium executable instead of Playwright's installed Chromium.

A single-render output file is overwritten if it already exists, except when it is the card or variables input file (including a hard link or symlink).

## Library

```ts
import { compile, migrate, render, CardError } from 'lark-card';

const project = { card, variables: [] };
const compiled = await compile(project, 'zh_cn');           // official VR + warnings
const migrated = await migrate(project, { allowShared: true }); // { project, compiled, warnings }
const { png, warnings } = await render(project, { platform: 'ios', theme: 'dark' });
```

`render` accepts the same `renderer`, `locale`, `platform`, `theme`, `chrome` and `webcontent` options as the CLI. Failures throw `CardError`; branch on `error.code`, see Errors below.

## Visual editor

```sh
bun run serve --port 4174
```

Open http://127.0.0.1:4174/ for the CardKit editor. To enable the optional client preview, run `bun run serve --renderer client --port 4174` and open http://127.0.0.1:4174/preview. On non-macOS systems also pass `--webcontent`.

## Review workflow

For a request to review all business cards, enumerate static JSON, dynamic generators, states, and roles in the business project. Generate each case from a real call or test fixture. Record whether each case was generated and reviewed in PC and iOS layouts, plus any gaps and their reasons. This tool does not discover every business state.

Use the simulator for routine PC and iOS layout checks. For key cards or a missing component, compare the source JSON and compiled VR with the client renderer. The client renderer has omitted Markdown link text; the simulator has omitted a collapsible panel. These observations concern local previews, not every Lark release. Neither renderer replaces a real-client check.

Check text clipping, button width, wrapping, visual hierarchy, and the distance between inputs and their actions. Preserve form ownership, control names, button actions and values, links, and role visibility. A screenshot cannot prove that submission, callbacks, or permissions work. A successful PNG does not prove that every component appeared. Render warnings are reported on stderr, in the batch manifest and in `render().warnings`. `resource_unresolved` means the compiled card references images or people that the local host cannot resolve. `simulator_component_count_decreased` names a component tag and the input paths the simulator dropped; compare with the client renderer before changing the card. `renderer_diagnostic` carries a host event that degraded the preview. Inspect the PNG and verify in a real client.

The Agent workflow is in `skills/lark-card/SKILL.md`.

## Layout

| Path | Owns |
| --- | --- |
| `src/cli.ts`, `src/serve.ts` | Thin entrypoints: parse argv, dispatch. |
| `src/index.ts` | The single public API: `compile`, `migrate`, `render`. |
| `src/errors.ts` | The closed set of error codes and their HTTP statuses. |
| `src/card/` | Pure Card JSON rules: schema, locales, V1 → V2 conversion. No I/O. |
| `src/compiler/` | Hosts the official CardKit WASM compiler in a worker. |
| `src/assets/` | Pinned remote assets, cache, integrity checks and `setup-assets`. |
| `src/preview/` | Loopback server, simulator and client renderers, preview warnings. |
| `src/browser/` | Code that runs in the editor and preview pages. |
| `examples/` | Sample cards served by the editor and used in this README. |

## Errors

Failures are JSON on stderr (`code`, `message`, optional `details`) and a nonzero exit status. `code` is from a closed set; any other failure is reported as `render_failed`. Branch on `code`, not on `message`.

| Caller must | Codes |
| --- | --- |
| Fix the call | `usage_invalid`, `locale_invalid`, `card_json_invalid` (also for malformed variables) |
| Fix the card | `card_compile_failed`, `card_component_failed` (`details` lists each failed component path, tag and code), `migration_source_invalid`, `migration_requires_manual`, `migration_locale_structure_mismatch`, `simulator_empty_card`, `simulator_render_failed` |
| Get the user's decision | `migration_requires_shared`: rerun with `--allow-shared` only if converting to shared mode is acceptable |
| Fix the environment | `assets_unavailable`: run `bun run setup-assets`. `client_unavailable`: check `--webcontent` and the Lark installation |
| Use a fresh target | `batch_output_exists`: choose a new `--output-dir` |
| Report or retry once | `compiler_timeout`, `compiler_runtime_failed`, `render_failed` |

`request_too_large` is returned only by the editor's local HTTP API.

## Verification

```sh
bun run check
bun test tests/unit   # no assets, browser or network needed
bun test tests        # needs prepared assets and Chromium; client tests also need Lark
```

Set `LARK_CARD_CHROME` to run the integration tests against a specific Chromium executable. The GitHub workflow runs type checking and `tests/unit` on Linux; it does not establish cross-platform rendering support.

## Limits

Import only trusted cards and variables. The server listens on loopback and restricts origins and external resources. It cannot resolve all people, images, or other host resources. Mobile layout preview is not a test on a mobile device.

Project source is TypeScript. Bun transpiles browser modules when the local server starts. Vendor files are downloaded separately. The project has no selected license yet.
