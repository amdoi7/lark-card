import { convertV1ToV2 } from './card/v1-to-v2.ts';
import { compileCard } from './compiler/compile.ts';

// Converts a V1 card to V2, then has the official compiler accept it in every declared locale.
export async function migrateCard(
  input: unknown,
  {
    locale,
    allowShared,
    variables,
  }: { locale?: string; allowShared?: boolean; variables?: unknown } = {},
) {
  const { card, warnings, chosen, locales } = convertV1ToV2(input, { locale, allowShared });
  const compiled = await compileCard(card, chosen, variables);
  for (const language of locales) {
    if (language !== chosen) await compileCard(card, language, variables);
  }
  return { card, compiled, warnings };
}
