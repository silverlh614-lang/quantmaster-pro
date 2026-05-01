// @responsibility ADR-0156 Yahoo 컨센서스 endpoint — Phase 4 #13/#14 격상 입력 (옵션 A 변형)
import { Router, type Request, type Response } from 'express';
import { fetchYahooConsensus } from '../clients/yahooConsensusClient.js';

const router = Router();

/**
 * GET /api/yahoo-consensus/snapshot?code=005930
 *
 * ADR-0156: ADR-0154 §1 옵션 A (외부 컨센서스 API) 변형 — Yahoo Finance 무료
 * quoteSummary endpoint 활용 (인증 키 무관). recommendationTrend + earningsHistory
 * modules 합성. 한국 종목 (.KS/.KQ) 부분 지원 — 데이터 부재 시 source='unavailable'.
 *
 * 응답 schema:
 * - 정상: { recommendationStrength, earningsSurpriseAvg, sampleSize, source }
 * - 모든 suffix 실패: { source: 'unavailable', sampleSize: 0, ... }
 *
 * KIS quota 0 침범 (Yahoo 외부 API). EgressGuard intent='HISTORICAL'.
 */
router.get('/snapshot', async (req: Request, res: Response) => {
  const code = (req.query.code as string | undefined)?.trim() ?? '';
  if (!/^\d{1,6}$/.test(code)) {
    res.status(400).json({ error: 'invalid code — 1~6자리 숫자' });
    return;
  }
  try {
    const consensus = await fetchYahooConsensus(code);
    if (!consensus) {
      res.json({
        recommendationStrength: null,
        earningsSurpriseAvg: null,
        sampleSize: 0,
        source: 'unavailable',
      });
      return;
    }
    res.json(consensus);
  } catch (err) {
    console.error('[yahooConsensusRouter] fetchYahooConsensus 실패:', err);
    res.status(500).json({ error: 'internal' });
  }
});

export { router as yahooConsensusRouter };
