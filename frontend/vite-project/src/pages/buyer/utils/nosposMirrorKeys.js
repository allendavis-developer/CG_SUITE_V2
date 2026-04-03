export function buildApplyFieldKey(name, cardIdx, cardId = null) {
  const locationKey = cardId || (Number.isInteger(cardIdx) ? `idx:${cardIdx}` : 'idx:unknown');
  return `${locationKey}\0${name || ''}`;
}

export function buildCardFieldKey(cardIdx, name) {
  return `${Number.isInteger(cardIdx) ? cardIdx : 'idx:unknown'}\0${name || ''}`;
}
