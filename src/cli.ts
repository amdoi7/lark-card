#!/usr/bin/env bun
import { readFile, stat, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { InputError, parseCard } from './card-input';
import { renderBatch } from './batch';
import { compile, migrate, render, type PreviewOptions } from './core';
import { supportedLocales } from '../runtime/input.ts';

const help = `lark-card <command> <card.json|-> [options]

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

Use - to read JSON from stdin. Errors and warnings are JSON on stderr.
`;

async function writeStdout(data: string | Buffer) {
  await new Promise<void>((resolve, reject) => process.stdout.write(data, error => error ? reject(error) : resolve()));
}

async function readInput(path: string): Promise<string> {
  return path === '-' ? Bun.stdin.text() : readFile(path, 'utf8');
}

async function main() {
  const { values, positionals, tokens } = parseArgs({
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
  if (values.help) { await writeStdout(help); return; }
  if (positionals[0] === 'render-batch') {
    const inputs = positionals.slice(1);
    if (!inputs.length || inputs.includes('-') || !values['output-dir']) throw new InputError('render-batch requires card files and --output-dir.');
    if (values.output || values.variables || values.platform || values['allow-shared']) throw new InputError('render-batch does not accept --output, --variables, --platform or --allow-shared.');
    const renderer = values.renderer ?? 'simulator', theme = values.theme ?? 'light', locale = values.locale ?? 'zh_cn';
    if (renderer !== 'simulator' && renderer !== 'client') throw new InputError('renderer must be simulator or client.');
    if (theme !== 'light' && theme !== 'dark') throw new InputError('theme must be light or dark.');
    if (!supportedLocales.includes(locale)) throw new InputError(`Unsupported locale: ${locale}.`);
    if (renderer !== 'client' && values.webcontent) throw new InputError('--webcontent requires --renderer client.');
    const options: PreviewOptions = renderer === 'client'
      ? { renderer, webcontent: values.webcontent, locale, theme, chrome: values.chrome }
      : { renderer, locale, theme, chrome: values.chrome };
    const manifest = await renderBatch(inputs, values['output-dir'], options);
    await writeStdout(JSON.stringify(manifest) + '\n');
    if (manifest.results.some(result => result.status === 'error')) process.exitCode = 1;
    return;
  }
  if (values['output-dir']) throw new InputError('--output-dir is only valid for render-batch.');
  if (positionals.length !== 2 || !['compile', 'migrate', 'render'].includes(positionals[0])) {
    throw new InputError('Expected compile, migrate or render followed by a card file or -. Use --help for usage.');
  }
  const [operation, input] = positionals;
  const renderOnly = new Set(['output', 'renderer', 'platform', 'theme', 'chrome', 'webcontent']);
  const invalid = tokens.find(token => token.kind === 'option' && (
    (operation !== 'render' && renderOnly.has(token.name)) || (operation !== 'migrate' && token.name === 'allow-shared')
  ));
  if (invalid?.kind === 'option') throw new InputError(`Option --${invalid.name} is not valid for ${operation}.`);
  if (input === '-' && values.variables === '-') throw new InputError('Card and variables cannot both read from stdin.');
  if (operation === 'render' && values.output) {
    const target = await stat(values.output).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (target) {
      for (const path of [input, values.variables]) {
        if (!path || path === '-') continue;
        const source = await stat(path);
        if (target.dev === source.dev && target.ino === source.ino) throw new InputError('Output must not overwrite a card or variables input file.');
      }
    }
  }
  const locale = values.locale ?? 'zh_cn';
  if (!supportedLocales.includes(locale)) throw new InputError(`Unsupported locale: ${locale}.`);
  const card = parseCard(await readInput(input));
  let variables: unknown[] = [];
  if (values.variables) {
    let parsed: unknown;
    try { parsed = JSON.parse(await readInput(values.variables)); }
    catch (error) { if (error instanceof SyntaxError) throw new InputError('Variables must be valid JSON.'); throw error; }
    if (!Array.isArray(parsed)) throw new InputError('Variables must be an array.');
    variables = parsed;
  }
  const project = { card, variables };
  if (operation === 'compile') {
    await writeStdout(JSON.stringify(await compile(project, locale)) + '\n');
    return;
  }
  if (operation === 'migrate') {
    const result = await migrate(project, { locale, allowShared: values['allow-shared'] });
    if (result.warnings.length) console.error(JSON.stringify({ operation: 'migrate', warnings: result.warnings }));
    await writeStdout(JSON.stringify(result.project.card) + '\n');
    return;
  }
  const renderer = values.renderer ?? 'simulator';
  const platform = values.platform ?? 'pc';
  const theme = values.theme ?? 'light';
  if (renderer !== 'simulator' && renderer !== 'client') throw new InputError('renderer must be simulator or client.');
  if (platform !== 'pc' && platform !== 'ios') throw new InputError('platform must be pc or ios.');
  if (theme !== 'light' && theme !== 'dark') throw new InputError('theme must be light or dark.');
  if (renderer !== 'client' && values.webcontent) throw new InputError('--webcontent requires --renderer client.');
  const options: PreviewOptions = renderer === 'client'
    ? { renderer, webcontent: values.webcontent, locale, platform, theme, chrome: values.chrome }
    : { renderer, locale, platform, theme, chrome: values.chrome };
  const result = await render(project, options);
  const warnings = [...result.compiled.warnings, ...result.warnings];
  if (warnings.length) console.error(JSON.stringify({ operation: 'render', warnings }));
  if (values.output) await writeFile(values.output, result.png);
  else await writeStdout(result.png);
}

try { await main(); }
catch (error) {
  const failure = error as Error & { code?: string; details?: unknown };
  const knownCodes = new Set(['batch_output_exists', 'card_json_invalid', 'card_compile_failed', 'card_component_failed', 'compiler_timeout', 'migration_source_invalid', 'migration_requires_shared', 'migration_requires_manual', 'migration_locale_structure_mismatch', 'simulator_empty_card', 'simulator_render_failed']);
  const code = knownCodes.has(failure.code ?? '') ? failure.code : 'render_failed';
  console.error(JSON.stringify({ operation: 'lark-card', code, message: failure.message, ...(failure.details ? { details: failure.details } : {}) }));
  process.exitCode = 1;
}
