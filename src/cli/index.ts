#!/usr/bin/env bun
import { readFile, stat, writeFile } from 'node:fs/promises';
import { renderBatch } from '../engine/preview/batch.ts';
import { parseCard } from '../core/schema.ts';
import { asCardError, CardError } from '../core/errors.ts';
import { compile, migrate, render } from '../index.ts';
import {
  helpText,
  localeOption,
  parseCli,
  renderOptions,
  usageError,
  type CliValues,
} from './args.ts';

async function writeStdout(data: string | Buffer) {
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(data, (error) => (error ? reject(error) : resolve())),
  );
}

async function readInput(path: string): Promise<string> {
  return path === '-' ? Bun.stdin.text() : readFile(path, 'utf8');
}

async function runRenderBatch(inputs: string[], values: CliValues) {
  if (!inputs.length || inputs.includes('-') || !values['output-dir'])
    throw usageError('render-batch requires card files and --output-dir.');
  if (values.output || values.variables || values.platform || values['allow-shared'])
    throw usageError(
      'render-batch does not accept --output, --variables, --platform or --allow-shared.',
    );
  const options = renderOptions(values, localeOption(values.locale));
  const manifest = await renderBatch(inputs, values['output-dir'], options);
  await writeStdout(JSON.stringify(manifest) + '\n');
  if (manifest.results.some((result) => result.status === 'error')) process.exitCode = 1;
}

async function main() {
  const { values, positionals, tokens } = parseCli();
  if (values.help) {
    await writeStdout(helpText);
    return;
  }
  if (positionals[0] === 'render-batch') {
    await runRenderBatch(positionals.slice(1), values);
    return;
  }
  if (values['output-dir']) throw usageError('--output-dir is only valid for render-batch.');
  if (positionals.length !== 2 || !['compile', 'migrate', 'render'].includes(positionals[0])) {
    throw usageError(
      'Expected compile, migrate or render followed by a card file or -. Use --help for usage.',
    );
  }
  const [operation, input] = positionals;
  const renderOnly = new Set(['output', 'renderer', 'platform', 'theme', 'chrome', 'webcontent']);
  const invalid = tokens.find(
    (token) =>
      token.kind === 'option' &&
      ((operation !== 'render' && renderOnly.has(token.name)) ||
        (operation !== 'migrate' && token.name === 'allow-shared')),
  );
  if (invalid?.kind === 'option')
    throw usageError(`Option --${invalid.name} is not valid for ${operation}.`);
  if (input === '-' && values.variables === '-')
    throw usageError('Card and variables cannot both read from stdin.');
  if (operation === 'render' && values.output) {
    const target = await stat(values.output).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (target) {
      for (const path of [input, values.variables]) {
        if (!path || path === '-') continue;
        const source = await stat(path);
        if (target.dev === source.dev && target.ino === source.ino)
          throw usageError('Output must not overwrite a card or variables input file.');
      }
    }
  }
  const locale = localeOption(values.locale);
  const card = parseCard(await readInput(input));
  let variables: unknown[] = [];
  if (values.variables) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readInput(values.variables));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new CardError('card_json_invalid', 'Variables must be valid JSON.');
      throw error;
    }
    if (!Array.isArray(parsed))
      throw new CardError('card_json_invalid', 'Variables must be an array.');
    variables = parsed;
  }
  const project = { card, variables };
  if (operation === 'compile') {
    await writeStdout(JSON.stringify(await compile(project, locale)) + '\n');
    return;
  }
  if (operation === 'migrate') {
    const result = await migrate(project, { locale, allowShared: values['allow-shared'] });
    if (result.warnings.length)
      console.error(JSON.stringify({ operation: 'migrate', warnings: result.warnings }));
    await writeStdout(JSON.stringify(result.project.card) + '\n');
    return;
  }
  const result = await render(project, renderOptions(values, locale, values.platform ?? 'pc'));
  const warnings = [...result.compiled.warnings, ...result.warnings];
  if (warnings.length) console.error(JSON.stringify({ operation: 'render', warnings }));
  if (values.output) await writeFile(values.output, result.png);
  else await writeStdout(result.png);
}

try {
  await main();
} catch (error) {
  const failure = asCardError(error, 'render_failed');
  console.error(
    JSON.stringify({
      operation: 'lark-card',
      code: failure.code,
      message: failure.message,
      ...(failure.details ? { details: failure.details } : {}),
    }),
  );
  process.exitCode = 1;
}
