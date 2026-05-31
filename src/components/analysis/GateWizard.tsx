// @responsibility analysis area GateWizard component
/**
 * GateWizard - 3-Gate decision flow.
 *
 * Visualizes the Quantus-style 27 condition pyramid:
 * Gate 1 survival filter -> Gate 2 growth verification -> Gate 3 timing
 * -> position sizing -> execution confirmation.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  Shield, TrendingUp, Clock, Target, Play,
  Check, Lock, ChevronRight, Zap,
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

type PositionMode = 'full' | 'half' | 'observation';

interface GateWizardProps {
  stockName?: string;
  stockCode?: string;
  conditionScores?: Record<number, number>;
  onExecute?: (result: {
    gate1Passed: boolean;
    gate2Passed: boolean;
    gate3Passed: boolean;
    positionMode: PositionMode;
    conditionScores: Record<number, number>;
  }) => void;
}

interface GateStatus {
  gate1Passed: boolean;
  gate2Passed: boolean;
  gate3Passed: boolean;
}

const STEPS: StepDef[] = [
  {
    key: 'gate1', label: 'Gate 1', labelKo: '생존',
    icon: <Shield className="w-5 h-5" />,
    color: 'text-red-400', bgColor: 'bg-red-500/12', borderColor: 'border-red-500/40', glowColor: 'shadow-[0_0_20px_rgba(239,68,68,0.15)]',
  },
  {
    key: 'gate2', label: 'Gate 2', labelKo: '성장',
    icon: <TrendingUp className="w-5 h-5" />,
    color: 'text-amber-400', bgColor: 'bg-amber-500/12', borderColor: 'border-amber-500/40', glowColor: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]',
  },
  {
    key: 'gate3', label: 'Gate 3', labelKo: '타이밍',
    icon: <Clock className="w-5 h-5" />,
    color: 'text-green-400', bgColor: 'bg-green-500/12', borderColor: 'border-green-500/40', glowColor: 'shadow-[0_0_20px_rgba(34,197,94,0.15)]',
  },
  {
    key: 'position', label: '포지션', labelKo: '사이징',
    icon: <Target className="w-5 h-5" />,
    color: 'text-blue-400', bgColor: 'bg-blue-500/12', borderColor: 'border-blue-500/40', glowColor: 'shadow-[0_0_20px_rgba(59,130,246,0.15)]',
  },
  {
    key: 'execute', label: '실행', labelKo: '확인',
    icon: <Play className="w-5 h-5" />,
    color: 'text-purple-400', bgColor: 'bg-purple-500/12', borderColor: 'border-purple-500/40', glowColor: 'shadow-[0_0_20px_rgba(168,85,247,0.15)]',
  },
];

const GATE_PANEL_COPY = [
  {
    description: '다음 게이트가 열리려면 5개 생존 점검을 모두 통과해야 합니다.',
    ruleText: '5개 조건 전부 통과 필요 (점수 >= 5)',
  },
  {
    description: '신호 품질 검증을 위해 성장·모멘텀 점검 중 최소 9개를 통과해야 합니다.',
    ruleText: '12개 중 9개 조건 통과 필요 (점수 >= 5)',
  },
  {
    description: '진입 타이밍 확정을 위해 타이밍 점검 중 최소 7개를 통과해야 합니다.',
    ruleText: '10개 중 7개 조건 통과 필요 (점수 >= 5)',
  },
] as const;

const POSITION_OPTIONS: {
  mode: PositionMode;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
}[] = [
  { mode: 'full', label: '풀 포지션 (100%)', desc: '모든 게이트 통과, 최대 확신', icon: <Zap className="w-5 h-5" />, color: 'text-green-400', bgColor: 'bg-green-500/10', borderColor: 'border-green-500/40' },
  { mode: 'half', label: '하프 포지션 (50%)', desc: '추가 매수 여지를 둔 보수적 진입', icon: <Scale className="w-5 h-5" />, color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/40' },
  { mode: 'observation', label: '관망만', desc: '집행 없이 셋업만 추적', icon: <Eye className="w-5 h-5" />, color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/40' },
];

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

function countPassed(ids: readonly number[], scores: Record<number, number>): number {
  return ids.filter(id => (scores[id] ?? 0) >= CONDITION_PASS_THRESHOLD).length;
}

function canAccessGateStep(stepIndex: number, status: GateStatus): boolean {
  if (stepIndex === 0) return true;
  if (stepIndex === 1) return status.gate1Passed;
  if (stepIndex === 2) return status.gate1Passed && status.gate2Passed;
  if (stepIndex === 3) return status.gate1Passed && status.gate2Passed && status.gate3Passed;
  if (stepIndex === 4) return status.gate1Passed && status.gate2Passed && status.gate3Passed;
  return false;
}

function isGateStepCompleted(stepIndex: number, status: GateStatus): boolean {
  if (stepIndex === 0) return status.gate1Passed;
  if (stepIndex === 1) return status.gate2Passed;
  if (stepIndex === 2) return status.gate3Passed;
  return false;
}

function StepNavigation({
  activeStep,
  canAccessStep,
  isStepCompleted,
  onStepChange,
}: {
  activeStep: number;
  canAccessStep: (stepIndex: number) => boolean;
  isStepCompleted: (stepIndex: number) => boolean;
  onStepChange: (stepIndex: number) => void;
}) {
  return (
    <div className="flex items-center gap-0 sm:gap-1 p-2 sm:p-3 bg-[var(--bg-elevated)] rounded-xl sm:rounded-2xl border-2 border-theme-border shadow-[3px_3px_0px_rgba(0,0,0,0.3)] overflow-x-auto no-scrollbar">
      {STEPS.map((step, idx) => (
        <StepNavigationItem
          key={step.key}
          step={step}
          index={idx}
          activeStep={activeStep}
          accessible={canAccessStep(idx)}
          completed={isStepCompleted(idx)}
          onStepChange={onStepChange}
        />
      ))}
    </div>
  );
}

function StepNavigationItem({
  step,
  index,
  activeStep,
  accessible,
  completed,
  onStepChange,
}: {
  step: StepDef;
  index: number;
  activeStep: number;
  accessible: boolean;
  completed: boolean;
  onStepChange: (stepIndex: number) => void;
}) {
  const active = activeStep === index;
  return (
    <React.Fragment>
      {index > 0 && (
        <div className={cn(
          'w-4 sm:w-8 h-0.5 shrink-0 rounded-full transition-colors',
          completed || (accessible && index <= activeStep + 1) ? 'bg-white/20' : 'bg-white/5'
        )} />
      )}
      <button
        type="button"
        onClick={() => accessible && onStepChange(index)}
        disabled={!accessible}
        className={cn(
          'flex items-center gap-1.5 sm:gap-2.5 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl transition-all shrink-0',
          active && `${step.bgColor} ${step.borderColor} border-2 ${step.glowColor}`,
          !active && accessible && 'hover:bg-white/5 border-2 border-transparent',
          !active && completed && `border-2 ${step.borderColor} opacity-80`,
          !accessible && 'opacity-30 cursor-not-allowed border-2 border-transparent',
        )}
      >
        <StepStatusIcon step={step} active={active} accessible={accessible} completed={completed} />
        <div className="text-left hidden xs:block">
          <span className={cn(
            'text-[10px] font-semibold tracking-tight block leading-tight',
            active ? step.color : completed ? step.color : 'text-theme-text-muted'
          )}>
            {step.label}
          </span>
          <span className="text-[8px] font-bold text-theme-text-muted leading-tight">{step.labelKo}</span>
        </div>
      </button>
    </React.Fragment>
  );
}

function StepStatusIcon({
  step,
  active,
  accessible,
  completed,
}: {
  step: StepDef;
  active: boolean;
  accessible: boolean;
  completed: boolean;
}) {
  if (completed) {
    return (
      <div className={cn('w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center', step.bgColor)}>
        <Check className={cn('w-3 h-3 sm:w-3.5 sm:h-3.5', step.color)} />
      </div>
    );
  }
  if (!accessible) return <Lock className="w-4 h-4 text-theme-text-muted" />;
  return <span className={cn(active ? step.color : 'text-theme-text-muted')}>{step.icon}</span>;
}

function GateProgressStrip({
  gate1Count,
  gate2Count,
  gate3Count,
  gate1Passed,
  gate2Passed,
  gate3Passed,
}: {
  gate1Count: number;
  gate2Count: number;
  gate3Count: number;
  gate1Passed: boolean;
  gate2Passed: boolean;
  gate3Passed: boolean;
}) {
  return (
    <div className="flex items-center gap-3 sm:gap-4 px-1">
      <GateProgressPill label="G1" passed={gate1Count} total={GATE1_IDS.length} required={GATE1_REQUIRED} ok={gate1Passed} color="red" />
      <GateProgressPill label="G2" passed={gate2Count} total={GATE2_IDS.length} required={GATE2_REQUIRED} ok={gate2Passed} color="amber" />
      <GateProgressPill label="G3" passed={gate3Count} total={GATE3_IDS.length} required={GATE3_REQUIRED} ok={gate3Passed} color="green" />
    </div>
  );
}

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
      <div className={cn('text-[10px] font-semibold tracking-tight shrink-0', c.text)}>
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

function ActiveStepPanel({
  activeStep,
  scores,
  positionMode,
  gate1Passed,
  gate2Passed,
  gate3Passed,
  gate1Count,
  gate2Count,
  gate3Count,
  stockName,
  stockCode,
  onUpdateScore,
  onChangeMode,
  onExecute,
}: {
  activeStep: number;
  scores: Record<number, number>;
  positionMode: PositionMode;
  gate1Passed: boolean;
  gate2Passed: boolean;
  gate3Passed: boolean;
  gate1Count: number;
  gate2Count: number;
  gate3Count: number;
  stockName?: string;
  stockCode?: string;
  onUpdateScore: (id: number, val: number) => void;
  onChangeMode: (mode: PositionMode) => void;
  onExecute: () => void;
}) {
  if (activeStep === 0) {
    return (
      <GatePanel
        step={STEPS[0]}
        conditionIds={[...GATE1_IDS]}
        scores={scores}
        onUpdateScore={onUpdateScore}
        passedCount={gate1Count}
        requiredCount={GATE1_REQUIRED}
        gatePassed={gate1Passed}
        description={GATE_PANEL_COPY[0].description}
        ruleText={GATE_PANEL_COPY[0].ruleText}
      />
    );
  }
  if (activeStep === 1) {
    return (
      <GatePanel
        step={STEPS[1]}
        conditionIds={[...GATE2_IDS]}
        scores={scores}
        onUpdateScore={onUpdateScore}
        passedCount={gate2Count}
        requiredCount={GATE2_REQUIRED}
        gatePassed={gate2Passed}
        description={GATE_PANEL_COPY[1].description}
        ruleText={GATE_PANEL_COPY[1].ruleText}
      />
    );
  }
  if (activeStep === 2) {
    return (
      <GatePanel
        step={STEPS[2]}
        conditionIds={[...GATE3_IDS]}
        scores={scores}
        onUpdateScore={onUpdateScore}
        passedCount={gate3Count}
        requiredCount={GATE3_REQUIRED}
        gatePassed={gate3Passed}
        description={GATE_PANEL_COPY[2].description}
        ruleText={GATE_PANEL_COPY[2].ruleText}
      />
    );
  }
  if (activeStep === 3) {
    return (
      <PositionPanel
        positionMode={positionMode}
        onChangeMode={onChangeMode}
        gate1Count={gate1Count}
        gate2Count={gate2Count}
        gate3Count={gate3Count}
        stockName={stockName}
      />
    );
  }
  return (
    <ExecutionPanel
      stockName={stockName}
      stockCode={stockCode}
      positionMode={positionMode}
      onExecute={onExecute}
    />
  );
}

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
          {passedCount}/{requiredCount} {gatePassed ? '통과' : '미통과'}
        </Badge>
      </div>

      <p className="text-xs text-theme-text-muted font-bold leading-relaxed mb-5 sm:mb-6">{description}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {conditionIds.map((id) => (
          <ConditionRow
            key={id}
            id={id}
            score={scores[id] ?? 0}
            onUpdateScore={onUpdateScore}
          />
        ))}
      </div>
    </Card>
  );
}

function ConditionRow({
  id,
  score,
  onUpdateScore,
}: {
  id: number;
  score: number;
  onUpdateScore: (id: number, val: number) => void;
}) {
  const cond = ALL_CONDITIONS[id];
  const passed = score >= CONDITION_PASS_THRESHOLD;
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 sm:p-4 rounded-xl border-2 transition-all',
        passed
          ? 'bg-green-500/8 border-green-500/25'
          : score > 0
          ? 'bg-red-500/5 border-red-500/15'
          : 'bg-white/[0.02] border-theme-border'
      )}
    >
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

      <ScoreSlider id={id} score={score} passed={passed} onUpdateScore={onUpdateScore} />
    </div>
  );
}

function ScoreSlider({
  id,
  score,
  passed,
  onUpdateScore,
}: {
  id: number;
  score: number;
  passed: boolean;
  onUpdateScore: (id: number, val: number) => void;
}) {
  return (
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
  );
}

function PositionPanel({ positionMode, onChangeMode, gate1Count, gate2Count, gate3Count, stockName }: {
  positionMode: PositionMode;
  onChangeMode: (m: PositionMode) => void;
  gate1Count: number; gate2Count: number; gate3Count: number;
  stockName?: string;
}) {
  return (
    <Card padding="lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-500/15 flex items-center justify-center">
          <Target className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" />
        </div>
        <div>
          <div className="text-base sm:text-lg font-black text-theme-text">포지션 사이징</div>
          <span className="text-[10px] font-bold text-theme-text-muted">
            {stockName ? `${stockName} ` : ''}Gate 상태: G1 {gate1Count}/5, G2 {gate2Count}/12, G3 {gate3Count}/10
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {POSITION_OPTIONS.map((opt) => (
          <PositionOption
            key={opt.mode}
            option={opt}
            selected={positionMode === opt.mode}
            onSelect={onChangeMode}
          />
        ))}
      </div>
    </Card>
  );
}

function PositionOption({
  option,
  selected,
  onSelect,
}: {
  option: typeof POSITION_OPTIONS[number];
  selected: boolean;
  onSelect: (mode: PositionMode) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(option.mode)}
      className={cn(
        'w-full text-left p-4 sm:p-5 rounded-xl sm:rounded-2xl border-2 transition-all',
        selected
          ? `${option.bgColor} ${option.borderColor}`
          : 'bg-white/[0.02] border-theme-border hover:bg-white/[0.04]'
      )}
    >
      <div className="flex items-center gap-3">
        <span className={selected ? option.color : 'text-theme-text-muted'}>{option.icon}</span>
        <div className="flex-1">
          <span className={cn('text-sm font-black', selected ? option.color : 'text-theme-text')}>{option.label}</span>
          <p className="text-[10px] text-theme-text-muted font-bold mt-0.5">{option.desc}</p>
        </div>
        <div className={cn(
          'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all',
          selected ? `${option.borderColor} ${option.bgColor}` : 'border-theme-border'
        )}>
          {selected && <div className="w-2 h-2 rounded-full bg-white" />}
        </div>
      </div>
    </button>
  );
}

function ExecutionPanel({ stockName, stockCode, positionMode, onExecute }: {
  stockName?: string; stockCode?: string;
  positionMode: PositionMode;
  onExecute: () => void;
}) {
  const modeLabel = positionMode === 'full' ? '풀 포지션 (100%)' : positionMode === 'half' ? '하프 포지션 (50%)' : '관망만';
  const modeColor = positionMode === 'full' ? 'text-green-400' : positionMode === 'half' ? 'text-amber-400' : 'text-blue-400';

  return (
    <Card padding="lg">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-purple-500/15 flex items-center justify-center">
          <Crosshair className="w-5 h-5 sm:w-6 sm:h-6 text-purple-400" />
        </div>
        <div>
          <div className="text-base sm:text-lg font-black text-theme-text">집행 확인</div>
          <span className="text-[10px] font-bold text-theme-text-muted">3개 게이트를 모두 통과했습니다. 최종 액션을 확인하세요.</span>
        </div>
      </div>

      <div className="p-4 sm:p-6 bg-white/[0.03] rounded-xl sm:rounded-2xl border border-theme-border mb-6 space-y-3">
        {stockName && (
          <div className="flex justify-between text-sm">
            <span className="font-black text-theme-text-muted">종목</span>
            <span className="font-black text-theme-text">{stockName} {stockCode && <span className="text-theme-text-muted font-mono text-xs">({stockCode})</span>}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="font-black text-theme-text-muted">게이트 통과</span>
          <span className="font-black text-green-400">3 / 3 전부 통과</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="font-black text-theme-text-muted">포지션</span>
          <span className={cn('font-black', modeColor)}>{modeLabel}</span>
        </div>
      </div>

      {positionMode === 'observation' ? (
        <div className="p-4 bg-blue-500/10 border border-blue-500/25 rounded-xl text-center">
          <Eye className="w-6 h-6 text-blue-400 mx-auto mb-2" />
          <p className="text-xs font-black text-blue-400">관망 모드는 모니터링만 기록합니다.</p>
        </div>
      ) : (
        <Button
          variant="primary"
          size="lg"
          icon={<Play className="w-5 h-5" />}
          onClick={onExecute}
          className="w-full py-4 text-base shadow-[0_8px_30px_rgba(249,115,22,0.3)]"
        >
          {positionMode === 'full' ? '풀 포지션 매수 집행' : '하프 포지션 매수 집행'}
        </Button>
      )}
    </Card>
  );
}

function WizardBottomNav({
  activeStep,
  canAccessStep,
  onPrev,
  onNext,
}: {
  activeStep: number;
  canAccessStep: (stepIndex: number) => boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const canGoNext = activeStep < STEPS.length - 1 && canAccessStep(activeStep + 1);
  return (
    <div className="flex items-center justify-between">
      <Button
        variant="ghost"
        size="md"
        onClick={onPrev}
        disabled={activeStep === 0}
      >
        이전
      </Button>
      <div className="text-[10px] font-black text-theme-text-muted tracking-tight">
        {activeStep + 1} / {STEPS.length}
      </div>
      {activeStep < STEPS.length - 1 ? (
        <Button
          variant={canGoNext ? 'primary' : 'secondary'}
          size="md"
          icon={canGoNext ? <ChevronRight className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          onClick={onNext}
          disabled={!canGoNext}
        >
          {canGoNext ? '다음' : '잠김'}
        </Button>
      ) : (
        <div />
      )}
    </div>
  );
}

export function GateWizard({ stockName, stockCode, conditionScores: externalScores, onExecute }: GateWizardProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [scores, setScores] = useState<Record<number, number>>(externalScores || {});
  const [positionMode, setPositionMode] = useState<PositionMode>('full');

  React.useEffect(() => {
    if (externalScores) setScores(externalScores);
  }, [externalScores]);

  const gate1Count = useMemo(() => countPassed(GATE1_IDS, scores), [scores]);
  const gate2Count = useMemo(() => countPassed(GATE2_IDS, scores), [scores]);
  const gate3Count = useMemo(() => countPassed(GATE3_IDS, scores), [scores]);
  const gateStatus = useMemo(() => ({
    gate1Passed: gate1Count >= GATE1_REQUIRED,
    gate2Passed: gate2Count >= GATE2_REQUIRED,
    gate3Passed: gate3Count >= GATE3_REQUIRED,
  }), [gate1Count, gate2Count, gate3Count]);

  const canAccessStep = useCallback((stepIndex: number) => {
    return canAccessGateStep(stepIndex, gateStatus);
  }, [gateStatus]);

  const isStepCompleted = useCallback((stepIndex: number) => {
    return isGateStepCompleted(stepIndex, gateStatus);
  }, [gateStatus]);

  const updateScore = useCallback((id: number, val: number) => {
    setScores(prev => ({ ...prev, [id]: Math.max(0, Math.min(10, val)) }));
  }, []);

  const goNext = useCallback(() => {
    if (activeStep < STEPS.length - 1 && canAccessStep(activeStep + 1)) {
      setActiveStep(prev => prev + 1);
    }
  }, [activeStep, canAccessStep]);

  const goPrev = useCallback(() => {
    if (activeStep > 0) setActiveStep(prev => prev - 1);
  }, [activeStep]);

  const handleExecute = useCallback(() => {
    onExecute?.({
      ...gateStatus,
      positionMode,
      conditionScores: scores,
    });
  }, [gateStatus, onExecute, positionMode, scores]);

  return (
    <div className="space-y-5 sm:space-y-6">
      <StepNavigation
        activeStep={activeStep}
        canAccessStep={canAccessStep}
        isStepCompleted={isStepCompleted}
        onStepChange={setActiveStep}
      />

      <GateProgressStrip
        gate1Count={gate1Count}
        gate2Count={gate2Count}
        gate3Count={gate3Count}
        gate1Passed={gateStatus.gate1Passed}
        gate2Passed={gateStatus.gate2Passed}
        gate3Passed={gateStatus.gate3Passed}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={activeStep}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.2 }}
        >
          <ActiveStepPanel
            activeStep={activeStep}
            scores={scores}
            positionMode={positionMode}
            gate1Count={gate1Count}
            gate2Count={gate2Count}
            gate3Count={gate3Count}
            gate1Passed={gateStatus.gate1Passed}
            gate2Passed={gateStatus.gate2Passed}
            gate3Passed={gateStatus.gate3Passed}
            stockName={stockName}
            stockCode={stockCode}
            onUpdateScore={updateScore}
            onChangeMode={setPositionMode}
            onExecute={handleExecute}
          />
        </motion.div>
      </AnimatePresence>

      <WizardBottomNav
        activeStep={activeStep}
        canAccessStep={canAccessStep}
        onPrev={goPrev}
        onNext={goNext}
      />
    </div>
  );
}
