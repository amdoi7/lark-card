# lark-card

Compile, migrate and preview Lark/Feishu Card JSON locally. The CLI and library use the official CardKit compiler and simulator; the visual editor uses the official CardKit designer. Nothing sends a card or runs business callbacks.

## Setup

Requires Bun 1.4.4 and Chromium (Playwright's, or any executable via `--chrome`). The Lark client is needed only for `--renderer client`. End-to-end tests have run on macOS only.

```sh
bun install --frozen-lockfile --ignore-scripts
bunx playwright-core install --only-shell chromium
bun run setup-assets
```

`setup-assets` downloads CardKit files from Feishu and Go's repository, checks their SHA-256 and caches them in `~/.cache/lark-card` (override with `LARK_CARD_CACHE`). Do not redistribute them without checking their license.

## CLI

```sh
bun src/cli.ts compile examples/basic.card.json > card-vr.json
bun src/cli.ts render examples/basic.card.json --platform ios --theme dark -o card.png
bun src/cli.ts render-batch card-a.json card-b.json --output-dir previews
bun src/cli.ts migrate legacy.json > card-v2.json
```

Run `--help` for all options. Cards come from a file or `-` (stdin); `--variables` takes a CardKit variables JSON array; the default locale is `zh_cn`.

- `compile` writes the compiled VR and warnings to stdout.
- `migrate` writes V2 Card JSON to stdout and warnings to stderr. It refuses an independent (non-shared) V1 card unless `--allow-shared` is given, because V2 supports only shared cards.
- `render` writes PNG bytes to stdout, or to `--output`, which is overwritten unless it is the card or variables file (including links). Warnings go to stderr.
- `render-batch` renders each file in PC and iOS layouts into a fresh `--output-dir`, with a `manifest.json` (also printed) listing every result, warning and error. It is updated after each result, so after an interruption `pending` entries may have partial output. Any failed result makes the exit status nonzero. Files only: no stdin, `--variables` or `--platform`.
- `--renderer client` uses the installed Lark client renderer instead of the simulator. On macOS it finds Lark itself; elsewhere pass `--webcontent` with the client archives directory.

## Library

```ts
import { compile, migrate, render, CardError } from 'lark-card';

const project = { card, variables: [] };
const compiled = await compile(project, 'zh_cn');
const migrated = await migrate(project, { allowShared: true }); // { project, compiled, warnings }
const { png, warnings } = await render(project, { platform: 'ios', theme: 'dark' });
```

`render` takes the CLI's `renderer`, `locale`, `platform`, `theme`, `chrome` and `webcontent` options. Failures throw `CardError`.

## Visual editor

```sh
bun run serve --port 4174                      # http://127.0.0.1:4174/
bun run serve --renderer client --port 4174    # also /preview, the client renderer
```

## Errors

Failures are JSON on stderr (`code`, `message`, optional `details`) with a nonzero exit status. `code` comes from a closed set; anything else is `render_failed`. Branch on `code`, not `message`.

| Caller must | Codes |
| --- | --- |
| Fix the call | `usage_invalid`, `locale_invalid`, `card_json_invalid` (also malformed variables) |
| Fix the card | `card_compile_failed`, `card_component_failed` (`details`: path, tag, code per component), `migration_source_invalid`, `migration_requires_manual`, `migration_locale_structure_mismatch`, `simulator_empty_card`, `simulator_render_failed` |
| Get the user's decision | `migration_requires_shared` (rerun with `--allow-shared` only if sharing is acceptable) |
| Fix the environment | `assets_unavailable` (`bun run setup-assets`), `client_unavailable` (check `--webcontent` and the Lark install) |
| Use a fresh target | `batch_output_exists` |
| Report or retry once | `compiler_timeout`, `compiler_runtime_failed`, `render_failed` |

## Development

| Path | Owns |
| --- | --- |
| `src/cli.ts`, `src/serve.ts` | Thin entrypoints |
| `src/index.ts` | The public API |
| `src/errors.ts` | The error codes and their HTTP statuses |
| `src/card/` | Pure Card JSON rules: schema, locales, V1 → V2 (no I/O) |
| `src/compiler/` | The CardKit WASM compiler in a worker |
| `src/assets/` | Pinned downloads, cache, integrity checks, `setup-assets` |
| `src/preview/` | Local server, simulator and client renderers, render warnings |
| `src/browser/` | Code that runs in the editor and preview pages |

```sh
bun run check
bun test tests/unit   # no assets, browser or network; this is what CI runs
bun test tests        # needs assets and Chromium (LARK_CARD_CHROME selects one); client tests need Lark
```

## Limits

Import only trusted cards and variables. The server listens on loopback only and restricts origins. The local host cannot resolve all people or images, and the iOS layout is not a device test. For review workflow and agent guidance see `skills/lark-card/SKILL.md`. No license is selected yet.
