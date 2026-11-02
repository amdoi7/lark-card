import { expect, test } from 'bun:test';
import {
  conversionWarnings,
  diagnosticWarnings,
  resourceWarnings,
} from '../../src/preview/warnings.ts';

test('reports components lost in the editor round trip, with their input paths', () => {
  const input = {
    body: { elements: [{ tag: 'markdown' }, { tag: 'collapsible_panel', elements: [] }] },
  };
  const exported = { body: { elements: [{ tag: 'markdown' }] } };
  expect(conversionWarnings(input, exported)).toEqual([
    {
      code: 'simulator_component_count_decreased',
      tag: 'collapsible_panel',
      inputCount: 1,
      exportedCount: 0,
      candidatePaths: ['card.body.elements[1]'],
    },
  ]);
});

test('component-like tags inside opaque fields are not components', () => {
  const input = { body: { elements: [{ tag: 'button', value: { tag: 'not_a_component' } }] } };
  expect(conversionWarnings(input, { body: { elements: [{ tag: 'button' }] } })).toEqual([]);
});

test('lists only resource kinds the compiler left unresolved', () => {
  const compiled = (attachment: unknown) =>
    ({ attachment }) as Parameters<typeof resourceWarnings>[0];
  expect(
    resourceWarnings(compiled({ images: { img_x: {} }, atUsers: {}, characters: { c: {} } })),
  ).toEqual([{ code: 'resource_unresolved', resources: ['images', 'characters'] }]);
  expect(resourceWarnings(compiled({ images: {} }))).toEqual([]);
});

test('keeps renderer diagnostics that indicate a degraded preview and drops the rest', () => {
  expect(
    diagnosticWarnings([
      { operation: 'compiler.warning', detail: 1 },
      { operation: 'host.unavailable', detail: 2 },
      { operation: 'toast.info', detail: 3 },
    ]),
  ).toEqual([{ code: 'renderer_diagnostic', operation: 'host.unavailable', detail: 2 }]);
});
