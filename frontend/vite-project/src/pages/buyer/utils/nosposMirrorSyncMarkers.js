const CG_SYNC_MARKER_PREFIX = '[CG_SUITE_SYNCED:';

export function isNosposMirrorItemDescriptionField(field) {
  const name = String(field?.name || '').toLowerCase();
  const label = String(field?.label || '').toLowerCase();
  return /\[description\]$/.test(name) || label === 'item description';
}

export function resolveNosposMirrorItemDescriptionField(card) {
  const fields = card?.fields || [];
  return fields.find((field) => field?.name && isNosposMirrorItemDescriptionField(field)) || null;
}

export function buildNosposMirrorSourceItemSyncKey(item, rowIdx, requestId) {
  const reqPart = requestId != null && requestId !== '' ? String(requestId) : 'req-unknown';
  const itemPart =
    item?.request_item_id != null ? `rid-${item.request_item_id}`
      : item?.id != null ? `id-${item.id}`
      : item?.variantId != null ? `vid-${item.variantId}`
      : `idx-${rowIdx}`;
  return `${reqPart}:${itemPart}`;
}

export function buildNosposMirrorCgSyncMarker(item, rowIdx, requestId) {
  return `${CG_SYNC_MARKER_PREFIX}${buildNosposMirrorSourceItemSyncKey(item, rowIdx, requestId)}]`;
}

export function hasNosposMirrorCgSyncMarker(value, item, rowIdx, requestId) {
  const marker = buildNosposMirrorCgSyncMarker(item, rowIdx, requestId);
  return String(value || '').includes(marker);
}

export function appendNosposMirrorCgSyncMarker(value, item, rowIdx, requestId) {
  const raw = value != null ? String(value) : '';
  const marker = buildNosposMirrorCgSyncMarker(item, rowIdx, requestId);
  if (raw.includes(marker)) return raw;
  return raw.trim() ? `${raw} ${marker}` : marker;
}
