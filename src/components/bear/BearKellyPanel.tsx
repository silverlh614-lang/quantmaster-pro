// @responsibility bear 영역 BearKellyPanel 컴포넌트
/**
 * 아이디어 6: Bear Mode Kelly Criterion — 하락 베팅에 적용하는 켈리 공식
 * Bear Regime 감지 시 인버스 ETF에 대한 최적 포지션 비중을 켈리 공식으로 자동 계산하고,
 * 30거래일 Time-Stop 로직과 자동 청산 알림을 표시한다.
 */
import React, { useState, useEffect } from 'react';
import { AlertTriangle, Calculator, Clock, TrendingDown, ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { BearKellyResult } from '../../types/quant';

interface BearKellyPanelProps {
  bearKellyResult: BearKellyResult | null;
  entryDate: string | null;
  onSetEntryDate: (date: string | null) => void;
}

export function BearKellyPanel({ bearKellyResult, entryDate, onSetEntryDate }: BearKellyPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [dateInput, setDateInput] = useState(entryDate ?? '');

  // Sync dateInput when entryDate changes externally (e.g., loaded from persisted storage)
  useEffect(() => {
    setDateInput(entryDate ?? '');
  }, [entryDate]);

  // Always render — show inactive placeholder when no regime data is available
  const result = bearKellyResult ?? {
    isActive: false,
    p: 0,
    b: 1.8,
    q: 1,
    rawKellyFraction: 0,
    kellyPct: 0,
    halfKellyPct: 0,
    maxHoldingDays: 30,
    entryDate: null,
    tradingDaysElapsed: 0,
    tradingDaysRemaining: 30,
    timeStopTriggered: false,
    timeStopAlert: '포지션 진입 후 Time-Stop이 자동 카운트다운됩니다. 30거래일 도달 시 자동 청산 알림이 발송됩니다.',
    formulaNote: 'Bear Kelly = (p × b − q) / b  — Gate -1 Bear Regime 감지 시 자동 계산됩니다.',
    actionMessage: '🟢 Bear Regime 비활성 — Bear Kelly 포지션 없음. Gate -1이 Bear Mode를 감지하면 켈리 공식이 자동 계산됩니다.',
    lastUpdated: new Date().toISOString(),
  };

  const { isActive, p, b, q, kellyPct, halfKellyPct, tradingDaysElapsed, tradingDaysRemaining,
    timeStopTriggered, timeStopAlert, formulaNote, actionMessage, maxHoldingDays } = result;

  const progressPct = entryDate ? Math.min((tradingDaysElapsed / maxHoldingDays) * 100, 100) : 0;

  const borderColor = timeStopTriggered
    ? 'border-red-500'
    : isActive
      ? 'border-red-500/70'
      : 'border-theme-border';

  const handleSetEntry = () => {
    if (dateInput) {
      onSetEntryDate(dateInput);
    }
  };

  const handleClearEntry = () => {
    setDateInput('');
    onSetEntryDate(null);
  };

  return (
    <div className={cn(
      'p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]',
      borderColor,
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
          <Calculator className="w-3.5 h-3.5" />
          Bear Kelly Criterion · 인버스 ETF 최적 포지션
        </h3>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-black px-3 py-1 rounded border',
            timeStopTriggered
              ? 'bg-red-900/60 border-red-400 text-red-200 animate-pulse'
              : isActive
                ? 'bg-red-900/40 border-red-500/70 text-red-300'
                : 'bg-theme-bg border-theme-border text-theme-text-muted',
          )}>
            {timeStopTriggered ? '🔴 TIME-STOP' : isActive ? '🔴 BEAR ACTIVE' : '🟢 INACTIVE'}
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

      {/* Time-Stop Alert */}
      {timeStopTriggered && (
        <div className="mb-4 p-3 border border-red-500 bg-red-900/30 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-200 leading-relaxed font-bold">{timeStopAlert}</p>
        </div>
      )}

      {/* Kelly Position Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="p-3 border border-theme-border bg-theme-bg text-center">
          <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-1">반 켈리 권장</p>
          <p className={cn(
            'text-2xl font-black font-mono',
            isActive ? 'text-red-400' : 'text-theme-text-muted',
          )}>
            {halfKellyPct.toFixed(1)}<span className="text-sm">%</span>
          </p>
          <p className="text-[8px] text-theme-text-muted mt-0.5">실전 권고 비중</p>
        </div>
        <div className="p-3 border border-theme-border bg-theme-bg text-center">
          <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-1">전체 켈리</p>
          <p className="text-2xl font-black font-mono text-theme-text-secondary">
            {kellyPct.toFixed(1)}<span className="text-sm">%</span>
          </p>
          <p className="text-[8px] text-theme-text-muted mt-0.5">이론 최대치</p>
        </div>
        <div className="p-3 border border-theme-border bg-theme-bg text-center">
          <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-1">신호 확률 (p)</p>
          <p className="text-2xl font-black font-mono text-theme-text-secondary">
            {(p * 100).toFixed(0)}<span className="text-sm">%</span>
          </p>
          <p className="text-[8px] text-theme-text-muted mt-0.5">Gate -1 충족도</p>
        </div>
        <div className="p-3 border border-theme-border bg-theme-bg text-center">
          <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-1">기대수익 배수 (b)</p>
          <p className="text-2xl font-black font-mono text-theme-text-secondary">
            {b.toFixed(1)}<span className="text-sm">×</span>
          </p>
          <p className="text-[8px] text-theme-text-muted mt-0.5">인버스 2X ETF</p>
        </div>
      </div>

      {/* Time-Stop Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-[9px] font-black text-theme-text-muted mb-1.5">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Time-Stop 카운트다운 (최대 {maxHoldingDays}거래일)
          </span>
          {entryDate
            ? <span>{tradingDaysElapsed} / {maxHoldingDays}일 경과 — 잔여 {tradingDaysRemaining}일</span>
            : <span>진입일 미설정</span>
          }
        </div>
        <div className="h-3 bg-theme-bg border border-theme-border relative overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-700',
              timeStopTriggered ? 'bg-red-600' : progressPct >= 70 ? 'bg-orange-500' : 'bg-amber-400',
            )}
            style={{ width: `${progressPct}%` }}
          />
          {/* 70% warning marker */}
          <div
            className="absolute top-0 h-full w-px bg-orange-400/60"
            style={{ left: '70%' }}
          />
        </div>
        <p className="text-[9px] text-theme-text-muted mt-1 leading-relaxed">{timeStopAlert}</p>
      </div>

      {/* Entry Date Setting */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5 flex-1">
          <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest whitespace-nowrap">
            진입일 설정
          </label>
          <input
            type="date"
            value={dateInput}
            onChange={e => setDateInput(e.target.value)}
            className="flex-1 text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-red-500/60 min-w-0"
            max={new Date().toISOString().split('T')[0]}
          />
        </div>
        <button
          onClick={handleSetEntry}
          disabled={!dateInput}
          className="px-3 py-1 text-[10px] font-black uppercase tracking-widest border border-theme-text bg-theme-card hover:bg-theme-text hover:text-white transition-colors disabled:opacity-40"
        >
          설정
        </button>
        {entryDate && (
          <button
            onClick={handleClearEntry}
            className="p-1 text-theme-text-muted hover:text-red-400 transition-colors"
            aria-label="진입일 초기화"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Action Message */}
      <div className={cn(
        'p-3 border text-xs leading-relaxed',
        timeStopTriggered
          ? 'border-red-500/50 bg-red-900/20 text-red-200'
          : isActive
            ? 'border-red-600/30 bg-red-900/15 text-red-300'
            : 'border-theme-border bg-theme-bg text-theme-text-secondary',
      )}>
        {actionMessage}
      </div>

      {/* Expanded: Formula Details */}
      {expanded && (
        <div className="mt-4 space-y-3">
          {/* Kelly Formula */}
          <div className="p-3 border border-theme-border bg-theme-bg">
            <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-2">
              켈리 공식 계산 상세
            </p>
            <p className="text-[10px] font-mono text-theme-text leading-relaxed">{formulaNote}</p>
          </div>

          {/* Variables explanation */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'p (Bear 확률)', value: `${(p * 100).toFixed(1)}%`, desc: 'Gate -1 충족 조건 비율. Bear Mode 시 최소 50% 적용.' },
              { label: 'b (기대수익 배수)', value: `${b}×`, desc: '인버스 2X ETF 실효 배율 (슬리피지·롤링 비용 반영).' },
              { label: 'q (손실 확률)', value: `${(q * 100).toFixed(1)}%`, desc: '1 − p. Bear 신호 실패 확률.' },
            ].map(item => (
              <div key={item.label} className="p-2 border border-theme-border bg-theme-bg">
                <p className="text-[8px] font-black text-theme-text-muted uppercase tracking-widest">{item.label}</p>
                <p className="text-lg font-black font-mono mt-0.5">{item.value}</p>
                <p className="text-[8px] text-theme-text-muted mt-1 leading-tight">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Risk Warning */}
          <div className="p-3 border border-amber-500/30 bg-amber-900/10">
            <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest mb-1 flex items-center gap-1">
              <TrendingDown className="w-3 h-3" /> 인버스 ETF 시간가치 손실 주의
            </p>
            <p className="text-[9px] text-amber-200/70 leading-relaxed">
              레버리지 인버스 ETF는 일간 복리 효과로 인해 보유 기간이 길수록 기대수익률이 낮아집니다.
              반 켈리(Half-Kelly) 적용 및 최대 {maxHoldingDays}거래일 Time-Stop을 준수하여 시간가치 손실을 최소화하십시오.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
