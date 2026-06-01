// @responsibility market 영역 MarketRegimeBanner 컴포넌트
/**
 * Display-only Market Regime UI.
 * This component surfaces NORMAL/RANGE_BOUND/UNCERTAIN/CRISIS/UNKNOWN context without
 * changing Gate, scoring, Kelly, execution, Shadow, or order policy.
 *
 * 레이아웃 (사용자 요청 — 상단 공간 절약): MarketModeBanner 와 동일하게 *항상 1줄
 * compact 헤더* + 토글로 상세(summary/안내문/RiskBanner/Evidence) 펼침. 기본 접힘.
 * 접힌 상태에서도 상태 배지(state+confidence)는 노출돼 레짐을 한눈에 인지할 수 있다.
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
  // 기본 접힘 (사용자 요청) — 펼치면 summary/안내문/RiskBanner/Evidence 전부 노출.
  const [expanded, setExpanded] = useState(false);
  // 불변식 #6 — 주말/장외(WEEKEND_CACHE / AFTER_MARKET)는 예상된 캐시 상태이지 provider 장애가
  // 아니다. offHoursExpected 로 전달해 stale field 가 거짓 provider 장애로 표기되지 않게 한다.
  const marketMode = useMarketMode();
  const offHoursExpected = marketMode !== 'LIVE_TRADING_DAY';
  const view = useMemo(() => buildMarketRegimeView({ bearRegimeResult, vkospiTriggerResult, inverseGate1Result, marketContext, staleFields, offHoursExpected }), [bearRegimeResult, vkospiTriggerResult, inverseGate1Result, marketContext, staleFields, offHoursExpected]);

  return (
    <section className={cn('no-print border-b backdrop-blur-sm', BANNER_TONE[view.state])} aria-label="Market Regime display-only status">
      {/* Compact one-line header — 항상 표시 (모바일/데스크탑 공통) */}
      <div className="mx-auto flex max-w-screen-2xl items-center gap-3 px-4 py-2 sm:px-6">
        <RegimeStatusBadge view={view} />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h3 className="shrink-0 text-sm font-black text-white">{view.title}</h3>
          <span className="hidden shrink-0 rounded-full border border-white/[0.07] bg-white/5 px-2 py-0.5 text-[10px] font-semibold tracking-tight text-white/45 sm:inline">READ-ONLY · DISPLAY-ONLY</span>
          <span className="truncate text-xs text-white/60">{view.summary}</span>
        </div>
        <span className="hidden shrink-0 text-[10px] text-white/35 md:inline">{formatRegimeUpdatedAt(view.updatedAt)}</span>
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-white/[0.07] bg-white/5 px-3 py-1.5 text-[10px] font-semibold tracking-tight text-white/50 transition hover:text-white/80"
          aria-expanded={expanded}
          aria-controls="market-regime-detail-panel"
          aria-label={expanded ? '레짐 상세 접기' : '레짐 상세 펼치기'}
        >
          상세 {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Expanded detail — summary 보충 안내문 + RiskBanner + Evidence (기본 접힘) */}
      {expanded && (
        <div id="market-regime-detail-panel" className="mx-auto max-w-screen-2xl border-t border-white/[0.07] px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 sm:hidden">
            <span className="rounded-full border border-white/[0.07] bg-white/5 px-2 py-0.5 text-[10px] font-semibold tracking-tight text-white/45">READ-ONLY · DISPLAY-ONLY</span>
            <span className="text-[10px] text-white/35">{formatRegimeUpdatedAt(view.updatedAt)}</span>
          </div>
          {view.state === 'UNKNOWN' && !offHoursExpected && (
            <p className="mt-1 text-[11px] text-white/45">No market regime telemetry available. Connect macro/market/provider health sources to populate regime context. Until regime data is available, market context should be treated as UNKNOWN.</p>
          )}
          {view.state === 'UNKNOWN' && offHoursExpected && (
            <p className="mt-1 text-[11px] text-white/45">주말·장외 시간 — 직전 거래일 종가 기준 캐시를 사용 중입니다. provider 장애가 아니며, 장 재개(평일 09:00 KST) 시 자동 갱신됩니다.</p>
          )}
          <div className="mt-2">
            <RegimeRiskBanner view={view} />
          </div>
          <div className="mt-3 border-t border-white/[0.07] pt-3">
            <RegimeEvidencePanel evidence={view.evidence} />
          </div>
        </div>
      )}
    </section>
  );
}
