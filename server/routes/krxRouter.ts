// server/routes/krxRouter.ts
// KRX-style 밸류에이션 프록시 — 실제로는 KIS inquire-price TR(FHKST01010100)에서
// per/pbr/시가총액/eps 를 뽑아 {per, pbr, marketCap, eps} 로 정규화해 반환한다.
// 프론트 enrichment.ts 의 fetchKrxValuation(code) 계약과 호환되는 단일 엔드포인트.
import { Router, Request, Response } from 'express';
import { realDataKisGet, HAS_REAL_DATA_CLIENT, KIS_IS_REAL } from '../clients/kisClient.js';

const router = Router();

const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * GET /api/krx/valuation?code=005930
 * Returns { per, pbr, eps, bps, marketCap, marketCapDisplay }
 *   - per, pbr, eps, bps: number (0 = 데이터 없음)
 *   - marketCap: number (억원 단위)
 *   - marketCapDisplay: "12.3조" / "3,450억" 포맷 문자열
 */
router.get('/valuation', async (req: Request, res: Response) => {
  const code = String(req.query.code || '').trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'code must be 6-digit' });
  }

  const cached = cache.get(code);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json(cached.data);
  }

  // KIS 실계좌 데이터 키 / 실서버 미설정 시 조용히 빈값 반환 (enrichment는 null 처리)
  if (!HAS_REAL_DATA_CLIENT && !KIS_IS_REAL) {
    return res.json({ per: 0, pbr: 0, eps: 0, bps: 0, marketCap: 0, marketCapDisplay: '' });
  }

  try {
    const data = await realDataKisGet(
      'FHKST01010100',
      '/uapi/domestic-stock/v1/quotations/inquire-price',
      { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code },
    );
    const out = (data as { output?: Record<string, string> } | null)?.output;

    const per = Number(out?.per ?? '0') || 0;
    const pbr = Number(out?.pbr ?? '0') || 0;
    const eps = Number(out?.eps ?? '0') || 0;
    const bps = Number(out?.bps ?? '0') || 0;
    // hts_avls: 시가총액 (단위: 억원)
    const marketCap = Number(out?.hts_avls ?? '0') || 0;

    let marketCapDisplay = '';
    if (marketCap >= 10000) marketCapDisplay = `${(marketCap / 10000).toFixed(2)}조`;
    else if (marketCap > 0) marketCapDisplay = `${marketCap.toLocaleString()}억`;

    const result = { per, pbr, eps, bps, marketCap, marketCapDisplay };
    cache.set(code, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[KRX] valuation(${code}) error:`, msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
