import { CardError } from './errors.ts';
import { assertLocale, localized, v1Locales, type LocaleWarning } from './locales.ts';
import { requireSchema, transformNodes, type CardDocument } from './schema.ts';

export function toCompilerInput(input: unknown, locale = 'zh_cn') {
  const schema = requireSchema(input);
  assertLocale(locale);
  let card = structuredClone(input) as CardDocument;
  const warnings: LocaleWarning[] = [];
  if (schema === '1.0') {
    v1Locales(card);
    const elements = localized(
      card.i18n_elements,
      card.elements ?? card.body?.elements ?? [],
      locale,
      warnings,
      'card.i18n_elements',
    );
    if (!Array.isArray(elements))
      throw new CardError('card_json_invalid', 'Card elements must be an array.');
    card.header = localized(
      card.i18n_header,
      card.header,
      locale,
      warnings,
      'card.i18n_header',
    ) as CardDocument['header'];
    delete card.i18n_elements;
    delete card.i18n_header;
    delete card.elements;
    card.schema = '1.0';
    card.body = { ...card.body, elements };
    if (!card.header) delete card.header;
    if (card.header?.ud_icon) {
      const { token, style } = card.header.ud_icon;
      card.header.icon ??= {
        tag: 'standard_icon',
        token,
        ...(style?.color ? { color: style.color } : {}),
      };
      delete card.header.ud_icon;
    }
    if (card.header?.icon && !card.header.icon.tag) card.header.icon.tag = 'custom_icon';
    card = transformNodes(card, (node) => {
      if (['plain_text', 'lark_md', 'markdown'].includes(node.tag as string) && node.i18n) {
        node.i18n_content = node.i18n;
        delete node.i18n;
      }
      return node;
    }) as CardDocument;
  }
  return { card, sourceSchema: schema, locale, warnings };
}
