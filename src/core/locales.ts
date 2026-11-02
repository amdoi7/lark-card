import { CardError } from './errors.ts';
import { transformNodes, type CardDocument } from './schema.ts';

export const supportedLocales = [
  'zh_cn',
  'en_us',
  'ja_jp',
  'zh_hk',
  'zh_tw',
  'id_id',
  'vi_vn',
  'th_th',
  'pt_br',
  'es_es',
  'ko_kr',
  'de_de',
  'fr_fr',
  'it_it',
  'ru_ru',
  'ms_my',
];

export type LocaleWarning = {
  code: 'locale_fallback';
  path: string;
  requested: string;
  selected: string;
};

export function assertLocale(locale: string) {
  if (!supportedLocales.includes(locale))
    throw new CardError('locale_invalid', `Unsupported locale: ${locale}.`);
}

export function contentLocales(card: CardDocument): string[] {
  const locales = new Set(card.config?.locales || []);
  transformNodes(card, (node) => {
    for (const key of [
      'i18n_content',
      'i18n_default_value',
      'i18n_img_key',
      'i18n_text_tag_list',
      'i18n_file_key',
    ]) {
      if (node[key]) Object.keys(node[key] as object).forEach((locale) => locales.add(locale));
    }
    return node;
  });
  return [...locales];
}

export function v1Locales(input: CardDocument): string[] {
  const locales: string[] = [];
  for (const key of ['i18n_elements', 'i18n_header'] as const) {
    if (input[key] === undefined) continue;
    const map = input[key];
    if (!map || typeof map !== 'object' || Array.isArray(map))
      throw new CardError('card_json_invalid', `${key} must map locales to content.`);
    for (const [locale, value] of Object.entries(map)) {
      assertLocale(locale);
      if (key === 'i18n_elements' && !Array.isArray(value))
        throw new CardError('card_json_invalid', `i18n_elements.${locale} must be an array.`);
      locales.push(locale);
    }
  }
  return [...new Set(locales)];
}

export function localized(
  map: Record<string, unknown> | undefined,
  fallback: unknown,
  locale: string,
  warnings: LocaleWarning[],
  path: string,
): unknown {
  if (!map || !Object.keys(map).length) return fallback;
  const selected = Object.hasOwn(map, locale)
    ? locale
    : Object.hasOwn(map, 'en_us')
      ? 'en_us'
      : Object.keys(map)[0];
  if (selected !== locale)
    warnings.push({ code: 'locale_fallback', path, requested: locale, selected });
  return map[selected];
}
