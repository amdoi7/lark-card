import { CardError } from './errors.ts';

export type Card = Record<string, unknown>;

export type CardProject = {
  card: Card;
  variables?: readonly unknown[];
};

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

// These fields carry opaque business data, not card component trees.
const opaqueFields = new Set(['value', 'behaviors', 'chart_spec', 'chartSpec', 'rows']);

export function transformNodes(
  value: unknown,
  transform: (node: Record<string, unknown>, path: string) => unknown,
  path = 'card',
): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value))
    return value.flatMap((node, index) => {
      const transformed = transformNodes(node, transform, `${path}[${index}]`);
      return Array.isArray(node) ? [transformed] : transformed;
    });
  const node = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      opaqueFields.has(key)
        ? structuredClone(child)
        : transformNodes(child, transform, `${path}.${key}`),
    ]),
  );
  return transform(node, path);
}

export function requireSchema(input: unknown): '1.0' | '2.0' {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new CardError('card_json_invalid', 'Card JSON must be an object.');
  const schema = (input as CardDocument).schema ?? '1.0';
  if (schema !== '1.0' && schema !== '2.0')
    throw new CardError('card_json_invalid', `Unsupported card schema: ${schema}.`);
  return schema;
}

export function parseCard(text: string): Card {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CardError('card_json_invalid', 'Input must be valid JSON.');
  }
  requireSchema(value);
  return value as Card;
}
