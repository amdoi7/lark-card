import { isDeepStrictEqual } from 'node:util';
import { CardError } from '../errors.ts';
import {
  assertLocale,
  v1Locales,
  contentLocales,
  toCompilerInput,
  requireSchema,
  transformNodes,
  type CardDocument,
} from './input.ts';

type CardNode = Record<string, unknown>;
type MigrationWarning = {
  code: string;
  message?: string;
  path?: string;
  requested?: string;
  selected?: string;
};

function localizable(node: CardNode, key: string): string | undefined {
  if (key === 'content' && ['plain_text', 'lark_md', 'markdown'].includes(node.tag as string))
    return 'i18n_content';
  if (key === 'default_value' && node.tag === 'input') return 'i18n_default_value';
  if (key === 'img_key' && ['img', 'custom_icon', 'select_img'].includes(node.tag as string))
    return 'i18n_img_key';
}

function convertVariant(
  input: CardDocument,
  locale: string,
  warnings: MigrationWarning[],
  localize: boolean,
): CardDocument {
  const compilerInput = toCompilerInput(input, locale);
  warnings.push(...compilerInput.warnings);
  const card = compilerInput.card;
  card.schema = '2.0';
  card.config = { ...card.config, update_multi: true };
  card.body!.vertical_spacing ??= '16px';
  if (card.card_link && !Object.values(card.card_link as object).some(Boolean))
    delete card.card_link;
  if (Object.hasOwn(card.config, 'wide_screen_mode')) {
    delete card.config.wide_screen_mode;
    warnings.push({
      code: 'wide_screen_removed',
      message: '2.0 使用统一布局，不保留 wide_screen_mode',
    });
  }
  return transformNodes(card, (node, path) => {
    if (Object.hasOwn(node, 'fallback')) {
      delete node.fallback;
      warnings.push({ code: 'fallback_removed', path, message: '2.0 不支持旧版自定义降级规则' });
    }
    if (node.tag === 'markdown' && node.href && Object.keys(node.href as object).length) {
      throw new CardError(
        'migration_requires_manual',
        `旧版 Markdown href 需要改写为 link 标签 path=${path}`,
      );
    }
    for (const key of ['vertical_spacing', 'horizontal_spacing']) {
      if (node[key] === 'large') node[key] = 'extra_large';
    }
    if (node.tag === 'form') {
      node.horizontal_spacing ??= '16px';
      node.vertical_spacing ??= '16px';
    }
    if (node.tag === 'interactive_container') {
      node.horizontal_spacing ??= '12px';
      node.vertical_spacing ??= '12px';
    }
    if (node.tag === 'collapsible_panel') {
      const decorated = Boolean(node.border || node.background_color);
      if (node.header) (node.header as CardNode).padding ??= decorated ? '8px' : '8px 0px';
      node.padding ??= decorated ? '8px' : '0px';
    }
    if (node.tag === 'img' && node.size === 'stretch_without_padding') {
      if (node.margin !== undefined)
        throw new CardError(
          'migration_requires_manual',
          `通栏图片已有 margin，需要人工核对 path=${path}`,
        );
      node.size = 'crop_center';
      node.margin = '4px -12px';
      warnings.push({
        code: 'image_layout_changed',
        path,
        message: '通栏图片按官方迁移示例改为负 margin，需要核对裁切效果',
      });
    }
    if (localize) {
      for (const [key, value] of Object.entries(node)) {
        const field = localizable(node, key);
        if (field && typeof value === 'string')
          node[field] = { ...(node[field] as CardNode), [locale]: value };
      }
    }
    if (node.tag === 'note') {
      if (!Array.isArray(node.elements))
        throw new CardError('card_json_invalid', `note.elements 必须是数组 path=${path}`);
      warnings.push({
        code: 'note_layout_changed',
        path,
        message: '旧版备注拆为小号灰色文本或图片，需核对组合布局',
      });
      return node.elements.map((child: CardNode) => {
        if (child.tag === 'plain_text')
          return { tag: 'div', text: { ...child, text_size: 'notation', text_color: 'grey' } };
        if (['lark_md', 'markdown'].includes(child.tag as string))
          return { ...child, tag: 'markdown', text_size: 'notation' };
        if (child.tag === 'img') return child;
        throw new CardError(
          'migration_requires_manual',
          `备注包含未适配元素 tag=${child.tag} path=${path}`,
        );
      });
    }
    if (node.tag === 'action') {
      const modes = { flow: 'flow', bisected: 'bisect', trisection: 'trisect' };
      const layout = (node.layout ?? 'flow') as string;
      if (!Object.hasOwn(modes, layout) || !Array.isArray(node.actions))
        throw new CardError('migration_requires_manual', `交互模块布局无法转换 path=${path}`);
      const { tag: _tag, actions, layout: _layout, ...rest } = node;
      return {
        ...rest,
        tag: 'column_set',
        flex_mode: modes[layout as keyof typeof modes],
        horizontal_spacing: '8px',
        columns: (actions as CardNode[]).map((action) => ({
          tag: 'column',
          width: layout === 'flow' ? 'auto' : 'weighted',
          ...(layout === 'flow' ? {} : { weight: 1 }),
          elements: [action],
        })),
      };
    }
    return node;
  }) as CardDocument;
}

function mergeLocales(base: unknown, other: unknown, locale: string, path = 'card'): unknown {
  const mismatch = (): never => {
    throw new CardError(
      'migration_locale_structure_mismatch',
      `不同语言存在非文本结构差异 locale=${locale} path=${path}；不能自动合并为 2.0`,
    );
  };
  if (isDeepStrictEqual(base, other)) return base;
  if (Array.isArray(base) && Array.isArray(other)) {
    if (base.length !== other.length) mismatch();
    return base.map((item, index) => mergeLocales(item, other[index], locale, `${path}[${index}]`));
  }
  if (
    !base ||
    !other ||
    typeof base !== 'object' ||
    typeof other !== 'object' ||
    Array.isArray(base) ||
    Array.isArray(other)
  )
    mismatch();
  const left = base as CardNode,
    right = other as CardNode;
  const result = { ...left };
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (localizable(left, key)) continue;
    if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) {
      if (/\.i18n_(content|default_value|img_key)$/.test(path))
        result[key] = structuredClone(left[key] ?? right[key]);
      else mismatch();
    } else if (['value', 'behaviors'].includes(key)) {
      if (!isDeepStrictEqual(left[key], right[key])) mismatch();
    } else result[key] = mergeLocales(left[key], right[key], locale, `${path}.${key}`);
  }
  return result;
}

export type V2Conversion = {
  card: CardDocument;
  warnings: MigrationWarning[];
  chosen: string;
  locales: string[];
};

// Pure V1 → V2 conversion. `locales` lists every language the result declares; `chosen` is the
// one the caller should compile first. Compiler validation is the caller's job.
export function convertV1ToV2(
  input: unknown,
  { locale = 'zh_cn', allowShared = false }: { locale?: string; allowShared?: boolean } = {},
): V2Conversion {
  if (requireSchema(input) !== '1.0')
    throw new CardError('migration_source_invalid', 'V1→V2 转换只接受 1.0 卡片');
  const source = input as CardDocument;
  if (typeof allowShared !== 'boolean')
    throw new CardError('card_json_invalid', 'allowShared 必须是布尔值');
  const warnings: MigrationWarning[] = [
    {
      code: 'interaction_lifetime_changed',
      message: '2.0 的可交互/可更新时间统一为 14 天；旧客户端要求至少 7.20',
    },
  ];
  if (source.config?.update_multi !== true) {
    if (!allowShared)
      throw new CardError(
        'migration_requires_shared',
        'V1 默认为独享卡片；2.0 只支持共享卡片。请明确允许切换共享模式后再迁移',
      );
    warnings.push({
      code: 'sharing_changed',
      message: '已按显式授权将独享/默认模式改为 update_multi=true',
    });
  }
  const globalLocales = v1Locales(source);
  const chosen = globalLocales.includes(locale)
    ? locale
    : globalLocales.includes('en_us')
      ? 'en_us'
      : (globalLocales[0] ?? locale);
  const variants = globalLocales.length
    ? [chosen, ...globalLocales.filter((value) => value !== chosen)]
    : [locale];
  let card = convertVariant(source, variants[0], warnings, globalLocales.length > 0);
  for (const language of variants.slice(1))
    card = mergeLocales(
      card,
      convertVariant(source, language, warnings, true),
      language,
    ) as CardDocument;
  const locales = new Set([...globalLocales, ...contentLocales(card)]);
  if (locales.size) card.config!.locales = [...locales];
  for (const language of locales) assertLocale(language);
  return {
    card,
    warnings: [...new Map(warnings.map((warning) => [JSON.stringify(warning), warning])).values()],
    chosen,
    locales: [...locales],
  };
}
