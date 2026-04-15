/**
 * GateStatusWidget — 실시간 Gate 통과 현황 미니 위젯
 * 27개 조건 체크리스트를 3-Gate 구조로 시각화합니다.
 */
import React, { useState } from 'react';
import { Shield, TrendingUp, Clock, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../ui/cn';
import { Badge } from '../../ui/badge';
import {
  GATE1_IDS, GATE2_IDS, GATE3_IDS,
  GATE1_REQUIRED, GATE2_REQUIRED, GATE3_REQUIRED,
  CONDITION_PASS_THRESHOLD,
} from '../../constants/gateConfig';
import type { StockRecommendation } from '../../services/stock/types';

// ─── Condition Labels ──────────────────────────────────────────────────────

const CONDITION_LABELS: Record<number, string> = {
  1: '사이클 검증', 2: '모멘텀 랭킹', 3: 'ROE 3기연속',
  4: '수급 유입', 5: '리스크 온 환경', 6: '일목균형 돌파',
  7: '기계적 손절', 8: '경제적 해자', 9: '전 대장주 제외',
  10: '골든크로스', 11: '거래량 급증', 12: '기관 매수',
  13: '컨센서스 목표', 14: '어닝 서프라이즈', 15: '실적 리얼리티',
  16: '정책 부합', 17: '심리 객관성', 18: '터틀 돌파',
  19: '피보나치 레벨', 20: '엘리어트 파동', 21: 'OCF 퀄리티',
  22: '마진 가속', 23: '이자 보상배율', 24: '상대 강도',
  25: 'VCP 패턴', 26: '다이버전스', 27: '촉매 분석',
};

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

// ─── Gate Config ───────────────────────────────────────────────────────────

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
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function getScoresFromStock(stock: StockRecommendation): Record<number, number> {
  const scores: Record<number, number> = {};

  if (stock.checklist) {
    for (const [key, val] of Object.entries(stock.checklist)) {
      const id = CHECKLIST_TO_ID[key];
      if (id != null) {
        scores[id] = typeof val === 'number' ? val : (val ? 10 : 0);
      }
    }
  }

  return scores;
}

function getGateResult(ids: readonly number[], required: number, scores: Record<number, number>) {
  const passed = ids.filter(id => (scores[id] ?? 0) >= CONDITION_PASS_THRESHOLD).length;
  return { passed, total: ids.length, required, ok: passed >= required };
}

// ─── Component ─────────────────────────────────────────────────────────────

interface GateStatusWidgetProps {
  stock: StockRecommendation;
}

export function GateStatusWidget({ stock }: GateStatusWidgetProps) {
  const [expanded, setExpanded] = useState(false);

  const scores = getScoresFromStock(stock);
  const gateResults = GATES.map(gate => ({
    ...gate,
    ...getGateResult(gate.ids, gate.required, scores),
  }));

  const totalPassed = gateResults.reduce((sum, g) => sum + g.passed, 0);
  const totalConditions = gateResults.reduce((sum, g) => sum + g.total, 0);
  const overallPercent = totalConditions > 0 ? Math.round((totalPassed / totalConditions) * 100) : 0;

  return (
    <div className="rounded-xl border border-theme-border/30 bg-white/[0.02] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center gap-3 hover:bg-white/[0.03] transition-colors"
      >
        {/* Gate dots */}
        <div className="flex items-center gap-1.5">
          {gateResults.map((g, i) => (
            <div
              key={i}
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black',
                g.ok ? g.bgColor : 'bg-white/5',
                g.ok ? g.color : 'text-theme-text-muted'
              )}
            >
              {g.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className={cn(
            'text-sm font-black font-num',
            overallPercent >= 70 ? 'text-green-400' : overallPercent >= 50 ? 'text-amber-400' : 'text-red-400'
          )}>
            {overallPercent}%
          </span>
          <Badge
            variant={gateResults.filter(g => g.ok).length === 3 ? 'success' : gateResults.filter(g => g.ok).length >= 2 ? 'warning' : 'danger'}
            size="sm"
          >
            {gateResults.filter(g => g.ok).length}/3 GATE
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
              {gateResults.map((gate, gi) => (
                <div key={gi}>
                  <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-theme-border/30">
                    <span className={cn('shrink-0', gate.color)}>{gate.icon}</span>
                    <span className={cn('text-[10px] font-black uppercase tracking-widest', gate.color)}>
                      {gate.label} — {gate.labelKo}
                    </span>
                    <span className="text-[9px] text-theme-text-muted ml-auto font-num">
                      {gate.passed}/{gate.total} (필수 {gate.required})
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {gate.ids.map(id => {
                      const score = scores[id] ?? 0;
                      const passed = score >= CONDITION_PASS_THRESHOLD;
                      return (
                        <div
                          key={id}
                          className={cn(
                            'flex items-center gap-1.5 px-2 py-1 rounded text-[10px]',
                            passed ? 'text-green-400/80' : 'text-red-400/50'
                          )}
                        >
                          {passed
                            ? <Check className="w-3 h-3 text-green-400 shrink-0" />
                            : <X className="w-3 h-3 text-red-400/40 shrink-0" />}
                          <span className="truncate">{CONDITION_LABELS[id] ?? `#${id}`}</span>
                          <span className="ml-auto font-num text-[9px] opacity-60">{score}</span>
                        </div>
                      );
                    })}
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
