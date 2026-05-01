// @responsibility ADR-0155 KRX 기관 순매수 종목별 N영업일 누적 endpoint — #12 institutionalBuying 격상
import { Router, type Request, type Response } from 'express';
import { fetchInvestorTrading } from '../clients/krxClient.js';

const router = Router();

const MAX_DAYS = 5;

/**
 * 직전 영업일 계산 (KRX 주말 회피).
 * 토요일/일요일 → 직전 금요일.
 */
function previousBusinessDay(now: Date, offsetDays: number): string {
  const t = new Date(now.getTime());
  let consumed = 0;
  while (consumed < offsetDays) {
    t.setUTCDate(t.getUTCDate() - 1);
    const dow = t.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    consumed += 1;
  }
  // YYYYMMDD
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * GET /api/krx-investor/trend?code=005930&days=5
 *
 * ADR-0155: ADR-0154 §2 옵션 C — KRX OpenAPI 기관 순매수 종목별 N영업일 누적.
 * `fetchInvestorTrading(date)` (BLD MDCSTAT02203) 를 N일치 호출 + 종목 코드 필터 +
 * 합산. 응답 schema:
 *
 * - 정상: {
 *     code, foreignNet5d, institutionNet5d, individualNet5d, sampleSize, latestDate
 *   }
 * - sampleSize === 0: 영속 부재 (KRX 응답 부재)
 *
 * KIS quota 0 침범 (KRX 공개 endpoint, ADR-0011 정합).
 *
 * 호출 비용: KRX 1 요청 = 모든 종목 1 응답 (5분 cache). 종목별 1 응답이 아닌 *시장
 * 전체 1 응답* 이라 동일 일자 N 종목 호출 시 cache hit.
 */
router.get('/trend', async (req: Request, res: Response) => {
  const code = (req.query.code as string | undefined)?.trim() ?? '';
  if (!/^\d{1,6}$/.test(code)) {
    res.status(400).json({ error: 'invalid code — 1~6자리 숫자' });
    return;
  }
  const daysRaw = Number(req.query.days);
  const days = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= MAX_DAYS
    ? Math.floor(daysRaw)
    : 5;

  const baseCode = code.padStart(6, '0');
  const now = new Date();

  let foreignNet5d = 0;
  let institutionNet5d = 0;
  let individualNet5d = 0;
  let sampleSize = 0;
  let latestDate: string | null = null;

  try {
    for (let i = 0; i < days; i += 1) {
      const date = previousBusinessDay(now, i);
      const rows = await fetchInvestorTrading(date);
      const row = rows.find((r) => r.code === baseCode);
      if (!row) continue;
      foreignNet5d += row.foreignNetBuy ?? 0;
      institutionNet5d += row.institutionNetBuy ?? 0;
      individualNet5d += row.individualNetBuy ?? 0;
      sampleSize += 1;
      // YYYYMMDD → YYYY-MM-DD (가장 최근 기준 = i=0)
      if (i === 0 || latestDate === null) {
        const y = date.slice(0, 4);
        const m = date.slice(4, 6);
        const d = date.slice(6, 8);
        latestDate = `${y}-${m}-${d}`;
      }
    }
    res.json({
      code: baseCode,
      foreignNet5d,
      institutionNet5d,
      individualNet5d,
      sampleSize,
      latestDate,
    });
  } catch (err) {
    console.error('[krxInvestorRouter] fetchInvestorTrading 실패:', err);
    res.status(500).json({ error: 'internal' });
  }
});

export { router as krxInvestorRouter };
