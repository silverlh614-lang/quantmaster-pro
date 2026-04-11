/**
 * 아이디어 8: Bear Mode 손익 시뮬레이터 — "지금 인버스 ETF를 샀다면?"
 *
 * 사용자가 현재 포트폴리오를 보면서 "만약 Bear Mode로 전환했다면 수익이 얼마였을까?"를
 * 백테스팅으로 비교하는 대시보드 패널.
 *
 * 시나리오 비교:
 *   - 현재 롱 포트폴리오 수익률 (Bear 구간 기준)
 *   - Bear Mode 전환 시 시뮬레이션 수익률 (KODEX 인버스 2X, Gate -1 감지 D+3 전환)
 *   - 알파 차이 (%p)
 */
import React, { useState, useMemo, useCallback } from 'react';
import { TrendingDown, Plus, Trash2, ChevronDown, ChevronUp, BarChart2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { cn } from '../ui/cn';
import { evaluateBearModeSimulator } from '../services/quant/bearEngine';
import type { BearModeSimulatorInput, BearModeSimulatorResult } from '../types/quant';

// ── 기본 시나리오 팩토리 ──────────────────────────────────────────────────────

function createDefaultScenario(): BearModeSimulatorInput {
  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - 1);
  const gateDate = new Date(startDate);
  gateDate.setDate(gateDate.getDate() + 5);
  return {
    label: '새 시나리오',
    bearStartDate: startDate.toISOString().split('T')[0],
    gateDetectionDate: gateDate.toISOString().split('T')[0],
    bearEndDate: endDate,
    longPortfolioReturn: -12.3,
    marketReturn: -10.5,
  };
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────────────

interface ScenarioCardProps {
  input: BearModeSimulatorInput;
  index: number;
  onInputChange: (updated: BearModeSimulatorInput) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ScenarioCard({ input, index, onInputChange, onRemove, canRemove }: ScenarioCardProps) {
  const [expanded, setExpanded] = useState(index === 0);

  const computed = useMemo(() => evaluateBearModeSimulator([input]), [input]);
  const scenario = computed.scenarios[0];

  const alphaPositive = scenario ? scenario.alphaDifference > 0 : false;
  const borderColor = !scenario
    ? 'border-theme-border'
    : scenario.alphaDifference > 20
      ? 'border-red-500'
      : scenario.alphaDifference > 0
        ? 'border-amber-500/70'
        : 'border-theme-border';

  return (
    <div className={cn('border-2 bg-theme-card', borderColor)}>
      {/* Card Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(v => !v)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex items-center justify-center w-8 h-8 border text-xs font-black',
            scenario && alphaPositive
              ? 'border-red-500 bg-red-900/40 text-red-300'
              : 'border-theme-border bg-theme-bg text-theme-text-muted',
          )}>
            {index + 1}
          </div>
          <div>
            <p className="text-sm font-black text-theme-text tracking-tight">{input.label}</p>
            {scenario && (
              <p className="text-[9px] font-bold text-theme-text-muted uppercase tracking-widest">
                알파 {alphaPositive ? '+' : ''}{scenario.alphaDifference.toFixed(1)}%p
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {scenario && (
            <span className={cn(
              'text-[9px] font-black px-2 py-0.5 border tracking-widest',
              scenario.alphaDifference > 20
                ? 'border-red-500 bg-red-900/40 text-red-300 animate-pulse'
                : scenario.alphaDifference > 0
                  ? 'border-amber-500/70 bg-amber-900/20 text-amber-300'
                  : 'border-theme-border bg-theme-bg text-theme-text-muted',
            )}>
              {scenario.alphaDifference > 20 ? '🔴 강력 전환' : scenario.alphaDifference > 0 ? '🟡 유의미' : '🟢 효과 미미'}
            </span>
          )}
          {canRemove && (
            <button
              onClick={e => { e.stopPropagation(); onRemove(); }}
              className="p-1 text-theme-text-muted hover:text-red-400 transition-colors"
              aria-label="시나리오 삭제"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-theme-text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-theme-text-muted" />}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-theme-border">
          {/* Inputs */}
          <div className="grid grid-cols-2 gap-2 pt-3">
            {/* Label */}
            <div className="col-span-2 space-y-1">
              <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">
                시나리오 이름
              </label>
              <input
                type="text"
                value={input.label}
                onChange={e => onInputChange({ ...input, label: e.target.value })}
                className="w-full text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-red-500/60"
              />
            </div>

            {/* Bear Start Date */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">
                Bear 구간 시작
              </label>
              <input
                type="date"
                value={input.bearStartDate}
                onChange={e => onInputChange({ ...input, bearStartDate: e.target.value })}
                className="w-full text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-red-500/60"
              />
            </div>

            {/* Gate Detection Date */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">
                Gate -1 감지일
              </label>
              <input
                type="date"
                value={input.gateDetectionDate}
                onChange={e => onInputChange({ ...input, gateDetectionDate: e.target.value })}
                className="w-full text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-red-500/60"
              />
              <p className="text-[8px] text-theme-text-muted">D+3에 자동 전환</p>
            </div>

            {/* Bear End Date */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">
                Bear 구간 종료
              </label>
              <input
                type="date"
                value={input.bearEndDate}
                onChange={e => onInputChange({ ...input, bearEndDate: e.target.value })}
                className="w-full text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-red-500/60"
              />
            </div>

            {/* Market Return */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">
                KOSPI 수익률 (%)
              </label>
              <input
                type="number"
                step={0.1}
                value={input.marketReturn}
                onChange={e => onInputChange({ ...input, marketReturn: parseFloat(e.target.value) || 0 })}
                className="w-full text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-red-500/60"
              />
              <p className="text-[8px] text-theme-text-muted">하락 시 음수 입력</p>
            </div>

            {/* Long Portfolio Return */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest block">
                롱 포트폴리오 수익률 (%)
              </label>
              <input
                type="number"
                step={0.1}
                value={input.longPortfolioReturn}
                onChange={e => onInputChange({ ...input, longPortfolioReturn: parseFloat(e.target.value) || 0 })}
                className="w-full text-[10px] font-mono px-2 py-1 border border-theme-border bg-theme-bg text-theme-text focus:outline-none focus:border-red-500/60"
              />
              <p className="text-[8px] text-theme-text-muted">이 Bear 구간의 실제 성과</p>
            </div>
          </div>

          {/* Results */}
          {scenario && (
            <>
              {/* KPI Row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 border border-theme-border bg-theme-bg text-center">
                  <p className="text-[8px] font-black text-theme-text-muted uppercase tracking-widest mb-1">롱 포트폴리오</p>
                  <p className={cn(
                    'text-xl font-black font-mono',
                    scenario.longReturn < 0 ? 'text-red-400' : 'text-emerald-400',
                  )}>
                    {scenario.longReturn > 0 ? '+' : ''}{scenario.longReturn.toFixed(1)}<span className="text-xs">%</span>
                  </p>
                  <p className="text-[8px] text-theme-text-muted mt-0.5">Bear 구간 기준</p>
                </div>
                <div className="p-2 border border-red-500/40 bg-red-900/10 text-center">
                  <p className="text-[8px] font-black text-red-400/80 uppercase tracking-widest mb-1">Bear Mode 전환</p>
                  <p className={cn(
                    'text-xl font-black font-mono',
                    scenario.bearModeReturn > 0 ? 'text-emerald-400' : 'text-red-400',
                  )}>
                    {scenario.bearModeReturn > 0 ? '+' : ''}{scenario.bearModeReturn.toFixed(1)}<span className="text-xs">%</span>
                  </p>
                  <p className="text-[8px] text-red-400/60 mt-0.5">{scenario.inverseEtfName}</p>
                </div>
                <div className={cn(
                  'p-2 border text-center',
                  alphaPositive
                    ? 'border-amber-500/50 bg-amber-900/15'
                    : 'border-theme-border bg-theme-bg',
                )}>
                  <p className="text-[8px] font-black text-theme-text-muted uppercase tracking-widest mb-1">알파 차이</p>
                  <p className={cn(
                    'text-xl font-black font-mono',
                    alphaPositive ? 'text-amber-300' : 'text-theme-text-muted',
                  )}>
                    {alphaPositive ? '+' : ''}{scenario.alphaDifference.toFixed(1)}<span className="text-xs">%p</span>
                  </p>
                  <p className="text-[8px] text-theme-text-muted mt-0.5">Bear − Long</p>
                </div>
              </div>

              {/* Switch Date Info */}
              <div className="p-2 border border-theme-border/50 bg-theme-bg/50 text-[9px] text-theme-text-secondary">
                <span className="font-black text-theme-text-muted uppercase tracking-widest">D+{scenario.switchDayOffset} 전환일:</span>{' '}
                <span className="font-mono">{scenario.switchDate}</span>
                {' '}(Gate -1 감지 후 {scenario.switchDayOffset}거래일)
              </div>

              {/* Recommendation */}
              <div className={cn(
                'p-2 border text-[10px] leading-relaxed',
                scenario.alphaDifference > 20
                  ? 'border-red-500/40 bg-red-900/15 text-red-300'
                  : alphaPositive
                    ? 'border-amber-500/30 bg-amber-900/10 text-amber-300'
                    : 'border-theme-border bg-theme-bg text-theme-text-secondary',
              )}>
                {scenario.recommendation}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── 비교 차트 ─────────────────────────────────────────────────────────────────

interface ComparisonChartProps {
  result: BearModeSimulatorResult;
}

function ComparisonChart({ result }: ComparisonChartProps) {
  if (result.scenarios.length === 0) return null;

  const chartData = result.scenarios.flatMap(s => [
    { name: `${s.label}\n(롱)`, value: s.longReturn, type: 'long' },
    { name: `${s.label}\n(Bear)`, value: s.bearModeReturn, type: 'bear' },
  ]);

  return (
    <div className="p-3 border border-theme-border bg-theme-card">
      <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-3 flex items-center gap-1">
        <BarChart2 className="w-3 h-3" />
        시나리오별 수익률 비교 (롱 vs. Bear Mode)
      </p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.4)' }}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.4)' }}
            tickFormatter={v => `${v}%`}
          />
          <Tooltip
            contentStyle={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.15)', fontSize: 10 }}
            formatter={(value: any) => {
              const n = Number(value);
              return [`${n > 0 ? '+' : ''}${n.toFixed(1)}%`, '수익률'];
            }}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" />
          <Bar dataKey="value" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={
                  entry.type === 'bear'
                    ? entry.value > 0 ? '#ef4444' : '#7f1d1d'
                    : entry.value >= 0 ? '#10b981' : '#dc2626'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 메인 패널 ─────────────────────────────────────────────────────────────────

interface BearModeSimulatorPanelProps {
  inputs: BearModeSimulatorInput[];
  onInputsChange: (inputs: BearModeSimulatorInput[]) => void;
  result: BearModeSimulatorResult | null;
}

export function BearModeSimulatorPanel({ inputs, onInputsChange, result }: BearModeSimulatorPanelProps) {
  const [headerExpanded, setHeaderExpanded] = useState(true);

  const computed = useMemo(() => evaluateBearModeSimulator(inputs), [inputs]);
  const displayed = result ?? computed;

  const bestAlpha = displayed.bestScenario?.alphaDifference ?? 0;

  const handleInputChange = useCallback((idx: number, updated: BearModeSimulatorInput) => {
    const next = [...inputs];
    next[idx] = updated;
    onInputsChange(next);
  }, [inputs, onInputsChange]);

  const handleAdd = useCallback(() => {
    onInputsChange([...inputs, createDefaultScenario()]);
  }, [inputs, onInputsChange]);

  const handleRemove = useCallback((idx: number) => {
    onInputsChange(inputs.filter((_, i) => i !== idx));
  }, [inputs, onInputsChange]);

  const headerBorder = bestAlpha > 20
    ? 'border-red-500'
    : bestAlpha > 0
      ? 'border-amber-500/70'
      : 'border-theme-border';

  return (
    <div className={cn(
      'p-4 sm:p-6 border-2 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]',
      headerBorder,
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted flex items-center gap-2">
          <TrendingDown className="w-3.5 h-3.5" />
          Bear Mode 손익 시뮬레이터 · "인버스 ETF를 샀다면?"
        </h3>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-black px-3 py-1 rounded border',
            bestAlpha > 20
              ? 'bg-red-900/40 border-red-500 text-red-300 animate-pulse'
              : bestAlpha > 0
                ? 'bg-amber-900/30 border-amber-500/70 text-amber-300'
                : 'bg-theme-bg border-theme-border text-theme-text-muted',
          )}>
            {bestAlpha > 0 ? `🔴 +${bestAlpha.toFixed(1)}%p 알파` : '🟢 시나리오 대기'}
          </span>
          <button
            onClick={() => setHeaderExpanded(v => !v)}
            className="text-theme-text-muted hover:text-theme-text transition-colors"
            aria-label={headerExpanded ? '접기' : '펼치기'}
          >
            {headerExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Conclusion Alert */}
      {displayed.scenarios.length > 0 && bestAlpha > 0 && (
        <div className={cn(
          'mb-4 p-3 border flex items-start gap-2',
          bestAlpha > 20 ? 'border-red-500 bg-red-900/30' : 'border-amber-500/50 bg-amber-900/20',
        )}>
          <TrendingDown className={cn('w-4 h-4 flex-shrink-0 mt-0.5', bestAlpha > 20 ? 'text-red-400' : 'text-amber-400')} />
          <p className={cn(
            'text-xs leading-relaxed font-bold',
            bestAlpha > 20 ? 'text-red-200' : 'text-amber-200',
          )}>
            {displayed.conclusionMessage}
          </p>
        </div>
      )}

      {headerExpanded && (
        <div className="space-y-3">
          {/* Scenario Cards */}
          {inputs.map((input, idx) => (
            <ScenarioCard
              key={idx}
              input={input}
              index={idx}
              onInputChange={updated => handleInputChange(idx, updated)}
              onRemove={() => handleRemove(idx)}
              canRemove={inputs.length > 1}
            />
          ))}

          {/* Add Scenario Button */}
          <button
            onClick={handleAdd}
            className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-theme-border text-[10px] font-black text-theme-text-muted uppercase tracking-widest hover:border-red-500/50 hover:text-red-400 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            시나리오 추가
          </button>

          {/* Comparison Chart */}
          {displayed.scenarios.length > 0 && (
            <ComparisonChart result={displayed} />
          )}

          {/* No-scenario placeholder */}
          {displayed.scenarios.length === 0 && (
            <div className="p-3 border border-theme-border bg-theme-bg text-xs leading-relaxed text-theme-text-secondary">
              {displayed.conclusionMessage}
            </div>
          )}

          {/* Legend */}
          <div className="p-3 border border-theme-border/50 bg-theme-bg/50">
            <p className="text-[9px] font-black text-theme-text-muted uppercase tracking-widest mb-2">
              시뮬레이션 계산 기준
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {[
                { label: 'Bear Mode ETF', value: 'KODEX 인버스 2X (122630)' },
                { label: '전환 지연', value: 'Gate -1 감지 D+3 (3거래일)' },
                { label: '배율', value: '시장 하락률 × 1.8 (비용 감안)' },
                { label: '알파', value: 'Bear Mode 수익 − 롱 포트폴리오' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span className="text-[8px] font-black text-theme-text-muted uppercase tracking-widest">{item.label}:</span>
                  <span className="text-[8px] text-theme-text-secondary">{item.value}</span>
                </div>
              ))}
            </div>
            <p className="text-[8px] text-theme-text-muted mt-2">
              * 과거 시나리오 기반 시뮬레이션이며, 실제 미래 수익을 보장하지 않습니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
