// @responsibility market 영역 MarketRegimeBanner 컴포넌트
/**
 * Display-only Market Regime UI.
 * This component surfaces NORMAL/RANGE_BOUND/UNCERTAIN/CRISIS/UNKNOWN context without
 * changing Gate, scoring, Kelly, execution, Shadow, or order policy.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { BearRegimeResult, InverseGate1Result, VkospiTriggerResult } from '../../types/quant';
import type { MarketContext } from '../../services/stock/types';
import { buildMarketRegimeView, formatRegimeUpdatedAt } from '../../lib/marketRegimeViewModel';
import { useMarketMode } from '../../hooks/useMarketMode';
import { RegimeEvidencePanel } from './RegimeEvidencePanel';
import { RegimeRiskBanner } from './RegimeRiskBanner';
import { RegimeStatusBadge } from './RegimeStatusBadge';

interface MarketRegimeBannerProps {
  bearRegimeResult: BearRegimeResult | null;
  vkospiTriggerResult: VkospiTriggerResult | null;
  inverseGate1Result?: InverseGate1Result | null;
  marketContext?: MarketContext | null;
  staleFields?: readonly string[];
}

const BANNER_TONE = {
  NORMAL: 'border-emerald-500/25 bg-emerald-950/25',
  RANGE_BOUND: 'border-sky-500/25 bg-sky-950/25',
  UNCERTAIN: 'border-amber-500/30 bg-amber-950/35',
  CRISIS: 'border-red-500/40 bg-red-950/45',
  UNKNOWN: 'border-zinc-500/25 bg-zinc-950/55',
} as const;

export function MarketRegimeBanner({ bearRegimeResult, vkospiTriggerResult, inverseGate1Result, marketContext, staleFields }: MarketRegimeBannerProps) {
  const [expanded, setExpanded] = useState(false);
  // 불변식 #6 — 주말/장외(WEEKEND_CACHE / AFTER_MARKET)는 예상된 캐시 상태이지 provider 장애가
  // 아니다. offHoursExpected 로 전달해 stale field 가 거짓 provider 장애로 표기되지 않게 한다.
  const marketMode = useMarketMode();
  const offHoursExpected = marketMode !== 'LIVE_TRADING_DAY';
  const view = useMemo(() => buildMarketRegimeView({ bearRegimeResult, vkospiTriggerResult, inverseGate1Result, marketContext, staleFields, offHoursExpected }), [bearRegimeResult, vkospiTriggerResult, inverseGate1Result, marketContext, staleFields, offHoursExpected]);

  return (
    <section className={cn('no-print border-b backdrop-blur-sm', BANNER_TONE[view.state])} aria-label="Market Regime display-only status">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center">
        <RegimeStatusBadge view={view} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-white">{view.title}</h3>
            <span className="rounded-full border border-white/[0.07] bg-white/5 px-2 py-0.5 text-[10px] font-semibold tracking-tight text-white/45">READ-ONLY · DISPLAY-ONLY</span>
            <span className="text-[10px] text-white/35">{formatRegimeUpdatedAt(view.updatedAt)}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-white/70">{view.summary}</p>
          {view.state === 'UNKNOWN' && !offHoursExpected && (
            <p className="mt-1 text-[11px] text-white/45">No market regime telemetry available. Connect macro/market/provider health sources to populate regime context. Until regime data is available, market context should be treated as UNKNOWN.</p>
          )}
          {view.state === 'UNKNOWN' && offHoursExpected && (
            <p className="mt-1 text-[11px] text-white/45">주말·장외 시간 — 직전 거래일 종가 기준 캐시를 사용 중입니다. provider 장애가 아니며, 장 재개(평일 09:00 KST) 시 자동 갱신됩니다.</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/[0.07] bg-white/5 px-3 py-2 text-[10px] font-semibold tracking-tight text-white/50 transition hover:text-white/80"
          aria-expanded={expanded}
          aria-controls="market-regime-evidence-panel"
        >
          Evidence {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="mx-auto max-w-screen-2xl px-4 pb-3 sm:px-6">
        <RegimeRiskBanner view={view} />
      </div>
      {expanded && (
        <div id="market-regime-evidence-panel" className="mx-auto max-w-screen-2xl border-t border-white/[0.07] px-4 py-3 sm:px-6">
          <RegimeEvidencePanel evidence={view.evidence} />
        </div>
      )}
    </section>
  );
}
