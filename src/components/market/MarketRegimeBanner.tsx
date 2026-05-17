// @responsibility market 영역 MarketRegimeBanner 컴포넌트
/**
 * Idea 5: Compact one-line Market Regime Banner
 * RISK-ON/OFF state + VKOSPI chip + Foreign flow chip — readable in 10 seconds.
 * Expandable for full detail on click.
 */
import React, { useState } from 'react';
import { TrendingDown, ChevronDown, ChevronUp, Shield, Activity } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { BearRegimeResult, VkospiTriggerResult, InverseGate1Result } from '../../types/quant';

interface MarketRegimeBannerProps {
  bearRegimeResult: BearRegimeResult | null;
  vkospiTriggerResult: VkospiTriggerResult | null;
  inverseGate1Result?: InverseGate1Result | null;
}


interface BannerViewModel {
  regime: string;
  vLevel: string;
  isStrongBear: boolean;
  isPartialBear: boolean;
  isBear: boolean;
  isTransition: boolean;
  isVkospiAlert: boolean;
  shouldRender: boolean;
  triggeredCount: number;
  threshold: number;
  isRiskOff: boolean;
  riskLabel: string;
  riskColor: string;
  borderColor: string;
  bgColor: string;
}

function deriveBannerViewModel({ bearRegimeResult, vkospiTriggerResult, inverseGate1Result }: MarketRegimeBannerProps): BannerViewModel {
  const regime = bearRegimeResult?.regime ?? 'BULL';
  const vLevel = vkospiTriggerResult?.level ?? 'NORMAL';
  const isStrongBear = inverseGate1Result?.signalType === 'STRONG_BEAR';
  const isPartialBear = inverseGate1Result?.signalType === 'PARTIAL';
  const isBear = regime === 'BEAR';
  const isTransition = regime === 'TRANSITION';
  const isVkospiAlert = vLevel !== 'NORMAL';
  const isRiskOff = isBear || isStrongBear;
  return {
    regime, vLevel, isStrongBear, isPartialBear, isBear, isTransition, isVkospiAlert, isRiskOff,
    shouldRender: !(regime === 'BULL' && !isVkospiAlert && !isStrongBear && !isPartialBear),
    triggeredCount: bearRegimeResult?.triggeredCount ?? 0,
    threshold: bearRegimeResult?.threshold ?? 5,
    riskLabel: isRiskOff ? 'RISK-OFF' : 'RISK-ON',
    riskColor: isRiskOff ? 'text-red-400' : isTransition ? 'text-amber-400' : 'text-orange-400',
    borderColor: isRiskOff ? 'border-red-500/30' : isTransition ? 'border-amber-500/30' : 'border-orange-500/30',
    bgColor: isRiskOff ? 'bg-red-950/60' : isTransition ? 'bg-amber-950/60' : 'bg-orange-950/60',
  };
}

function RegimeChip({ vm }: { vm: BannerViewModel }) {
  return (
    <span className={cn(
      'text-[10px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest shrink-0 font-num',
      vm.isBear ? 'bg-red-500/20 border-red-500/30 text-red-300'
        : vm.isTransition ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
        : 'bg-orange-500/20 border-orange-500/30 text-orange-300'
    )}>
      {vm.isBear ? 'BEAR' : vm.isTransition ? 'TRANSITION' : 'WATCH'} {vm.triggeredCount}/{vm.threshold}
    </span>
  );
}

function VkospiChip({ result, level }: { result: VkospiTriggerResult; level: string }) {
  return (
    <>
      <div className="w-px h-4 bg-white/10 shrink-0" />
      <span className={cn(
        'text-[10px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest shrink-0 font-num',
        level === 'HISTORICAL_FEAR' || level === 'ENTRY_2'
          ? 'bg-red-500/20 border-red-500/30 text-red-300'
          : 'bg-amber-500/20 border-amber-500/30 text-amber-300'
      )}>
        VKOSPI {result.vkospi.toFixed(1)}
      </span>
    </>
  );
}

function InverseGateChip({ result, isStrongBear }: { result: InverseGate1Result; isStrongBear: boolean }) {
  return (
    <>
      <div className="w-px h-4 bg-white/10 shrink-0" />
      <span className={cn(
        'text-[10px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest shrink-0',
        isStrongBear
          ? 'bg-red-500/20 border-red-500/30 text-red-300'
          : 'bg-orange-500/20 border-orange-500/30 text-orange-300'
      )}>
        {isStrongBear ? 'INV BEAR' : `INV ${result.triggeredCount}/5`}
      </span>
    </>
  );
}

function ActionSummary({ vm, vkospiTriggerResult }: { vm: BannerViewModel; vkospiTriggerResult: VkospiTriggerResult | null }) {
  const label = vm.isBear ? '인버스 모드 — 롱 중단'
    : vm.isTransition ? '현금 확대 + 헤지 활성화'
    : vm.isStrongBear ? 'Inverse Gate STRONG BEAR'
    : `VKOSPI ${vkospiTriggerResult?.vkospi.toFixed(1)} 경보`;
  return <span className="text-[10px] text-white/40 font-medium hidden md:block flex-1 truncate ml-1">{label}</span>;
}

function ConditionList({ conditions }: { conditions: Array<{ id: string; name: string; triggered: boolean; description: string }> }) {
  return (
    <ul className="space-y-1">
      {conditions.map(cond => (
        <li key={cond.id} className="flex items-start gap-2 text-xs">
          <span className={cn(
            'mt-0.5 w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center text-[8px] font-black',
            cond.triggered ? 'bg-red-500/40 border-red-400 text-red-200' : 'bg-white/5 border-white/20 text-white/40',
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
  );
}

export function MarketRegimeBanner({ bearRegimeResult, vkospiTriggerResult, inverseGate1Result }: MarketRegimeBannerProps) {
  const [expanded, setExpanded] = useState(false);

  const vm = deriveBannerViewModel({ bearRegimeResult, vkospiTriggerResult, inverseGate1Result });

  // Only render banner in non-BULL or alert states
  if (!vm.shouldRender) return null;

  return (
    <div className={cn('no-print', vm.borderColor, vm.bgColor, 'border-b-2 backdrop-blur-sm')} role="alert" aria-live="assertive">
      {/* Compact One-Line Banner (Idea 5) */}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-10 flex items-center gap-3">
        {/* Pulsing Risk State */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn('signal-dot', vm.isRiskOff ? 'signal-dot-strong-sell' : 'signal-dot-neutral')} style={{ width: '8px', height: '8px' }} />
          <span className={cn('text-[11px] font-black uppercase tracking-[0.15em]', vm.riskColor)}>
            {vm.riskLabel}
          </span>
        </div>

        <div className="w-px h-4 bg-white/10 shrink-0" />

        {/* Regime Chip */}
        <RegimeChip vm={vm} />

        {/* VKOSPI Chip */}
        {vkospiTriggerResult && vm.isVkospiAlert && (
          <VkospiChip result={vkospiTriggerResult} level={vm.vLevel} />
        )}

        {/* Inverse Gate 1 Chip */}
        {inverseGate1Result && (vm.isStrongBear || vm.isPartialBear) && (
          <InverseGateChip result={inverseGate1Result} isStrongBear={vm.isStrongBear} />
        )}

        {/* Action Summary (desktop only) */}
        <ActionSummary vm={vm} vkospiTriggerResult={vkospiTriggerResult} />

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
                <Shield className="w-3 h-3" /> Gate -1 조건 ({vm.triggeredCount}/{bearRegimeResult.conditions.length})
              </h4>
<ConditionList conditions={bearRegimeResult.conditions} />
              <p className="mt-2 text-xs opacity-80 leading-relaxed">{bearRegimeResult.actionRecommendation}</p>
            </div>
          )}

          {/* VKOSPI Trigger Detail */}
          {vkospiTriggerResult && vm.isVkospiAlert && (
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
          {inverseGate1Result && (vm.isStrongBear || vm.isPartialBear) && (
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
