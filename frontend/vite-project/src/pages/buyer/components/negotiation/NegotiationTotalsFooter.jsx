import React, { forwardRef } from 'react';

function TotalPill({ label, value, emphasize = false }) {
  return (
    <div className={`flex min-w-0 flex-col ${emphasize ? 'px-1' : ''}`}>
      {label ? (
        <span className="text-[10px] font-black uppercase tracking-widest text-white/75">
          {label}
        </span>
      ) : null}
      <span
        className={`font-black tabular-nums tracking-tight text-white ${
          emphasize ? 'text-2xl leading-none sm:text-3xl' : 'text-lg'
        }`}
      >
        £{value.toFixed(2)}
      </span>
    </div>
  );
}

/**
 * Buying negotiation: offer breakdown + target + primary actions in a single horizontal strip.
 */
const NegotiationTotalsFooter = forwardRef(function NegotiationTotalsFooter(
  {
    mode,
    jewelleryOfferTotal,
    otherItemsOfferTotal,
    totalOfferPrice,
    hasTarget,
    targetMatched,
    parsedTarget,
    targetShortfall,
    targetExcess,
    setTargetOffer,
    researchSandboxBookedView,
    persistedNosposAgreementId,
    handleParkAgreementOpenNospos,
    handleViewParkedAgreement,
    handleDownloadParkLog,
    headerWorkspaceOpen,
    researchItem,
    cashConvertersResearchItem,
    handleFinalizeTransaction,
  },
  ref,
) {
  const finalizeBlocked =
    mode === 'view' ||
    headerWorkspaceOpen ||
    researchItem ||
    cashConvertersResearchItem ||
    (hasTarget && !targetMatched);

  return (
    <footer
      ref={ref}
      className="shrink-0 border-t border-white/20 bg-brand-blue py-3 pl-4 pr-3 sm:pl-6 sm:pr-4 md:pl-10 md:pr-4"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-2 border-b border-white/15 pb-3 lg:border-b-0 lg:pb-0">
          <TotalPill label="Jewellery" value={jewelleryOfferTotal} />
          <TotalPill label="Other items" value={otherItemsOfferTotal} />
          <div className="min-w-0 border-l border-white/20 pl-6">
            <TotalPill label="Grand total" value={totalOfferPrice} emphasize />
          </div>
        </div>

        {hasTarget ? (
          <div
            className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-3 py-2 sm:justify-start ${
              targetMatched
                ? 'border border-emerald-400/50 bg-emerald-950/35'
                : 'border border-red-400/50 bg-red-950/35'
            }`}
          >
            <div className="min-w-0">
              <div
                className={`text-[10px] font-black uppercase tracking-wider ${
                  targetMatched ? 'text-emerald-100' : 'text-red-100'
                }`}
              >
                Target offer
              </div>
              {!targetMatched && (
                <div className="text-[9px] font-medium text-red-100">
                  {totalOfferPrice < parsedTarget
                    ? `Below target by £${targetShortfall.toFixed(2)}`
                    : `Too high by £${targetExcess.toFixed(2)}`}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span
                className={`text-lg font-black tabular-nums sm:text-xl ${
                  targetMatched ? 'text-emerald-100' : 'text-red-100'
                }`}
              >
                £{parsedTarget.toFixed(2)}
              </span>
              <span
                className={`material-symbols-outlined text-[20px] ${
                  targetMatched ? 'text-emerald-200' : 'text-red-200'
                }`}
              >
                {targetMatched ? 'check_circle' : 'cancel'}
              </span>
              {mode === 'negotiate' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTargetOffer('');
                  }}
                  className="text-white/50 transition-colors hover:text-white"
                  title="Remove target"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden min-w-0 lg:flex lg:flex-1" aria-hidden />
        )}

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end lg:ml-auto lg:w-auto lg:shrink-0">
          {researchSandboxBookedView ? (
            <>
              <button
                type="button"
                className="group flex w-full min-w-[12rem] items-center justify-center gap-2 rounded-lg py-3.5 font-bold transition-all active:scale-[0.98] sm:w-auto sm:px-6"
                style={{
                  background: 'var(--brand-orange)',
                  color: 'var(--brand-blue)',
                  boxShadow: '0 10px 15px -3px rgba(247, 185, 24, 0.3)',
                }}
                onClick={handleParkAgreementOpenNospos}
              >
                <span className="material-symbols-outlined text-xl" aria-hidden>
                  task_alt
                </span>
                <span className="text-sm uppercase tracking-tight sm:text-base">
                  {persistedNosposAgreementId ? 'Rerun Park Agreement' : 'Park Agreement'}
                </span>
                <span
                  className="material-symbols-outlined text-xl transition-transform group-hover:translate-x-1"
                  aria-hidden
                >
                  arrow_forward
                </span>
              </button>
              {persistedNosposAgreementId ? (
                <>
                  <button
                    type="button"
                    className="group flex w-full min-w-[12rem] items-center justify-center gap-2 rounded-lg py-3 font-bold text-white transition-all active:scale-[0.98] sm:w-auto sm:px-6"
                    style={{
                      background: 'var(--brand-blue)',
                      boxShadow: '0 6px 15px -3px rgba(0,0,0,0.25)',
                    }}
                    onClick={handleViewParkedAgreement}
                  >
                    <span className="material-symbols-outlined text-xl" aria-hidden>
                      open_in_new
                    </span>
                    <span className="flex flex-col items-center leading-tight">
                      <span className="text-sm uppercase tracking-tight sm:text-base">View Parked Agreement</span>
                      <span className="text-[11px] font-semibold tracking-wide opacity-90">
                        ID {persistedNosposAgreementId}
                      </span>
                    </span>
                  </button>
                  {typeof handleDownloadParkLog === 'function' ? (
                    <button
                      type="button"
                      onClick={handleDownloadParkLog}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/20 active:scale-[0.98] sm:w-auto"
                      title="Download park agreement diagnostic log"
                    >
                      <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden>
                        download
                      </span>
                      Download log
                    </button>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                className={`group flex w-full min-w-[12rem] items-center justify-center gap-2 rounded-lg py-3.5 font-bold transition-all active:scale-[0.98] sm:w-auto sm:px-8 ${
                  finalizeBlocked ? 'cursor-not-allowed opacity-50' : ''
                }`}
                style={{
                  background: 'var(--brand-orange)',
                  color: 'var(--brand-blue)',
                  boxShadow: '0 10px 15px -3px rgba(247, 185, 24, 0.3)',
                }}
                onClick={finalizeBlocked ? undefined : () => void handleFinalizeTransaction()}
                disabled={finalizeBlocked}
              >
                <span className="text-sm uppercase tracking-tight sm:text-base">Book for Testing</span>
                <span className="material-symbols-outlined text-xl transition-transform group-hover:translate-x-1">
                  arrow_forward
                </span>
              </button>
              {hasTarget && !targetMatched && mode === 'negotiate' ? (
                <p className="w-full text-center text-[10px] font-semibold text-red-100 sm:text-left">
                  {totalOfferPrice < parsedTarget
                    ? `Grand total is below target by £${targetShortfall.toFixed(2)}`
                    : `Grand total is too high by £${targetExcess.toFixed(2)}`}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </footer>
  );
});

NegotiationTotalsFooter.displayName = 'NegotiationTotalsFooter';

export default NegotiationTotalsFooter;
