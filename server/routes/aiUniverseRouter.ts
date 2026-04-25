/**
 * @responsibility AI 추천 universe API 라우터 — KIS/KRX 비의존 (ADR-0011, PR-25-B)
 *
 * 클라이언트 (`src/services/stock/*Recommendations.ts`, `enrichment.ts`) 가 이전에
 * `/api/krx/valuation` 으로 호출하던 enrichment 와 KIS 랭킹 기반 universe 발굴을
 * 본 endpoint 로 흡수해 자동매매 quota 침범 없이 처리한다.
 *
 * 응답 schema 는 기존 KRX valuation 호환 필드(per/pbr/eps/bps/marketCap/marketCapDisplay)
 * 를 유지해 클라 변경을 최소화한다.
 */

import { Router, Request, Response } from 'express';
import { discoverUniverse, enrichKnownStock, type AiUniverseMode } from '../services/aiUniverseService.js';
import { fetchNaverStockSnapshot, type NaverStockSnapshot } from '../clients/naverFinanceClient.js';
import { getStockByCode } from '../persistence/krxStockMasterRepo.js';
import { getBudgetSnapshot } from '../persistence/aiCallBudgetRepo.js';

const router = Router();

const MODE_VALUES: AiUniverseMode[] = ['MOMENTUM', 'QUANT_SCREEN', 'BEAR_SCREEN', 'EARLY_DETECT', 'SMALL_MID_CAP'];

function isMode(v: unknown): v is AiUniverseMode {
  return typeof v === 'string' && MODE_VALUES.includes(v as AiUniverseMode);
}

/**
 * 시총을 한국식 단위 문자열("12조 3,450억" 등)로 변환.
 * Naver Finance 의 marketCap (단위: 원) → display string.
 */
export function formatMarketCapKr(marketCapWon: number): string {
  if (!Number.isFinite(marketCapWon) || marketCapWon <= 0) return '';
  const eok = Math.floor(marketCapWon / 1_0000_0000);
  if (eok < 10_000) {
    return `${eok.toLocaleString('ko-KR')}억`;
  }
  const jo = Math.floor(eok / 10_000);
  const rem = eok % 10_000;
  if (rem === 0) return `${jo.toLocaleString('ko-KR')}조`;
  return `${jo.toLocaleString('ko-KR')}조 ${rem.toLocaleString('ko-KR')}억`;
}

/**
 * GET /api/ai-universe/discover?mode=MOMENTUM&maxCandidates=12&enrich=1
 * AI 추천 universe 발굴 — Google Search + Naver enrichment.
 */
router.get('/discover', async (req: Request, res: Response) => {
  const mode = req.query.mode;
  if (!isMode(mode)) {
    return res.status(400).json({
      error: 'mode 파라미터가 필요합니다',
      validModes: MODE_VALUES,
    });
  }
  const maxCandidates = req.query.maxCandidates !== undefined
    ? Math.max(1, Math.min(Number(req.query.maxCandidates) || 12, 30))
    : 12;
  const enrich = req.query.enrich !== '0';

  try {
    const result = await discoverUniverse(mode, { maxCandidates, enrich });
    res.json(result);
  } catch (e: any) {
    console.error('[aiUniverseRouter] /discover 실패:', e?.message ?? e);
    res.status(500).json({ error: 'universe 발굴 실패', detail: e?.message });
  }
});

/**
 * GET /api/ai-universe/snapshot?code=005930
 * 단일 종목 enrichment — KRX valuation 응답과 호환되는 schema.
 * 기존 `/api/krx/valuation` 의 drop-in 대체.
 */
router.get('/snapshot', async (req: Request, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'code(6자리 숫자)가 필요합니다' });
  }

  let snap: NaverStockSnapshot | null = null;
  try {
    snap = await fetchNaverStockSnapshot(code);
  } catch (e: any) {
    console.warn('[aiUniverseRouter] snapshot 실패:', e?.message ?? e);
  }

  if (!snap) {
    const master = getStockByCode(code);
    return res.json({
      code,
      name: master?.name ?? '',
      per: 0, pbr: 0, eps: 0, bps: 0,
      marketCap: 0, marketCapDisplay: '',
      dividendYield: 0, foreignerOwnRatio: 0,
      found: false,
      source: 'NAVER_MISS',
    });
  }

  res.json({
    code: snap.code,
    name: snap.name,
    per: snap.per,
    pbr: snap.pbr,
    eps: snap.eps,
    bps: snap.bps,
    marketCap: snap.marketCap,
    marketCapDisplay: formatMarketCapKr(snap.marketCap),
    dividendYield: snap.dividendYield,
    foreignerOwnRatio: snap.foreignerOwnRatio,
    closePrice: snap.closePrice,
    changeRate: snap.changeRate,
    found: true,
    source: snap.source,
  });
});

/**
 * GET /api/ai-universe/snapshots?codes=005930,000660,247540
 * 다중 종목 enrichment — momentumRecommendations 의 prefetch 패턴 지원.
 */
router.get('/snapshots', async (req: Request, res: Response) => {
  const raw = typeof req.query.codes === 'string' ? req.query.codes : '';
  const codes = raw.split(',').map((c) => c.trim()).filter((c) => /^\d{6}$/.test(c)).slice(0, 30);
  if (codes.length === 0) {
    return res.json({ items: [] });
  }
  try {
    const out = await Promise.all(codes.map(async (code) => {
      const snap = await fetchNaverStockSnapshot(code);
      if (!snap) return null;
      return {
        code: snap.code,
        name: snap.name,
        per: snap.per,
        pbr: snap.pbr,
        marketCap: snap.marketCap,
        marketCapDisplay: formatMarketCapKr(snap.marketCap),
      };
    }));
    res.json({ items: out.filter(Boolean) });
  } catch (e: any) {
    console.error('[aiUniverseRouter] /snapshots 실패:', e?.message ?? e);
    res.status(500).json({ error: 'snapshots 실패', detail: e?.message });
  }
});

/**
 * GET /api/ai-universe/budget
 * 운영 모니터 — 일일 호출 예산 잔여.
 */
router.get('/budget', (_req: Request, res: Response) => {
  res.json(getBudgetSnapshot());
});

/**
 * GET /api/ai-universe/enriched?code=005930
 * 마스터 + Naver snapshot 결합 — discoverUniverse 의 단일 종목 변형.
 */
router.get('/enriched', async (req: Request, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'code(6자리 숫자)가 필요합니다' });
  }
  try {
    const result = await enrichKnownStock(code);
    if (!result) return res.status(404).json({ error: '마스터에 없음', code });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: 'enriched 실패', detail: e?.message });
  }
});

export default router;
