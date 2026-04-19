/**
 * DynamicStopPanel.tsx — 변동성 적응형 동적 손절 패널
 *
 * ATR 기반 동적 손절가 계산 및 트레일링 스톱 자동 활성화 상태를 표시한다.
 * 고정 -7% 손절 대신 시장 변동성에 맞춰 손절 폭을 자동 조정한다.
 */
import React, { useState } from 'react';
import {
  ShieldAlert, ChevronDown, ChevronUp, TrendingDown, Lock,
  AlertCircle, CheckCircle, Target,
} from 'lucide-react';
import { cn } from '../../ui/cn';
import type { DynamicStopInput, DynamicStopResult, DynamicStopRegime } from '../../types/sell';
import { evaluateDynamicStop } from '../../services/quant/dynamicStopEngine';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  result: DynamicStopResult | null;
  inputs: DynamicStopInput;
  onInputsChange: (inputs: DynamicStopInput) => void;
  /**
   * 활성화 시 레짐 선택 UI 를 비활성화하고 RegimeContext 도출값으로 표시한다.
   * 호출 측이 이미 분류기 결과로부터 자동 동기화하고 있을 때만 true 로 전달하라.
   */
  regimeLockedByContext?: boolean;
}

// ─── 레짐 스타일 ─────────────────────────────────────────────────────────────

function getRegimeStyle(regime: DynamicStopRegime) {
  switch (regime) {
    case 'RISK_ON':  return { label: 'Risk-On 강세', color: 'text-emerald-400', bg: 'bg-emerald-500', mult: '×2.0' };
    case 'RISK_OFF': return { label: 'Risk-Off 조정', color: 'text-yellow-400', bg: 'bg-yellow-500', mult: '×1.5' };
    case 'CRISIS':   return { label: '시스템 위기', color: 'text-red-400', bg: 'bg-red-500', mult: '×1.0' };
  }
}

// ─── 숫자 입력 ────────────────────────────────────────────────────────────────

function NumInput({ label, value, onChange, step = 100, min = 0 }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] text-gray-400 w-20 flex-shrink-0">{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-28 text-xs bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white"
      />
    </label>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export const DynamicStopPanel: React.FC<Props> = ({
  result,
  inputs,
  onInputsChange,
  regimeLockedByContext = false,
}) => {
  const [expanded, setExpanded] = useState(false);

  const r = result ?? evaluateDynamicStop(inputs);
  const regStyle = getRegimeStyle(r.regime);

  function update(patch: Partial<DynamicStopInput>) {
    onInputsChange({ ...inputs, ...patch });
  }

  const activeStop = r.trailingActive ? r.trailingStopPrice : r.stopPrice;
  const activeStopPct = r.trailingActive ? r.trailingStopPct : r.stopPct;

  return (
    <div className={cn(
      'rounded-xl border-2 bg-gray-900/60 overflow-hidden',
      r.profitLockIn ? 'border-emerald-500' : r.bepProtection ? 'border-sky-500' : 'border-orange-500/70',
    )}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-orange-400" />
          <div>
            <h3 className="text-sm font-black text-white tracking-wide">
              변동성 적응형 동적 손절 (ATR-Dynamic Stop)
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">
              ATR × 레짐 배수 → 고정 -7% 손절 대체 · 트레일링 자동 활성
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn('text-xs font-bold', regStyle.color)}>
            {regStyle.label} {regStyle.mult}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* Main Metrics */}
      <div className="px-5 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* ATR Stop */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
          <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">ATR 동적 손절</p>
          <p className="text-base font-black text-white">{r.stopPrice.toLocaleString()}<span className="text-xs text-gray-400">원</span></p>
          <p className="text-[10px] text-red-400">{r.stopPct.toFixed(1)}%</p>
        </div>

        {/* Active Stop */}
        <div className={cn(
          'border rounded-lg p-3',
          r.trailingActive ? 'bg-emerald-900/20 border-emerald-600' : 'bg-gray-800/50 border-gray-700',
        )}>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">
            {r.trailingActive ? '트레일링 손절 (활성)' : '현재 손절가'}
          </p>
          <p className={cn('text-base font-black', r.trailingActive ? 'text-emerald-300' : 'text-white')}>
            {activeStop.toLocaleString()}<span className="text-xs text-gray-400">원</span>
          </p>
          <p className={cn('text-[10px]', activeStopPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {activeStopPct >= 0 ? '+' : ''}{activeStopPct.toFixed(1)}%
          </p>
        </div>

        {/* ATR Multiplier */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
          <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">ATR14</p>
          <p className="text-base font-black text-white">{inputs.atr14.toLocaleString()}<span className="text-xs text-gray-400">원</span></p>
          <p className={cn('text-[10px]', regStyle.color)}>배수 {regStyle.mult}</p>
        </div>

        {/* Current Return */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
          <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">현재 수익률</p>
          <p className={cn('text-base font-black', r.currentReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {r.currentReturnPct >= 0 ? '+' : ''}{r.currentReturnPct.toFixed(1)}<span className="text-xs">%</span>
          </p>
          <p className="text-[10px] text-gray-400">
            {r.profitLockIn ? '수익 Lock-in ✓' : r.bepProtection ? 'BEP 보호 ✓' : '기본 손절'}
          </p>
        </div>
      </div>

      {/* Status Badges */}
      <div className="px-5 pb-4 flex flex-wrap gap-2">
        <div className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px]',
          r.bepProtection
            ? 'bg-sky-900/20 border-sky-600 text-sky-300'
            : 'bg-gray-800/50 border-gray-700 text-gray-500',
        )}>
          {r.bepProtection ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
          BEP 보호 (+5% 트리거)
        </div>
        <div className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px]',
          r.profitLockIn
            ? 'bg-emerald-900/20 border-emerald-600 text-emerald-300'
            : 'bg-gray-800/50 border-gray-700 text-gray-500',
        )}>
          {r.profitLockIn ? <Lock className="w-3 h-3" /> : <Lock className="w-3 h-3 opacity-40" />}
          수익 Lock-in (+10% 트리거)
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-orange-900/20 border-orange-700 text-orange-300 text-[10px]">
          <TrendingDown className="w-3 h-3" />
          고정 손절 -7% 대체
        </div>
      </div>

      {/* Action Message */}
      <div className={cn(
        'mx-5 mb-4 px-4 py-2.5 rounded-lg border text-[11px]',
        r.profitLockIn ? 'bg-emerald-900/20 border-emerald-600 text-emerald-300' :
        r.bepProtection ? 'bg-sky-900/20 border-sky-600 text-sky-300' :
        'bg-orange-900/20 border-orange-700 text-orange-200',
      )}>
        {r.actionMessage}
      </div>

      {/* Expanded Inputs */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-700/50 pt-4 space-y-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">입력 설정</p>

          <div className="space-y-2">
            <NumInput label="진입가 (원)" value={inputs.entryPrice} onChange={v => update({ entryPrice: v })} step={1000} />
            <NumInput label="현재가 (원)" value={inputs.currentPrice} onChange={v => update({ currentPrice: v })} step={1000} />
            <NumInput label="ATR14 (원)" value={inputs.atr14} onChange={v => update({ atr14: v })} step={100} min={0} />
          </div>

          {/* Regime — RegimeContext 동기화 시 read-only 표시 */}
          <div>
            <p className="text-[10px] text-gray-400 mb-2">
              시장 레짐 (ATR 배수 결정)
              {regimeLockedByContext && (
                <span className="ml-2 text-[9px] text-emerald-400 font-bold">
                  · 레짐 분류기 동기화 (수동 변경 불가)
                </span>
              )}
            </p>
            {regimeLockedByContext ? (
              <div className={cn(
                'w-full py-2 rounded-lg border text-center text-[11px] font-bold',
                'bg-gray-800/60 border-gray-600 text-gray-200',
              )}>
                {regStyle.label} {regStyle.mult}
              </div>
            ) : (
              <div className="flex gap-2">
                {(['RISK_ON', 'RISK_OFF', 'CRISIS'] as DynamicStopRegime[]).map(rg => {
                  const s = getRegimeStyle(rg);
                  return (
                    <button
                      key={rg}
                      onClick={() => update({ regime: rg })}
                      className={cn(
                        'flex-1 py-1.5 rounded-lg border text-[10px] font-bold transition-all',
                        inputs.regime === rg
                          ? `${s.bg} border-transparent text-white`
                          : 'bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500',
                      )}
                    >
                      {s.label}<br /><span className="font-normal">{s.mult}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Algorithm Explanation */}
          <div className="bg-orange-900/20 border border-orange-700/50 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Target className="w-3.5 h-3.5 text-orange-400 mt-0.5 flex-shrink-0" />
              <div className="text-[10px] text-orange-200 leading-relaxed space-y-1">
                <p><span className="font-bold">Dynamic_Stop</span> = 진입가 − (ATR14 × 레짐 배수)</p>
                <p>• 변동성 낮은 종목: 타이트한 손절 | 변동성 높은 종목: 여유 있는 손절</p>
                <p>• +5% 수익 → 손절선을 진입가로 이동 (원금 보호)</p>
                <p>• +10% 수익 → 손절선을 +3%로 이동 (수익 확보)</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
