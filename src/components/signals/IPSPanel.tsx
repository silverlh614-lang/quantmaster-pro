// @responsibility signals 영역 IPSPanel 컴포넌트
/**
 * 아이디어 11: IPS 통합 변곡점 확률 엔진
 *
 * 6개 신호(THS·VDA·FSS·FBS·TMA·SRR)의 가중합으로 변곡점 확률(0~100%)을 산출하고
 * 임계치별 텔레그램 경보 단계를 표시하는 대시보드 패널.
 *
 *   IPS ≥ 60% → ⚠️ WARNING  (변곡점 경보)
 *   IPS ≥ 80% → 🚨 CRITICAL (50% 비중 축소 트리거)
 *   IPS ≥ 90% → 🔴 EXTREME  (Pre-Mortem 체크리스트)
 */
import React, { useState } from 'react';
import { Activity, ChevronDown, ChevronUp, AlertTriangle, Zap, Target } from 'lucide-react';
import type { IpsResult, IpsSignalId } from '../../types/quant';
import { cn } from '../../ui/cn';

interface IPSPanelProps {
  ipsResult: IpsResult | null;
}

const SIGNAL_LABELS: Record<IpsSignalId, { short: string; full: string }> = {
  THS: { short: 'THS', full: 'Trend Health Score 역전' },
  VDA: { short: 'VDA', full: 'VIX Divergence Alert' },
  FSS: { short: 'FSS', full: 'Fundamental Stress Score 음수' },
  FBS: { short: 'FBS', full: 'Fundamental Bias Score 2단계' },
  TMA: { short: 'TMA', full: 'Trend Momentum Acceleration 감속' },
  SRR: { short: 'SRR', full: 'Sector Rotation Rate 역전' },
};

function getLevelStyles(level: IpsResult['level']) {
  switch (level) {
    case 'EXTREME':
      return {
        border: 'border-red-600',
        badge: 'bg-red-600 text-white',
        bar: 'bg-red-600',
        icon: '🔴',
        label: 'EXTREME',
        alertBg: 'bg-red-900/30 border-red-600',
        alertText: 'text-red-300',
      };
    case 'CRITICAL':
      return {
        border: 'border-orange-500',
        badge: 'bg-orange-500 text-white',
        bar: 'bg-orange-500',
        icon: '🚨',
        label: 'CRITICAL',
        alertBg: 'bg-orange-900/30 border-orange-500',
        alertText: 'text-orange-300',
      };
    case 'WARNING':
      return {
        border: 'border-amber-400',
        badge: 'bg-amber-400 text-black',
        bar: 'bg-amber-400',
        icon: '⚠️',
        label: 'WARNING',
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

export function IPSPanel({ ipsResult }: IPSPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!ipsResult) {
    return (
      <div className="p-4 sm:p-6 border-2 border-theme-border bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-3.5 h-3.5 text-theme-text-muted" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            IPS 통합 변곡점 확률 엔진
          </h3>
        </div>
        <p className="text-[10px] text-theme-text-muted italic">
          매크로 데이터를 불러오면 IPS가 자동 계산됩니다.
        </p>
      </div>
    );
  }

  const styles = getLevelStyles(ipsResult.level);

  // Gauge thresholds for display
  const thresholds = [
    { pct: 60, label: '60%', color: 'bg-amber-400/60' },
    { pct: 80, label: '80%', color: 'bg-orange-500/60' },
    { pct: 90, label: '90%', color: 'bg-red-600/60' },
  ];

  return (
    <div className={cn(
      'p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]',
      styles.border,
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
          <Activity className="w-3.5 h-3.5" />
          IPS 통합 변곡점 확률 엔진
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
      {ipsResult.level !== 'NORMAL' && (
        <div className={cn('mb-4 p-3 border flex items-start gap-2', styles.alertBg)}>
          <AlertTriangle className={cn('w-4 h-4 flex-shrink-0 mt-0.5', styles.alertText)} />
          <p className={cn('text-xs leading-relaxed font-bold', styles.alertText)}>
            {ipsResult.actionMessage}
          </p>
        </div>
      )}

      {/* IPS Gauge */}
      <div className="mb-5">
        <div className="flex items-end justify-between mb-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-theme-text-muted">
            IPS 점수
          </span>
          <span className={cn('text-2xl font-black tabular-nums', styles.alertText || 'text-theme-text')}>
            {ipsResult.ips}%
          </span>
        </div>

        {/* Bar + threshold markers */}
        <div className="relative h-4 bg-theme-bg border border-theme-border overflow-visible">
          {/* Filled bar */}
          <div
            className={cn('h-full transition-all', styles.bar)}
            style={{ width: `${Math.min(ipsResult.ips, 100)}%` }}
          />
          {/* Threshold tick lines */}
          {thresholds.map(t => (
            <div
              key={t.pct}
              className="absolute top-0 bottom-0 w-px bg-white/30"
              style={{ left: `${t.pct}%` }}
            >
              <span className="absolute -top-4 -translate-x-1/2 text-[7px] font-black text-theme-text-muted whitespace-nowrap">
                {t.label}
              </span>
            </div>
          ))}
        </div>

        {/* Threshold legend */}
        <div className="flex gap-3 mt-3 flex-wrap">
          <span className="text-[8px] text-amber-400 font-bold">⚠️ ≥60 경보</span>
          <span className="text-[8px] text-orange-400 font-bold">🚨 ≥80 비중 축소</span>
          <span className="text-[8px] text-red-400 font-bold">🔴 ≥90 Pre-Mortem</span>
        </div>
      </div>

      {/* Signal Breakdown */}
      {expanded && (
        <div className="space-y-2">
          <p className="text-[9px] font-black uppercase tracking-widest text-theme-text-muted mb-2">
            신호 구성 (6개 · 합계 100%)
          </p>
          {ipsResult.signals.map(signal => (
            <div
              key={signal.id}
              className={cn(
                'flex items-start gap-3 p-2.5 border',
                signal.triggered
                  ? 'border-red-500/50 bg-red-900/15'
                  : 'border-theme-border bg-theme-bg',
              )}
            >
              {/* Signal ID chip */}
              <div className={cn(
                'shrink-0 w-10 h-10 flex flex-col items-center justify-center border font-black text-[8px]',
                signal.triggered
                  ? 'border-red-500 bg-red-600/20 text-red-300'
                  : 'border-theme-border bg-theme-card text-theme-text-muted',
              )}>
                <span className="text-[10px]">{signal.triggered ? '▲' : '–'}</span>
                <span>{signal.id}</span>
              </div>

              {/* Signal details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className={cn(
                    'text-[10px] font-black',
                    signal.triggered ? 'text-red-300' : 'text-theme-text-muted',
                  )}>
                    {SIGNAL_LABELS[signal.id].full}
                  </span>
                  <span className={cn(
                    'shrink-0 text-[9px] font-black tabular-nums',
                    signal.triggered ? 'text-red-400' : 'text-theme-text-muted',
                  )}>
                    +{signal.contribution}% / {signal.weight * 100}%
                  </span>
                </div>
                <p className="text-[9px] text-theme-text-secondary leading-snug">
                  {signal.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Special Action Badges */}
      {expanded && (ipsResult.positionReduceRecommended || ipsResult.preMortemRequired) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {ipsResult.positionReduceRecommended && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 border border-orange-500 bg-orange-900/20">
              <Zap className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-[9px] font-black text-orange-300 uppercase tracking-wider">
                50% 비중 축소 트리거
              </span>
            </div>
          )}
          {ipsResult.preMortemRequired && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 border border-red-600 bg-red-900/20">
              <Target className="w-3.5 h-3.5 text-red-400" />
              <span className="text-[9px] font-black text-red-300 uppercase tracking-wider">
                Pre-Mortem 체크리스트 실행
              </span>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <p className="mt-4 text-[8px] text-theme-text-muted">
        최종 업데이트: {new Date(ipsResult.lastUpdated).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST
        &nbsp;·&nbsp;텔레그램 경보: IPS≥60 자동 발송 (15분 간격 폴링)
      </p>
    </div>
  );
}
