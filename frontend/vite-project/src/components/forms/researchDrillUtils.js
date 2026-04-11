/** Normalized drill level: either `{ min, max }` or multi-zoom `{ kind: 'multi', segments, min, max }`. */

export const DRILL_MULTI_KIND = 'multi';

export function getDrillSegments(level) {
  if (!level || typeof level !== 'object') return [];
  if (level.kind === DRILL_MULTI_KIND && Array.isArray(level.segments) && level.segments.length > 0) {
    return level.segments.map((s) => ({
      min: Number(s.min),
      max: Number(s.max),
    }));
  }
  if (level.min != null && level.max != null) {
    return [{ min: Number(level.min), max: Number(level.max) }];
  }
  return [];
}

export function drillEnvelope(level) {
  const segs = getDrillSegments(level);
  if (!segs.length) return null;
  return {
    min: Math.min(...segs.map((s) => s.min)),
    max: Math.max(...segs.map((s) => s.max)),
  };
}

export function priceMatchesDrillLevel(price, level) {
  if (!level) return true;
  const n = typeof price === 'number' ? price : parseFloat(String(price ?? '').replace(/[^0-9.]/g, ''));
  if (Number.isNaN(n)) return false;
  const segs = getDrillSegments(level);
  return segs.some((s) => n >= s.min && n <= s.max);
}

/** Sort and merge overlapping / adjacent intervals (float-safe). */
export function normalizeHistogramSegments(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const arr = raw
    .filter((s) => s && typeof s === 'object' && Number.isFinite(s.min) && Number.isFinite(s.max) && s.min <= s.max)
    .map((s) => ({ min: Number(s.min), max: Number(s.max) }));
  arr.sort((a, b) => a.min - b.min);
  const out = [];
  const eps = 1e-9;
  for (const s of arr) {
    const last = out[out.length - 1];
    if (!last || s.min > last.max + eps) out.push({ min: s.min, max: s.max });
    else last.max = Math.max(last.max, s.max);
  }
  return out;
}

export function formatDrillBreadcrumbLabel(level) {
  if (!level) return '';
  const segs = getDrillSegments(level);
  if (segs.length > 1) {
    const parts = segs.map((s) => `£${s.min.toFixed(2)}–£${s.max.toFixed(2)}`);
    return `Multi (${segs.length}): ${parts.join(', ')}`;
  }
  if (segs.length === 1) {
    return `£${segs[0].min.toFixed(2)} - £${segs[0].max.toFixed(2)}`;
  }
  return '';
}

/** Compact label for breadcrumb buttons; use `formatDrillBreadcrumbLabel` for tooltips. */
export function formatDrillBreadcrumbShortLabel(level) {
  if (!level) return '';
  const segs = getDrillSegments(level);
  if (segs.length > 1) return `Multi-zoom (${segs.length} bands)`;
  if (segs.length === 1) return `£${segs[0].min.toFixed(2)} - £${segs[0].max.toFixed(2)}`;
  return '';
}
