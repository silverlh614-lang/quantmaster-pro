// server/routes/krxRouter.ts
// KRX-style 밸류에이션 프록시 — 실제로는 KIS inquire-price TR(FHKST01010100)에서
// per/pbr/시가총액/eps 를 뽑아 {per, pbr, marketCap, eps} 로 정규화해 반환한다.
// 프론트 enrichment.ts 의 fetchKrxValuation(code) 계약과 호환되는 단일 엔드포인트.
//
// 추가 엔드포인트 (인증 KRX OpenAPI + Yahoo 이중화):
//   GET /api/krx/quote?code=005930       — 단일 종목 일봉 스냅샷 (KRX → Yahoo fallback)
//   GET /api/krx/index?name=KOSPI|KOSDAQ — 대표 지수 일봉 스냅샷
//   GET /api/krx/openapi-status          — KRX OpenAPI 진단 (인증키·서킷 상태)
import { Router, Request, Response } from 'express';
import { realDataKisGet, HAS_REAL_DATA_CLIENT, KIS_IS_REAL } from '../clients/kisClient.js';
import {
  fetchKoreanDailyQuote,
  fetchKoreanIndexDailyQuote,
  type KoreanIndexAlias,
} from '../clients/koreanQuoteBridge.js';
import { getKrxOpenApiStatus } from '../clients/krxOpenApi.js';
import { getSectorEnergyInputs } from '../clients/sectorEnergyProvider.js';
import { evaluateSectorEnergy } from '../../src/services/quant/sectorEnergyEngine.js';

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

/**
 * GET /api/krx/quote?code=005930
 * KRX OpenAPI(인증) 1차, Yahoo Finance 폴백. 응답에 source 포함.
 */
router.get('/quote', async (req: Request, res: Response) => {
  const code = String(req.query.code || '').trim();
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'code must be 6-digit' });
  }
  try {
    const quote = await fetchKoreanDailyQuote(code);
    // source === 'none' 이면 양쪽 다 실패 — 502 로 올려 상위 재시도 유도.
    if (quote.source === 'none') {
      return res.status(502).json({ error: 'KRX/Yahoo 모두 응답 없음', code });
    }
    return res.json(quote);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[KRX] /quote(${code}) error:`, msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/krx/index?name=KOSPI|KOSDAQ
 * 대표 지수 일봉 — KRX 인증 시리즈 API 1차, Yahoo (^KS11/^KQ11) 폴백.
 */
router.get('/index', async (req: Request, res: Response) => {
  const raw = String(req.query.name || '').trim().toUpperCase();
  if (raw !== 'KOSPI' && raw !== 'KOSDAQ') {
    return res.status(400).json({ error: 'name must be KOSPI or KOSDAQ' });
  }
  try {
    const quote = await fetchKoreanIndexDailyQuote(raw as KoreanIndexAlias);
    if (quote.source === 'none') {
      return res.status(502).json({ error: 'KRX/Yahoo 모두 응답 없음', name: raw });
    }
    return res.json(quote);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[KRX] /index(${raw}) error:`, msg);
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/krx/openapi-status
 * 운영 중 KRX 인증키 설정·서킷 상태·캐시 키를 관측하기 위한 진단 엔드포인트.
 */
router.get('/openapi-status', (_req: Request, res: Response) => {
  res.json(getKrxOpenApiStatus());
});

/**
 * GET /api/krx/sector-energy
 * KRX 섹터 지수·종목·투자자 데이터를 묶어 sectorEnergyEngine 결과를 반환한다.
 * 프론트는 evaluateSectorEnergy 재실행 없이 leadingSectors/laggingSectors/summary 만 소비.
 * inputs 배열이 비어있으면 엔진은 '입력 없음' 요약을 반환하므로 504 로 올리지 않는다.
 */
router.get('/sector-energy', async (_req: Request, res: Response) => {
  try {
    const inputs = await getSectorEnergyInputs();
    const result = evaluateSectorEnergy(inputs);
    res.json({ inputs, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[KRX] /sector-energy error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
