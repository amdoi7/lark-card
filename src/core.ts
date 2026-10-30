import { compileCard } from '../runtime/compile.ts';
import { migrateCard } from '../runtime/migrate.ts';
import type { Card } from './card-input';
import { renderCard } from './render';

export type { Card } from './card-input';

export type CardProject = {
  card: Card;
  variables?: readonly unknown[];
};

export type CompiledCard = Awaited<ReturnType<typeof compileCard>>;

export type PreviewOptions = {
  locale?: string;
  platform?: 'pc' | 'ios';
  theme?: 'light' | 'dark';
  chrome?: string;
} & (
  | { renderer?: 'simulator'; webcontent?: never }
  | { renderer: 'client'; webcontent?: string }
);

export type PreviewWarning = {
  code: 'simulator_component_count_decreased';
  tag: string;
  inputCount: number;
  exportedCount: number;
  candidatePaths: string[];
};

export type Preview = {
  png: Buffer;
  renderer: 'simulator' | 'client';
  compiled: CompiledCard;
  warnings: PreviewWarning[];
};

export function compile(project: CardProject, locale = 'zh_cn'): Promise<CompiledCard> {
  return compileCard(project.card, locale, project.variables);
}

export function render(project: CardProject, options: PreviewOptions = {}): Promise<Preview> {
  return renderCard(project, options);
}

export async function migrate(project: CardProject, options: { locale?: string; allowShared?: boolean } = {}) {
  const result = await migrateCard(project.card, { ...options, variables: project.variables });
  return {
    project: { ...project, card: result.card },
    compiled: result.compiled!,
    warnings: result.warnings,
  };
}
