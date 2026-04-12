/**
 * BehavioralMirrorPanel.tsx — 투자자 행동 교정 미러 대시보드
 *
 * 5개 패널로 투자자 자신의 행동 편향을 데이터로 교정한다:
 *   1. 시스템 vs 직관 매매 수익률 비교 (6개월)
 *   2. 손절 실행 충실도 트래커
 *   3. Gate 조건별 기여도 히트맵 (3개월)
 *   4. 포트폴리오 레짐 적합도 스코어
 *   5. 30일 이벤트 타임라인
 */
import React, { useState } from 'react';
import {
  Brain, TrendingUp, TrendingDown, Shield, BarChart2, Calendar,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Minus,
  Target, Zap, Plus, Trash2,
} from 'lucide-react';
import { cn } from '../ui/cn';
import type {
  BehavioralMirrorResult,
  BehavioralMirrorInput,
  BehavioralSystemVsIntuition,
  StopLossFidelity,
  GateContributionHeatmap,
  RegimeFitnessScore,
  EventTimeline,
  UpcomingEvent,
  EventType,
} from '../types/behavioralMirror';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  result: BehavioralMirrorResult | null;
  input: BehavioralMirrorInput;
  onInputChange: (input: BehavioralMirrorInput) => void;
}

// ─── 패널 1: 시스템 vs 직관 ────────────────────────────────────────────────────

function SystemVsIntuitionPanel({ data }: { data: BehavioralSystemVsIntuition }) {
  const systemAhead = data.systemEdge >= 0;

  const Bar = ({
    label,
    value,
    max,
    color,
    suffix = '',
  }: {
    label: string;
    value: number;
    max: number;
    color: string;
    suffix?: string;
  }) => {
    const pct = max > 0 ? Math.min(100, Math.abs(value) / Math.abs(max) * 100) : 0;
    return (
      <div className="space-y-0.5">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">{label}</span>
          <span className={cn('font-semibold', value >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {value >= 0 ? '+' : ''}{value.toFixed(1)}{suffix}
          </span>
        </div>
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full', color)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-gray-700/50 bg-gray-800/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-semibold text-gray-300">시스템 vs 직관 (최근 6개월)</span>
        <span className={cn(
          'ml-auto text-xs font-bold px-2 py-0.5 rounded-full border',
          systemAhead
            ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700/50'
            : 'bg-red-900/50 text-red-300 border-red-700/50',
        )}>
          {systemAhead ? '시스템 우위' : '직관 우위'} ({data.systemEdge > 0 ? '+' : ''}{data.systemEdge.toFixed(1)}%p)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-blue-400 uppercase">시스템 ({data.systemCount}건)</p>
          <Bar label="누적 수익" value={data.systemCumulativeReturn} max={Math.max(Math.abs(data.systemCumulativeReturn), Math.abs(data.intuitionCumulativeReturn), 1)} color="bg-blue-500" suffix="%" />
          <Bar label="승률" value={data.systemWinRate} max={100} color="bg-blue-400" suffix="%" />
          <div className="text-xs text-gray-500">평균 수익률: <span className={cn('font-semibold', data.systemAvgReturn >= 0 ? 'text-emerald-400' : 'text-red-400')}>{data.systemAvgReturn >= 0 ? '+' : ''}{data.systemAvgReturn.toFixed(2)}%</span></div>
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-amber-400 uppercase">직관 ({data.intuitionCount}건)</p>
          <Bar label="누적 수익" value={data.intuitionCumulativeReturn} max={Math.max(Math.abs(data.systemCumulativeReturn), Math.abs(data.intuitionCumulativeReturn), 1)} color="bg-amber-500" suffix="%" />
          <Bar label="승률" value={data.intuitionWinRate} max={100} color="bg-amber-400" suffix="%" />
          <div className="text-xs text-gray-500">평균 수익률: <span className={cn('font-semibold', data.intuitionAvgReturn >= 0 ? 'text-emerald-400' : 'text-red-400')}>{data.intuitionAvgReturn >= 0 ? '+' : ''}{data.intuitionAvgReturn.toFixed(2)}%</span></div>
        </div>
      </div>

      {data.systemCount === 0 && data.intuitionCount === 0 && (
        <p className="text-xs text-gray-600 text-center py-2">최근 6개월 종료 거래 없음</p>
      )}
    </div>
  );
}

// ─── 패널 2: 손절 충실도 ──────────────────────────────────────────────────────

const TRUST_LEVEL_CFG: Record<StopLossFidelity['trustLevel'], { label: string; color: string; icon: React.ReactNode }> = {
  HIGH: { label: '높음', color: 'text-emerald-400', icon: <CheckCircle className="w-4 h-4 text-emerald-400" /> },
  MID:  { label: '보통', color: 'text-amber-400',   icon: <AlertTriangle className="w-4 h-4 text-amber-400" /> },
  LOW:  { label: '낮음', color: 'text-red-400',     icon: <AlertTriangle className="w-4 h-4 text-red-500" />  },
};

function StopLossFidelityPanel({ data }: { data: StopLossFidelity }) {
  const cfg = TRUST_LEVEL_CFG[data.trustLevel];
  const fidelityPct = data.fidelityRate;

  return (
    <div className="rounded-lg border border-gray-700/50 bg-gray-800/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-emerald-400" />
        <span className="text-xs font-semibold text-gray-300">손절 실행 충실도</span>
        <div className={cn('ml-auto flex items-center gap-1', cfg.color)}>
          {cfg.icon}
          <span className="text-xs font-bold">{cfg.label} ({fidelityPct.toFixed(1)}%)</span>
        </div>
      </div>

      {/* 충실도 진척 바 */}
      <div className="space-y-0.5">
        <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              data.trustLevel === 'HIGH' ? 'bg-emerald-500' :
              data.trustLevel === 'MID' ? 'bg-amber-500' : 'bg-red-500',
            )}
            style={{ width: `${fidelityPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-gray-600">
          <span>0%</span><span>60%</span><span>80%</span><span>100%</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded bg-gray-800/60 p-2">
          <p className="text-gray-500">손실 종료</p>
          <p className="text-gray-100 font-bold text-sm">{data.totalStopCases}건</p>
        </div>
        <div className="rounded bg-emerald-900/20 p-2">
          <p className="text-gray-500">기계적 손절</p>
          <p className="text-emerald-300 font-bold text-sm">{data.mechanicalStops}건</p>
        </div>
        <div className="rounded bg-red-900/20 p-2">
          <p className="text-gray-500">망설임 손절</p>
          <p className="text-red-300 font-bold text-sm">{data.hesitantStops}건</p>
        </div>
      </div>

      {data.hesitantStops > 0 && (
        <p className="text-xs text-amber-400/80">
          ⚠️ 망설임 손절 시 평균 추가 손실: <span className="font-semibold">{data.avgExtraLossOnHesitation.toFixed(2)}%p</span>
        </p>
      )}
    </div>
  );
}

// ─── 패널 3: Gate 조건 기여도 히트맵 ──────────────────────────────────────────

function GateHeatmapPanel({ data }: { data: GateContributionHeatmap }) {
  const [showAll, setShowAll] = useState(false);
  const effective = data.contributions.filter((c) => !c.isNoise).sort((a, b) => b.avgReturnContrib - a.avgReturnContrib);
  const noise = data.contributions.filter((c) => c.isNoise);
  const displayList = showAll ? data.contributions : effective.slice(0, 8);

  return (
    <div className="rounded-lg border border-gray-700/50 bg-gray-800/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart2 className="w-4 h-4 text-indigo-400" />
        <span className="text-xs font-semibold text-gray-300">Gate 조건 기여도 히트맵 (최근 3개월)</span>
        <span className="ml-auto text-[10px] text-gray-600">
          유효 {data.effectiveCount} / 노이즈 {data.noiseCount}
        </span>
      </div>

      {effective.length === 0 && (
        <p className="text-xs text-gray-600 text-center py-2">3개월 내 분석 가능한 거래 없음</p>
      )}

      <div className="space-y-1.5">
        {displayList.map((c) => {
          const maxAbs = Math.max(...data.contributions.map((x) => Math.abs(x.avgReturnContrib)), 1);
          const barPct = Math.min(100, Math.abs(c.avgReturnContrib) / maxAbs * 100);
          return (
            <div key={c.conditionId} className="flex items-center gap-2">
              <span className="w-5 text-[10px] text-gray-600 text-right">{c.conditionId}</span>
              <span className={cn(
                'flex-1 text-xs truncate',
                c.isNoise ? 'text-gray-600' : c.avgReturnContrib >= 0 ? 'text-gray-300' : 'text-gray-400',
              )}>
                {c.conditionName}
              </span>
              <div className="w-20 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full',
                    c.isNoise ? 'bg-gray-700' :
                    c.avgReturnContrib >= 1 ? 'bg-emerald-500' :
                    c.avgReturnContrib >= 0 ? 'bg-emerald-700' : 'bg-red-600',
                  )}
                  style={{ width: `${barPct}%` }}
                />
              </div>
              <span className={cn(
                'w-12 text-right text-xs font-medium',
                c.isNoise ? 'text-gray-600' :
                c.avgReturnContrib >= 0 ? 'text-emerald-400' : 'text-red-400',
              )}>
                {c.isNoise ? '노이즈' : `${c.avgReturnContrib >= 0 ? '+' : ''}${c.avgReturnContrib.toFixed(1)}%`}
              </span>
            </div>
          );
        })}
      </div>

      {noise.length > 0 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1"
        >
          {showAll ? <><ChevronUp className="w-3 h-3" /> 접기</> : <><ChevronDown className="w-3 h-3" /> 전체 보기 ({data.contributions.length}개)</>}
        </button>
      )}
    </div>
  );
}

// ─── 패널 4: 레짐 적합도 스코어 ───────────────────────────────────────────────

function RegimeFitnessPanel({
  data,
  input,
  onInputChange,
}: {
  data: RegimeFitnessScore;
  input: BehavioralMirrorInput;
  onInputChange: (i: BehavioralMirrorInput) => void;
}) {
  const [editing, setEditing] = useState(false);

  const scoreColor =
    data.score >= 80 ? 'text-emerald-400' :
    data.score >= 60 ? 'text-amber-400' : 'text-red-400';

  const gaugeColor =
    data.score >= 80 ? 'bg-emerald-500' :
    data.score >= 60 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className={cn(
      'rounded-lg border p-4 space-y-3',
      data.isWarning
        ? 'border-red-700/60 bg-red-900/10'
        : 'border-gray-700/50 bg-gray-800/30',
    )}>
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-semibold text-gray-300">포트폴리오 레짐 적합도</span>
        {data.isWarning && (
          <span className="ml-auto flex items-center gap-1 text-xs text-red-400 font-bold">
            <AlertTriangle className="w-3.5 h-3.5" /> 경고
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* 원형 스코어 */}
        <div className="flex-shrink-0 relative w-16 h-16">
          <svg viewBox="0 0 64 64" className="-rotate-90 w-16 h-16">
            <circle cx="32" cy="32" r="26" fill="none" stroke="#1f2937" strokeWidth="6" />
            <circle
              cx="32" cy="32" r="26" fill="none"
              stroke={data.isWarning ? '#ef4444' : data.score >= 80 ? '#10b981' : '#f59e0b'}
              strokeWidth="6"
              strokeDasharray={2 * Math.PI * 26}
              strokeDashoffset={2 * Math.PI * 26 * (1 - data.score / 100)}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn('text-lg font-black', scoreColor)}>{data.score}</span>
          </div>
        </div>

        <div className="flex-1 space-y-1.5">
          <div className="text-xs text-gray-500">현재 레짐: <span className="text-gray-300 font-semibold">{data.currentRegimeLabel}</span></div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded bg-emerald-900/20 p-1.5 text-center">
              <p className="text-gray-500">적합</p>
              <p className="text-emerald-300 font-bold">{data.fitCount}개</p>
            </div>
            <div className="rounded bg-red-900/20 p-1.5 text-center">
              <p className="text-gray-500">부적합</p>
              <p className="text-red-300 font-bold">{data.misfitCount}개</p>
            </div>
          </div>
          {data.isWarning && (
            <p className="text-xs text-red-400/90">{data.recommendation}</p>
          )}
        </div>
      </div>

      {/* 레짐 & 포지션 편집 */}
      <div className="border-t border-gray-700/40 pt-2">
        <button
          onClick={() => setEditing(!editing)}
          className="text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1"
        >
          {editing ? <><ChevronUp className="w-3 h-3" /> 접기</> : <><ChevronDown className="w-3 h-3" /> 레짐/포지션 편집</>}
        </button>

        {editing && (
          <div className="mt-2 space-y-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-xs text-gray-500">현재 레짐</span>
              <select
                value={input.currentRegime}
                onChange={(e) => onInputChange({ ...input, currentRegime: e.target.value })}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none"
              >
                {['BULL', 'BEAR', 'SIDEWAYS', 'VOLATILE'].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">보유 포지션 레짐 적합 여부</span>
                <button
                  onClick={() => onInputChange({
                    ...input,
                    openPositions: [...input.openPositions, { stockCode: '', stockName: '', sector: '', regimeFit: true }],
                  })}
                  className="flex items-center gap-0.5 text-xs text-gray-600 hover:text-gray-400"
                >
                  <Plus className="w-3 h-3" /> 추가
                </button>
              </div>
              {input.openPositions.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5 mb-1">
                  <input
                    type="text"
                    placeholder="종목명"
                    value={p.stockName}
                    onChange={(e) => {
                      const next = [...input.openPositions];
                      next[i] = { ...next[i], stockName: e.target.value };
                      onInputChange({ ...input, openPositions: next });
                    }}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none"
                  />
                  <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.regimeFit}
                      onChange={(e) => {
                        const next = [...input.openPositions];
                        next[i] = { ...next[i], regimeFit: e.target.checked };
                        onInputChange({ ...input, openPositions: next });
                      }}
                      className="accent-emerald-500"
                    />
                    적합
                  </label>
                  <button
                    onClick={() => {
                      const next = input.openPositions.filter((_, j) => j !== i);
                      onInputChange({ ...input, openPositions: next });
                    }}
                    className="text-gray-600 hover:text-red-400"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 패널 5: 30일 이벤트 타임라인 ─────────────────────────────────────────────

const EVENT_TYPE_CFG: Record<EventType, { label: string; color: string }> = {
  EARNINGS:     { label: '실적 발표', color: 'text-blue-400' },
  LOCKUP_EXPIRY:{ label: '보호예수 해제', color: 'text-red-400' },
  FED:          { label: '연준 FOMC', color: 'text-amber-400' },
  BOK:          { label: '금통위', color: 'text-violet-400' },
  OTHER:        { label: '기타', color: 'text-gray-400' },
};

const RISK_COLOR: Record<UpcomingEvent['riskLevel'], string> = {
  HIGH: 'border-red-700/60 bg-red-900/15',
  MID:  'border-amber-700/50 bg-amber-900/10',
  LOW:  'border-gray-700/40 bg-gray-800/20',
};

function EventTimelinePanel({
  data,
  input,
  onInputChange,
}: {
  data: EventTimeline;
  input: BehavioralMirrorInput;
  onInputChange: (i: BehavioralMirrorInput) => void;
}) {
  const [editing, setEditing] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const addEvent = () => {
    onInputChange({
      ...input,
      upcomingEvents: [
        ...input.upcomingEvents,
        { date: today, eventType: 'EARNINGS', description: '', riskLevel: 'MID' },
      ],
    });
  };

  const removeEvent = (i: number) => {
    onInputChange({
      ...input,
      upcomingEvents: input.upcomingEvents.filter((_, j) => j !== i),
    });
  };

  const updateEvent = (
    i: number,
    field: keyof BehavioralMirrorInput['upcomingEvents'][number],
    value: string,
  ) => {
    const next = [...input.upcomingEvents];
    next[i] = { ...next[i], [field]: value };
    onInputChange({ ...input, upcomingEvents: next });
  };

  return (
    <div className="rounded-lg border border-gray-700/50 bg-gray-800/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-semibold text-gray-300">30일 이벤트 타임라인</span>
        {data.highRiskCount > 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-red-400 font-bold">
            <AlertTriangle className="w-3 h-3" /> 고위험 {data.highRiskCount}건
          </span>
        )}
      </div>

      {data.events.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-2">향후 30일 이벤트 없음</p>
      ) : (
        <div className="space-y-2">
          {data.events.map((e, i) => {
            const typeCfg = EVENT_TYPE_CFG[e.eventType];
            return (
              <div key={i} className={cn('rounded border p-2.5', RISK_COLOR[e.riskLevel])}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-bold', typeCfg.color)}>{typeCfg.label}</span>
                    {e.stockName && (
                      <span className="text-xs text-gray-300">{e.stockName}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{e.date.slice(0, 10)}</span>
                    <span className={cn(
                      'text-xs font-bold',
                      e.daysUntil <= 7 ? 'text-red-400' : e.daysUntil <= 14 ? 'text-amber-400' : 'text-gray-500',
                    )}>
                      D-{e.daysUntil}
                    </span>
                  </div>
                </div>
                {e.description && (
                  <p className="text-xs text-gray-500 mt-1">{e.description}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 이벤트 편집 */}
      <div className="border-t border-gray-700/40 pt-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setEditing(!editing)}
            className="text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1"
          >
            {editing ? <><ChevronUp className="w-3 h-3" /> 접기</> : <><ChevronDown className="w-3 h-3" /> 이벤트 편집</>}
          </button>
        </div>

        {editing && (
          <div className="mt-2 space-y-2">
            <div className="flex justify-end">
              <button
                onClick={addEvent}
                className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400"
              >
                <Plus className="w-3 h-3" /> 추가
              </button>
            </div>
            {input.upcomingEvents.map((e, i) => (
              <div key={i} className="grid grid-cols-4 gap-1.5 items-end">
                <input
                  type="date"
                  value={e.date}
                  onChange={(ev) => updateEvent(i, 'date', ev.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none"
                />
                <select
                  value={e.eventType}
                  onChange={(ev) => updateEvent(i, 'eventType', ev.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none"
                >
                  {Object.keys(EVENT_TYPE_CFG).map((t) => (
                    <option key={t} value={t}>{EVENT_TYPE_CFG[t as EventType].label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="설명"
                  value={e.description}
                  onChange={(ev) => updateEvent(i, 'description', ev.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none"
                />
                <div className="flex items-center gap-1">
                  <select
                    value={e.riskLevel}
                    onChange={(ev) => updateEvent(i, 'riskLevel', ev.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-xs text-gray-100 focus:outline-none"
                  >
                    <option value="HIGH">고위험</option>
                    <option value="MID">중위험</option>
                    <option value="LOW">저위험</option>
                  </select>
                  <button
                    onClick={() => removeEvent(i)}
                    className="text-gray-600 hover:text-red-400"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export const BehavioralMirrorPanel: React.FC<Props> = ({ result, input, onInputChange }) => {
  const [expanded, setExpanded] = useState(false);

  const hasWarnings = result && (
    result.stopLossFidelity.trustLevel === 'LOW' ||
    result.regimeFitnessScore.isWarning ||
    result.eventTimeline.highRiskCount > 0 ||
    result.systemVsIntuition.systemEdge < 0
  );

  return (
    <div className={cn(
      'rounded-xl border-2 bg-gray-900/60 overflow-hidden',
      hasWarnings ? 'border-amber-600' : 'border-gray-700',
    )}>
      {/* 헤더 */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-pink-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-100">
              투자자 행동 교정 미러 대시보드
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {result ? result.summary : '매매 기록이 쌓이면 행동 편향을 데이터로 교정합니다.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasWarnings && (
            <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border bg-amber-900/50 text-amber-300 border-amber-700/50">
              <AlertTriangle className="w-3 h-3" /> 교정 필요
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* 내용 */}
      {expanded && (
        <div className="px-5 pb-5 space-y-4">
          {!result ? (
            <div className="text-center py-8 text-gray-600">
              <Brain className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">매매 기록을 쌓으면 행동 분석이 시작됩니다.</p>
              <p className="text-xs mt-1">최소 1건의 종료 거래가 필요합니다.</p>
            </div>
          ) : (
            <>
              {/* 패널 1: 시스템 vs 직관 */}
              <SystemVsIntuitionPanel data={result.systemVsIntuition} />

              {/* 패널 2: 손절 충실도 */}
              <StopLossFidelityPanel data={result.stopLossFidelity} />

              {/* 패널 3: Gate 조건 기여도 히트맵 */}
              <GateHeatmapPanel data={result.gateContributionHeatmap} />

              {/* 패널 4: 레짐 적합도 */}
              <RegimeFitnessPanel
                data={result.regimeFitnessScore}
                input={input}
                onInputChange={onInputChange}
              />

              {/* 패널 5: 이벤트 타임라인 */}
              <EventTimelinePanel
                data={result.eventTimeline}
                input={input}
                onInputChange={onInputChange}
              />
            </>
          )}

          {/* 이벤트/레짐 편집은 result 없어도 가능 */}
          {!result && (
            <>
              <RegimeFitnessPanel
                data={{
                  score: 100, isWarning: false, fitCount: 0, misfitCount: 0,
                  currentRegimeLabel: input.currentRegime, misfitNames: [],
                  recommendation: '',
                }}
                input={input}
                onInputChange={onInputChange}
              />
              <EventTimelinePanel
                data={{ events: [], highRiskCount: 0, fromDate: '', toDate: '' }}
                input={input}
                onInputChange={onInputChange}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};
