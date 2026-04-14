/**
 * 아이디어 4: FSS 외국인 수급 방향 전환 스코어
 *
 * 외국인 Passive + Active 동반 매도 전환을 추적하여
 * 5일 누적 스코어로 수급 이탈 경보를 발생시키는 대시보드 패널.
 *
 *   누적 > -3         → 🟢 NORMAL   (정상)
 *   -5 < 누적 ≤ -3    → ⚠️ CAUTION  (주의)
 *   누적 ≤ -5         → 🔴 HIGH_ALERT (수급 이탈 경보)
 */
import React, { useState } from 'react';
import { Users, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import type { FssResult, FssAlertLevel } from '../../types/quant';
import { cn } from '../../ui/cn';

interface FSSPanelProps {
  fssResult: FssResult | null;
}

function getAlertStyles(level: FssAlertLevel) {
  switch (level) {
    case 'HIGH_ALERT':
      return {
        border: 'border-red-600',
        badge: 'bg-red-600 text-white',
        bar: 'bg-red-600',
        icon: '🔴',
        label: 'HIGH ALERT',
        alertBg: 'bg-red-900/30 border-red-600',
        alertText: 'text-red-300',
      };
    case 'CAUTION':
      return {
        border: 'border-amber-400',
        badge: 'bg-amber-400 text-black',
        bar: 'bg-amber-400',
        icon: '⚠️',
        label: 'CAUTION',
        alertBg: 'bg-amber-900/30 border-amber-400',
        alertText: 'text-amber-300',
      };
    default:
      return {
        border: 'border-theme-border',
        badge: 'bg-emerald-600 text-white',
        bar: 'bg-emerald-500',
        icon: '🟢',
        label: 'NORMAL',
        alertBg: 'bg-emerald-900/20 border-emerald-600',
        alertText: 'text-emerald-400',
      };
  }
}

const LABEL_KO: Record<string, string> = {
  BOTH_SELL: '동반 매도',
  PARTIAL_SELL: '편방 매도',
  MIXED: '혼합',
  PARTIAL_BUY: '편방 매수',
  BOTH_BUY: '동반 매수',
};

const LABEL_COLOR: Record<string, string> = {
  BOTH_SELL: 'text-red-400',
  PARTIAL_SELL: 'text-orange-400',
  MIXED: 'text-theme-text-muted',
  PARTIAL_BUY: 'text-sky-400',
  BOTH_BUY: 'text-emerald-400',
};

export function FSSPanel({ fssResult }: FSSPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!fssResult) {
    return (
      <div className="p-4 sm:p-6 border-2 border-theme-border bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-3.5 h-3.5 text-theme-text-muted" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            FSS 외국인 수급 방향 전환 스코어
          </h3>
        </div>
        <p className="text-[10px] text-theme-text-muted italic">
          /api/fss/records 에 일별 외국인 수급 데이터를 입력하면 FSS가 자동 계산됩니다.
        </p>
      </div>
    );
  }

  const styles = getAlertStyles(fssResult.alertLevel);

  // Gauge: score ranges from -15 to +15, normalize to 0-100 for display
  const normalizedPct = Math.max(0, Math.min(100, ((fssResult.cumulativeScore + 15) / 30) * 100));

  return (
    <div className={cn(
      'p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]',
      styles.border,
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
          <Users className="w-3.5 h-3.5" />
          FSS 외국인 수급 방향 전환 스코어
        </h3>
        <div className="flex items-center gap-2">
          <span className={cn('px-2 py-0.5 text-[9px] font-black uppercase tracking-wider', styles.badge)}>
            {styles.icon} {styles.label}
          </span>
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-theme-text-muted hover:text-theme-text transition-colors"
            aria-label={expanded ? '접기' : '펼치기'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Action Alert */}
      {fssResult.alertLevel !== 'NORMAL' && (
        <div className={cn('mb-4 p-3 border flex items-start gap-2', styles.alertBg)}>
          <AlertTriangle className={cn('w-4 h-4 flex-shrink-0 mt-0.5', styles.alertText)} />
          <p className={cn('text-xs leading-relaxed font-bold', styles.alertText)}>
            {fssResult.actionMessage}
          </p>
        </div>
      )}

      {/* FSS Score Gauge */}
      <div className="mb-5">
        <div className="flex items-end justify-between mb-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-theme-text-muted">
            5일 누적 점수
          </span>
          <span className={cn('text-2xl font-black tabular-nums', styles.alertText || 'text-theme-text')}>
            {fssResult.cumulativeScore > 0 ? '+' : ''}{fssResult.cumulativeScore}
          </span>
        </div>

        {/* Score bar: -15 to +15 */}
        <div className="relative h-4 bg-theme-bg border border-theme-border overflow-visible">
          {/* Center line (0) */}
          <div className="absolute top-0 bottom-0 w-px bg-white/40" style={{ left: '50%' }} />
          {/* Filled portion: from center to current score */}
          {fssResult.cumulativeScore < 0 ? (
            <div
              className="absolute top-0 bottom-0 bg-red-500/60"
              style={{
                left: `${normalizedPct}%`,
                width: `${50 - normalizedPct}%`,
              }}
            />
          ) : fssResult.cumulativeScore > 0 ? (
            <div
              className="absolute top-0 bottom-0 bg-emerald-500/60"
              style={{
                left: '50%',
                width: `${normalizedPct - 50}%`,
              }}
            />
          ) : null}
          {/* Threshold markers */}
          <div className="absolute top-0 bottom-0 w-px bg-amber-400/50" style={{ left: `${(((-3) + 15) / 30) * 100}%` }}>
            <span className="absolute -top-4 -translate-x-1/2 text-[7px] font-black text-amber-400/70 whitespace-nowrap">-3</span>
          </div>
          <div className="absolute top-0 bottom-0 w-px bg-red-500/50" style={{ left: `${(((-5) + 15) / 30) * 100}%` }}>
            <span className="absolute -top-4 -translate-x-1/2 text-[7px] font-black text-red-400/70 whitespace-nowrap">-5</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex gap-3 mt-3 flex-wrap">
          <span className="text-[8px] text-emerald-400 font-bold">&gt; -3 정상</span>
          <span className="text-[8px] text-amber-400 font-bold">-5 ~ -3 주의</span>
          <span className="text-[8px] text-red-400 font-bold">&le; -5 수급 이탈</span>
        </div>
      </div>

      {/* Consecutive sell streak */}
      {fssResult.consecutiveBothSellDays > 0 && (
        <div className="mb-4 px-3 py-2 border border-red-500/30 bg-red-900/10">
          <span className="text-[9px] font-black text-red-400">
            Passive+Active 동반 순매도 {fssResult.consecutiveBothSellDays}일 연속
          </span>
        </div>
      )}

      {/* Daily Breakdown */}
      {expanded && fssResult.dailyScores.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-theme-text-muted mb-2">
            최근 {fssResult.dailyScores.length}거래일 일별 내역
          </p>
          {fssResult.dailyScores.map(day => (
            <div
              key={day.date}
              className={cn(
                'flex items-center gap-3 p-2 border',
                day.label === 'BOTH_SELL'
                  ? 'border-red-500/50 bg-red-900/15'
                  : day.label === 'BOTH_BUY'
                    ? 'border-emerald-500/50 bg-emerald-900/15'
                    : 'border-theme-border bg-theme-bg',
              )}
            >
              {/* Date */}
              <span className="text-[10px] font-black text-theme-text-muted tabular-nums w-20 shrink-0">
                {day.date}
              </span>
              {/* Score chip */}
              <span className={cn(
                'w-8 text-center text-[10px] font-black tabular-nums',
                day.score < 0 ? 'text-red-400' : day.score > 0 ? 'text-emerald-400' : 'text-theme-text-muted',
              )}>
                {day.score > 0 ? '+' : ''}{day.score}
              </span>
              {/* Label */}
              <span className={cn('text-[9px] font-bold', LABEL_COLOR[day.label] ?? 'text-theme-text-muted')}>
                {LABEL_KO[day.label] ?? day.label}
              </span>
              {/* Net buy amounts */}
              <span className="ml-auto text-[8px] text-theme-text-muted tabular-nums">
                P: {day.passiveNetBuy > 0 ? '+' : ''}{day.passiveNetBuy.toFixed(0)}
                {' / '}
                A: {day.activeNetBuy > 0 ? '+' : ''}{day.activeNetBuy.toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
