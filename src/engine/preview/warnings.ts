import { transformNodes } from '../../core/schema.ts';
import type { CompiledCard } from '../compiler/index.ts';

export type Diagnostic = { operation: string; detail: unknown };

export type RenderWarning =
  | {
      code: 'simulator_component_count_decreased';
      tag: string;
      inputCount: number;
      exportedCount: number;
      candidatePaths: string[];
    }
  | {
      code: 'resource_unresolved';
      resources: string[];
    }
  | {
      code: 'renderer_diagnostic';
      operation: string;
      detail: unknown;
    };

// Components present in the input card but missing after the editor round trip (the simulator drops what it cannot load).
export function conversionWarnings(input: unknown, exported: unknown): RenderWarning[] {
  function components(card: unknown) {
    const tags = new Map<string, string[]>();
    transformNodes(card, (node, path) => {
      if (typeof node.tag === 'string') tags.set(node.tag, [...(tags.get(node.tag) ?? []), path]);
      return node;
    });
    return tags;
  }
  const original = components(input),
    converted = components(exported);
  return [...original].flatMap(([tag, candidatePaths]) => {
    const exportedCount = converted.get(tag)?.length ?? 0;
    return exportedCount < candidatePaths.length
      ? [
          {
            code: 'simulator_component_count_decreased' as const,
            tag,
            inputCount: candidatePaths.length,
            exportedCount,
            candidatePaths,
          },
        ]
      : [];
  });
}

export function resourceWarnings(compiled: CompiledCard): RenderWarning[] {
  const attachment = compiled.attachment as Record<string, Record<string, unknown>>;
  const resources = ['images', 'atUsers', 'characters'].filter(
    (name) => Object.keys(attachment[name] ?? {}).length > 0,
  );
  return resources.length ? [{ code: 'resource_unresolved', resources }] : [];
}

export function diagnosticWarnings(diagnostics: Diagnostic[]): RenderWarning[] {
  const relevant = new Set([
    'host.unavailable',
    'frame.error',
    'engine.error',
    'render.failed',
    'resource.resolve',
    'runtime.error',
    'runtime.rejection',
  ]);
  return diagnostics
    .filter((item) => relevant.has(item.operation))
    .map((item) => ({ code: 'renderer_diagnostic', ...item }));
}
