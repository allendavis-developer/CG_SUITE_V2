import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import { WEB_EPOS_UPLOAD_SKIP_GATE_KEY } from '@/pages/buyer/webEposUploadConstants';
import WebEposProductsTablePanel from '@/pages/buyer/components/WebEposProductsTablePanel';

/**
 * Shows the Web EPOS products table scraped by the extension (deep link / bookmark).
 * State: { rows, pagingText?, pageUrl?, scrapedAt? } from navigate().
 */
export default function WebEposProductsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { rows = [], pagingText = null, pageUrl = null, scrapedAt = null } = location.state || {};

  return (
    <div className="flex min-h-screen flex-col bg-ui-bg text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <AppHeader />
      <main className="flex-1 w-full max-w-none py-8 pl-2 pr-2 sm:pl-3 sm:pr-3 md:pl-4 md:pr-4">
        <div className="w-full max-w-none space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="cg-section-title text-xl sm:text-2xl">Web EPOS products</h1>
            </div>
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.setItem(WEB_EPOS_UPLOAD_SKIP_GATE_KEY, '1');
                } catch (_) {}
                navigate(-1);
              }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-brand-blue transition-colors hover:bg-brand-blue/5 dark:border-slate-600"
            >
              Back to upload
            </button>
          </div>

          <WebEposProductsTablePanel
            rows={rows}
            pagingText={pagingText}
            pageUrl={pageUrl}
            scrapedAt={scrapedAt}
            showSourceBlurb
          />
        </div>
      </main>
    </div>
  );
}
