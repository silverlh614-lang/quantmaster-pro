/**
 * 포지션 생애주기 완전 자동화 패널 (Position Lifecycle Automation)
 *
 * 매수 진입부터 전량 청산까지의 5단계 생애주기를 시각적으로 표시하고,
 * 데모 시뮬레이터를 통해 각 단계 전환 조건을 확인할 수 있다.
 *
 * 5단계:
 *   ENTRY    — Gate 1+2+3 통과 → OCO 주문 등록
 *   HOLD     — 27조건 일일 재검증 → 점수 추이 모니터링
 *   ALERT    — 점수 20% 이상 하락 → 50% 분할 매도 + 경보
 *   EXIT_PREP — Gate 1 2개 이상 이탈 → 25% 추가 매도
 *   FULL_EXIT — Gate 1 3개 이상 이탈 OR 손절 → 전량 청산
 */
import React, { useState, useMemo } from 'react';
import { Activity, AlertTriangle, ChevronDown, ChevronUp, CheckCircle, XCircle, ArrowRight, Shield } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { LifecycleStage, PositionLifecycleState } from '../../types/sell';
import {
  evaluatePositionLifecycle,
  LIFECYCLE_LABELS,
  LIFECYCLE_DESCRIPTIONS,
  getLifecycleNextAction,
} from '../../services/quant/positionLifecycleEngine';

// ─── 단계별 스타일 ────────────────────────────────────────────────────────────

function getStageStyles(stage: LifecycleStage, isCurrent: boolean) {
  const active = {
    ENTRY:     { bg: 'bg-sky-800/40',    border: 'border-sky-400',    text: 'text-sky-300',    dot: 'bg-sky-400'    },
    HOLD:      { bg: 'bg-emerald-800/30', border: 'border-emerald-500', text: 'text-emerald-300', dot: 'bg-emerald-500' },
    ALERT:     { bg: 'bg-amber-800/30',  border: 'border-amber-400',  text: 'text-amber-300',  dot: 'bg-amber-400'  },
    EXIT_PREP: { bg: 'bg-orange-800/30', border: 'border-orange-500', text: 'text-orange-300', dot: 'bg-orange-500' },
    FULL_EXIT: { bg: 'bg-red-800/30',    border: 'border-red-500',    text: 'text-red-300',    dot: 'bg-red-500'    },
  };
  const inactive = {
    bg: 'bg-theme-bg/30', border: 'border-theme-border', text: 'text-theme-muted', dot: 'bg-theme-muted/30',
  };
  return isCurrent ? active[stage] : inactive;
}

// ─── 생애주기 단계 진행 표시 ──────────────────────────────────────────────────

interface LifecycleProgressProps {
  currentStage: LifecycleStage;
}

const STAGE_ORDER: LifecycleStage[] = ['ENTRY', 'HOLD', 'ALERT', 'EXIT_PREP', 'FULL_EXIT'];

function LifecycleProgress({ currentStage }: LifecycleProgressProps) {
  const currentIdx = STAGE_ORDER.indexOf(currentStage);

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STAGE_ORDER.map((stage, idx) => {
        const isPast    = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const styles    = getStageStyles(stage, isCurrent);

        return (
          <React.Fragment key={stage}>
            <div className={cn(
              'flex flex-col items-center gap-1 px-2 py-2 border min-w-[80px] flex-1 transition-colors',
              styles.bg, styles.border,
            )}>
              <div className={cn('w-2.5 h-2.5 rounded-full', isPast ? 'bg-emerald-500' : styles.dot)} />
              <span className={cn('text-[9px] font-bold text-center leading-tight', styles.text)}>
                {LIFECYCLE_LABELS[stage].replace('단계: ', '')}
              </span>
              {isPast && <CheckCircle className="w-3 h-3 text-emerald-500" />}
              {isCurrent && <Activity className={cn('w-3 h-3 animate-pulse', styles.text)} />}
            </div>
            {idx < STAGE_ORDER.length - 1 && (
              <ArrowRight className="w-3 h-3 text-theme-muted/50 shrink-0" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── 데모 시뮬레이터 ──────────────────────────────────────────────────────────

const DEFAULT_DEMO_STATE: PositionLifecycleState = {
  stage: 'HOLD',
  entryScore: 7,
  currentScore: 7,
  gate1BreachCount: 0,
  stopLossTriggered: false,
};

function DemoSimulator() {
  const [state, setState] = useState<PositionLifecycleState>(DEFAULT_DEMO_STATE);

  const transition = useMemo(() => evaluatePositionLifecycle(state), [state]);
  const nextAction = useMemo(() => getLifecycleNextAction(state), [state]);

  const handleApplyTransition = () => {
    if (transition) {
      setState(prev => ({
        ...prev,
        stage: transition.nextStage,
      }));
    }
  };

  const stageStyles = getStageStyles(state.stage, true);

  return (
    <div className="mt-4 space-y-4">
      <h4 className="text-[11px] font-bold text-theme-muted uppercase tracking-wider flex items-center gap-1">
        <Activity className="w-3 h-3" />단계 전환 시뮬레이터
      </h4>

      {/* 현재 단계 */}
      <div className={cn('px-4 py-3 border', stageStyles.bg, stageStyles.border)}>
        <div className="flex items-center justify-between">
          <span className={cn('text-xs font-black', stageStyles.text)}>
            현재: {LIFECYCLE_LABELS[state.stage]}
          </span>
          <span className="text-[10px] text-theme-muted">
            점수 {state.currentScore}/{state.entryScore} · Gate1 이탈 {state.gate1BreachCount}개
          </span>
        </div>
        <p className="text-[10px] text-theme-muted mt-1">{nextAction}</p>
      </div>

      {/* 입력 조작 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-theme-muted mb-1 uppercase">
            현재 점수 (0~{state.entryScore})
          </label>
          <input
            type="number"
            min={0}
            max={state.entryScore}
            value={state.currentScore}
            onChange={e => setState(prev => ({ ...prev, currentScore: parseInt(e.target.value) || 0 }))}
            className="w-full px-2 py-1 bg-theme-bg border border-theme-border text-theme-text text-xs focus:outline-none focus:border-theme-accent"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-theme-muted mb-1 uppercase">
            Gate 1 이탈 수 (0~5)
          </label>
          <input
            type="number"
            min={0}
            max={5}
            value={state.gate1BreachCount}
            onChange={e => setState(prev => ({ ...prev, gate1BreachCount: parseInt(e.target.value) || 0 }))}
            className="w-full px-2 py-1 bg-theme-bg border border-theme-border text-theme-text text-xs focus:outline-none focus:border-theme-accent"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-theme-muted mb-1 uppercase">
            진입 점수
          </label>
          <input
            type="number"
            min={1}
            max={8}
            value={state.entryScore}
            onChange={e => setState(prev => ({ ...prev, entryScore: parseInt(e.target.value) || 7 }))}
            className="w-full px-2 py-1 bg-theme-bg border border-theme-border text-theme-text text-xs focus:outline-none focus:border-theme-accent"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => setState(prev => ({ ...prev, stopLossTriggered: !prev.stopLossTriggered }))}
            className={cn(
              'w-full py-1.5 text-xs font-bold border transition-colors',
              state.stopLossTriggered
                ? 'bg-red-700 border-red-500 text-white'
                : 'bg-theme-bg border-theme-border text-theme-muted hover:text-theme-text',
            )}
          >
            {state.stopLossTriggered ? '🛑 손절 발동됨' : '손절 미발동'}
          </button>
        </div>
      </div>

      {/* 전환 결과 */}
      {transition ? (
        <div className="px-4 py-3 bg-amber-900/20 border border-amber-500">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-black text-amber-300">
                ⚡ 단계 전환 필요: {LIFECYCLE_LABELS[transition.prevStage]} → {LIFECYCLE_LABELS[transition.nextStage]}
              </p>
              <p className="text-[10px] text-amber-200 mt-1">{transition.reason}</p>
              {transition.sellRatio > 0 && (
                <p className="text-[10px] text-amber-400 mt-0.5 font-bold">
                  매도 비율: {(transition.sellRatio * 100).toFixed(0)}%
                  {transition.sendAlert && ' + Telegram 경보 발송'}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleApplyTransition}
              className="shrink-0 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold border border-amber-400 transition-colors"
            >
              전환 실행
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3 bg-emerald-900/20 border border-emerald-600">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-300 font-bold">
              {state.stage === 'FULL_EXIT' ? '포지션 종료 완료.' : '현재 단계 유지 — 추가 조치 불필요.'}
            </p>
          </div>
        </div>
      )}

      {/* 초기화 */}
      <button
        type="button"
        onClick={() => setState(DEFAULT_DEMO_STATE)}
        className="text-[10px] text-theme-muted hover:text-theme-text transition-colors"
      >
        ↺ 시뮬레이터 초기화
      </button>
    </div>
  );
}

// ─── 5단계 흐름 요약 ──────────────────────────────────────────────────────────

function LifecycleFlowSummary() {
  const steps = STAGE_ORDER.map(stage => ({
    stage,
    label: LIFECYCLE_LABELS[stage],
    desc: LIFECYCLE_DESCRIPTIONS[stage],
  }));

  const stepColors: Record<LifecycleStage, string> = {
    ENTRY: 'text-sky-400',
    HOLD: 'text-emerald-400',
    ALERT: 'text-amber-400',
    EXIT_PREP: 'text-orange-400',
    FULL_EXIT: 'text-red-400',
  };

  return (
    <div className="space-y-1.5">
      {steps.map(({ stage, label, desc }) => (
        <div key={stage} className="flex items-start gap-2 px-3 py-2 bg-theme-bg border border-theme-border">
          <span className={cn('text-[10px] font-black shrink-0 pt-0.5', stepColors[stage])}>
            {label.split(':')[0]}
          </span>
          <div>
            <p className="text-[11px] font-bold text-theme-text">{label.split(': ')[1]}</p>
            <p className="text-[10px] text-theme-muted">{desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 메인 패널 컴포넌트 ───────────────────────────────────────────────────────

export function PositionLifecyclePanel() {
  const [expanded, setExpanded] = useState(true);
  const [showSimulator, setShowSimulator] = useState(false);

  return (
    <div className="border-2 border-sky-500/60 bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
      {/* 헤더 */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-sky-400" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-black text-theme-text uppercase tracking-wider">
                포지션 생애주기 자동화
              </h3>
              <span className="text-[10px] font-black px-2 py-0.5 rounded border bg-sky-700/60 border-sky-500/50 text-sky-200 uppercase tracking-widest">
                5단계
              </span>
            </div>
            <p className="text-[11px] text-theme-muted mt-0.5">
              진입→보유→경보→청산준비→전량청산 완전 자동화 · 매도는 매수보다 체계적이어야 한다
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-theme-muted shrink-0" /> : <ChevronDown className="w-4 h-4 text-theme-muted shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 sm:px-5 pb-5 space-y-4">
          {/* 개념 설명 배너 */}
          <div className="px-4 py-3 bg-sky-900/20 border border-sky-500/60">
            <p className="text-xs font-bold text-sky-200">
              핵심: 매도는 매수보다 더 체계적이어야 한다.
            </p>
            <p className="text-[10px] text-sky-300/80 mt-1">
              현재 대부분의 시스템이 매수에 90%의 에너지를 쏟고 매도는 즉흥적으로 처리한다.
              이 비대칭이 수익을 갉아먹는다. 5단계 자동화로 이 구조적 문제를 해결한다.
            </p>
          </div>

          {/* 5단계 흐름 요약 */}
          <div>
            <h4 className="text-[11px] font-bold text-theme-muted uppercase tracking-wider mb-2 flex items-center gap-1">
              <Activity className="w-3 h-3" />5단계 자동화 흐름
            </h4>
            <LifecycleFlowSummary />
          </div>

          {/* 시뮬레이터 토글 */}
          <div>
            <button
              type="button"
              onClick={() => setShowSimulator(v => !v)}
              className="flex items-center gap-1 text-[11px] text-theme-muted hover:text-theme-text transition-colors"
            >
              {showSimulator ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              단계 전환 시뮬레이터 (인터랙티브 데모)
            </button>
            {showSimulator && <DemoSimulator />}
          </div>
        </div>
      )}
    </div>
  );
}
