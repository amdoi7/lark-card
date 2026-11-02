import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/async';

const core = fileURLToPath(new URL('../src/core/', import.meta.url));
const files = (await readdir(core, { recursive: true }))
  .filter((file) => file.endsWith('.ts'))
  .sort();
const effectfulGlobals = new Set([
  'Bun',
  'Deno',
  'process',
  'globalThis',
  'window',
  'document',
  'navigator',
  'console',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'require',
  'eval',
  'Function',
  'setTimeout',
  'setInterval',
  'setImmediate',
]);

test.each(files)('core/%s has only core dependencies and no runtime I/O globals', async (file) => {
  const path = resolve(core, file);
  await using resources = new AsyncDisposableStack();
  const root = resolve(core, '../..');
  const config = resolve(root, 'tsconfig.json');
  const api = new API({ cwd: root });
  resources.defer(() => api.close());
  const snapshot = await api.updateSnapshot({ openProjects: [config] });
  const project = snapshot.getProject(config);
  if (!project) throw Error(`TypeScript did not load project: ${config}`);
  const source = await project.program.getSourceFile(path);
  if (!source) throw Error(`TypeScript did not load source: ${path}`);
  const violations: string[] = [];
  function inspect(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const target = relative(core, resolve(dirname(path), specifier));
      if (!specifier.startsWith('.') || target.startsWith('..'))
        violations.push(`External dependency: ${specifier}`);
    }
    if (ts.isIdentifier(node) && effectfulGlobals.has(node.text))
      violations.push(`Runtime I/O global: ${node.text}`);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      violations.push('Dynamic import');
    node.forEachChild(inspect);
  }
  inspect(source);
  expect(violations).toEqual([]);
});
