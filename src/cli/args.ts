import { parseArgs } from 'node:util';
import { assertLocale } from '../core/locales.ts';
import { CardError } from '../core/errors.ts';
import type { RenderOptions } from '../index.ts';

export const helpText = `lark-card <command> <card.json|-> [options]

Commands:
  compile   Compile V1 or V2 card JSON to CardKit VR JSON.
  migrate   Convert V1 card JSON to V2 card JSON.
  render    Render card JSON to PNG using CardKit simulator by default.
  render-batch <files...> --output-dir <dir>  Render PC and iOS PNGs with a manifest.

Common options:
  --variables <file|->  CardKit variables JSON array.
  --locale <locale>     Card locale. Default: zh_cn.
  -h, --help            Show this help.

Render options:
  -o, --output <file>   Write PNG to a file instead of stdout.
  --renderer <name>     simulator or client. Default: simulator.
  --platform <name>     pc or ios. Default: pc.
  --theme <name>        light or dark. Default: light.
  --chrome <path>       Chromium executable. Default: Playwright Chromium.
  --webcontent <path>   Installed Lark archives. Requires --renderer client.

Migrate options:
  --allow-shared        Allow conversion of an independent card to shared mode.

Use - to read JSON from stdin. Errors are JSON on stderr.
Compile and batch warnings are in stdout JSON; migrate/render warnings are on stderr.
`;

export function usageError(message: string) {
  return new CardError('usage_invalid', message);
}

export function parseCli() {
  return parseArgs({
    allowPositionals: true,
    tokens: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      output: { type: 'string', short: 'o' },
      'output-dir': { type: 'string' },
      variables: { type: 'string' },
      locale: { type: 'string' },
      renderer: { type: 'string' },
      platform: { type: 'string' },
      theme: { type: 'string' },
      chrome: { type: 'string' },
      webcontent: { type: 'string' },
      'allow-shared': { type: 'boolean' },
    },
  });
}

export type CliValues = ReturnType<typeof parseCli>['values'];

export function localeOption(locale = 'zh_cn') {
  assertLocale(locale);
  return locale;
}

function oneOf<const T extends string>(name: string, value: string, allowed: readonly T[]): T {
  const selected = allowed.find((option) => option === value);
  if (selected === undefined) throw usageError(`${name} must be ${allowed.join(' or ')}.`);
  return selected;
}

export function renderOptions(
  values: CliValues,
  locale: string,
  platformName?: string,
): RenderOptions {
  const renderer = oneOf('renderer', values.renderer ?? 'simulator', ['simulator', 'client']);
  const platform =
    platformName === undefined ? undefined : oneOf('platform', platformName, ['pc', 'ios']);
  const theme = oneOf('theme', values.theme ?? 'light', ['light', 'dark']);
  if (renderer !== 'client' && values.webcontent)
    throw usageError('--webcontent requires --renderer client.');
  const common = { locale, platform, theme, chrome: values.chrome };
  return renderer === 'client'
    ? { ...common, renderer, webcontent: values.webcontent }
    : { ...common, renderer };
}
