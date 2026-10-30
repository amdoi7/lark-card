export type Card = Record<string, unknown>;

export class InputError extends Error {
  readonly code = 'card_json_invalid';
}

export function parseCard(input: string): Card {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new InputError('Input must be valid JSON.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('Input must be a Card JSON object.');
  }
  const card = value as Card;
  if (card.schema !== undefined && card.schema !== '1.0' && card.schema !== '2.0') {
    throw new InputError(`Unsupported card schema: ${JSON.stringify(card.schema)}.`);
  }
  return card;
}
