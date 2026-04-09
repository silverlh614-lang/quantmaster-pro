/**
 * 아이디어 1: Gate -1 "Market Regime Detector" 상단 배너
 * BULL → 투명/숨김 / TRANSITION → 노란색 경고 / BEAR → 붉은 위험 배너
 */
import React, { useState } from 'react';
import { TrendingDown, TrendingUp, AlertTriangle, ChevronDown, ChevronUp, Shield, Activity } from 'lucide-react';
import { cn } from '../ui/cn';
import type { BearRegimeResult, VkospiTriggerResult } from '../types/quant';

interface MarketRegimeBannerProps {
  bearRegimeResult: BearRegimeResult | null;
  vkospiTriggerResult: VkospiTriggerResult | null;
}

const LEVEL_LABELS: Record<string, string> = {
  NORMAL: '정상',
  WARNING: '경계경보',
  ENTRY_1: '인버스1차',
  ENTRY_2: '인버스2차',
  HISTORICAL_FEAR: '역사적공포',
};

export function MarketRegimeBanner({ bearRegimeResult, vkospiTriggerResult }: MarketRegimeBannerProps) {
  const [expanded, setExpanded] = useState(false);

  // Nothing to show when bull + normal VKOSPI
  const regime = bearRegimeResult?.regime ?? 'BULL';
  const vLevel = vkospiTriggerResult?.level ?? 'NORMAL';

  const isBear = regime === 'BEAR';
  const isTransition = regime === 'TRANSITION';
  const isVkospiAlert = vLevel !== 'NORMAL';

  // Only render banner in TRANSITION or BEAR mode, or when VKOSPI is alerting
  if (regime === 'BULL' && !isVkospiAlert) return null;

  // Color scheme based on severity
  const bannerBase = isBear
    ? 'bg-red-950/90 border-red-600/60 text-red-100'
    : isTransition
    ? 'bg-amber-950/90 border-amber-600/60 text-amber-100'
    : 'bg-orange-950/90 border-orange-600/60 text-orange-100';

  const iconColor = isBear ? 'text-red-400' : isTransition ? 'text-amber-400' : 'text-orange-400';

  const regimeLabel = isBear ? '🔴 BEAR MODE' : isTransition ? '🟡 TRANSITION' : '🟢 BULL';
  const RegimeIcon = isBear ? TrendingDown : isTransition ? AlertTriangle : TrendingUp;

  const triggeredCount = bearRegimeResult?.triggeredCount ?? 0;
  const threshold = bearRegimeResult?.threshold ?? 5;

  return (
    <div
      className={cn(
        'border-b transition-all duration-500 no-print',
        bannerBase,
        isBear && 'animate-pulse-slow',
      )}
      role="alert"
      aria-live="assertive"
    >
      {/* Main row */}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3 flex-wrap">
        {/* Regime label */}
        <div className="flex items-center gap-2 font-black text-sm shrink-0">
          <RegimeIcon className={cn('w-4 h-4', iconColor)} />
          <span className={cn('uppercase tracking-widest text-xs', iconColor)}>{regimeLabel}</span>
        </div>

        {/* Condition count badge */}
        {bearRegimeResult && (
          <span className={cn(
            'text-[10px] font-black px-2 py-0.5 rounded border uppercase tracking-widest shrink-0',
            isBear ? 'bg-red-800/60 border-red-500/50 text-red-200' : 'bg-amber-800/60 border-amber-500/50 text-amber-200',
          )}>
            {triggeredCount}/{threshold} 조건
          </span>
        )}

        {/* VKOSPI trigger badge */}
        {vkospiTriggerResult && isVkospiAlert && (
          <span className={cn(
            'text-[10px] font-black px-2 py-0.5 rounded border uppercase tracking-widest shrink-0',
            vLevel === 'HISTORICAL_FEAR' ? 'bg-red-800/60 border-red-500/50 text-red-200'
              : vLevel === 'ENTRY_2' ? 'bg-red-700/50 border-red-500/40 text-red-200'
              : vLevel === 'ENTRY_1' ? 'bg-orange-800/60 border-orange-500/50 text-orange-200'
              : 'bg-amber-800/60 border-amber-500/50 text-amber-200',
          )}>
            VKOSPI {vkospiTriggerResult.vkospi.toFixed(1)} · {LEVEL_LABELS[vLevel]}
          </span>
        )}

        {/* Action summary */}
        <span className="text-xs opacity-80 hidden md:block flex-1 truncate">
          {isBear
            ? '인버스/방어자산 모드 전환 — 신규 롱 포지션 전면 중단'
            : isTransition
            ? '현금 비중 확대 + 헤지 레이어 활성화 권고'
            : `VKOSPI ${vkospiTriggerResult?.vkospi.toFixed(1)} 경보`}
        </span>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="ml-auto flex items-center gap-1 text-[10px] font-black uppercase tracking-widest opacity-70 hover:opacity-100 transition-opacity shrink-0"
          aria-expanded={expanded}
          aria-label="상세 정보 보기"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{expanded ? '접기' : '상세'}</span>
        </button>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-3 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-white/10 mt-1 pt-3">

          {/* Bear Regime Conditions */}
          {bearRegimeResult && (
            <div>
              <h4 className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2 flex items-center gap-1.5">
                <Shield className="w-3 h-3" /> Gate -1 조건 ({triggeredCount}/{bearRegimeResult.conditions.length})
              </h4>
              <ul className="space-y-1">
                {bearRegimeResult.conditions.map(cond => (
                  <li key={cond.id} className="flex items-start gap-2 text-xs">
                    <span className={cn(
                      'mt-0.5 w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center text-[8px] font-black',
                      cond.triggered
                        ? 'bg-red-500/40 border-red-400 text-red-200'
                        : 'bg-white/5 border-white/20 text-white/40',
                    )}>
                      {cond.triggered ? '✓' : '–'}
                    </span>
                    <span className={cn('leading-snug', cond.triggered ? 'opacity-100' : 'opacity-40')}>
                      <span className="font-bold">{cond.name}</span>
                      {cond.triggered && <span className="opacity-70"> — {cond.description}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs opacity-80 leading-relaxed">{bearRegimeResult.actionRecommendation}</p>
            </div>
          )}

          {/* VKOSPI Trigger Detail */}
          {vkospiTriggerResult && isVkospiAlert && (
            <div>
              <h4 className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2 flex items-center gap-1.5">
                <Activity className="w-3 h-3" /> VKOSPI 공포 트리거
              </h4>
              <p className="text-xs font-bold mb-1">{vkospiTriggerResult.description}</p>
              <p className="text-xs opacity-80 leading-relaxed mb-2">{vkospiTriggerResult.actionMessage}</p>
              <div className="flex gap-3 text-[10px] font-black">
                <span>현금 {vkospiTriggerResult.cashRatio}%</span>
                {vkospiTriggerResult.inversePosition > 0 && (
                  <span>인버스 {vkospiTriggerResult.inversePosition}%</span>
                )}
              </div>
              {vkospiTriggerResult.inverseEtfSuggestions.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {vkospiTriggerResult.inverseEtfSuggestions.map(etf => (
                    <li key={etf} className="text-[10px] opacity-70">• {etf}</li>
                  ))}
                </ul>
              )}
              {vkospiTriggerResult.dualPositionActive && vkospiTriggerResult.vRecoveryStocks && (
                <div className="mt-3">
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1.5">
                    V자 반등 준비 리스트
                  </p>
                  <ul className="space-y-0.5">
                    {vkospiTriggerResult.vRecoveryStocks.map(s => (
                      <li key={s} className="text-[10px] opacity-70">• {s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
