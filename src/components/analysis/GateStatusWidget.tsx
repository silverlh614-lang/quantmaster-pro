/**
 * GateStatusWidget — 실시간 Gate 통과 현황 미니 위젯
 * StockDetailModal 상단에 배치. 27개 조건 체크리스트 + 실제 값 표시.
 */
import React, { useState, useMemo } from 'react';
import { Shield, TrendingUp, Clock, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../ui/cn';
import { Badge } from '../../ui/badge';
import { ALL_CONDITIONS } from '../../services/quant/evolutionEngine';
import {
  GATE1_IDS, GATE2_IDS, GATE3_IDS,
  GATE1_REQUIRED, GATE2_REQUIRED, GATE3_REQUIRED,
  CONDITION_PASS_THRESHOLD,
} from '../../constants/gateConfig';
import type { StockRecommendation } from '../../services/stockService';

// ── Gate 시각 설정 ──────────────────────────────────────────────────────────

const GATES = [
  {
    label: 'G1', labelKo: '생존필터', ids: GATE1_IDS, required: GATE1_REQUIRED,
    color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/20',
    icon: <Shield className="w-3 h-3" />,
  },
  {
    label: 'G2', labelKo: '성장검증', ids: GATE2_IDS, required: GATE2_REQUIRED,
    color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/20',
    icon: <TrendingUp className="w-3 h-3" />,
  },
  {
    label: 'G3', labelKo: '타이밍', ids: GATE3_IDS, required: GATE3_REQUIRED,
    color: 'text-green-400', bgColor: 'bg-green-500/10', borderColor: 'border-green-500/20',
    icon: <Clock className="w-3 h-3" />,
  },
] as const;

// ── 체크리스트 키 → 조건 ID ─────────────────────────────────────────────────

const CHECKLIST_TO_ID: Record<string, number> = {
  cycleVerified: 1, momentumRanking: 2, roeType3: 3, supplyInflow: 4,
  riskOnEnvironment: 5, ichimokuBreakout: 6, mechanicalStop: 7, economicMoatVerified: 8,
  notPreviousLeader: 9, technicalGoldenCross: 10, volumeSurgeVerified: 11,
  institutionalBuying: 12, consensusTarget: 13, earningsSurprise: 14,
  performanceReality: 15, policyAlignment: 16, psychologicalObjectivity: 17,
  turtleBreakout: 18, fibonacciLevel: 19, elliottWaveVerified: 20,
  ocfQuality: 21, marginAcceleration: 22, interestCoverage: 23,
  relativeStrength: 24, vcpPattern: 25, divergenceCheck: 26, catalystAnalysis: 27,
};

// ── 실제 값 추출 ────────────────────────────────────────────────────────────

const ICHIMOKU_LABEL: Record<string, string> = {
  ABOVE_CLOUD: '구름 위', INSIDE_CLOUD: '구름 안', BELOW_CLOUD: '구름 아래',
};
const MA_LABEL: Record<string, string> = {
  BULLISH: '정배열', BEARISH: '역배열', NEUTRAL: '중립',
};

function getActualValue(id: number, s: StockRecommendation): string | null {
  switch (id) {
    case 2:  return s.momentumRank != null ? `순위 ${s.momentumRank}위` : null;
    case 3:  return s.roeType ? `ROE 유형 ${s.roeType}` : null;
    case 5:  return s.marketSentiment?.vkospi != null ? `VKOSPI ${s.marketSentiment.vkospi.toFixed(1)}` : null;
    case 6:  return s.ichimokuStatus ? ICHIMOKU_LABEL[s.ichimokuStatus] ?? null : null;
    case 10: return s.technicalSignals?.maAlignment ? MA_LABEL[s.technicalSignals.maAlignment] ?? null : null;
    case 11: return s.technicalSignals?.volumeSurge != null ? (s.technicalSignals.volumeSurge ? '급증 감지' : '정상') : null;
    case 13: return s.targetPrice ? `목표가 ${s.targetPrice.toLocaleString()}원` : null;
    case 18: return s.technicalSignals?.rsi != null ? `RSI ${s.technicalSignals.rsi.toFixed(0)}` : null;
    case 24: return s.scores?.momentum != null ? `RS ${s.scores.momentum.toFixed(1)}` : null;
    case 25: return s.technicalSignals?.bbWidth != null ? `BB폭 ${s.technicalSignals.bbWidth.toFixed(2)}` : null;
    default: return null;
  }
}

// ── 점수 추출 ────────────────────────────────────────────────────────────────

function extractScores(stock: StockRecommendation): Record<number, number> {
  const scores: Record<number, number> = {};

  if (stock.checklist) {
    for (const [key, val] of Object.entries(stock.checklist)) {
      const id = CHECKLIST_TO_ID[key];
      if (id != null) {
        scores[id] = typeof val === 'number' ? val : (val ? 10 : 0);
      }
    }
  }

  if (stock.aiConvictionScore?.factors) {
    for (const factor of stock.aiConvictionScore.factors) {
      const normalized = Math.min(10, Math.max(0, factor.score));
      for (const [id, cond] of Object.entries(ALL_CONDITIONS)) {
        if (factor.name.includes(cond.name) && scores[Number(id)] == null) {
          scores[Number(id)] = normalized;
        }
      }
    }
  }

  return scores;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function GateMiniBadge({ label, passed, passedCount, required, bgColor, borderColor, color }: {
  label: string; passed: boolean; passedCount: number; required: number;
  bgColor: string; borderColor: string; color: string;
}) {
  return (
    <div className={cn(
      'flex items-center gap-1 px-2 py-1 rounded-md border text-[9px] font-black',
      passed ? `${bgColor} ${borderColor} ${color}` : 'bg-white/5 border-theme-border text-theme-text-muted'
    )}>
      {passed ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
      {label}
      <span className="font-num">{passedCount}/{required}</span>
    </div>
  );
}

function ConditionRow({ id, score, stock }: { id: number; score: number; stock: StockRecommendation }) {
  const passed = score >= CONDITION_PASS_THRESHOLD;
  const name = ALL_CONDITIONS[id]?.name || `조건 ${id}`;
  const actualVal = getActualValue(id, stock);

  return (
    <div className={cn(
      'flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors',
      passed ? 'bg-green-500/5' : 'bg-white/[0.02]'
    )}>
      <div className={cn(
        'w-4 h-4 rounded-full flex items-center justify-center shrink-0',
        passed ? 'bg-green-500/20' : 'bg-red-500/10'
      )}>
        {passed
          ? <Check className="w-2.5 h-2.5 text-green-400" />
          : <X className="w-2.5 h-2.5 text-red-400/60" />}
      </div>
      <span className={cn(
        'text-[10px] font-bold flex-1 min-w-0 truncate',
        passed ? 'text-theme-text' : 'text-theme-text-muted'
      )}>
        <span className="text-theme-text-muted mr-1 font-num">{id}.</span>
        {name}
      </span>
      {actualVal && (
        <span className={cn('text-[9px] font-num shrink-0', passed ? 'text-green-400/80' : 'text-theme-text-muted')}>
          {actualVal}
        </span>
      )}
      <span className={cn(
        'text-[9px] font-black font-num w-5 text-right shrink-0',
        passed ? 'text-green-400' : score > 0 ? 'text-red-400/70' : 'text-theme-text-muted/40'
      )}>
        {score > 0 ? score : '-'}
      </span>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function GateStatusWidget({ stock }: { stock: StockRecommendation }) {
  const [expanded, setExpanded] = useState(false);
  const scores = useMemo(() => extractScores(stock), [stock]);

  const gateResults = useMemo(() => GATES.map(gate => {
    const passedCount = gate.ids.filter(id => (scores[id] ?? 0) >= CONDITION_PASS_THRESHOLD).length;
    return { ...gate, passedCount, passed: passedCount >= gate.required };
  }), [scores]);

  const totalPassed = Object.values(scores).filter(v => v >= CONDITION_PASS_THRESHOLD).length;
  const overallPercent = Math.round((totalPassed / 27) * 100);

  return (
    <div className="glass-3d rounded-xl overflow-hidden">
      {/* Summary Bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center gap-3 hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-1.5">
          {gateResults.map(g => (
            <GateMiniBadge key={g.label} label={g.label} passed={g.passed}
              passedCount={g.passedCount} required={g.required}
              bgColor={g.bgColor} borderColor={g.borderColor} color={g.color} />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={cn(
            'text-xs font-black font-num',
            overallPercent >= 70 ? 'text-green-400' : overallPercent >= 50 ? 'text-amber-400' : 'text-red-400'
          )}>
            {overallPercent}%
          </span>
          <Badge
            variant={gateResults.every(g => g.passed) ? 'success' : gateResults.some(g => g.passed) ? 'warning' : 'danger'}
            size="sm"
          >
            {gateResults.filter(g => g.passed).length}/3 GATE
          </Badge>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-theme-text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-theme-text-muted" />}
        </div>
      </button>

      {/* Expanded Checklist */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">
              {gateResults.map(gate => (
                <div key={gate.label}>
                  <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-theme-border/30">
                    <span className={cn('shrink-0', gate.color)}>{gate.icon}</span>
                    <span className={cn('text-[10px] font-black uppercase tracking-widest', gate.color)}>
                      {gate.label} — {gate.labelKo}
                    </span>
                    <Badge variant={gate.passed ? 'success' : 'danger'} size="sm" className="ml-auto">
                      {gate.passedCount}/{gate.required} {gate.passed ? 'PASS' : 'FAIL'}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    {gate.ids.map(id => (
                      <ConditionRow key={id} id={id} score={scores[id] ?? 0} stock={stock} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
