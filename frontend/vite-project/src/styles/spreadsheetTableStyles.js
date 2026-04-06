/**
 * Global spreadsheet-style table visuals (buyer negotiation, repricing, jewellery, pricing rules, etc.).
 * Inject via `<style>{SPREADSHEET_TABLE_STYLES}</style>` and use `className="spreadsheet-table ..."`.
 */

/** Red header for CeX-related columns; add class `spreadsheet-th-cex` on `<th>`. Also used by `.reprice-table`. */
export const SPREADSHEET_CEX_TH_STYLES = `
  .spreadsheet-table th.spreadsheet-th-cex,
  .reprice-table th.spreadsheet-th-cex {
    background: #b91c1c;
  }
`;

/** Full brand-blue fill for the column chosen as RRP/offers source (`td.negotiation-rrp-source-cell`). */
export const RRP_SOURCE_CELL_STYLES = `
  .spreadsheet-table td.negotiation-rrp-source-cell,
  .reprice-table td.negotiation-rrp-source-cell {
    background: var(--brand-blue) !important;
    color: #fff !important;
    box-shadow: none !important;
  }
  .spreadsheet-table tbody tr td.negotiation-rrp-source-cell:hover,
  .reprice-table tbody tr td.negotiation-rrp-source-cell:hover {
    background: var(--brand-blue) !important;
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.4) !important;
  }
  .spreadsheet-table td.negotiation-rrp-source-cell a,
  .reprice-table td.negotiation-rrp-source-cell a {
    color: #fff !important;
    text-decoration-color: rgba(255, 255, 255, 0.65);
  }
`;

/** Shared `<style>` block for `.spreadsheet-table` (negotiation + repricing session + data tools). */
export const SPREADSHEET_TABLE_STYLES = `
  .spreadsheet-table th {
    background: var(--brand-blue);
    color: white;
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.75rem;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .spreadsheet-table th.spreadsheet-th-offer-tier {
    font-size: 13px;
    letter-spacing: 0.06em;
    font-weight: 700;
  }
  ${SPREADSHEET_CEX_TH_STYLES}
  .spreadsheet-table th:last-child { border-right: 0; }
  /* Optional: scroll with body (e.g. jewellery workspace panel) instead of sticking inside overflow-y-auto */
  .spreadsheet-table.spreadsheet-table--static-header th {
    position: static;
    top: auto;
    z-index: auto;
  }
  .spreadsheet-table td {
    padding: 0.5rem 0.75rem;
    border-right: 1px solid var(--ui-border);
    vertical-align: middle;
    transition: background-color 0.1s ease, box-shadow 0.1s ease;
    box-shadow: inset 0 0 0 0 transparent;
  }
  .spreadsheet-table td:last-child { border-right: 0; }
  .spreadsheet-table tr { border-bottom: 1px solid var(--ui-border); }
  .spreadsheet-table tbody td:hover {
    background: var(--brand-blue-alpha-10);
    box-shadow: inset 0 0 0 2px var(--brand-blue-alpha-30);
  }
  ${RRP_SOURCE_CELL_STYLES}
`;

/** Lighter paint path for dense tables that re-render often (e.g. jewellery workspace). */
export const SPREADSHEET_TABLE_WORKSPACE_PERF_STYLES = `
  .spreadsheet-table.spreadsheet-table--workspace td {
    transition: none;
  }
  .spreadsheet-table.spreadsheet-table--workspace tbody td:hover {
    box-shadow: none;
  }
`;
