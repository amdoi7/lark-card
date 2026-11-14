import type { CardProject } from './core/schema.ts';
import { compileCard, migrateCard, type CompiledCard } from './engine/compiler/index.ts';

export type { Card, CardProject } from './core/schema.ts';
export type { CompiledCard };
export type { RenderResult, RenderWarning } from './engine/preview/render.ts';
export { CardError, type ErrorCode } from './core/errors.ts';
export { render, type RenderOptions } from './engine/preview/session.ts';

export function compile(project: CardProject, locale = 'zh_cn'): Promise<CompiledCard> {
  return compileCard(project.card, locale, project.variables);
}

export async function migrate(
  project: CardProject,
  options: { locale?: string; allowShared?: boolean } = {},
) {
  const result = await migrateCard(project.card, { ...options, variables: project.variables });
  return {
    project: { ...project, card: result.card },
    compiled: result.compiled,
    warnings: result.warnings,
  };
}
