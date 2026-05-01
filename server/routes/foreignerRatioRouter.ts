// @responsibility ADR-0152 Naver 외인 추세 endpoint — ADR-0140 영속 시계열 read-only 노출
import { Router, type Request, type Response } from 'express';
import { computeForeignerRatioTrend } from '../persistence/foreignerRatioRepo.js';

const router = Router();

/**
 * GET /api/foreigner-ratio/trend?code=005930
 *
 * ADR-0152: ADR-0140 (Naver 외인 보유율 추세) 영속 시계열의 클라이언트 노출 통로.
 * 클라이언트 enrichment.ts 가 #4 supplyInflow 격상에 사용.
 *
 * 응답 schema:
 * - 정상: { current, changePct5d, changePct20d, sampleSize, latestDate }
 *   - changePct5d / changePct20d 가 null 이면 표본 부족 (표본 < 6 / 21)
 * - 영속 부재 또는 미수집: { current: null, ... } (404 아님 — 클라가 fallback)
 *
 * 외부 호출 0건 (영속 read-only). KIS/KRX quota 무관.
 */
router.get('/trend', (req: Request, res: Response) => {
  const code = (req.query.code as string | undefined)?.trim() ?? '';
  if (!/^\d{1,6}$/.test(code)) {
    res.status(400).json({ error: 'invalid code — 1~6자리 숫자' });
    return;
  }
  try {
    const trend = computeForeignerRatioTrend(code);
    if (!trend) {
      res.json({
        current: null,
        changePct5d: null,
        changePct20d: null,
        sampleSize: 0,
        latestDate: null,
      });
      return;
    }
    res.json(trend);
  } catch (err) {
    console.error('[foreignerRatioRouter] computeForeignerRatioTrend 실패:', err);
    res.status(500).json({ error: 'internal' });
  }
});

export { router as foreignerRatioRouter };
