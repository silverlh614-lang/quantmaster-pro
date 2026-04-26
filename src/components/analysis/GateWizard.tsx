// @responsibility analysis 영역 GateWizard 컴포넌트
/**
 * GateWizard — 3-Gate 위저드 플로우
 *
 * Quantus의 선형 단계 탐색을 27조건 피라미드에 이식.
 * Gate 1(5 필수) → Gate 2(12→9 통과) → Gate 3(10→7 통과) → 포지션 확정 → 실행
 * 각 Gate를 순서대로 통과해야 다음 단계로 진행 가능.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  Shield, TrendingUp, Clock, Target, Play,
  Check, Lock, ChevronRight, AlertTriangle, Zap,
  BarChart3, Brain, Eye, Scale, Crosshair,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../ui/cn';
import { Card } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { ALL_CONDITIONS } from '../../services/quant/evolutionEngine';
import {
  GATE1_IDS, GATE2_IDS, GATE3_IDS,
  GATE1_REQUIRED, GATE2_REQUIRED, GATE3_REQUIRED,
  CONDITION_PASS_THRESHOLD,
} from '../../constants/gateConfig';

// ── Step Config ─────────────────────────────────────────────────────────────

interface StepDef {
  key: string;
  label: string;
  labelKo: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  glowColor: string;
}

const STEPS: StepDef[] = [
  {
    key: 'gate1', label: 'Gate 1', labelKo: '생존필터',
    icon: <Shield className="w-5 h-5" />,
    color: 'text-red-400', bgColor: 'bg-red-500/12', borderColor: 'border-red-500/40', glowColor: 'shadow-[0_0_20px_rgba(239,68,68,0.15)]',
  },
  {
    key: 'gate2', label: 'Gate 2', labelKo: '성장검증',
    icon: <TrendingUp className="w-5 h-5" />,
    color: 'text-amber-400', bgColor: 'bg-amber-500/12', borderColor: 'border-amber-500/40', glowColor: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]',
  },
  {
    key: 'gate3', label: 'Gate 3', labelKo: '타이밍',
    icon: <Clock className="w-5 h-5" />,
    color: 'text-green-400', bgColor: 'bg-green-500/12', borderColor: 'border-green-500/40', glowColor: 'shadow-[0_0_20px_rgba(34,197,94,0.15)]',
  },
  {
    key: 'position', label: 'Position', labelKo: '포지션 확정',
    icon: <Target className="w-5 h-5" />,
    color: 'text-blue-400', bgColor: 'bg-blue-500/12', borderColor: 'border-blue-500/40', glowColor: 'shadow-[0_0_20px_rgba(59,130,246,0.15)]',
  },
  {
    key: 'execute', label: 'Execute', labelKo: '실행',
    icon: <Play className="w-5 h-5" />,
    color: 'text-purple-400', bgColor: 'bg-purple-500/12', borderColor: 'border-purple-500/40', glowColor: 'shadow-[0_0_20px_rgba(168,85,247,0.15)]',
  },
];

// ── Condition icon helper ───────────────────────────────────────────────────

function getConditionIcon(id: number) {
  const icons: Record<number, React.ReactNode> = {
    1: <BarChart3 className="w-3.5 h-3.5" />,
    3: <TrendingUp className="w-3.5 h-3.5" />,
    5: <Eye className="w-3.5 h-3.5" />,
    7: <Shield className="w-3.5 h-3.5" />,
    9: <Zap className="w-3.5 h-3.5" />,
  };
  return icons[id] || <Brain className="w-3.5 h-3.5" />;
}

// ── Types ───────────────────────────────────────────────────────────────────

type PositionMode = 'full' | 'half' | 'observation';

interface GateWizardProps {
  stockName?: string;
  stockCode?: string;
  /** Per-condition scores (0-10) from AI evaluation */
  conditionScores?: Record<number, number>;
  /** Called when user clicks Execute */
  onExecute?: (result: {
    gate1Passed: boolean;
    gate2Passed: boolean;
    gate3Passed: boolean;
    positionMode: PositionMode;
    conditionScores: Record<number, number>;
  }) => void;
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export function GateWizard({ stockName, stockCode, conditionScores: externalScores, onExecute }: GateWizardProps) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [activeStep, setActiveStep] = useState(0);
  const [scores, setScores] = useState<Record<number, number>>(externalScores || {});
  const [positionMode, setPositionMode] = useState<PositionMode>('full');

  // Sync external scores when provided
  React.useEffect(() => {
    if (externalScores) setScores(externalScores);
  }, [externalScores]);

  // ── Computed gate results ─────────────────────────────────────────────────
  const gate1Passed = useMemo(() => {
    return GATE1_IDS.every(id => (scores[id] ?? 0) >= CONDITION_PASS_THRESHOLD);
  }, [scores]);

  const gate1Count = useMemo(() => {
    return GATE1_IDS.filter(id => (scores[id] ?? 0) >= CONDITION_PASS_THRESHOLD).length;
  }, [scores]);

  const gate2Count = useMemo(() => {
    return GATE2_IDS.filter(id => (scores[id] ?? 0) >= CONDITION_PASS_THRESHOLD).length;
  }, [scores]);

  const gate2Passed = useMemo(() => gate2Count >= GATE2_REQUIRED, [gate2Count]);

  const gate3Count = useMemo(() => {
    return GATE3_IDS.filter(id => (scores[id] ?? 0) >= CONDITION_PASS_THRESHOLD).length;
  }, [scores]);

  const gate3Passed = useMemo(() => gate3Count >= GATE3_REQUIRED, [gate3Count]);

  // ── Step accessibility ────────────────────────────────────────────────────
  const canAccessStep = useCallback((stepIndex: number) => {
    if (stepIndex === 0) return true;
    if (stepIndex === 1) return gate1Passed;
    if (stepIndex === 2) return gate1Passed && gate2Passed;
    if (stepIndex === 3) return gate1Passed && gate2Passed && gate3Passed;
    if (stepIndex === 4) return gate1Passed && gate2Passed && gate3Passed;
    return false;
  }, [gate1Passed, gate2Passed, gate3Passed]);

  const isStepCompleted = useCallback((stepIndex: number) => {
    if (stepIndex === 0) return gate1Passed;
    if (stepIndex === 1) return gate2Passed;
    if (stepIndex === 2) return gate3Passed;
    return false;
  }, [gate1Passed, gate2Passed, gate3Passed]);

  // ── Score update handler ──────────────────────────────────────────────────
  const updateScore = useCallback((id: number, val: number) => {
    setScores(prev => ({ ...prev, [id]: Math.max(0, Math.min(10, val)) }));
  }, []);

  // ── Navigate ──────────────────────────────────────────────────────────────
  const goNext = useCallback(() => {
    if (activeStep < STEPS.length - 1 && canAccessStep(activeStep + 1)) {
      setActiveStep(prev => prev + 1);
    }
  }, [activeStep, canAccessStep]);

  const goPrev = useCallback(() => {
    if (activeStep > 0) setActiveStep(prev => prev - 1);
  }, [activeStep]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ─── Top: Step Navigation Bar ──────────────────────────────────── */}
      <div className="flex items-center gap-0 sm:gap-1 p-2 sm:p-3 bg-[var(--bg-elevated)] rounded-xl sm:rounded-2xl border-2 border-theme-border shadow-[3px_3px_0px_rgba(0,0,0,0.3)] overflow-x-auto no-scrollbar">
        {STEPS.map((step, idx) => {
          const accessible = canAccessStep(idx);
          const completed = isStepCompleted(idx);
          const active = activeStep === idx;

          return (
            <React.Fragment key={step.key}>
              {idx > 0 && (
                <div className={cn(
                  'w-4 sm:w-8 h-0.5 shrink-0 rounded-full transition-colors',
                  completed || (accessible && idx <= activeStep + 1)
                    ? 'bg-white/20' : 'bg-white/5'
                )} />
              )}
              <button
                type="button"
                onClick={() => accessible && setActiveStep(idx)}
                disabled={!accessible}
                className={cn(
                  'flex items-center gap-1.5 sm:gap-2.5 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl transition-all shrink-0',
                  active && `${step.bgColor} ${step.borderColor} border-2 ${step.glowColor}`,
                  !active && accessible && 'hover:bg-white/5 border-2 border-transparent',
                  !active && completed && `border-2 ${step.borderColor} opacity-80`,
                  !accessible && 'opacity-30 cursor-not-allowed border-2 border-transparent',
                )}
              >
                {completed ? (
                  <div className={cn('w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center', step.bgColor)}>
                    <Check className={cn('w-3 h-3 sm:w-3.5 sm:h-3.5', step.color)} />
                  </div>
                ) : !accessible ? (
                  <Lock className="w-4 h-4 text-theme-text-muted" />
                ) : (
                  <span className={cn(active ? step.color : 'text-theme-text-muted')}>{step.icon}</span>
                )}
                <div className="text-left hidden xs:block">
                  <span className={cn(
                    'text-[10px] font-black uppercase tracking-wider block leading-tight',
                    active ? step.color : completed ? step.color : 'text-theme-text-muted'
                  )}>
                    {step.label}
                  </span>
                  <span className="text-[8px] font-bold text-theme-text-muted leading-tight">{step.labelKo}</span>
                </div>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* ─── Real-time Gate Progress Strip ─────────────────────────────── */}
      <div className="flex items-center gap-3 sm:gap-4 px-1">
        <GateProgressPill label="G1" passed={gate1Count} total={GATE1_IDS.length} required={GATE1_REQUIRED} ok={gate1Passed} color="red" />
        <GateProgressPill label="G2" passed={gate2Count} total={GATE2_IDS.length} required={GATE2_REQUIRED} ok={gate2Passed} color="amber" />
        <GateProgressPill label="G3" passed={gate3Count} total={GATE3_IDS.length} required={GATE3_REQUIRED} ok={gate3Passed} color="green" />
      </div>

      {/* ─── Active Step Panel ─────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeStep}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.2 }}
        >
          {activeStep === 0 && (
            <GatePanel
              step={STEPS[0]}
              conditionIds={[...GATE1_IDS]}
              scores={scores}
              onUpdateScore={updateScore}
              passedCount={gate1Count}
              requiredCount={GATE1_REQUIRED}
              gatePassed={gate1Passed}
              description="5개 필수 생존 조건을 모두 충족해야 다음 Gate로 진행할 수 있습니다. 하나라도 미달 시 투자 불가."
              ruleText="ALL 5 conditions must pass (score >= 5)"
            />
          )}
          {activeStep === 1 && (
            <GatePanel
              step={STEPS[1]}
              conditionIds={[...GATE2_IDS]}
              scores={scores}
              onUpdateScore={updateScore}
              passedCount={gate2Count}
              requiredCount={GATE2_REQUIRED}
              gatePassed={gate2Passed}
              description="12개 성장·모멘텀 조건 중 9개 이상 통과해야 합니다. 펀더멘털과 수급의 질을 검증합니다."
              ruleText="9 of 12 conditions must pass (score >= 5)"
            />
          )}
          {activeStep === 2 && (
            <GatePanel
              step={STEPS[2]}
              conditionIds={[...GATE3_IDS]}
              scores={scores}
              onUpdateScore={updateScore}
              passedCount={gate3Count}
              requiredCount={GATE3_REQUIRED}
              gatePassed={gate3Passed}
              description="10개 타이밍·기술적 조건 중 7개 이상 통과해야 합니다. 진입 시점의 정밀도를 확인합니다."
              ruleText="7 of 10 conditions must pass (score >= 5)"
            />
          )}
          {activeStep === 3 && (
            <PositionPanel
              positionMode={positionMode}
              onChangeMode={setPositionMode}
              gate1Passed={gate1Passed}
              gate2Passed={gate2Passed}
              gate3Passed={gate3Passed}
              gate1Count={gate1Count}
              gate2Count={gate2Count}
              gate3Count={gate3Count}
              stockName={stockName}
            />
          )}
          {activeStep === 4 && (
            <ExecutionPanel
              stockName={stockName}
              stockCode={stockCode}
              positionMode={positionMode}
              onExecute={() => onExecute?.({
                gate1Passed, gate2Passed, gate3Passed,
                positionMode, conditionScores: scores,
              })}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ─── Bottom Navigation ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="md"
          onClick={goPrev}
          disabled={activeStep === 0}
        >
          이전
        </Button>
        <div className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest">
          {activeStep + 1} / {STEPS.length}
        </div>
        {activeStep < STEPS.length - 1 ? (
          <Button
            variant={canAccessStep(activeStep + 1) ? 'primary' : 'secondary'}
            size="md"
            icon={canAccessStep(activeStep + 1) ? <ChevronRight className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            onClick={goNext}
            disabled={!canAccessStep(activeStep + 1)}
          >
            {canAccessStep(activeStep + 1) ? '다음' : '잠김'}
          </Button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

// ── Gate Progress Pill ──────────────────────────────────────────────────────

function GateProgressPill({ label, passed, total, required, ok, color }: {
  label: string; passed: number; total: number; required: number; ok: boolean;
  color: 'red' | 'amber' | 'green';
}) {
  const percent = total > 0 ? (passed / total) * 100 : 0;
  const colorMap = {
    red: { bar: 'bg-red-500', text: ok ? 'text-red-400' : 'text-theme-text-muted', ring: 'border-red-500/30' },
    amber: { bar: 'bg-amber-500', text: ok ? 'text-amber-400' : 'text-theme-text-muted', ring: 'border-amber-500/30' },
    green: { bar: 'bg-green-500', text: ok ? 'text-green-400' : 'text-theme-text-muted', ring: 'border-green-500/30' },
  };
  const c = colorMap[color];

  return (
    <div className="flex-1 flex items-center gap-2 sm:gap-3">
      <div className={cn('text-[10px] font-black uppercase tracking-widest shrink-0', c.text)}>
        {label}
      </div>
      <div className={cn('flex-1 h-2 rounded-full overflow-hidden bg-white/5 border', c.ring)}>
        <motion.div
          className={cn('h-full rounded-full', c.bar)}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
      <span className={cn('text-[10px] font-black shrink-0 font-mono tabular-nums', c.text)}>
        {passed}/{required}
      </span>
      {ok && <Check className={cn('w-3 h-3 shrink-0', c.text)} />}
    </div>
  );
}

// ── Gate Condition Panel ────────────────────────────────────────────────────

function GatePanel({ step, conditionIds, scores, onUpdateScore, passedCount, requiredCount, gatePassed, description, ruleText }: {
  step: StepDef;
  conditionIds: number[];
  scores: Record<number, number>;
  onUpdateScore: (id: number, val: number) => void;
  passedCount: number;
  requiredCount: number;
  gatePassed: boolean;
  description: string;
  ruleText: string;
}) {
  return (
    <Card padding="lg" className={cn(gatePassed && `${step.borderColor} border-2`)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center', step.bgColor)}>
            <span className={step.color}>{step.icon}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={cn('text-base sm:text-lg font-black', step.color)}>{step.label}</span>
              <span className="text-xs sm:text-sm font-black text-theme-text">{step.labelKo}</span>
            </div>
            <span className="text-[10px] font-bold text-theme-text-muted">{ruleText}</span>
          </div>
        </div>
        <Badge variant={gatePassed ? 'success' : 'warning'} size="sm">
          {passedCount}/{requiredCount} {gatePassed ? 'PASS' : 'FAIL'}
        </Badge>
      </div>

      <p className="text-xs text-theme-text-muted font-bold leading-relaxed mb-5 sm:mb-6">{description}</p>

      {/* Condition Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {conditionIds.map((id) => {
          const cond = ALL_CONDITIONS[id];
          const score = scores[id] ?? 0;
          const passed = score >= CONDITION_PASS_THRESHOLD;

          return (
            <div
              key={id}
              className={cn(
                'flex items-center gap-3 p-3 sm:p-4 rounded-xl border-2 transition-all',
                passed
                  ? 'bg-green-500/8 border-green-500/25'
                  : score > 0
                  ? 'bg-red-500/5 border-red-500/15'
                  : 'bg-white/[0.02] border-theme-border'
              )}
            >
              {/* Icon + Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={cn('shrink-0', passed ? 'text-green-400' : 'text-theme-text-muted')}>
                    {getConditionIcon(id)}
                  </span>
                  <span className="text-[10px] font-black text-theme-text-muted uppercase">{id}</span>
                  <span className={cn('text-xs font-black truncate', passed ? 'text-green-400' : 'text-theme-text')}>
                    {cond?.name || `조건 ${id}`}
                  </span>
                </div>
                <p className="text-[9px] text-theme-text-muted font-medium truncate pl-5.5">
                  {cond?.description || ''}
                </p>
              </div>

              {/* Score Input */}
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="range"
                  min={0} max={10}
                  value={score}
                  onChange={(e) => onUpdateScore(id, parseInt(e.target.value))}
                  className={cn(
                    'w-16 sm:w-20 h-1.5 rounded-full appearance-none cursor-pointer',
                    passed ? 'bg-green-500/20 accent-green-500' : 'bg-white/10 accent-orange-500',
                    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4',
                    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer',
                    passed
                      ? '[&::-webkit-slider-thumb]:bg-green-500 [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(34,197,94,0.4)]'
                      : '[&::-webkit-slider-thumb]:bg-orange-500 [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(249,115,22,0.4)]',
                  )}
                />
                <span className={cn(
                  'w-7 text-center text-xs font-black font-mono tabular-nums',
                  passed ? 'text-green-400' : score > 0 ? 'text-orange-400' : 'text-theme-text-muted'
                )}>
                  {score}
                </span>
                {passed && <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Position Panel ──────────────────────────────────────────────────────────

function PositionPanel({ positionMode, onChangeMode, gate1Passed, gate2Passed, gate3Passed, gate1Count, gate2Count, gate3Count, stockName }: {
  positionMode: PositionMode;
  onChangeMode: (m: PositionMode) => void;
  gate1Passed: boolean; gate2Passed: boolean; gate3Passed: boolean;
  gate1Count: number; gate2Count: number; gate3Count: number;
  stockName?: string;
}) {
  const options: { mode: PositionMode; label: string; desc: string; icon: React.ReactNode; color: string; bgColor: string; borderColor: string }[] = [
    { mode: 'full', label: '풀 포지션 (100%)', desc: '3-Gate 모두 통과 — 최대 확신 매수', icon: <Zap className="w-5 h-5" />, color: 'text-green-400', bgColor: 'bg-green-500/10', borderColor: 'border-green-500/40' },
    { mode: 'half', label: '절반 포지션 (50%)', desc: '보수적 진입 — 추가 확인 후 증량', icon: <Scale className="w-5 h-5" />, color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/40' },
    { mode: 'observation', label: '관망 (모니터링)', desc: 'Gate 통과했으나 진입 보류 — 타이밍 대기', icon: <Eye className="w-5 h-5" />, color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/40' },
  ];

  return (
    <Card padding="lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-500/15 flex items-center justify-center">
          <Target className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" />
        </div>
        <div>
          <div className="text-base sm:text-lg font-black text-theme-text">포지션 확정</div>
          <span className="text-[10px] font-bold text-theme-text-muted">
            {stockName ? `${stockName} — ` : ''}Gate 통과 현황: G1 {gate1Count}/5, G2 {gate2Count}/12, G3 {gate3Count}/10
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {options.map((opt) => (
          <button
            key={opt.mode}
            type="button"
            onClick={() => onChangeMode(opt.mode)}
            className={cn(
              'w-full text-left p-4 sm:p-5 rounded-xl sm:rounded-2xl border-2 transition-all',
              positionMode === opt.mode
                ? `${opt.bgColor} ${opt.borderColor}`
                : 'bg-white/[0.02] border-theme-border hover:bg-white/[0.04]'
            )}
          >
            <div className="flex items-center gap-3">
              <span className={positionMode === opt.mode ? opt.color : 'text-theme-text-muted'}>{opt.icon}</span>
              <div className="flex-1">
                <span className={cn('text-sm font-black', positionMode === opt.mode ? opt.color : 'text-theme-text')}>{opt.label}</span>
                <p className="text-[10px] text-theme-text-muted font-bold mt-0.5">{opt.desc}</p>
              </div>
              <div className={cn(
                'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
                positionMode === opt.mode ? `${opt.borderColor} ${opt.bgColor}` : 'border-theme-border'
              )}>
                {positionMode === opt.mode && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ── Execution Panel ─────────────────────────────────────────────────────────

function ExecutionPanel({ stockName, stockCode, positionMode, onExecute }: {
  stockName?: string; stockCode?: string;
  positionMode: PositionMode;
  onExecute: () => void;
}) {
  const modeLabel = positionMode === 'full' ? '풀 포지션 (100%)' : positionMode === 'half' ? '절반 포지션 (50%)' : '관망 (모니터링)';
  const modeColor = positionMode === 'full' ? 'text-green-400' : positionMode === 'half' ? 'text-amber-400' : 'text-blue-400';

  return (
    <Card padding="lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-purple-500/15 flex items-center justify-center">
          <Crosshair className="w-5 h-5 sm:w-6 sm:h-6 text-purple-400" />
        </div>
        <div>
          <div className="text-base sm:text-lg font-black text-theme-text">실행 확인</div>
          <span className="text-[10px] font-bold text-theme-text-muted">3-Gate 통과 완료 — 최종 실행 전 확인</span>
        </div>
      </div>

      {/* Summary */}
      <div className="p-4 sm:p-6 bg-white/[0.03] rounded-xl sm:rounded-2xl border border-theme-border mb-6 space-y-3">
        {stockName && (
          <div className="flex justify-between text-sm">
            <span className="font-black text-theme-text-muted">종목</span>
            <span className="font-black text-theme-text">{stockName} {stockCode && <span className="text-theme-text-muted font-mono text-xs">({stockCode})</span>}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="font-black text-theme-text-muted">Gate 통과</span>
          <span className="font-black text-green-400">3 / 3 ALL PASS</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="font-black text-theme-text-muted">포지션</span>
          <span className={cn('font-black', modeColor)}>{modeLabel}</span>
        </div>
      </div>

      {positionMode === 'observation' ? (
        <div className="p-4 bg-blue-500/10 border border-blue-500/25 rounded-xl text-center">
          <Eye className="w-6 h-6 text-blue-400 mx-auto mb-2" />
          <p className="text-xs font-black text-blue-400">관망 모드 — 매매일지에 모니터링 등록됩니다</p>
        </div>
      ) : (
        <Button
          variant="primary"
          size="lg"
          icon={<Play className="w-5 h-5" />}
          onClick={onExecute}
          className="w-full py-4 text-base shadow-[0_8px_30px_rgba(249,115,22,0.3)]"
        >
          {positionMode === 'full' ? '풀 포지션 매수 실행' : '절반 포지션 매수 실행'}
        </Button>
      )}
    </Card>
  );
}
