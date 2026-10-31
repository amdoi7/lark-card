# lark-card

Compile, migrate, and preview Lark and Feishu card JSON files locally. The command-line tool and library use the CardKit compiler and simulator. The browser editor uses the CardKit visual designer. Neither tool sends cards to a server or executes business callbacks.

## Setup

The project runs on Bun 1.4.4 and requires Chromium. Install Playwright Chromium or pass a browser path with `--chrome`. The client renderer also requires Lark installed locally. End-to-end tests have run on macOS only.

```sh
bun install --frozen-lockfile --ignore-scripts
bunx playwright-core install --only-shell chromium
bun run setup-assets
```

The command `bun run setup-assets` downloads CardKit files from Feishu and the Go repository, verifies their SHA-256 hashes, and stores them in `~/.cache/lark-card`. Set `LARK_CARD_CACHE` in the environment to choose a different directory. Confirm asset licenses before redistributing downloaded files.

## Command line

```sh
bun src/cli.ts compile examples/basic.card.json > card-vr.json
bun src/cli.ts render examples/basic.card.json --platform ios --theme dark -o card.png
bun src/cli.ts render-batch card-a.json card-b.json --output-dir previews
bun src/cli.ts migrate legacy.json > card-v2.json
```

Run `bun src/cli.ts --help` to list all options. Card input comes from a file path or `-` for standard input. The default locale is `zh_cn`. Use `--variables` to pass a JSON array of CardKit variables.

- `compile` converts card JSON to CardKit intermediate format and writes the result to standard output. Warnings write to standard error.
- `migrate` converts version 1 card JSON to version 2 card JSON. Version 2 supports only shared cards. The command rejects independent cards unless you pass `--allow-shared`. Card JSON writes to standard output and warnings write to standard error.
- `render` generates a PNG preview. It writes PNG bytes to standard output or to the path passed to `--output`. The command overwrites an existing output file, but exits with an error if the output path matches the card input file or the variables file, including hard links and symbolic links. Warnings write to standard error.
- `render-batch` renders each card file in desktop and mobile layouts into a directory specified by `--output-dir`. The directory must not exist before the command runs. The command writes `manifest.json` inside the directory and prints the manifest JSON to standard output. It updates the manifest after completing each card. If a process stops early, entries marked `pending` in the manifest may have incomplete output files. The process exits with code 1 if any card fails. The command accepts file paths only, not standard input, `--variables`, or `--platform`.
- The default renderer is the CardKit simulator. Pass `--renderer client` to render with the local Lark application. On macOS, the tool locates the installed application automatically. On other systems, pass `--webcontent` with the path to the directory with Lark webcontent archives.

## Library

```ts
import { compile, migrate, render, CardError } from 'lark-card';

const project = { card, variables: [] };
const compiled = await compile(project, 'zh_cn');
const migrated = await migrate(project, { allowShared: true });
const { png, warnings } = await render(project, { platform: 'ios', theme: 'dark' });
```

`render` accepts the same `renderer`, `locale`, `platform`, `theme`, `chrome`, and `webcontent` options as the command-line tool. Functions throw `CardError` on failure.

## Visual editor

```sh
bun run serve --port 4174
bun run serve --renderer client --port 4174
```

Start the editor at http://127.0.0.1:4174. When started with `--renderer client`, the client preview page is available at `/preview`.

## Errors

On failure, commands print a JSON object to standard error and exit with code 1. The object contains `code`, `message`, and optional `details`. Branch on `code` rather than reading `message`.

| Action | Codes | Notes |
| --- | --- | --- |
| Fix command arguments or input | `usage_invalid`, `locale_invalid`, `card_json_invalid` | The code `card_json_invalid` also covers malformed variable arrays. |
| Fix card structure | `card_compile_failed`, `card_component_failed`, `migration_source_invalid`, `migration_requires_manual`, `migration_locale_structure_mismatch`, `simulator_empty_card`, `simulator_render_failed` | For `card_component_failed`, `details` lists the path, component tag, and error code for each failed component. |
| Confirm mode change with user | `migration_requires_shared` | Version 2 cards must be shared. Rerun with `--allow-shared` only after confirming with the user. |
| Set up required files | `assets_unavailable`, `client_unavailable` | Run `bun run setup-assets` for asset errors, or verify Lark files for client renderer errors. |
| Choose a new path | `batch_output_exists` | Pass a directory path that does not exist. |
| Retry or report | `compiler_timeout`, `compiler_runtime_failed`, `render_failed` | Retry the command once. If the failure persists, report the error message. |

## Development

| Path | Responsibility |
| --- | --- |
| `src/cli.ts`, `src/serve.ts` | Parse command-line arguments and start the requested command or server. |
| `src/index.ts` | Exports public library functions and error types. |
| `src/errors.ts` | Defines error codes and HTTP status codes. |
| `src/card/` | Implements card schema checks, locale extraction, and version conversion without file or network operations. |
| `src/compiler/` | Runs the CardKit WebAssembly compiler in a worker thread. |
| `src/assets/` | Manages downloaded assets, cache files, hash verification, and the asset setup command. |
| `src/preview/` | Implements the local HTTP server, simulator and client renderers, and preview warning detection. |
| `src/browser/` | Contains browser scripts for the visual editor and preview pages. |

```sh
bun run check
bun test tests/unit
bun test tests
```

The unit tests in `tests/unit` run without downloaded assets, browsers, or network access. Continuous integration runs this suite. The full test suite in `tests` requires prepared assets and Chromium. Client renderer tests also require Lark installed locally. Set `LARK_CARD_CHROME` to specify a Chromium executable.

## Limits

Import only trusted cards and variables. The local server listens on the loopback interface only and checks request origins. The local environment cannot resolve remote user avatars or image attachments. The mobile preview shows layout sizing rather than mobile device behavior. See [card JSON reference](skills/lark-card/references/card-json.md) for editing guidance and [card review workflows](skills/lark-card/SKILL.md). The project does not currently specify an open source license.
