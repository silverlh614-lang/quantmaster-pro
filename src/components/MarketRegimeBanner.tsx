/**
 * Idea 5: Compact one-line Market Regime Banner
 * RISK-ON/OFF state + VKOSPI chip + Foreign flow chip — readable in 10 seconds.
 * Expandable for full detail on click.
 */
import React, { useState } from 'react';
import { TrendingDown, TrendingUp, AlertTriangle, ChevronDown, ChevronUp, Shield, Activity } from 'lucide-react';
import { cn } from '../ui/cn';
import type { BearRegimeResult, VkospiTriggerResult, InverseGate1Result } from '../types/quant';

interface MarketRegimeBannerProps {
  bearRegimeResult: BearRegimeResult | null;
  vkospiTriggerResult: VkospiTriggerResult | null;
  inverseGate1Result?: InverseGate1Result | null;
}

const LEVEL_LABELS: Record<string, string> = {
  NORMAL: '정상',
  WARNING: '경계경보',
  ENTRY_1: '인버스1차',
  ENTRY_2: '인버스2차',
  HISTORICAL_FEAR: '역사적공포',
};

export function MarketRegimeBanner({ bearRegimeResult, vkospiTriggerResult, inverseGate1Result }: MarketRegimeBannerProps) {
  const [expanded, setExpanded] = useState(false);

  const regime = bearRegimeResult?.regime ?? 'BULL';
  const vLevel = vkospiTriggerResult?.level ?? 'NORMAL';
  const isStrongBear = inverseGate1Result?.signalType === 'STRONG_BEAR';
  const isPartialBear = inverseGate1Result?.signalType === 'PARTIAL';

  const isBear = regime === 'BEAR';
  const isTransition = regime === 'TRANSITION';
  const isVkospiAlert = vLevel !== 'NORMAL';

  // Only render banner in non-BULL or alert states
  if (regime === 'BULL' && !isVkospiAlert && !isStrongBear && !isPartialBear) return null;

  const triggeredCount = bearRegimeResult?.triggeredCount ?? 0;
  const threshold = bearRegimeResult?.threshold ?? 5;

  // Determine risk state
  const isRiskOff = isBear || isStrongBear;
  const riskLabel = isRiskOff ? 'RISK-OFF' : 'RISK-ON';
  const riskColor = isRiskOff ? 'text-red-400' : isTransition ? 'text-amber-400' : 'text-orange-400';
  const dotColor = isRiskOff ? 'bg-red-500' : isTransition ? 'bg-amber-500' : 'bg-orange-500';
  const borderColor = isRiskOff ? 'border-red-500/30' : isTransition ? 'border-amber-500/30' : 'border-orange-500/30';
  const bgColor = isRiskOff ? 'bg-red-950/60' : isTransition ? 'bg-amber-950/60' : 'bg-orange-950/60';

  return (
    <div className={cn('no-print', borderColor, bgColor, 'border-b')} role="alert" aria-live="assertive">
      {/* Compact One-Line Banner (Idea 5) */}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-10 flex items-center gap-3">
        {/* Pulsing Risk State */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('signal-dot', isRiskOff ? 'signal-dot-strong-sell' : 'signal-dot-neutral')} style={{ width: '8px', height: '8px' }} />
          <span className={cn('text-[11px] font-black uppercase tracking-[0.15em]', riskColor)}>
            {riskLabel}
          </span>
        </div>

        <div className="w-px h-4 bg-white/10 shrink-0" />

        {/* Regime Chip */}
        <span className={cn(
          'text-[10px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest shrink-0 font-num',
          isBear ? 'bg-red-500/20 border-red-500/30 text-red-300'
            : isTransition ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
            : 'bg-orange-500/20 border-orange-500/30 text-orange-300'
        )}>
          {isBear ? 'BEAR' : isTransition ? 'TRANSITION' : 'WATCH'} {triggeredCount}/{threshold}
        </span>

        {/* VKOSPI Chip */}
        {vkospiTriggerResult && isVkospiAlert && (
          <>
            <div className="w-px h-4 bg-white/10 shrink-0" />
            <span className={cn(
              'text-[10px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest shrink-0 font-num',
              vLevel === 'HISTORICAL_FEAR' || vLevel === 'ENTRY_2'
                ? 'bg-red-500/20 border-red-500/30 text-red-300'
                : 'bg-amber-500/20 border-amber-500/30 text-amber-300'
            )}>
              VKOSPI {vkospiTriggerResult.vkospi.toFixed(1)}
            </span>
          </>
        )}

        {/* Inverse Gate 1 Chip */}
        {inverseGate1Result && (isStrongBear || isPartialBear) && (
          <>
            <div className="w-px h-4 bg-white/10 shrink-0" />
            <span className={cn(
              'text-[10px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest shrink-0',
              isStrongBear
                ? 'bg-red-500/20 border-red-500/30 text-red-300'
                : 'bg-orange-500/20 border-orange-500/30 text-orange-300'
            )}>
              {isStrongBear ? 'INV BEAR' : `INV ${inverseGate1Result.triggeredCount}/5`}
            </span>
          </>
        )}

        {/* Action Summary (desktop only) */}
        <span className="text-[10px] text-white/40 font-medium hidden md:block flex-1 truncate ml-1">
          {isBear ? '인버스 모드 — 롱 중단'
            : isTransition ? '현금 확대 + 헤지 활성화'
            : isStrongBear ? 'Inverse Gate STRONG BEAR'
            : `VKOSPI ${vkospiTriggerResult?.vkospi.toFixed(1)} 경보`}
        </span>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="ml-auto flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-white/60 transition-opacity shrink-0"
          aria-expanded={expanded}
          aria-label="상세 정보 보기"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
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
                      {cond.triggered ? '\u2713' : '\u2013'}
                    </span>
                    <span className={cn('leading-snug', cond.triggered ? 'opacity-100' : 'opacity-40')}>
                      <span className="font-bold">{cond.name}</span>
                      {cond.triggered && <span className="opacity-70"> \u2014 {cond.description}</span>}
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
              <div className="flex gap-3 text-[10px] font-black font-num">
                <span>현금 {vkospiTriggerResult.cashRatio}%</span>
                {vkospiTriggerResult.inversePosition > 0 && (
                  <span>인버스 {vkospiTriggerResult.inversePosition}%</span>
                )}
              </div>
              {vkospiTriggerResult.inverseEtfSuggestions.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {vkospiTriggerResult.inverseEtfSuggestions.map(etf => (
                    <li key={etf} className="text-[10px] opacity-70">{etf}</li>
                  ))}
                </ul>
              )}
              {vkospiTriggerResult.dualPositionActive && vkospiTriggerResult.vRecoveryStocks && (
                <div className="mt-3">
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-1.5">V자 반등 준비 리스트</p>
                  <ul className="space-y-0.5">
                    {vkospiTriggerResult.vRecoveryStocks.map(s => (
                      <li key={s} className="text-[10px] opacity-70">{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Inverse Gate 1 Detail */}
          {inverseGate1Result && (isStrongBear || isPartialBear) && (
            <div>
              <h4 className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2 flex items-center gap-1.5">
                <TrendingDown className="w-3 h-3" /> Inverse Gate 1 ({inverseGate1Result.triggeredCount}/{inverseGate1Result.conditions.length})
              </h4>
              <ul className="space-y-1">
                {inverseGate1Result.conditions.map(cond => (
                  <li key={cond.id} className="flex items-start gap-2 text-xs">
                    <span className={cn(
                      'mt-0.5 w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center text-[8px] font-black',
                      cond.triggered
                        ? 'bg-red-500/40 border-red-400 text-red-200'
                        : 'bg-white/5 border-white/20 text-white/40',
                    )}>
                      {cond.triggered ? '\u2713' : '\u2013'}
                    </span>
                    <span className={cn('leading-snug', cond.triggered ? 'opacity-100' : 'opacity-40')}>
                      <span className="font-bold">{cond.name}</span>
                      {cond.triggered && <span className="opacity-70"> \u2014 {cond.description}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs opacity-80 leading-relaxed">{inverseGate1Result.actionMessage}</p>
              {inverseGate1Result.etfRecommendations.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {inverseGate1Result.etfRecommendations.map(etf => (
                    <li key={etf} className="text-[10px] opacity-70 text-red-300">{etf}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
