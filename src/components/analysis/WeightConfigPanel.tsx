/**
 * WeightConfigPanel — 27조건 팩터 가중치 컨트롤 패널
 *
 * Quantus PER/PBR 가중치 UI를 27개 마스터 조건에 적용.
 * 각 조건이 카드 형태로 펼쳐지고, 0~10 가중치 슬라이더 +
 * VKOSPI/레짐에 따른 동적 추천 가중치가 함께 표시된다.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  SlidersHorizontal, RotateCcw, Zap, Shield, TrendingUp, Clock,
  ChevronDown, ChevronUp, AlertTriangle, Sparkles, Brain, Cpu,
  ArrowUp, ArrowDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../ui/cn';
import { Card } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { ALL_CONDITIONS, CONDITION_SOURCE_MAP } from '../../services/quant/evolutionEngine';
import { VKOSPI } from '../../constants/thresholds';
import { GATE1_IDS, GATE2_IDS, GATE3_IDS } from '../../constants/gateConfig';

// ── Gate assignment map ─────────────────────────────────────────────────────

function getGate(id: number): 1 | 2 | 3 {
  if ((GATE1_IDS as readonly number[]).includes(id)) return 1;
  if ((GATE2_IDS as readonly number[]).includes(id)) return 2;
  return 3;
}

const GATE_META: Record<1 | 2 | 3, { label: string; color: string; bgColor: string; borderColor: string; icon: React.ReactNode }> = {
  1: { label: 'Gate 1 생존', color: 'text-red-400', bgColor: 'bg-red-500/12', borderColor: 'border-red-500/30', icon: <Shield className="w-3.5 h-3.5" /> },
  2: { label: 'Gate 2 성장', color: 'text-amber-400', bgColor: 'bg-amber-500/12', borderColor: 'border-amber-500/30', icon: <TrendingUp className="w-3.5 h-3.5" /> },
  3: { label: 'Gate 3 타이밍', color: 'text-green-400', bgColor: 'bg-green-500/12', borderColor: 'border-green-500/30', icon: <Clock className="w-3.5 h-3.5" /> },
};

// ── VKOSPI-based dynamic recommended weights ────────────────────────────────

function computeRecommendedWeights(vkospi: number): Record<number, number> {
  const rec: Record<number, number> = {};

  for (let id = 1; id <= 27; id++) {
    const base = ALL_CONDITIONS[id]?.baseWeight ?? 1.0;
    let multiplier = 1.0;

    // VKOSPI regime adjustments
    if (vkospi >= VKOSPI.EXTREME) {
      // Crisis: risk management conditions maxed out
      if (id === 7 || id === 23) multiplier = 2.0;   // stop loss, ICR
      if (id === 5) multiplier = 1.8;                 // risk-on check
      if (id === 17) multiplier = 1.5;                // psychological objectivity
      if (id === 2 || id === 24) multiplier = 0.5;    // momentum less relevant
      if (id === 25 || id === 18) multiplier = 0.6;   // VCP/Turtle less reliable
    } else if (vkospi >= VKOSPI.FEAR) {
      // High volatility: defensive bias
      if (id === 7 || id === 23) multiplier = 1.5;
      if (id === 5) multiplier = 1.3;
      if (id === 2 || id === 24) multiplier = 0.7;
    } else if (vkospi >= VKOSPI.ELEVATED) {
      // Cautious
      if (id === 7) multiplier = 1.3;
      if (id === 17) multiplier = 1.2;
    } else if (vkospi < 15) {
      // Ultra-calm: growth conditions boosted
      if (id === 2 || id === 24) multiplier = 1.5;    // momentum, RS
      if (id === 3 || id === 14 || id === 15) multiplier = 1.3; // ROE, earnings
      if (id === 25) multiplier = 1.3;                // VCP
      if (id === 7) multiplier = 0.8;                 // less stop-loss pressure
    } else {
      // Calm normal
      if (id === 2 || id === 24) multiplier = 1.2;
    }

    rec[id] = Math.round(Math.min(10, Math.max(0.1, base * multiplier)) * 10) / 10;
  }

  return rec;
}

// ── VKOSPI Regime label ─────────────────────────────────────────────────────

function getVkospiLabel(v: number): { label: string; color: string } {
  if (v >= VKOSPI.EXTREME) return { label: 'EXTREME FEAR', color: 'text-red-500' };
  if (v >= VKOSPI.FEAR) return { label: 'FEAR', color: 'text-red-400' };
  if (v >= VKOSPI.ELEVATED) return { label: 'ELEVATED', color: 'text-amber-400' };
  if (v >= VKOSPI.CALM) return { label: 'CALM', color: 'text-green-400' };
  return { label: 'ULTRA CALM', color: 'text-blue-400' };
}

// ── Types ───────────────────────────────────────────────────────────────────

type GroupBy = 'gate' | 'all';

interface WeightConfigPanelProps {
  /** User-set weights (condition ID → weight). Falls back to baseWeight if absent. */
  weights: Record<number, number>;
  /** Called when user changes any weight */
  onWeightsChange: (weights: Record<number, number>) => void;
  /** Current VKOSPI value for dynamic recommendations */
  vkospi?: number;
}

// ═════════════════════════════════════════════════════════════════════════════

export function WeightConfigPanel({ weights, onWeightsChange, vkospi = 18 }: WeightConfigPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('gate');

  const recommended = useMemo(() => computeRecommendedWeights(vkospi), [vkospi]);
  const vkLabel = useMemo(() => getVkospiLabel(vkospi), [vkospi]);

  // Number of user-modified weights
  const modifiedCount = useMemo(() => {
    return Object.keys(weights).filter(k => {
      const id = parseInt(k);
      const base = ALL_CONDITIONS[id]?.baseWeight ?? 1;
      return Math.abs((weights[id] ?? base) - base) > 0.01;
    }).length;
  }, [weights]);

  const getWeight = useCallback((id: number) => weights[id] ?? ALL_CONDITIONS[id]?.baseWeight ?? 1, [weights]);

  const setWeight = useCallback((id: number, val: number) => {
    onWeightsChange({ ...weights, [id]: Math.round(Math.max(0.1, Math.min(10, val)) * 10) / 10 });
  }, [weights, onWeightsChange]);

  const applyRecommended = useCallback(() => {
    onWeightsChange({ ...recommended });
  }, [recommended, onWeightsChange]);

  const resetToDefaults = useCallback(() => {
    const defaults: Record<number, number> = {};
    for (let id = 1; id <= 27; id++) {
      defaults[id] = ALL_CONDITIONS[id]?.baseWeight ?? 1;
    }
    onWeightsChange(defaults);
  }, [onWeightsChange]);

  // Build grouped condition lists
  const gateGroups = useMemo(() => {
    if (groupBy === 'all') {
      return [{ gate: 0 as 1 | 2 | 3, ids: Array.from({ length: 27 }, (_, i) => i + 1) }];
    }
    return [
      { gate: 1 as const, ids: GATE1_IDS },
      { gate: 2 as const, ids: GATE2_IDS },
      { gate: 3 as const, ids: GATE3_IDS },
    ];
  }, [groupBy]);

  return (
    <Card padding="none" className="overflow-visible">
      {/* ── Collapsed Header ──────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center gap-3 sm:gap-4 p-4 sm:p-5 hover:bg-white/[0.02] transition-colors"
      >
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center bg-orange-500/12 shrink-0">
          <SlidersHorizontal className="w-5 h-5 text-orange-400" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-micro">팩터 가중치 컨트롤</span>
            <Badge variant="info" size="sm">27 CONDITIONS</Badge>
            {modifiedCount > 0 && (
              <Badge variant="warning" size="sm">{modifiedCount} 수정됨</Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="font-black text-theme-text-muted">VKOSPI</span>
            <span className={cn('font-black font-mono tabular-nums', vkLabel.color)}>{vkospi.toFixed(1)}</span>
            <span className={cn('text-[10px] font-black uppercase tracking-wider', vkLabel.color)}>{vkLabel.label}</span>
          </div>
        </div>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-5 h-5 text-theme-text-muted shrink-0" />
        </motion.div>
      </button>

      {/* ── Expanded Panel ────────────────────────────────────────────── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 sm:px-5 pb-5 sm:pb-6 space-y-5">
              <div className="h-px bg-theme-border" />

              {/* ── VKOSPI Indicator + Actions ───────────────────────── */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
                {/* VKOSPI bar */}
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest">VKOSPI 레짐</span>
                    <span className={cn('text-xs font-black font-mono', vkLabel.color)}>{vkospi.toFixed(1)}</span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden bg-white/5 border border-theme-border relative">
                    {/* Zone backgrounds */}
                    <div className="absolute inset-0 flex">
                      <div className="bg-blue-500/20" style={{ width: '30%' }} />
                      <div className="bg-green-500/20" style={{ width: '20%' }} />
                      <div className="bg-amber-500/20" style={{ width: '20%' }} />
                      <div className="bg-red-500/20" style={{ width: '20%' }} />
                      <div className="bg-red-600/30" style={{ width: '10%' }} />
                    </div>
                    {/* Indicator */}
                    <motion.div
                      className="absolute top-0 bottom-0 w-1 bg-white rounded-full shadow-[0_0_6px_rgba(255,255,255,0.6)]"
                      animate={{ left: `${Math.min(100, Math.max(0, (vkospi / 45) * 100))}%` }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-[8px] font-black text-theme-text-muted uppercase tracking-wider">
                    <span>ULTRA CALM</span>
                    <span>CALM</span>
                    <span>ELEVATED</span>
                    <span>FEAR</span>
                    <span>EXTREME</span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 shrink-0">
                  <Button variant="secondary" size="sm" icon={<Sparkles className="w-3 h-3" />} onClick={applyRecommended}>
                    추천 적용
                  </Button>
                  <Button variant="ghost" size="sm" icon={<RotateCcw className="w-3 h-3" />} onClick={resetToDefaults}>
                    초기화
                  </Button>
                </div>
              </div>

              {/* ── Group Toggle ──────────────────────────────────────── */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setGroupBy('gate')}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all',
                    groupBy === 'gate'
                      ? 'bg-orange-500/15 border-orange-500/40 text-orange-400'
                      : 'bg-white/5 border-theme-border text-theme-text-muted hover:bg-white/10'
                  )}
                >
                  Gate별 그룹
                </button>
                <button
                  type="button"
                  onClick={() => setGroupBy('all')}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all',
                    groupBy === 'all'
                      ? 'bg-orange-500/15 border-orange-500/40 text-orange-400'
                      : 'bg-white/5 border-theme-border text-theme-text-muted hover:bg-white/10'
                  )}
                >
                  전체 목록
                </button>
              </div>

              {/* ── Condition Cards ───────────────────────────────────── */}
              {gateGroups.map((group) => {
                const meta = group.gate > 0 ? GATE_META[group.gate] : null;
                return (
                  <div key={group.gate}>
                    {meta && (
                      <div className="flex items-center gap-2 mb-3">
                        <span className={meta.color}>{meta.icon}</span>
                        <span className={cn('text-[10px] font-black uppercase tracking-widest', meta.color)}>{meta.label}</span>
                        <span className="text-[10px] font-bold text-theme-text-muted">({group.ids.length}개 조건)</span>
                      </div>
                    )}
                    <div className="space-y-2">
                      {group.ids.map((id) => (
                        <ConditionWeightCard
                          key={id}
                          id={id}
                          weight={getWeight(id)}
                          recommended={recommended[id] ?? ALL_CONDITIONS[id]?.baseWeight ?? 1}
                          baseWeight={ALL_CONDITIONS[id]?.baseWeight ?? 1}
                          onWeightChange={(val) => setWeight(id, val)}
                          gate={getGate(id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Individual Condition Weight Card
// ═════════════════════════════════════════════════════════════════════════════

function ConditionWeightCard({ id, weight, recommended, baseWeight, onWeightChange, gate }: {
  id: number;
  weight: number;
  recommended: number;
  baseWeight: number;
  onWeightChange: (val: number) => void;
  gate: 1 | 2 | 3;
}) {
  const cond = ALL_CONDITIONS[id];
  const source = CONDITION_SOURCE_MAP[id];
  const meta = GATE_META[gate];
  const isModified = Math.abs(weight - baseWeight) > 0.01;
  const diffFromRec = weight - recommended;

  return (
    <div className={cn(
      'flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border transition-all',
      isModified ? `${meta.bgColor} ${meta.borderColor}` : 'bg-white/[0.02] border-theme-border hover:bg-white/[0.04]'
    )}>
      {/* ID + Name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn('text-[10px] font-black uppercase tracking-wider shrink-0', meta.color)}>
            {id.toString().padStart(2, '0')}
          </span>
          <span className="text-xs font-black text-theme-text truncate">
            {cond?.name || `조건 ${id}`}
          </span>
          {source === 'COMPUTED' ? (
            <Cpu className="w-3 h-3 text-blue-400 shrink-0" title="실계산" />
          ) : (
            <Brain className="w-3 h-3 text-purple-400 shrink-0" title="AI 추정" />
          )}
        </div>
        <p className="text-[9px] text-theme-text-muted font-medium truncate">
          {cond?.description || ''}
        </p>
      </div>

      {/* Recommended badge */}
      <div className="hidden sm:flex flex-col items-center gap-0.5 shrink-0 w-14">
        <span className="text-[8px] font-black text-theme-text-muted uppercase tracking-wider">추천</span>
        <span className={cn(
          'text-xs font-black font-mono tabular-nums',
          Math.abs(diffFromRec) < 0.1 ? 'text-green-400' : 'text-amber-400'
        )}>
          {recommended.toFixed(1)}
        </span>
      </div>

      {/* Weight controls */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onWeightChange(weight - 0.5)}
          disabled={weight <= 0.1}
          className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-white/5 border border-theme-border flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-30"
        >
          <ArrowDown className="w-3 h-3 text-theme-text-muted" />
        </button>

        <input
          type="range"
          min={0.1} max={10} step={0.1}
          value={weight}
          onChange={(e) => onWeightChange(parseFloat(e.target.value))}
          className={cn(
            'w-16 sm:w-24 h-1.5 rounded-full appearance-none cursor-pointer',
            isModified ? 'bg-orange-500/20 accent-orange-500' : 'bg-white/10 accent-white',
            '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4',
            '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer',
            isModified
              ? '[&::-webkit-slider-thumb]:bg-orange-500 [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(249,115,22,0.4)]'
              : '[&::-webkit-slider-thumb]:bg-white/60',
          )}
        />

        <button
          type="button"
          onClick={() => onWeightChange(weight + 0.5)}
          disabled={weight >= 10}
          className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-white/5 border border-theme-border flex items-center justify-center hover:bg-white/10 transition-colors disabled:opacity-30"
        >
          <ArrowUp className="w-3 h-3 text-theme-text-muted" />
        </button>

        <span className={cn(
          'w-9 text-center text-sm font-black font-mono tabular-nums',
          isModified ? 'text-orange-400' : 'text-theme-text'
        )}>
          {weight.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
