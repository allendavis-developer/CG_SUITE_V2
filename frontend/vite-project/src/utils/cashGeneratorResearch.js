/**
 * Cash Generator (UK) Snize search results. Optional override:
 * `import.meta.env.VITE_CASH_GENERATOR_BASE_URL` (no trailing slash), default https://cashgenerator.co.uk
 */
export function openCashGeneratorSearchTab(searchQuery) {
  const q = String(searchQuery ?? '').trim();
  const baseRaw =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CASH_GENERATOR_BASE_URL) ||
    'https://cashgenerator.co.uk';
  const base = String(baseRaw).replace(/\/$/, '');
  const url = q ? `${base}/pages/search-results-page?q=${encodeURIComponent(q)}` : `${base}/`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
