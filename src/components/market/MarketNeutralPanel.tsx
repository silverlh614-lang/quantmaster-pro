// @responsibility market 영역 MarketNeutralPanel 컴포넌트
/**
 * 아이디어 9: Market Neutral 모드 패널
 * TRANSITION 레짐에서 롱/인버스 동시 보유로 변동성 수익을 추구하는
 * Market Neutral 전략을 시각화한다.
 */
import React, { useState } from 'react';
import { Scale, TrendingUp, TrendingDown, Wallet, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { MarketNeutralResult, MarketNeutralLegType } from '../../types/quant';

interface MarketNeutralPanelProps {
  marketNeutralResult: MarketNeutralResult | null;
}

const LEG_STYLES: Record<MarketNeutralLegType, { bg: string; border: string; text: string; icon: React.ElementType }> = {
  LONG:    { bg: 'bg-emerald-900/40', border: 'border-emerald-500/40', text: 'text-emerald-300', icon: TrendingUp },
  INVERSE: { bg: 'bg-red-900/40',     border: 'border-red-500/40',     text: 'text-red-300',     icon: TrendingDown },
  CASH:    { bg: 'bg-gray-800/50',    border: 'border-gray-500/40',    text: 'text-gray-300',    icon: Wallet },
};

export function MarketNeutralPanel({ marketNeutralResult }: MarketNeutralPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!marketNeutralResult?.isActive) return null;

  const { legs, betaNeutralScenario, sharpeImprovementNote, strategyDescription, actionMessage } = marketNeutralResult;

  return (
    <div
      className="border-b border-purple-600/40 bg-purple-950/80 text-purple-100 transition-all duration-500 no-print"
      role="region"
      aria-label="Market Neutral 모드 패널"
    >
      {/* ── Main row ── */}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3 flex-wrap">

        {/* Label */}
        <div className="flex items-center gap-2 font-black text-sm shrink-0">
          <Scale className="w-4 h-4 text-purple-400" />
          <span className="uppercase tracking-widest text-xs text-purple-400">MARKET NEUTRAL</span>
        </div>

        {/* Allocation pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {legs.map(leg => {
            const style = LEG_STYLES[leg.type];
            const LegIcon = style.icon;
            return (
              <span
                key={leg.type}
                className={cn(
                  'flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded border uppercase tracking-widest shrink-0',
                  style.bg, style.border, style.text,
                )}
              >
                <LegIcon className="w-2.5 h-2.5" />
                {leg.type === 'LONG' ? '롱' : leg.type === 'INVERSE' ? '인버스' : '현금'} {leg.weightPct}%
              </span>
            );
          })}
        </div>

        {/* Action summary */}
        <span className="text-xs opacity-80 hidden md:block flex-1 truncate">
          {actionMessage}
        </span>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="ml-auto flex items-center gap-1 text-[10px] font-black uppercase tracking-widest opacity-70 hover:opacity-100 transition-opacity shrink-0"
          aria-expanded={expanded}
          aria-label="Market Neutral 상세 정보 보기"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{expanded ? '접기' : '상세'}</span>
        </button>
      </div>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-4 border-t border-purple-600/20 mt-1 pt-3 space-y-4">

          {/* Strategy description */}
          <div className="flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-purple-400 mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed opacity-85">{strategyDescription}</p>
          </div>

          {/* Portfolio legs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {legs.map(leg => {
              const style = LEG_STYLES[leg.type];
              const LegIcon = style.icon;
              return (
                <div
                  key={leg.type}
                  className={cn('rounded-lg border p-3', style.bg, style.border)}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <LegIcon className={cn('w-3.5 h-3.5', style.text)} />
                      <span className={cn('text-[11px] font-black uppercase tracking-widest', style.text)}>
                        {leg.label}
                      </span>
                    </div>
                    <span className={cn('text-lg font-black', style.text)}>{leg.weightPct}%</span>
                  </div>
                  <p className="text-[10px] opacity-75 leading-snug mb-2">{leg.description}</p>
                  <ul className="space-y-0.5">
                    {leg.examples.map(ex => (
                      <li key={ex} className="text-[10px] opacity-60">• {ex}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {/* Beta neutral scenario */}
          <div className="rounded-lg border border-purple-500/30 bg-purple-900/30 p-3">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-purple-300 mb-2 flex items-center gap-1.5">
              <Scale className="w-3 h-3" /> 베타 중립화 시나리오
            </h4>
            <p className="text-xs font-bold text-purple-100 mb-1">{betaNeutralScenario.description}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
              <div className="text-center">
                <p className="text-[9px] uppercase tracking-widest opacity-60 mb-0.5">시장 수익률</p>
                <p className="text-sm font-black text-red-300">{betaNeutralScenario.marketReturn}%</p>
              </div>
              <div className="text-center">
                <p className="text-[9px] uppercase tracking-widest opacity-60 mb-0.5">롱 알파</p>
                <p className="text-sm font-black text-emerald-300">+{betaNeutralScenario.longAlpha}%</p>
              </div>
              <div className="text-center">
                <p className="text-[9px] uppercase tracking-widest opacity-60 mb-0.5">인버스 수익</p>
                <p className="text-sm font-black text-emerald-300">+{betaNeutralScenario.inverseReturn}%</p>
              </div>
              <div className="text-center">
                <p className="text-[9px] uppercase tracking-widest opacity-60 mb-0.5">포트폴리오 총수익</p>
                <p className={cn('text-sm font-black', betaNeutralScenario.totalReturn >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                  {betaNeutralScenario.totalReturn >= 0 ? '+' : ''}{betaNeutralScenario.totalReturn}%
                </p>
              </div>
            </div>
          </div>

          {/* Sharpe improvement */}
          <p className="text-[10px] font-bold text-purple-300 opacity-80">
            📈 {sharpeImprovementNote}
          </p>
        </div>
      )}
    </div>
  );
}
