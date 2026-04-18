/**
 * GateStatusWidget — 실시간 Gate 통과 현황 미니 위젯
 * StockDetailModal 상단에 배치되어 종목의 27개 조건 충족 여부를
 * 체크리스트 형태로 표시합니다.
 *
 * 각 조건 옆에 실제 값(예: ROE 12.3%, 목표: 15% 이상)이 표시되어
 * 왜 통과/탈락인지 즉시 파악 가능합니다.
 */
import React, { useState } from 'react';
import { Shield, TrendingUp, Clock, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../ui/cn';
import { Badge } from '../../ui/badge';
import { TopBlockersPanel } from '../common/TopBlockersPanel';
import type { StockRecommendation } from '../../services/stockService';
import {
  GATE1_IDS, GATE2_IDS, GATE3_IDS,
  GATE1_REQUIRED, GATE2_REQUIRED, GATE3_REQUIRED,
  CONDITION_PASS_THRESHOLD,
} from '../../constants/gateConfig';

// ── 조건 이름 매핑 ───────────────────────────────────────────────────────

const CONDITION_NAMES: Record<number, string> = {
  1: '주도주 사이클', 2: '모멘텀', 3: 'ROE 유형 3', 4: '수급 질',
  5: '시장 환경 Risk-On', 6: '일목균형표', 7: '기계적 손절 설정', 8: '경제적 해자',
  9: '신규 주도주 여부', 10: '기술적 정배열', 11: '거래량', 12: '기관/외인 수급',
  13: '목표가 여력', 14: '실적 서프라이즈', 15: '실체적 펀더멘털', 16: '정책/매크로',
  17: '심리적 객관성', 18: '터틀 돌파', 19: '피보나치', 20: '엘리엇 파동',
  21: '이익의 질 OCF', 22: '마진 가속도', 23: '재무 방어력 ICR', 24: '상대강도 RS',
  25: 'VCP', 26: '다이버전스', 27: '촉매제',
};

// ── Gate Color Config ───────────────────────────────────────────────────────

interface GateConfig {
  label: string;
  labelKo: string;
  ids: readonly number[];
  required: number;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
}

const GATES: GateConfig[] = [
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

// ── 체크리스트 키 → 조건 ID 매핑 ──────────────────────────────────────────

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

// ── 실제 값 추출 헬퍼 ────────────────────────────────────────────────────

function getActualValue(conditionId: number, stock: StockRecommendation): string | null {
  switch (conditionId) {
    case 2: return stock.momentumRank != null ? `순위 ${stock.momentumRank}위` : null;
    case 3: return stock.roeType ? `ROE 유형 ${stock.roeType}` : null;
    case 5: return stock.marketSentiment?.vkospi != null ? `VKOSPI ${stock.marketSentiment.vkospi.toFixed(1)}` : null;
    case 6: return stock.ichimokuStatus ? `${stock.ichimokuStatus === 'ABOVE_CLOUD' ? '구름 위' : stock.ichimokuStatus === 'INSIDE_CLOUD' ? '구름 안' : '구름 아래'}` : null;
    case 10: return stock.technicalSignals?.maAlignment ? `${stock.technicalSignals.maAlignment === 'BULLISH' ? '정배열' : stock.technicalSignals.maAlignment === 'BEARISH' ? '역배열' : '중립'}` : null;
    case 11: return stock.technicalSignals?.volumeSurge != null ? `${stock.technicalSignals.volumeSurge ? '급증 감지' : '정상'}` : null;
    case 13: return stock.targetPrice ? `목표가 ${stock.targetPrice.toLocaleString()}원` : null;
    case 18: return stock.technicalSignals?.rsi != null ? `RSI ${stock.technicalSignals.rsi.toFixed(0)}` : null;
    case 24: return stock.scores?.momentum != null ? `RS ${stock.scores.momentum.toFixed(1)}` : null;
    case 25: return stock.technicalSignals?.bbWidth != null ? `BB폭 ${stock.technicalSignals.bbWidth.toFixed(2)}` : null;
    default: return null;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface GateStatusWidgetProps {
  stock: StockRecommendation;
}

export function GateStatusWidget({ stock }: GateStatusWidgetProps) {
  const [expanded, setExpanded] = useState(false);

  // 체크리스트에서 점수 추출 (0~10 스케일로 매핑)
  const scores: Record<number, number> = {};
  if (stock.checklist) {
    for (const [key, val] of Object.entries(stock.checklist)) {
      const id = CHECKLIST_TO_ID[key];
      if (id != null) {
        scores[id] = typeof val === 'number' ? val : (val ? 10 : 0);
      }
    }
  }

  // AI conviction score factors가 있으면 보완
  if (stock.aiConvictionScore?.factors) {
    for (const factor of stock.aiConvictionScore.factors) {
      // factor score를 0-10으로 정규화
      const normalized = Math.min(10, Math.max(0, factor.score));
      // 이미 체크리스트에서 설정되지 않은 조건만 보완
      for (const [id, name] of Object.entries(CONDITION_NAMES)) {
        if (factor.name.includes(name) && scores[Number(id)] == null) {
          scores[Number(id)] = normalized;
        }
      }
    }
  }

  // Gate별 통과 현황 계산
  const gateResults = GATES.map(gate => {
    const passedIds = gate.ids.filter(id => (scores[id] ?? 0) >= CONDITION_PASS_THRESHOLD);
    return {
      ...gate,
      passedCount: passedIds.length,
      total: gate.ids.length,
      passed: passedIds.length >= gate.required,
      passedIds: new Set(passedIds),
    };
  });

  const totalPassed = Object.values(scores).filter(v => v >= CONDITION_PASS_THRESHOLD).length;
  const totalConditions = 27;
  const overallPercent = Math.round((totalPassed / totalConditions) * 100);

  return (
    <div className="glass-3d rounded-xl overflow-hidden">
      {/* Summary Bar (always visible) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center gap-3 hover:bg-white/[0.03] transition-colors"
      >
        {/* Gate Mini Badges */}
        <div className="flex items-center gap-1.5">
          {gateResults.map((g) => (
            <div
              key={g.label}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md border text-[9px] font-black',
                g.passed
                  ? `${g.bgColor} ${g.borderColor} ${g.color}`
                  : 'bg-white/5 border-theme-border text-theme-text-muted'
              )}
            >
              {g.passed ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
              {g.label}
              <span className="font-num">{g.passedCount}/{g.required}</span>
            </div>
          ))}
        </div>

        {/* Overall Score */}
        <div className="ml-auto flex items-center gap-2">
          <span className={cn(
            'text-xs font-black font-num',
            overallPercent >= 70 ? 'text-green-400' :
            overallPercent >= 50 ? 'text-amber-400' : 'text-red-400'
          )}>
            {overallPercent}%
          </span>
          <Badge
            variant={
              gateResults.every(g => g.passed) ? 'success' :
              gateResults.some(g => g.passed) ? 'warning' : 'danger'
            }
            size="sm"
          >
            {gateResults.filter(g => g.passed).length}/3 GATE
          </Badge>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-theme-text-muted" />
            : <ChevronDown className="w-3.5 h-3.5 text-theme-text-muted" />
          }
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
              {/* 오늘 가장 많이 탈락시킨 조건 TOP 3 — 증상이 아닌 원인 노출 */}
              <TopBlockersPanel limit={3} />

              {gateResults.map((gate) => (
                <div key={gate.label}>
                  {/* Gate Header */}
                  <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-theme-border/30">
                    <span className={cn('shrink-0', gate.color)}>{gate.icon}</span>
                    <span className={cn('text-[10px] font-black uppercase tracking-widest', gate.color)}>
                      {gate.label} — {gate.labelKo}
                    </span>
                    <Badge
                      variant={gate.passed ? 'success' : 'danger'}
                      size="sm"
                      className="ml-auto"
                    >
                      {gate.passedCount}/{gate.required} {gate.passed ? 'PASS' : 'FAIL'}
                    </Badge>
                  </div>

                  {/* Condition Checklist */}
                  <div className="space-y-1">
                    {gate.ids.map((id) => {
                      const score = scores[id] ?? 0;
                      const passed = score >= CONDITION_PASS_THRESHOLD;
                      const name = CONDITION_NAMES[id] || `조건 ${id}`;
                      const actualVal = getActualValue(id, stock);

                      return (
                        <div
                          key={id}
                          className={cn(
                            'flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors',
                            passed ? 'bg-green-500/5' : 'bg-white/[0.02]'
                          )}
                        >
                          {/* Pass/Fail Icon */}
                          <div className={cn(
                            'w-4 h-4 rounded-full flex items-center justify-center shrink-0',
                            passed ? 'bg-green-500/20' : 'bg-red-500/10'
                          )}>
                            {passed
                              ? <Check className="w-2.5 h-2.5 text-green-400" />
                              : <X className="w-2.5 h-2.5 text-red-400/60" />
                            }
                          </div>

                          {/* Condition Name */}
                          <span className={cn(
                            'text-[10px] font-bold flex-1 min-w-0 truncate',
                            passed ? 'text-theme-text' : 'text-theme-text-muted'
                          )}>
                            <span className="text-theme-text-muted mr-1 font-num">{id}.</span>
                            {name}
                          </span>

                          {/* Actual Value */}
                          {actualVal && (
                            <span className={cn(
                              'text-[9px] font-num shrink-0',
                              passed ? 'text-green-400/80' : 'text-theme-text-muted'
                            )}>
                              {actualVal}
                            </span>
                          )}

                          {/* Score */}
                          <span className={cn(
                            'text-[9px] font-black font-num w-5 text-right shrink-0',
                            passed ? 'text-green-400' : score > 0 ? 'text-red-400/70' : 'text-theme-text-muted/40'
                          )}>
                            {score > 0 ? score : '-'}
                          </span>
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
