/**
 * @responsibility 추천 학습 통계·실거래 준비 상태·귀인 분석·조건 가중치 디버그·스캔 피드백 엔드포인트 제공
 *
 * 엔드포인트:
 *   GET  /auto-trade/recommendations              — 추천 이력
 *   GET  /auto-trade/recommendations/stats        — 월간 통계 + 월간 실현 성과
 *   POST /auto-trade/recommendations/evaluate     — 수동 평가 트리거
 *   GET  /real-trade/status                       — 실거래 전환 준비 상태
 *   POST /attribution/record                      — 27조건 스냅샷 저장 + L1 학습 훅
 *   GET  /attribution/stats                       — 조건별 승률·평균 수익률 집계
 *   GET  /auto-trade/condition-weights/debug      — 조건 가중치 + 30일 적중률
 *   GET  /auto-trade/scan-feedback                — 빈스캔 백오프 상태
 */
import { Router } from 'express';
import {
  getRecommendations,
  getMonthlyStats,
  evaluateRecommendations,
  isRealTradeReady,
} from '../../learning/recommendationTracker.js';
import { computeMonthlyShadowTradeStats } from '../../persistence/shadowAccountRepo.js';
import {
  appendAttributionRecord,
  computeAttributionStats,
  type ServerAttributionRecord,
} from '../../persistence/attributionRepo.js';
import { learningOrchestrator } from '../../orchestrator/learningOrchestrator.js';
import {
  loadConditionWeights,
  loadConditionWeightsByRegime,
} from '../../persistence/conditionWeightsRepo.js';
import { CONDITION_KEYS, DEFAULT_CONDITION_WEIGHTS, type ConditionKey } from '../../quantFilter.js';
import { getScanFeedbackState } from '../../orchestrator/adaptiveScanScheduler.js';

const router = Router();

router.get('/auto-trade/recommendations', (_req: any, res: any) => {
  res.json(getRecommendations());
});

router.get('/auto-trade/recommendations/stats', (_req: any, res: any) => {
  // 🔑 UI "서버 자기학습 통계" 카드는 실제 SELL fill(부분청산 포함) 기반 지표를
  // 보여야 한다. getMonthlyStats()는 추천 시그널 품질 추적용이라 추천-기준-% 수익률
  // 만 반영해 금일 실현 결산이 누락된다. trades 필드에 실제 월간 실현 성과를 함께
  // 실어 보내고 프런트가 이를 우선 사용한다. (Telegram 리포트는 기존 필드 유지)
  res.json({
    ...getMonthlyStats(),
    trades: computeMonthlyShadowTradeStats(),
  });
});

// 수동 평가 트리거 (테스트 / 장 마감 후 즉시 확인 용도)
router.post('/auto-trade/recommendations/evaluate', async (_req: any, res: any) => {
  try {
    await evaluateRecommendations();
    res.json({ ok: true, stats: getMonthlyStats() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/real-trade/status', (_req: any, res: any) => {
  res.json({ ready: isRealTradeReady(), kisIsReal: process.env.KIS_IS_REAL === 'true' });
});

router.post('/attribution/record', (req: any, res: any) => {
  try {
    const record = req.body as ServerAttributionRecord;
    if (!record.tradeId || !record.conditionScores) {
      return res.status(400).json({ error: 'tradeId, conditionScores 필수' });
    }
    appendAttributionRecord(record);
    // L1 학습 훅 (아이디어 2) — 응답은 즉시, 온라인 학습은 비동기 실행
    setImmediate(() => {
      learningOrchestrator.onAttributionRecorded(record).catch((e) =>
        console.error('[Attribution] incremental calibration 실패:', e),
      );
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[Attribution] record 저장 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

router.get('/attribution/stats', (_req: any, res: any) => {
  try {
    res.json(computeAttributionStats());
  } catch (e) {
    console.error('[Attribution] stats 계산 실패:', e);
    res.status(500).json({ error: 'internal' });
  }
});

/**
 * 각 조건의 현재 가중치 + 최근 30일 적중률을 JSON으로 반환.
 * 블랙박스성 제거를 위한 핵심 투명성 도구.
 */
router.get('/auto-trade/condition-weights/debug', (_req: any, res: any) => {
  try {
    const globalWeights = loadConditionWeights();

    const allRecs = getRecommendations();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentRecs = allRecs.filter(
      (r) => r.signalTime >= thirtyDaysAgo && r.status !== 'PENDING',
    );

    const conditionStats: Record<string, {
      totalAppearances: number;
      wins: number;
      losses: number;
      hitRate: number;
      avgReturn: number;
    }> = {};

    for (const key of Object.values(CONDITION_KEYS)) {
      conditionStats[key] = { totalAppearances: 0, wins: 0, losses: 0, hitRate: 0, avgReturn: 0 };
    }

    for (const rec of recentRecs) {
      for (const key of rec.conditionKeys ?? []) {
        if (!conditionStats[key]) {
          conditionStats[key] = { totalAppearances: 0, wins: 0, losses: 0, hitRate: 0, avgReturn: 0 };
        }
        conditionStats[key].totalAppearances++;
        if (rec.status === 'WIN')  conditionStats[key].wins++;
        if (rec.status === 'LOSS') conditionStats[key].losses++;
      }
    }

    for (const key of Object.keys(conditionStats)) {
      const stat = conditionStats[key];
      const resolved = stat.wins + stat.losses;
      stat.hitRate = resolved > 0
        ? parseFloat(((stat.wins / resolved) * 100).toFixed(1))
        : 0;

      const returns = recentRecs
        .filter((r) => (r.conditionKeys ?? []).includes(key) && r.actualReturn !== undefined)
        .map((r) => r.actualReturn!);
      stat.avgReturn = returns.length > 0
        ? parseFloat((returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(2))
        : 0;
    }

    const regimes = ['R1_TURBO', 'R2_BULL', 'R3_EARLY', 'R4_NEUTRAL', 'R5_CAUTION', 'R6_DEFENSE'];
    const regimeWeights: Record<string, Record<string, number>> = {};
    for (const regime of regimes) {
      const rw = loadConditionWeightsByRegime(regime);
      const isDifferent = Object.keys(rw).some(
        (k) => rw[k as ConditionKey] !== globalWeights[k as ConditionKey],
      );
      if (isDifferent) {
        regimeWeights[regime] = rw;
      }
    }

    res.json({
      globalWeights,
      defaults: DEFAULT_CONDITION_WEIGHTS,
      conditionStats30d: conditionStats,
      recentRecordsCount: recentRecs.length,
      period: { from: thirtyDaysAgo.slice(0, 10), to: new Date().toISOString().slice(0, 10) },
      regimeWeights: Object.keys(regimeWeights).length > 0 ? regimeWeights : undefined,
    });
  } catch (e: any) {
    console.error('[ConditionWeightsDebug] 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/auto-trade/scan-feedback', (_req: any, res: any) => {
  res.json(getScanFeedbackState());
});

export default router;
