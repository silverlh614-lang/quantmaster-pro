// @responsibility signals 영역 MarketRegimeClassifierPanel 컴포넌트
/**
 * 시장 레짐 자동 분류기 패널 (Market Regime Classifier)
 *
 * 4개 변수(VKOSPI, 외국인 순매수 4주 추이, KOSPI 200일선 위치, 달러 인덱스 방향)를
 * 기반으로 현재 시장 레짐을 4단계로 분류하고 Gate 임계값 조정 지침을 표시한다.
 *
 *   RISK_ON_BULL       — Gate 2 완화(9→8), 공격적 포지션 허용
 *   RISK_ON_EARLY      — 표준 기준 유지, 주도주 초기 신호 포착
 *   RISK_OFF_CORRECTION — Gate 1 강화, 포지션 50% 제한
 *   RISK_OFF_CRISIS    — 신규 매수 전면 중단, 현금 70%+
 */
import React, { useState } from 'react';
import {
  Shield, TrendingUp, TrendingDown, AlertTriangle, ChevronDown, ChevronUp,
  Activity, DollarSign, BarChart2,
} from 'lucide-react';
import { cn } from '../../ui/cn';
import type {
  MarketRegimeClassifierInput,
  MarketRegimeClassifierResult,
  MarketRegimeClassification,
} from '../../types/quant';
import { evaluateMarketRegimeClassifier } from '../../services/quant/marketRegimeClassifier';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MarketRegimeClassifierPanelProps {
  result: MarketRegimeClassifierResult | null;
  inputs: MarketRegimeClassifierInput;
  onInputsChange: (inputs: MarketRegimeClassifierInput) => void;
}

// ─── 레짐별 스타일 매핑 ────────────────────────────────────────────────────────

function getRegimeStyles(classification: MarketRegimeClassification) {
  switch (classification) {
    case 'RISK_ON_BULL':
      return {
        border: 'border-emerald-500',
        badge: 'bg-emerald-600 text-white',
        bar: 'bg-emerald-500',
        icon: '🟢',
        label: 'RISK-ON 강세',
        alertBg: 'bg-emerald-900/20 border-emerald-600',
        alertText: 'text-emerald-300',
        iconColor: 'text-emerald-400',
      };
    case 'RISK_ON_EARLY':
      return {
        border: 'border-sky-400',
        badge: 'bg-sky-500 text-white',
        bar: 'bg-sky-400',
        icon: '🔵',
        label: 'RISK-ON 초기',
        alertBg: 'bg-sky-900/20 border-sky-500',
        alertText: 'text-sky-300',
        iconColor: 'text-sky-400',
      };
    case 'RISK_OFF_CORRECTION':
      return {
        border: 'border-amber-400',
        badge: 'bg-amber-500 text-black',
        bar: 'bg-amber-400',
        icon: '🟠',
        label: 'RISK-OFF 조정',
        alertBg: 'bg-amber-900/20 border-amber-400',
        alertText: 'text-amber-300',
        iconColor: 'text-amber-400',
      };
    case 'RISK_OFF_CRISIS':
      return {
        border: 'border-red-500',
        badge: 'bg-red-600 text-white',
        bar: 'bg-red-500',
        icon: '🔴',
        label: 'RISK-OFF 위기',
        alertBg: 'bg-red-900/30 border-red-500',
        alertText: 'text-red-300',
        iconColor: 'text-red-400',
      };
  }
}

// ─── 입력 폼 하위 컴포넌트 ────────────────────────────────────────────────────

interface InputFormProps {
  inputs: MarketRegimeClassifierInput;
  onChange: (inputs: MarketRegimeClassifierInput) => void;
}

function InputForm({ inputs, onChange }: InputFormProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
      {/* VKOSPI */}
      <div>
        <label className="block text-[11px] font-bold text-theme-muted mb-1 uppercase tracking-wide">
          <Activity className="inline w-3 h-3 mr-1" />VKOSPI
        </label>
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={inputs.vkospi}
          onChange={e => onChange({ ...inputs, vkospi: parseFloat(e.target.value) || 0 })}
          className="w-full px-2 py-1.5 bg-theme-bg border border-theme-border text-theme-text text-sm focus:outline-none focus:border-theme-accent"
        />
      </div>

      {/* 외국인 순매수 4주 추이 */}
      <div>
        <label className="block text-[11px] font-bold text-theme-muted mb-1 uppercase tracking-wide">
          <TrendingUp className="inline w-3 h-3 mr-1" />외국인 순매수 4주 (억원)
        </label>
        <input
          type="number"
          step={100}
          value={inputs.foreignNetBuy4wTrend}
          onChange={e => onChange({ ...inputs, foreignNetBuy4wTrend: parseFloat(e.target.value) || 0 })}
          className="w-full px-2 py-1.5 bg-theme-bg border border-theme-border text-theme-text text-sm focus:outline-none focus:border-theme-accent"
        />
      </div>

      {/* KOSPI 200일선 위치 */}
      <div>
        <label className="block text-[11px] font-bold text-theme-muted mb-1 uppercase tracking-wide">
          <BarChart2 className="inline w-3 h-3 mr-1" />KOSPI 200일선 위치
        </label>
        <div className="flex gap-2">
          {(['위', '아래'] as const).map((label) => {
            const isAbove = label === '위';
            const selected = inputs.kospiAbove200MA === isAbove;
            return (
              <button
                key={label}
                type="button"
                onClick={() => onChange({ ...inputs, kospiAbove200MA: isAbove })}
                className={cn(
                  'flex-1 py-1.5 text-xs font-bold border transition-colors',
                  selected
                    ? (isAbove ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-red-700 border-red-500 text-white')
                    : 'bg-theme-bg border-theme-border text-theme-muted hover:text-theme-text',
                )}
              >
                {isAbove ? '200일선 위 ↑' : '200일선 아래 ↓'}
              </button>
            );
          })}
        </div>
      </div>

      {/* 달러 인덱스 방향 */}
      <div>
        <label className="block text-[11px] font-bold text-theme-muted mb-1 uppercase tracking-wide">
          <DollarSign className="inline w-3 h-3 mr-1" />달러 인덱스 방향
        </label>
        <div className="flex gap-1">
          {(['UP', 'FLAT', 'DOWN'] as const).map((dir) => {
            const selected = inputs.dxyDirection === dir;
            const labels = { UP: '강세↑', FLAT: '보합', DOWN: '약세↓' };
            return (
              <button
                key={dir}
                type="button"
                onClick={() => onChange({ ...inputs, dxyDirection: dir })}
                className={cn(
                  'flex-1 py-1.5 text-xs font-bold border transition-colors',
                  selected
                    ? dir === 'UP' ? 'bg-red-700 border-red-500 text-white'
                      : dir === 'DOWN' ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-sky-700 border-sky-500 text-white'
                    : 'bg-theme-bg border-theme-border text-theme-muted hover:text-theme-text',
                )}
              >
                {labels[dir]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Gate 조정 지침 카드 ──────────────────────────────────────────────────────

interface GateAdjustmentCardProps {
  result: MarketRegimeClassifierResult;
}

function GateAdjustmentCard({ result }: GateAdjustmentCardProps) {
  const rows = [
    {
      label: 'Gate 2 통과 기준',
      value: result.gate2RequiredOverride !== null
        ? `${result.gate2RequiredOverride}/12 (완화 적용)`
        : '9/12 (표준 유지)',
      highlight: result.gate2RequiredOverride !== null,
      highlightColor: 'text-emerald-400',
    },
    {
      label: 'Gate 1 강화',
      value: result.gate1Strengthened ? '강화 적용 (엄격화)' : '표준 기준',
      highlight: result.gate1Strengthened,
      highlightColor: 'text-amber-400',
    },
    {
      label: '포지션 사이즈 한도',
      value: result.positionSizeLimitPct === 100
        ? '제한 없음'
        : result.positionSizeLimitPct === 0
          ? '🛑 신규 매수 차단'
          : `최대 ${result.positionSizeLimitPct}%`,
      highlight: result.positionSizeLimitPct < 100,
      highlightColor: result.positionSizeLimitPct === 0 ? 'text-red-400' : 'text-amber-400',
    },
    {
      label: '신규 매수',
      value: result.buyingHalted ? '🛑 전면 중단' : '정상 허용',
      highlight: result.buyingHalted,
      highlightColor: 'text-red-400',
    },
    {
      label: '현금 비중 최소',
      value: result.cashRatioMinPct === 0
        ? '제한 없음'
        : `${result.cashRatioMinPct}% 이상 유지`,
      highlight: result.cashRatioMinPct > 0,
      highlightColor: result.cashRatioMinPct >= 70 ? 'text-red-400' : 'text-amber-400',
    },
    {
      label: 'Gate 1 위반 임계',
      value: `${result.gate1BreachThreshold}개 이상 → 전량 청산`,
      highlight: false,
      highlightColor: 'text-theme-muted',
    },
  ];

  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
      {rows.map(row => (
        <div key={row.label} className="flex items-center justify-between px-3 py-2 bg-theme-bg border border-theme-border">
          <span className="text-[11px] text-theme-muted font-medium">{row.label}</span>
          <span className={cn(
            'text-[11px] font-bold',
            row.highlight ? row.highlightColor : 'text-theme-text',
          )}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── 메인 패널 컴포넌트 ───────────────────────────────────────────────────────

export function MarketRegimeClassifierPanel({
  result: propResult,
  inputs,
  onInputsChange,
}: MarketRegimeClassifierPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [showInputs, setShowInputs] = useState(false);

  // 입력값 변경 시 즉시 재계산
  const handleInputsChange = (newInputs: MarketRegimeClassifierInput) => {
    onInputsChange(newInputs);
  };

  // 실시간 계산 결과 (prop이 없으면 입력값 기반으로 계산)
  const result = propResult ?? evaluateMarketRegimeClassifier(inputs);

  const styles = getRegimeStyles(result.classification);

  return (
    <div className={cn(
      'border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]',
      styles.border,
    )}>
      {/* 헤더 */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Shield className={cn('w-5 h-5', styles.iconColor)} />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-black text-theme-text uppercase tracking-wider">
                시장 레짐 자동 분류기
              </h3>
              <span className={cn('text-[10px] font-black px-2 py-0.5 rounded border uppercase tracking-widest', styles.badge)}>
                {styles.icon} {styles.label}
              </span>
            </div>
            <p className="text-[11px] text-theme-muted mt-0.5">
              VKOSPI · 외국인 4주 추이 · KOSPI 200일선 · 달러 방향 → Gate 임계값 자동 재조정
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-theme-muted shrink-0" /> : <ChevronDown className="w-4 h-4 text-theme-muted shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 sm:px-5 pb-5 space-y-4">

          {/* 상태 배너 */}
          <div className={cn(
            'px-4 py-3 border rounded-none',
            styles.alertBg,
          )}>
            <p className="text-xs font-bold text-theme-text">{result.description}</p>
            <p className={cn('text-[11px] mt-1', styles.alertText)}>{result.actionMessage}</p>
          </div>

          {/* Gate 조정 지침 */}
          <div>
            <h4 className="text-[11px] font-bold text-theme-muted uppercase tracking-wider mb-1 flex items-center gap-1">
              <Shield className="w-3 h-3" />Gate 임계값 자동 재조정
            </h4>
            <GateAdjustmentCard result={result} />
          </div>

          {/* 입력값 편집 토글 */}
          <div>
            <button
              type="button"
              onClick={() => setShowInputs(v => !v)}
              className="flex items-center gap-1 text-[11px] text-theme-muted hover:text-theme-text transition-colors"
            >
              {showInputs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              입력값 수동 조정
            </button>
            {showInputs && (
              <InputForm inputs={inputs} onChange={handleInputsChange} />
            )}
          </div>

          {/* 마지막 업데이트 */}
          {result.lastUpdated && (
            <p className="text-[10px] text-theme-muted text-right">
              업데이트: {new Date(result.lastUpdated).toLocaleString('ko-KR')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
