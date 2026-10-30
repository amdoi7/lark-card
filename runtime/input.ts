export const supportedLocales = ['zh_cn', 'en_us', 'ja_jp', 'zh_hk', 'zh_tw', 'id_id', 'vi_vn', 'th_th', 'pt_br', 'es_es', 'ko_kr', 'de_de', 'fr_fr', 'it_it', 'ru_ru', 'ms_my'];
const opaqueFields = new Set(['value', 'behaviors', 'chart_spec', 'chartSpec', 'rows']);

export type CardDocument = Record<string, unknown> & {
  schema?: string;
  config?: Record<string, unknown> & { locales?: string[]; update_multi?: boolean };
  elements?: unknown[];
  i18n_elements?: Record<string, unknown>;
  i18n_header?: Record<string, unknown>;
  body?: Record<string, unknown> & { elements?: unknown[] };
  header?: Record<string, unknown> & {
    ud_icon?: { token: unknown; style?: { color?: unknown } };
    icon?: Record<string, unknown>;
  };
};

type LocaleWarning = { code: string; path: string; requested: string; selected: string };

export function cardError(code: string, message: string, details?: unknown) {
  return Object.assign(Error(message), { code, ...(details ? { details } : {}) });
}

export function transformNodes(value: unknown, transform: (node: Record<string, unknown>, path: string) => unknown, path = 'card'): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.flatMap((node, index) => {
    const transformed = transformNodes(node, transform, `${path}[${index}]`);
    return Array.isArray(node) ? [transformed] : transformed;
  });
  const node = Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    opaqueFields.has(key) ? structuredClone(child) : transformNodes(child, transform, `${path}.${key}`),
  ]));
  return transform(node, path);
}

export function localCardLocales(card: CardDocument): string[] {
  const locales = new Set(card.config?.locales || []);
  transformNodes(card, node => {
    for (const key of ['i18n_content', 'i18n_default_value', 'i18n_img_key', 'i18n_text_tag_list', 'i18n_file_key']) {
      if (node[key]) Object.keys(node[key] as object).forEach(locale => locales.add(locale));
    }
    return node;
  });
  return [...locales];
}

export function sourceSchema(input: unknown): '1.0' | '2.0' {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw cardError('card_json_invalid', '输入必须是官方 Card JSON 对象');
  const schema = (input as CardDocument).schema ?? '1.0';
  if (schema !== '1.0' && schema !== '2.0') throw cardError('card_json_invalid', `schema_unsupported value=${schema}`);
  return schema;
}

export function legacyLocales(input: CardDocument): string[] {
  const locales: string[] = [];
  for (const key of ['i18n_elements', 'i18n_header'] as const) {
    if (input[key] === undefined) continue;
    const map = input[key];
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw cardError('card_json_invalid', `${key} 必须是语言到内容的映射`);
    for (const [locale, value] of Object.entries(map)) {
      if (!supportedLocales.includes(locale)) throw cardError('card_json_invalid', `locale_invalid value=${locale}`);
      if (key === 'i18n_elements' && !Array.isArray(value)) throw cardError('card_json_invalid', `i18n_elements.${locale} 必须是数组`);
      locales.push(locale);
    }
  }
  return [...new Set(locales)];
}

function localized(map: Record<string, unknown> | undefined, fallback: unknown, locale: string, warnings: LocaleWarning[], path: string): unknown {
  if (!map || !Object.keys(map).length) return fallback;
  const selected = Object.hasOwn(map, locale) ? locale : Object.hasOwn(map, 'en_us') ? 'en_us' : Object.keys(map)[0];
  if (selected !== locale) warnings.push({ code: 'locale_fallback', path, requested: locale, selected });
  return map[selected];
}

export function prepareCard(input: unknown, locale = 'zh_cn') {
  const schema = sourceSchema(input);
  if (!supportedLocales.includes(locale)) throw cardError('card_json_invalid', `locale_invalid value=${locale}`);
  let card = structuredClone(input) as CardDocument;
  const warnings: LocaleWarning[] = [];
  if (schema === '1.0') {
    legacyLocales(card);
    const elements = localized(card.i18n_elements, card.elements ?? card.body?.elements ?? [], locale, warnings, 'card.i18n_elements');
    if (!Array.isArray(elements)) throw cardError('card_json_invalid', 'elements 必须是数组');
    card.header = localized(card.i18n_header, card.header, locale, warnings, 'card.i18n_header') as CardDocument['header'];
    delete card.i18n_elements;
    delete card.i18n_header;
    delete card.elements;
    card.schema = '1.0';
    card.body = { ...card.body, elements };
    if (!card.header) delete card.header;
    if (card.header?.ud_icon) {
      const { token, style } = card.header.ud_icon;
      card.header.icon ??= { tag: 'standard_icon', token, ...(style?.color ? { color: style.color } : {}) };
      delete card.header.ud_icon;
    }
    if (card.header?.icon && !card.header.icon.tag) card.header.icon.tag = 'custom_icon';
    card = transformNodes(card, node => {
      if (['plain_text', 'lark_md', 'markdown'].includes(node.tag as string) && node.i18n) {
        node.i18n_content = node.i18n;
        delete node.i18n;
      }
      return node;
    }) as CardDocument;
  }
  return { card, sourceSchema: schema, locale, warnings };
}
