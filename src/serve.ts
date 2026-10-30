#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { asCardError, CardError } from './errors.ts';
import { startPreviewServer } from './preview/server.ts';

try {
  const { values } = parseArgs({ options: { webcontent: { type: 'string' }, renderer: { type: 'string', default: 'simulator' }, port: { type: 'string', default: '4173' } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CardError('usage_invalid', `port_invalid value=${values.port}`);
  if (values.renderer !== 'simulator' && values.renderer !== 'client') throw new CardError('usage_invalid', `renderer_invalid value=${values.renderer}`);
  if (values.webcontent && values.renderer !== 'client') throw new CardError('usage_invalid', 'webcontent_requires_client action="add --renderer client"');
  const server = await startPreviewServer({ webcontent: values.webcontent, port, renderer: values.renderer });
  console.log(JSON.stringify({ operation: 'preview.ready', url: server.url, ...server.runtimeInfo }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close().catch(error => { console.error(error); process.exitCode = 1; }));
} catch (error) {
  const failure = asCardError(error, 'render_failed');
  console.error(JSON.stringify({ operation: 'preview.start', code: failure.code, error: failure.message, action: 'Check --renderer, --webcontent, --port and prepared assets.' }));
  process.exitCode = 1;
}
