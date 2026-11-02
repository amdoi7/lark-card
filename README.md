# lark-card

Compile, migrate, and preview Lark and Feishu card JSON files locally. The command-line tool and library use the CardKit compiler and simulator. The browser editor uses the CardKit visual designer. Card data stays local; the tools do not publish cards or execute business callbacks.

## Setup

Compilation and migration require Bun 1.4.4 and prepared CardKit assets, not a browser. PNG rendering additionally requires Chromium: install Playwright Chromium or pass a browser path with `--chrome`. The client renderer also requires Lark installed locally. End-to-end tests have run on macOS only.

```sh
bun install --frozen-lockfile --ignore-scripts
bunx playwright-core install --only-shell chromium
bun run setup-assets
```

The command `bun run setup-assets` downloads CardKit files from Feishu and the Go repository, verifies their SHA-256 hashes, and stores them in `~/.cache/lark-card`. Set `LARK_CARD_CACHE` in the environment to choose a different directory. Confirm asset licenses before redistributing downloaded files.

## Command line

```sh
bun src/cli/index.ts compile examples/basic.card.json > card-vr.json
bun src/cli/index.ts render examples/basic.card.json --platform ios --theme dark -o card.png
bun src/cli/index.ts render-batch card-a.json card-b.json --output-dir previews
bun src/cli/index.ts migrate legacy.json > card-v2.json
```

The installed command is `lark-card`; from a source checkout, use `bun src/cli/index.ts`. Run it with `--help` to list all options. Card input comes from a file path or `-` for standard input. The default locale is `zh_cn`. Use `--variables` to pass a JSON array of CardKit variables. Card and variables cannot both read from stdin.

- `compile` converts Card JSON to CardKit intermediate format (VR) and writes the result, including its `warnings` array, as JSON to standard output. VR is a diagnostic snapshot, not source Card JSON.
- `migrate` converts version 1 card JSON to version 2 card JSON. Version 2 supports only shared cards. The command rejects independent cards unless you pass `--allow-shared`. Card JSON writes to standard output and warnings write to standard error.
- `render` generates a PNG preview. It writes PNG bytes to standard output or to the path passed to `--output`. The command overwrites an existing output file, but exits with an error if the output path matches the card input file or the variables file, including hard links and symbolic links. Warnings write to standard error.
- `render-batch` renders each card file in desktop and mobile layouts into a directory specified by `--output-dir`. A fresh directory is recommended. The command creates missing directories, refuses to replace an existing `manifest.json`, and never overwrites existing PNGs. It prints the manifest JSON to standard output; warnings are attached to each result. It updates the manifest after completing each card. If a process stops early, entries marked `pending` in the manifest may have incomplete output files. The process exits with code 1 if any card fails. The command accepts file paths only, not standard input, `--variables`, or `--platform`.
- The default renderer is the CardKit simulator. Pass `--renderer client` to render with the local Lark application. On macOS, the tool locates the installed application automatically. On other systems, pass `--webcontent` with the path to the directory with Lark webcontent archives.

## Library

```ts
import { compile, migrate, render, CardError } from 'lark-card';

const project = { card, variables: [] };
const compiled = await compile(project, 'zh_cn');
const migrated = await migrate(project, { allowShared: true });
const { png, warnings } = await render(project, { platform: 'ios', theme: 'dark' });
```

The public runtime exports are `compile`, `migrate`, `render`, and `CardError`. Import them from `lark-card`; engine, browser, and CLI modules are internal rather than package subpath exports. The root also exports the types `Card`, `CardProject`, `CompiledCard`, `ErrorCode`, `RenderOptions`, `RenderResult`, and `RenderWarning`.

`render` accepts the same `renderer`, `locale`, `platform`, `theme`, `chrome`, and `webcontent` options as the command-line tool. Functions throw `CardError` on failure.

## Visual editor

```sh
bun run serve --port 4174
bun run serve --renderer client --port 4174
```

Start the editor at http://127.0.0.1:4174. When started with `--renderer client`, the client preview page is available at `/preview`.

## Errors

On failure, the `lark-card` CLI prints a JSON error record to standard error and exits with code 1. Preview runtime diagnostics may precede the final error record. The object contains `code`, `message`, and optional `details`. Branch on `code` rather than reading `message`.

| Action | Codes | Notes |
| --- | --- | --- |
| Fix command arguments or input | `usage_invalid`, `locale_invalid`, `card_json_invalid` | The code `card_json_invalid` also covers malformed variable arrays. |
| Inspect compiler or migration diagnostics | `card_compile_failed`, `card_component_failed`, `migration_source_invalid`, `migration_requires_manual`, `migration_locale_structure_mismatch` | `card_compile_failed` retains the compiler diagnostic in `details.message`; `card_component_failed` lists each failed component's path, tag, and error code in `details`. |
| Check simulator support | `simulator_empty_card`, `simulator_render_failed` | These do not by themselves prove that the source card is invalid. Cross-check source, compiler output, and an available client renderer. |
| Confirm mode change with user | `migration_requires_shared` | Version 2 cards must be shared. Rerun with `--allow-shared` only after confirming with the user. |
| Set up required files | `assets_unavailable`, `client_unavailable` | Run `bun run setup-assets` for asset errors, or verify Lark files for client renderer errors. |
| Choose a new path | `batch_output_exists` | Pass a directory path that does not exist. |
| Diagnose or report | `compiler_timeout`, `compiler_runtime_failed`, `render_failed` | Check input, flags, assets, and browser prerequisites. Retry once only with evidence of a transient cause; do not blindly retry deterministic failures. |

## Development

| Path | Responsibility |
| --- | --- |
| `src/cli/` | `args.ts` owns flag definitions and option validation; `index.ts` executes commands; `serve.ts` starts the local preview server. |
| `src/index.ts` | Exports public library functions and error types. |
| `src/core/` | Pure card schema checks, locale selection, compiler-input normalization, version conversion, and the closed error-code set. No runtime I/O or dependencies outside core. |
| `src/engine/compiler/` | Runs compilation and migration validation through one lazy, persistent worker. WASM is loaded and instantiated once per worker; requests run serially with a 15-second execution timeout. Idle workers do not keep the CLI process alive. |
| `src/assets/` | Manages downloaded assets, cache files, hash verification, and the asset setup command. |
| `src/engine/preview/` | Owns rendering sessions, single-card and batch rendering, the local HTTP server, HTTP error-status mapping, and preview warnings. `session.ts` owns browser and server lifetimes; `render.ts` drives pages and screenshots. |
| `src/browser/` | Contains browser scripts for the visual editor and preview pages. |

Development uses the TypeScript 7 native compiler, Oxfmt for formatting, and Oxlint for static linting. Dependencies are pinned in `package.json` and `bun.lock`.

```sh
bun run format       # Format TypeScript sources/tests and tooling JSON.
bun run check        # Check formatting, reject lint warnings, and type-check.
bun test tests/unit tests/architecture.test.ts
bun test tests
```

Run `bun run format:check`, `bun run lint`, or `bun run typecheck` for an individual gate. CI runs the same `bun run check` command. Formatting does not rewrite browser HTML, generated asset manifests, or documentation.

The unit tests in `tests/unit` run without downloaded assets, browsers, or network access. The architecture tests enforce core-only imports and prohibit runtime I/O globals in `src/core/`. Continuous integration runs both suites. The full test suite in `tests` requires prepared assets and Chromium. Client renderer tests also require Lark installed locally. Set `LARK_CARD_CHROME` to specify a Chromium executable.

## Limits

Import only trusted cards and variables. The local server listens on the loopback interface only and checks request origins. The local environment cannot resolve remote user avatars or image attachments. The mobile preview shows layout sizing rather than mobile device behavior. See [card JSON reference](skills/lark-card/references/card-json.md) for editing guidance and [card review workflows](skills/lark-card/SKILL.md). The project does not currently specify an open source license.
