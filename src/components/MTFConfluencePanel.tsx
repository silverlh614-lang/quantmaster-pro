/**
 * MTFConfluencePanel.tsx — 다중 시간 프레임 합치 스코어 패널
 *
 * 월봉·주봉·일봉·60분봉의 4개 시간 프레임 신호 정렬도를 표시하고
 * 가중 합산 점수(0~100)로 매수 등급을 결정한다.
 */
import React, { useState } from 'react';
import { Layers, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { cn } from '../ui/cn';
import type { MTFConfluenceInput, MTFConfluenceResult, MTFTimeframeScore } from '../types/technical';
import { evaluateMTFConfluence } from '../services/quant/mtfEngine';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  result: MTFConfluenceResult | null;
  inputs: MTFConfluenceInput;
  onInputsChange: (inputs: MTFConfluenceInput) => void;
}

// ─── 신호 스타일 매핑 ─────────────────────────────────────────────────────────

function getSignalStyles(signal: MTFConfluenceResult['signal']) {
  switch (signal) {
    case 'STRONG_BUY': return {
      border: 'border-emerald-500',
      badge: 'bg-emerald-600 text-white',
      bar: 'bg-emerald-500',
      icon: '🟢',
      label: 'STRONG BUY',
      alertBg: 'bg-emerald-900/20 border-emerald-600',
      alertText: 'text-emerald-300',
    };
    case 'BUY': return {
      border: 'border-sky-400',
      badge: 'bg-sky-500 text-white',
      bar: 'bg-sky-400',
      icon: '🔵',
      label: 'BUY',
      alertBg: 'bg-sky-900/20 border-sky-500',
      alertText: 'text-sky-300',
    };
    case 'WATCH': return {
      border: 'border-yellow-400',
      badge: 'bg-yellow-500 text-gray-900',
      bar: 'bg-yellow-400',
      icon: '🟡',
      label: 'WATCH',
      alertBg: 'bg-yellow-900/20 border-yellow-500',
      alertText: 'text-yellow-300',
    };
    default: return {
      border: 'border-gray-500',
      badge: 'bg-gray-600 text-white',
      bar: 'bg-gray-500',
      icon: '⚪',
      label: 'IDLE',
      alertBg: 'bg-gray-800/50 border-gray-600',
      alertText: 'text-gray-400',
    };
  }
}

function getTFSignalIcon(signal: MTFTimeframeScore['signal']) {
  if (signal === 'BULLISH') return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
  if (signal === 'BEARISH') return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
  return <Minus className="w-3.5 h-3.5 text-yellow-400" />;
}

function getTFLabel(tf: MTFTimeframeScore['timeframe']) {
  switch (tf) {
    case 'MONTHLY': return '월봉';
    case 'WEEKLY':  return '주봉';
    case 'DAILY':   return '일봉';
    case 'H60':     return '60분봉';
  }
}

// ─── 체크박스 헬퍼 ───────────────────────────────────────────────────────────

function BoolToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={value}
        onChange={e => onChange(e.target.checked)}
        className="accent-emerald-500 w-3.5 h-3.5"
      />
      <span className="text-[10px] text-gray-300">{label}</span>
    </label>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export const MTFConfluencePanel: React.FC<Props> = ({ result, inputs, onInputsChange }) => {
  const [expanded, setExpanded] = useState(false);

  const r = result ?? evaluateMTFConfluence(inputs);
  const styles = getSignalStyles(r.signal);
  const timeframes = [r.monthly, r.weekly, r.daily, r.h60];

  function update(patch: Partial<MTFConfluenceInput>) {
    onInputsChange({ ...inputs, ...patch });
  }

  return (
    <div className={cn('rounded-xl border-2 bg-gray-900/60 overflow-hidden', styles.border)}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <Layers className="w-5 h-5 text-violet-400" />
          <div>
            <h3 className="text-sm font-black text-white tracking-wide">
              MTF 합치 스코어 (Multi-Timeframe Confluence)
            </h3>
            <p className="text-[10px] text-gray-400 mt-0.5">
              월봉·주봉·일봉·60분봉 4개 시간 프레임 동시 정렬 — 계층적 노이즈 필터
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', styles.badge)}>
            {styles.icon} {styles.label}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* Score Bar */}
      <div className="px-5 pb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-400">MTF Score</span>
          <span className="text-base font-black text-white">{r.mtfScore.toFixed(0)}<span className="text-xs text-gray-400"> / 100</span></span>
        </div>
        <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full transition-all duration-500', styles.bar)} style={{ width: `${r.mtfScore}%` }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-gray-500">관망 &lt;65</span>
          <span className="text-[9px] text-yellow-500">WATCH 65~74</span>
          <span className="text-[9px] text-sky-400">BUY 75~84</span>
          <span className="text-[9px] text-emerald-400">STRONG BUY ≥85</span>
        </div>
      </div>

      {/* Summary */}
      <div className={cn('mx-5 mb-4 px-4 py-2.5 rounded-lg border text-[11px]', styles.alertBg, styles.alertText)}>
        {r.summary}
        {r.positionRatio > 0 && (
          <span className="ml-2 font-bold text-white">
            포지션 {(r.positionRatio * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {/* Timeframe Bars */}
      <div className="px-5 pb-4 grid grid-cols-2 gap-2">
        {timeframes.map(tf => (
          <div key={tf.timeframe} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                {getTFSignalIcon(tf.signal)}
                <span className="text-[10px] font-bold text-gray-200">{getTFLabel(tf.timeframe)}</span>
                <span className="text-[9px] text-gray-500">×{tf.weight}</span>
              </div>
              <span className="text-xs font-black text-white">{tf.score.toFixed(0)}</span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mb-1.5">
              <div
                className={cn('h-full rounded-full', tf.signal === 'BULLISH' ? 'bg-emerald-500' : tf.signal === 'BEARISH' ? 'bg-red-500' : 'bg-yellow-400')}
                style={{ width: `${tf.score}%` }}
              />
            </div>
            <p className="text-[9px] text-gray-400 leading-tight">{tf.detail}</p>
          </div>
        ))}
      </div>

      {/* Expandable Input Panel */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-700/50 pt-4 space-y-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">입력 설정</p>

          {/* Monthly */}
          <div>
            <p className="text-[10px] font-bold text-gray-300 mb-2">월봉 (가중치 0.35)</p>
            <div className="flex flex-wrap gap-4">
              <BoolToggle label="MA60 상단" value={inputs.monthlyAboveMa60} onChange={v => update({ monthlyAboveMa60: v })} />
              <BoolToggle label="MA60 상승 추세" value={inputs.monthlyMa60TrendUp} onChange={v => update({ monthlyMa60TrendUp: v })} />
            </div>
          </div>

          {/* Weekly */}
          <div>
            <p className="text-[10px] font-bold text-gray-300 mb-2">주봉 (가중치 0.30)</p>
            <div className="flex flex-wrap gap-4 mb-2">
              <BoolToggle label="MACD 히스토 양수" value={inputs.weeklyMacdHistogramPositive} onChange={v => update({ weeklyMacdHistogramPositive: v })} />
              <BoolToggle label="돌파/지지 확인" value={inputs.weeklyBreakoutConfirmed} onChange={v => update({ weeklyBreakoutConfirmed: v })} />
            </div>
            <label className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400">주봉 RSI</span>
              <input
                type="number"
                min={0} max={100}
                value={inputs.weeklyRsi}
                onChange={e => update({ weeklyRsi: Number(e.target.value) })}
                className="w-16 text-xs bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-white"
              />
            </label>
          </div>

          {/* Daily */}
          <div>
            <p className="text-[10px] font-bold text-gray-300 mb-2">일봉 (가중치 0.25)</p>
            <div className="flex flex-wrap gap-4">
              <BoolToggle label="골든크로스 정배열" value={inputs.dailyGoldenCross} onChange={v => update({ dailyGoldenCross: v })} />
              <BoolToggle label="RSI 건강구간 (40~70)" value={inputs.dailyRsiHealthy} onChange={v => update({ dailyRsiHealthy: v })} />
              <BoolToggle label="Gate 신호 통과" value={inputs.dailyGateSignal} onChange={v => update({ dailyGateSignal: v })} />
            </div>
          </div>

          {/* H60 */}
          <div>
            <p className="text-[10px] font-bold text-gray-300 mb-2">60분봉 (가중치 0.10)</p>
            <div className="flex flex-wrap gap-4">
              <BoolToggle label="모멘텀 상승" value={inputs.h60MomentumUp} onChange={v => update({ h60MomentumUp: v })} />
              <BoolToggle label="거래량 서지" value={inputs.h60VolumeSurge} onChange={v => update({ h60VolumeSurge: v })} />
            </div>
          </div>

          {/* Insight Box */}
          <div className="bg-violet-900/20 border border-violet-700/50 rounded-lg p-3 mt-2">
            <div className="flex items-start gap-2">
              <Activity className="w-3.5 h-3.5 text-violet-400 mt-0.5 flex-shrink-0" />
              <p className="text-[10px] text-violet-200 leading-relaxed">
                <span className="font-bold">핵심 통찰:</span> 일봉 신호가 아무리 완벽해도 주봉이 하락 추세라면 역방향 수영이다.
                MTF Score &lt; 65이면 일봉 Gate 신호가 완벽해도 진입을 차단한다.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
