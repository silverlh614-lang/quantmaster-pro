// @responsibility ADR-0432 Shadow Learning Promotion Recommendations 회귀 테스트.
//
// 사용자 §I 정합 — 18+ 케이스 + 정적 안전 가드.
// 핵심 invariant — recommendation only, LIVE/PAPER/normal shadow 체결 영향 0.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  buildShadowLearningPromotionRecommendations,
  formatShadowLearningPromotionMessage,
  formatShadowLearningPromotionSummaryLine,
  isShadowLearningPromotionDisabled,
  SHADOW_PROMOTION_THRESHOLDS,
  type ShadowLearningPromotionAction,
  type ShadowLearningPromotionCandidate,
} from './shadowLearningPromotionRecommendation.js';
import type {
  ProvisionalShadowPerformanceRecord,
  ProvisionalShadowHorizon,
  ProvisionalShadowPointStatus,
} from './provisionalShadowPerformanceReport.js';
import type {
  CounterfactualShadowPerformanceRecord,
  CounterfactualShadowHorizon,
  CounterfactualShadowPointStatus,
} from './counterfactualShadowLearningPerformanceReport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SSOT_PATH = join(__dirname, 'shadowLearningPromotionRecommendation.ts');
const SSOT_SOURCE = readFileSync(SSOT_PATH, 'utf-8');

const NOW = '2026-05-08T15:00:00+09:00';

function makeProvisionalPoint(
  horizon: ProvisionalShadowHorizon,
  returnPct: number | undefined,
  status: ProvisionalShadowPointStatus = 'OBSERVED',
) {
  if (status === 'OBSERVED' && returnPct !== undefined) {
    return {
      horizon,
      observedAtKst: '2026-05-07T11:00:00+09:00',
      price: 100 + returnPct,
      returnPct,
      available: true,
      status: 'OBSERVED' as const,
    };
  }
  return { horizon, available: false, status };
}

function makeProvisionalRecord(
  overrides: Partial<ProvisionalShadowPerformanceRecord> = {},
  pointReturns: Partial<Record<ProvisionalShadowHorizon, number>> = {},
): ProvisionalShadowPerformanceRecord {
  const horizons: ProvisionalShadowHorizon[] = [
    'T_PLUS_30M',
    'T_PLUS_1H',
    'SAME_DAY_CLOSE',
    'NEXT_OPEN',
    'T_PLUS_1D_CLOSE',
    'T_PLUS_3D_CLOSE',
  ];
  const points = horizons.map((h) =>
    h in pointReturns
      ? makeProvisionalPoint(h, pointReturns[h], 'OBSERVED')
      : makeProvisionalPoint(h, undefined, 'PENDING'),
  );
  const observed = points.filter((p) => p.status === 'OBSERVED' && p.returnPct !== undefined);
  const best =
    observed.length > 0
      ? Math.max(...observed.map((p) => p.returnPct ?? 0))
      : undefined;
  const worst =
    observed.length > 0
      ? Math.min(...observed.map((p) => p.returnPct ?? 0))
      : undefined;
  const latest = observed.length > 0 ? observed[observed.length - 1].returnPct : undefined;
  return {
    id: 'prov-001',
    symbol: '005930',
    name: '삼성전자',
    entryAtKst: '2026-05-07T10:00:00+09:00',
    label: 'R3_PROVISIONAL_LEADER_DATA_DEGRADED',
    source: 'ADR-0426',
    reasons: ['R3_EARLY', 'GATE1_SURVIVOR'],
    points,
    summary: {
      ...(best !== undefined ? { bestReturnPct: best } : {}),
      ...(worst !== undefined ? { worstReturnPct: worst } : {}),
      ...(latest !== undefined ? { latestReturnPct: latest } : {}),
      ...(observed.length === 0
        ? { status: 'PENDING' as const }
        : observed.length === horizons.length
          ? { status: 'COMPLETE' as const }
          : { status: 'PARTIAL' as const }),
    },
    ...overrides,
  };
}

function makeCounterfactualPoint(
  horizon: CounterfactualShadowHorizon,
  returnPct: number | undefined,
  status: CounterfactualShadowPointStatus = 'OBSERVED',
) {
  if (status === 'OBSERVED' && returnPct !== undefined) {
    return {
      horizon,
      observedAtKst: '2026-05-07T11:00:00+09:00',
      price: 100 + returnPct,
      returnPct,
      available: true,
      status: 'OBSERVED' as const,
    };
  }
  return { horizon, available: false, status };
}

function makeCounterfactualRecord(
  overrides: Partial<CounterfactualShadowPerformanceRecord> = {},
  pointReturns: Partial<Record<CounterfactualShadowHorizon, number>> = {},
): CounterfactualShadowPerformanceRecord {
  const horizons: CounterfactualShadowHorizon[] = [
    'T_PLUS_30M',
    'T_PLUS_1H',
    'SAME_DAY_CLOSE',
    'NEXT_OPEN',
    'T_PLUS_1D_CLOSE',
    'T_PLUS_3D_CLOSE',
  ];
  const points = horizons.map((h) =>
    h in pointReturns
      ? makeCounterfactualPoint(h, pointReturns[h], 'OBSERVED')
      : makeCounterfactualPoint(h, undefined, 'PENDING'),
  );
  const observed = points.filter((p) => p.status === 'OBSERVED' && p.returnPct !== undefined);
  const best =
    observed.length > 0
      ? Math.max(...observed.map((p) => p.returnPct ?? 0))
      : undefined;
  const worst =
    observed.length > 0
      ? Math.min(...observed.map((p) => p.returnPct ?? 0))
      : undefined;
  const latest = observed.length > 0 ? observed[observed.length - 1].returnPct : undefined;
  return {
    id: 'cf-001',
    symbol: '005930',
    name: '삼성전자',
    entryAtKst: '2026-05-07T10:00:00+09:00',
    label: 'R3_COUNTERFACTUAL_UNDER_SELL_ONLY',
    source: 'ADR-0430',
    learningOnly: true,
    executionShadow: false,
    virtualAccountImpact: 'NONE',
    reasons: ['R3_EARLY', 'SELL_ONLY'],
    blockedBy: ['SELL_ONLY'],
    points,
    summary: {
      ...(best !== undefined ? { bestReturnPct: best } : {}),
      ...(worst !== undefined ? { worstReturnPct: worst } : {}),
      ...(latest !== undefined ? { latestReturnPct: latest } : {}),
      ...(observed.length === 0
        ? { status: 'PENDING' as const }
        : observed.length === horizons.length
          ? { status: 'COMPLETE' as const }
          : { status: 'PARTIAL' as const }),
    },
    ...overrides,
  };
}

describe('ADR-0432 Shadow Learning Promotion Recommendations', () => {
  // ──────────────────────────────────────────────────────────────────────
  // 1. observed point 0개 → INSUFFICIENT_DATA
  // ──────────────────────────────────────────────────────────────────────
  it('§C-1: observed point=0 + 일부 DATA_UNAVAILABLE → INSUFFICIENT_DATA (PENDING 아님)', () => {
    // 모든 horizon DATA_UNAVAILABLE
    const record = makeProvisionalRecord();
    record.points = record.points.map((p) => ({ ...p, status: 'DATA_UNAVAILABLE' as const }));
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [record],
      nowKst: NOW,
    });
    expect(summary.totalEvaluated).toBe(1);
    expect(summary.insufficientData).toBe(1);
    expect(summary.candidates[0].action).toBe('INSUFFICIENT_DATA');
    expect(summary.candidates[0].reasons).toContain('INSUFFICIENT_OBSERVED_POINTS');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. 모든 horizon PENDING → action='PENDING' (INSUFFICIENT_DATA 와 분리)
  // ──────────────────────────────────────────────────────────────────────
  it('§C-1: 모든 horizon PENDING → action="PENDING" (insufficientData 카운트 0)', () => {
    const record = makeProvisionalRecord(); // pointReturns 비움 → 모두 PENDING
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [record],
      nowKst: NOW,
    });
    expect(summary.totalEvaluated).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.insufficientData).toBe(0);
    expect(summary.candidates[0].action).toBe('PENDING');
    expect(summary.candidates[0].reasons).toContain('PENDING_HORIZONS');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. PROMOTE_TO_ENHANCED_WATCH — observed≥2 + avg>0 + best≥1.0 + winRate≥0.5 + worst>-1.5
  // ──────────────────────────────────────────────────────────────────────
  it('§C-2: ENHANCED_WATCH — observed=2, best=1.4, worst=-0.6, winRate=50%', () => {
    const record = makeProvisionalRecord(
      {},
      { T_PLUS_30M: 1.4, T_PLUS_1H: -0.6 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [record],
      nowKst: NOW,
    });
    expect(summary.candidates[0].action).toBe('PROMOTE_TO_ENHANCED_WATCH');
    expect(summary.promoteToEnhancedWatch).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 4. PROMOTE_TO_NORMAL_SHADOW_WATCH — observed≥3 + avg≥0.5 + winRate≥0.6 + latest≥0 + worst>-2.0
  // ──────────────────────────────────────────────────────────────────────
  it('§C-3: NORMAL_SHADOW_WATCH — multi-horizon strength', () => {
    const record = makeCounterfactualRecord(
      {},
      { T_PLUS_30M: 1.0, T_PLUS_1H: 0.8, SAME_DAY_CLOSE: 0.6 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      counterfactualRecords: [record],
      nowKst: NOW,
    });
    expect(summary.candidates[0].action).toBe('PROMOTE_TO_NORMAL_SHADOW_WATCH');
    expect(summary.promoteToNormalShadowWatch).toBe(1);
    expect(summary.candidates[0].reasons).toContain('MULTI_HORIZON_STRENGTH');
    // SELL_ONLY counterfactual 추가 진단
    expect(summary.candidates[0].reasons).toContain('SELL_ONLY_OVERDEFENSE_SIGNAL');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 5. REJECT_LEARNING_HYPOTHESIS — observed≥2 + avg<-1.0 + winRate≤0.33 + worst≤-2.5
  // ──────────────────────────────────────────────────────────────────────
  it('§C-4: REJECT_LEARNING_HYPOTHESIS — negative follow-through', () => {
    const record = makeCounterfactualRecord(
      {},
      { T_PLUS_30M: -1.5, T_PLUS_1H: -3.0, SAME_DAY_CLOSE: -2.0 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      counterfactualRecords: [record],
      nowKst: NOW,
    });
    expect(summary.candidates[0].action).toBe('REJECT_LEARNING_HYPOTHESIS');
    expect(summary.rejectLearningHypothesis).toBe(1);
    expect(summary.candidates[0].reasons).toContain('NEGATIVE_FOLLOW_THROUGH');
    expect(summary.candidates[0].reasons).toContain('HIGH_ADVERSE_EXCURSION');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 6. KEEP_LEARNING_ONLY — 애매한 성과
  // ──────────────────────────────────────────────────────────────────────
  it('§C-5: KEEP_LEARNING_ONLY — 임계 어디에도 안 맞음', () => {
    // observed=2, avg=+0.2, winRate=50%, best=0.5 (ENHANCED_MIN_BEST=1.0 미달)
    const record = makeProvisionalRecord(
      {},
      { T_PLUS_30M: 0.5, T_PLUS_1H: -0.1 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [record],
      nowKst: NOW,
    });
    expect(summary.candidates[0].action).toBe('KEEP_LEARNING_ONLY');
    expect(summary.keepLearningOnly).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 7. PENDING 은 avg/winRate 계산에서 제외 (observed only 분모)
  // ──────────────────────────────────────────────────────────────────────
  it('§I-6: PENDING/DATA_UNAVAILABLE 은 avg/winRate 분모에서 제외', () => {
    // observed 1건만 + 5건 PENDING. avg = +2.0 정확.
    const record = makeProvisionalRecord({}, { T_PLUS_30M: 2.0 });
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [record],
      nowKst: NOW,
    });
    expect(summary.candidates[0].avgObservedReturnPct).toBeCloseTo(2.0, 1);
    expect(summary.candidates[0].winRateObserved).toBe(1);
    // observed=1 + ENHANCED_MIN_OBSERVED=2 미달 → KEEP_LEARNING_ONLY
    expect(summary.candidates[0].action).toBe('KEEP_LEARNING_ONLY');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 8. DATA_UNAVAILABLE 은 손실로 계산하지 않음
  // ──────────────────────────────────────────────────────────────────────
  it('§I-7: DATA_UNAVAILABLE 은 손실 카운트 0', () => {
    const record = makeProvisionalRecord({}, { T_PLUS_30M: 3.0 });
    record.points[1] = { ...record.points[1], status: 'DATA_UNAVAILABLE' as const };
    record.points[2] = { ...record.points[2], status: 'MARKET_CLOSED' as const };
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [record],
      nowKst: NOW,
    });
    // observed=1 (T_PLUS_30M 만), winRate=1, avg=3.0 — 손실 영향 0
    expect(summary.candidates[0].avgObservedReturnPct).toBeCloseTo(3.0, 1);
    expect(summary.candidates[0].winRateObserved).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 9. INSUFFICIENT_DATA point 도 손실 카운트 0
  // ──────────────────────────────────────────────────────────────────────
  it('§I-8: INSUFFICIENT_DATA / ERROR 는 손실 카운트 0', () => {
    const record = makeCounterfactualRecord({}, { T_PLUS_30M: 5.0 });
    record.points[1] = { ...record.points[1], status: 'INSUFFICIENT_DATA' as const };
    record.points[2] = { ...record.points[2], status: 'ERROR' as const };
    const summary = buildShadowLearningPromotionRecommendations({
      counterfactualRecords: [record],
      nowKst: NOW,
    });
    expect(summary.candidates[0].avgObservedReturnPct).toBeCloseTo(5.0, 1);
    expect(summary.candidates[0].winRateObserved).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 10. provisional + counterfactual record source 별 구분
  // ──────────────────────────────────────────────────────────────────────
  it('§D: provisional + counterfactual record 가 source 필드로 구분', () => {
    const prov = makeProvisionalRecord(
      { id: 'prov-A', symbol: '000660' },
      { T_PLUS_30M: 0.6, T_PLUS_1H: 0.4 },
    );
    const cf = makeCounterfactualRecord(
      { id: 'cf-A', symbol: '000660' },
      { T_PLUS_30M: -2.0, T_PLUS_1H: -1.5, SAME_DAY_CLOSE: -3.0 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [prov],
      counterfactualRecords: [cf],
      nowKst: NOW,
    });
    expect(summary.totalEvaluated).toBe(2);
    const provCandidate = summary.candidates.find((c) => c.source === 'PROVISIONAL_SHADOW');
    const cfCandidate = summary.candidates.find((c) => c.source === 'COUNTERFACTUAL_SHADOW');
    expect(provCandidate).toBeDefined();
    expect(cfCandidate).toBeDefined();
    expect(provCandidate?.sourceEntryId).toBe('prov-A');
    expect(cfCandidate?.sourceEntryId).toBe('cf-A');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 11. 같은 symbol 양쪽 ledger 동시 등장 시 sourceEntryId 분리
  // ──────────────────────────────────────────────────────────────────────
  it('동일 symbol provisional/counterfactual 양쪽 → sourceEntryId 분리 (record.id 기준)', () => {
    const prov = makeProvisionalRecord(
      { id: 'prov:005930:2026-05-07', symbol: '005930' },
      { T_PLUS_30M: 1.0, T_PLUS_1H: 0.5 },
    );
    const cf = makeCounterfactualRecord(
      { id: 'cf:005930:2026-05-07', symbol: '005930' },
      { T_PLUS_30M: 1.0, T_PLUS_1H: 0.5 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [prov],
      counterfactualRecords: [cf],
      nowKst: NOW,
    });
    expect(summary.totalEvaluated).toBe(2);
    const ids = summary.candidates.map((c) => c.sourceEntryId);
    expect(new Set(ids).size).toBe(2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 12. confidence 계산 — observed≥4 HIGH / ≥2 MEDIUM / 그 외 LOW
  // ──────────────────────────────────────────────────────────────────────
  it('confidence — observed≥4 HIGH / ≥2 MEDIUM / 그 외 LOW', () => {
    const high = makeProvisionalRecord(
      { id: 'h' },
      { T_PLUS_30M: 1, T_PLUS_1H: 1, SAME_DAY_CLOSE: 1, NEXT_OPEN: 1 },
    );
    const medium = makeProvisionalRecord(
      { id: 'm' },
      { T_PLUS_30M: 0.5, T_PLUS_1H: 0.3 },
    );
    const low = makeProvisionalRecord({ id: 'l' }, { T_PLUS_30M: 0.5 });
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [high, medium, low],
      nowKst: NOW,
    });
    const byId = new Map(summary.candidates.map((c) => [c.sourceEntryId, c.confidence]));
    expect(byId.get('h')).toBe('HIGH');
    expect(byId.get('m')).toBe('MEDIUM');
    expect(byId.get('l')).toBe('LOW');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 13. score 정렬 — action 우선순위 + score desc
  // ──────────────────────────────────────────────────────────────────────
  it('정렬 — NORMAL > ENHANCED > KEEP > REJECT > INSUFFICIENT_DATA > PENDING', () => {
    const normal = makeCounterfactualRecord(
      { id: 'normal' },
      { T_PLUS_30M: 1, T_PLUS_1H: 0.8, SAME_DAY_CLOSE: 0.6 },
    );
    const enhanced = makeProvisionalRecord(
      { id: 'enhanced' },
      { T_PLUS_30M: 1.4, T_PLUS_1H: -0.6 },
    );
    const reject = makeProvisionalRecord(
      { id: 'reject' },
      { T_PLUS_30M: -1.5, T_PLUS_1H: -3.0, SAME_DAY_CLOSE: -2.0 },
    );
    const keep = makeProvisionalRecord({ id: 'keep' }, { T_PLUS_30M: 0.5, T_PLUS_1H: -0.1 });
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [enhanced, reject, keep],
      counterfactualRecords: [normal],
      nowKst: NOW,
    });
    const order = summary.candidates.map((c) => c.action);
    expect(order[0]).toBe('PROMOTE_TO_NORMAL_SHADOW_WATCH');
    expect(order[1]).toBe('PROMOTE_TO_ENHANCED_WATCH');
    expect(order[2]).toBe('KEEP_LEARNING_ONLY');
    expect(order[3]).toBe('REJECT_LEARNING_HYPOTHESIS');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 14. maxCandidates 제한
  // ──────────────────────────────────────────────────────────────────────
  it('maxCandidates 제한 — 정렬 후 상위 N 만 노출', () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      makeProvisionalRecord(
        { id: `r${i}`, symbol: `S${i.toString().padStart(6, '0')}` },
        { T_PLUS_30M: 0.5, T_PLUS_1H: 0.3 },
      ),
    );
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: records,
      nowKst: NOW,
      maxCandidates: 5,
    });
    expect(summary.totalEvaluated).toBe(20);
    expect(summary.candidates).toHaveLength(5);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 15. /shadow_promotion formatter 요약/후보/주의문 표시
  // ──────────────────────────────────────────────────────────────────────
  it('§F: formatter — 요약 + 후보 + 주의문 표시', () => {
    const normal = makeCounterfactualRecord(
      {},
      { T_PLUS_30M: 1, T_PLUS_1H: 0.8, SAME_DAY_CLOSE: 0.6 },
    );
    const enhanced = makeProvisionalRecord(
      { id: 'e1', symbol: '000660', name: 'SK하이닉스' },
      { T_PLUS_30M: 1.4, T_PLUS_1H: -0.6 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [enhanced],
      counterfactualRecords: [normal],
      nowKst: NOW,
    });
    const message = formatShadowLearningPromotionMessage(summary);
    expect(message).toContain('Shadow Learning Promotion Report (ADR-0432)');
    expect(message).toContain('recommendation-only');
    expect(message).toContain('evaluated:');
    expect(message).toContain('promoteToNormalShadowWatch:');
    expect(message).toContain('promoteToEnhancedWatch:');
    expect(message).toContain('Normal Shadow Watch');
    expect(message).toContain('Enhanced Watch');
    expect(message).toContain('source=COUNTERFACTUAL_SHADOW');
    expect(message).toContain('source=PROVISIONAL_SHADOW');
    expect(message).toContain('LIVE/PAPER/일반 shadow 체결 영향 0');
    expect(message).toContain('자동 승격 없음');
    expect(message).toContain('SK하이닉스');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 16. 데이터 부족 메시지
  // ──────────────────────────────────────────────────────────────────────
  it('§F: formatter totalEvaluated=0 → 데이터 부족 안내', () => {
    const summary = buildShadowLearningPromotionRecommendations({
      nowKst: NOW,
    });
    const message = formatShadowLearningPromotionMessage(summary);
    expect(message).toContain('Shadow Learning Promotion Report (ADR-0432)');
    expect(message).toContain('아직 평가 가능한 provisional/counterfactual 성과 데이터가 부족');
    expect(message).toContain('/shadow_provisional');
    expect(message).toContain('/shadow_counterfactual');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 17. /scan_blockers 한 줄 요약
  // ──────────────────────────────────────────────────────────────────────
  it('§G: formatShadowLearningPromotionSummaryLine — 정상 카운트 노출', () => {
    const normal = makeCounterfactualRecord(
      {},
      { T_PLUS_30M: 1, T_PLUS_1H: 0.8, SAME_DAY_CLOSE: 0.6 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      counterfactualRecords: [normal],
      nowKst: NOW,
    });
    const line = formatShadowLearningPromotionSummaryLine(summary);
    expect(line).toContain('Shadow Learning Promotion');
    expect(line).toContain('normalWatch=');
    expect(line).toContain('enhancedWatch=');
    expect(line).toContain('keep=');
    expect(line).toContain('reject=');
    expect(line).toContain('/shadow_promotion');
  });

  it('§G: formatShadowLearningPromotionSummaryLine totalEvaluated=0 → null', () => {
    const summary = buildShadowLearningPromotionRecommendations({ nowKst: NOW });
    expect(formatShadowLearningPromotionSummaryLine(summary)).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 18. ENV 우회
  // ──────────────────────────────────────────────────────────────────────
  it('ENV SHADOW_LEARNING_PROMOTION_DISABLED=true → 빈 summary', () => {
    const original = process.env.SHADOW_LEARNING_PROMOTION_DISABLED;
    process.env.SHADOW_LEARNING_PROMOTION_DISABLED = 'true';
    try {
      const record = makeProvisionalRecord({}, { T_PLUS_30M: 1 });
      const summary = buildShadowLearningPromotionRecommendations({
        provisionalRecords: [record],
        nowKst: NOW,
      });
      expect(summary.totalEvaluated).toBe(0);
      expect(summary.candidates).toEqual([]);
      expect(isShadowLearningPromotionDisabled()).toBe(true);
    } finally {
      if (original !== undefined) process.env.SHADOW_LEARNING_PROMOTION_DISABLED = original;
      else delete process.env.SHADOW_LEARNING_PROMOTION_DISABLED;
    }
  });

  it('ENV "1"/"TRUE"/"yes" 거부 (정확 비교 ADR-0157)', () => {
    const original = process.env.SHADOW_LEARNING_PROMOTION_DISABLED;
    try {
      for (const v of ['1', 'TRUE', 'yes']) {
        process.env.SHADOW_LEARNING_PROMOTION_DISABLED = v;
        expect(isShadowLearningPromotionDisabled()).toBe(false);
      }
    } finally {
      if (original !== undefined) process.env.SHADOW_LEARNING_PROMOTION_DISABLED = original;
      else delete process.env.SHADOW_LEARNING_PROMOTION_DISABLED;
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // 19. literal markers — TypeScript 강제 (recommendationOnly true / live/paper false)
  // ──────────────────────────────────────────────────────────────────────
  it('candidate literal markers — recommendationOnly=true / live/paper/executionShadow=false', () => {
    const record = makeProvisionalRecord({}, { T_PLUS_30M: 1.4, T_PLUS_1H: -0.6 });
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [record],
      nowKst: NOW,
    });
    const c: ShadowLearningPromotionCandidate = summary.candidates[0];
    expect(c.recommendationOnly).toBe(true);
    expect(c.liveAllowed).toBe(false);
    expect(c.paperAllowed).toBe(false);
    expect(c.executionShadowAllowed).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 20. SHADOW_PROMOTION_THRESHOLDS SSOT 정합 + Object.freeze
  // ──────────────────────────────────────────────────────────────────────
  it('SHADOW_PROMOTION_THRESHOLDS — SSOT Object.freeze + 사용자 §C 정합', () => {
    expect(Object.isFrozen(SHADOW_PROMOTION_THRESHOLDS)).toBe(true);
    expect(SHADOW_PROMOTION_THRESHOLDS.NORMAL_WATCH_MIN_OBSERVED).toBe(3);
    expect(SHADOW_PROMOTION_THRESHOLDS.NORMAL_WATCH_MIN_AVG_RETURN_PCT).toBe(0.5);
    expect(SHADOW_PROMOTION_THRESHOLDS.NORMAL_WATCH_MIN_WIN_RATE).toBe(0.6);
    expect(SHADOW_PROMOTION_THRESHOLDS.ENHANCED_WATCH_MIN_OBSERVED).toBe(2);
    expect(SHADOW_PROMOTION_THRESHOLDS.ENHANCED_WATCH_MIN_BEST_RETURN_PCT).toBe(1.0);
    expect(SHADOW_PROMOTION_THRESHOLDS.ENHANCED_WATCH_MIN_WIN_RATE).toBe(0.5);
    expect(SHADOW_PROMOTION_THRESHOLDS.REJECT_MIN_OBSERVED).toBe(2);
    expect(SHADOW_PROMOTION_THRESHOLDS.REJECT_MAX_AVG_RETURN_PCT).toBe(-1.0);
    expect(SHADOW_PROMOTION_THRESHOLDS.REJECT_MAX_WIN_RATE).toBe(0.33);
    expect(SHADOW_PROMOTION_THRESHOLDS.REJECT_MAX_WORST_RETURN_PCT).toBe(-2.5);
  });

  // ──────────────────────────────────────────────────────────────────────
  // 21. SELL_ONLY_OVERDEFENSE_SIGNAL — counterfactual 만 발생, provisional 미발생
  // ──────────────────────────────────────────────────────────────────────
  it('SELL_ONLY_OVERDEFENSE_SIGNAL — counterfactual 전용 (provisional 부재)', () => {
    const cf = makeCounterfactualRecord(
      { id: 'cf-overdef' },
      { T_PLUS_30M: 1.5, T_PLUS_1H: 0.8 },
    );
    const prov = makeProvisionalRecord(
      { id: 'prov-overdef' },
      { T_PLUS_30M: 1.5, T_PLUS_1H: 0.8 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [prov],
      counterfactualRecords: [cf],
      nowKst: NOW,
    });
    const cfCand = summary.candidates.find((c) => c.source === 'COUNTERFACTUAL_SHADOW');
    const provCand = summary.candidates.find((c) => c.source === 'PROVISIONAL_SHADOW');
    expect(cfCand?.reasons).toContain('SELL_ONLY_OVERDEFENSE_SIGNAL');
    expect(provCand?.reasons).not.toContain('SELL_ONLY_OVERDEFENSE_SIGNAL');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 22. action 우선순위 — NORMAL 먼저 평가 (NORMAL+ENHANCED 임계 모두 만족 시 NORMAL)
  // ──────────────────────────────────────────────────────────────────────
  it('우선순위 — NORMAL 임계 충족 시 ENHANCED 가 아니라 NORMAL', () => {
    // observed=3, avg=1.0, winRate=100%, best=2, worst=0.5 — 두 임계 모두 충족
    const record = makeProvisionalRecord(
      {},
      { T_PLUS_30M: 2, T_PLUS_1H: 1, SAME_DAY_CLOSE: 0.5 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [record],
      nowKst: NOW,
    });
    expect(summary.candidates[0].action).toBe('PROMOTE_TO_NORMAL_SHADOW_WATCH');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 23. counterfactual record blockedBy propagation
  // ──────────────────────────────────────────────────────────────────────
  it('counterfactual record blockedBy 가 candidate 에 propagate', () => {
    const cf = makeCounterfactualRecord(
      {
        blockedBy: ['SELL_ONLY', 'VIX_BLOCK'],
        routerSnapshot: { severity: 'HARD_BLOCK', learningShadowAllowed: true },
      },
      { T_PLUS_30M: 0.5, T_PLUS_1H: 0.3 },
    );
    const summary = buildShadowLearningPromotionRecommendations({
      counterfactualRecords: [cf],
      nowKst: NOW,
    });
    expect(summary.candidates[0].blockedBy).toEqual(['SELL_ONLY', 'VIX_BLOCK']);
    expect(summary.candidates[0].reasons).toContain('RISK_BLOCK_REMAINS');
  });

  // ──────────────────────────────────────────────────────────────────────
  // 24. provisional record 는 blockedBy 부재
  // ──────────────────────────────────────────────────────────────────────
  it('provisional record candidate.blockedBy === undefined', () => {
    const prov = makeProvisionalRecord({}, { T_PLUS_30M: 0.5, T_PLUS_1H: 0.3 });
    const summary = buildShadowLearningPromotionRecommendations({
      provisionalRecords: [prov],
      nowKst: NOW,
    });
    expect(summary.candidates[0].blockedBy).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────
  // 25. 정적 grep 가드 — LIVE/order/promote* 키워드 부재
  // ──────────────────────────────────────────────────────────────────────
  describe('§I-18: 정적 grep 가드 — recommendation only invariants', () => {
    function stripComments(src: string): string {
      return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    }
    const STRIPPED = stripComments(SSOT_SOURCE);

    it('KIS 주문 함수 5종 import 0건', () => {
      expect(STRIPPED).not.toMatch(
        /placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder/,
      );
    });

    it('orderExecutor / submitOrder / autoTradeEngine import 0건', () => {
      expect(STRIPPED).not.toMatch(/orderExecutor|submitOrder|trancheExecutor|autoTradeEngine/);
    });

    it('shadowTradeRepo write 키워드 0건', () => {
      expect(STRIPPED).not.toMatch(/shadowTradeRepo|appendShadow|saveShadowTrades|shadow-trades\.json/);
    });

    it('promoteToLive / promoteToPaper / autoPromote 함수명 0건', () => {
      expect(STRIPPED).not.toMatch(/promoteToLive|promoteToPaper|autoPromote/);
    });

    it('Gate threshold / STRONG_BUY 변경 키워드 0건', () => {
      expect(STRIPPED).not.toMatch(/setGateThreshold|MIN_GATE_OVERRIDE|GATE_RELAX|STRONG_BUY_OVERRIDE/);
    });

    it('virtual account mutation 키워드 0건', () => {
      expect(STRIPPED).not.toMatch(/setVirtualAccountHoldings|updateVirtualAccountCash|mutateHoldings|setEquity/);
    });

    it('직접 fetch / axios / node-fetch 0건', () => {
      expect(STRIPPED).not.toMatch(/^import.*['"](?:fetch|axios|node-fetch)/m);
      expect(STRIPPED).not.toMatch(/\bfetch\(/);
    });

    it('SectorEnergy DEGRADED → OK 승격 키워드 0건', () => {
      expect(STRIPPED).not.toMatch(/promoteSectorEnergyToOK|forceSectorEnergyOk/);
    });

    it('ADR-0432 inline comment 본문 보존', () => {
      expect(SSOT_SOURCE).toContain('ADR-0432');
      expect(SSOT_SOURCE).toContain('recommendation-only');
      expect(SSOT_SOURCE).toContain('without opening live');
      expect(SSOT_SOURCE).toContain('paper, execution shadow, virtual-account');
      expect(SSOT_SOURCE).toContain('only ranks learning samples for further observation');
    });

    it('NOT TRADING THRESHOLDS 주석 명시 (사용자 §C 정합)', () => {
      // 임계 상수 SSOT 가 매매 진입 기준 아님을 명시.
      expect(SSOT_SOURCE).toContain('NOT TRADING THRESHOLDS');
    });

    it('action union 명시적으로 PROMOTE_TO_LIVE / PROMOTE_TO_PAPER 부재 — recommendation only', () => {
      // ShadowLearningPromotionAction union 6값 — LIVE/PAPER 등 매매 액션 절대 부재.
      const actionMatch = STRIPPED.match(/type ShadowLearningPromotionAction\s*=([\s\S]*?);/);
      expect(actionMatch).not.toBeNull();
      const actionUnion = actionMatch?.[1] ?? '';
      expect(actionUnion).not.toMatch(/PROMOTE_TO_LIVE|PROMOTE_TO_PAPER|EXECUTE/);
      expect(actionUnion).toContain('PROMOTE_TO_NORMAL_SHADOW_WATCH');
      expect(actionUnion).toContain('PROMOTE_TO_ENHANCED_WATCH');
    });
  });
});
