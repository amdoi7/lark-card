import type { CardProject } from './card/input.ts';
import { compileCard, type CompiledCard } from './compiler/compile.ts';
import { migrateCard } from './migrate.ts';

export type { Card, CardProject } from './card/input.ts';
export type { CompiledCard } from './compiler/compile.ts';
export { render, type RenderResult, type RenderOptions, type RenderWarning } from './preview/render.ts';

export function compile(project: CardProject, locale = 'zh_cn'): Promise<CompiledCard> {
  return compileCard(project.card, locale, project.variables);
}

export async function migrate(project: CardProject, options: { locale?: string; allowShared?: boolean } = {}) {
  const result = await migrateCard(project.card, { ...options, variables: project.variables });
  return { project: { ...project, card: result.card }, compiled: result.compiled, warnings: result.warnings };
}
