// @responsibility marketDataRouter 서버 라우터 모듈
// server/routes/marketDataRouter.ts
// 외부 시장 데이터 라우터 — server.ts에서 분리
// ECOS(한국은행), FRED, Yahoo Finance 프록시, 시장지표 일괄 조회
import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { loadGlobalScanReport } from '../alerts/globalScanAgent.js';
import { analyzeNewsSupplyPatterns, loadNewsSupplyRecords } from '../learning/newsSupplyLogger.js';
import { getFomcProximity, generateFomcIcs, FOMC_DATES } from '../trading/fomcCalendar.js';
import { runBacktest } from '../learning/backtestEngine.js';
import {
  computeMacroIndex,
  generateMacroCommentary,
  buildMacroInterpretContext,
} from '../engines/macroIndexEngine.js';
import { fetchPerPbr } from '../clients/krxClient.js';
import { fetchNaverDailyOhlcv, fetchNaverInvestorTrend } from '../clients/naverFinanceClient.js';
import { isMarketOpen } from '../utils/marketClock.js';
import { isMarketOpenFor, nextOpenAtFor } from '../utils/symbolMarketRegistry.js';
import { guardedFetch } from '../utils/egressGuard.js';
import { capYahooRange } from '../utils/yahooRangePolicy.js';
import { getSnapshot } from '../persistence/offHoursSnapshotRepo.js';
import {
  fetchAndStoreYahooHistoricalSnapshot,
  type YahooHistoricalSnapshotFetchResult,
} from '../market/yahooHistoricalSnapshotWarmup.js';
import {
  fillMissingFromSnapshot,
  loadMarketIndicatorsSnapshot,
  mergeFreshIntoSnapshot,
  saveMarketIndicatorsSnapshot,
  type MarketIndicatorsFresh,
} from '../persistence/marketIndicatorsSnapshotRepo.js';

const router = Router();

// Naver 모바일 일봉 OHLCV (KR 차트 정본). Yahoo 절대값은 KR stale 심함 → Naver 우선,
// 클라이언트가 실패(204) 시 Yahoo(/historical-data) 로 fallback. 장외에도 가용(KIS 와 달리).
router.get('/naver/daily', async (req: Request, res: Response) => {
  const code = String(req.query.code ?? '').trim();
  const count = Math.max(1, Math.min(1000, parseInt(String(req.query.count ?? '260'), 10) || 260));
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'code(6자리 KR) 파라미터 필요' });
    return;
  }
  try {
    const chart = await fetchNaverDailyOhlcv(code, count);
    if (!chart) {
      res.status(204).end();
      return;
    }
    res.json(chart);
  } catch (e: any) {
    logger.warn(`[naver/daily] ${code}: ${e?.message ?? e}`);
    res.status(502).json({ error: 'naver daily fetch 실패' });
  }
});

// Naver 외국인/기관 순매수 (frgn.naver). KIS 와 달리 장외에도 가용 — 표시 전용.
router.get('/naver/supply', async (req: Request, res: Response) => {
  const code = String(req.query.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: 'code(6자리 KR) 파라미터 필요' });
    return;
  }
  try {
    const supply = await fetchNaverInvestorTrend(code);
    if (!supply) {
      res.status(204).end();
      return;
    }
    res.json(supply);
  } catch (e: any) {
    logger.warn(`[naver/supply] ${code}: ${e?.message ?? e}`);
    res.status(502).json({ error: 'naver supply fetch 실패' });
  }
});

// ── ADR-0009: Yahoo historical-data 프록시 LRU 캐시 ─────────────────────────
// 클라이언트 폴링이 같은 (symbol,range,interval) 조합을 분당 여러 번 요청하므로
// 인프로세스 LRU 로 coalescing 한다. 장외에는 TTL 을 3배 연장해 새 호출을
// 극단적으로 억제한다. 변경 범위는 /historical-data 엔드포인트 한 곳.
interface YahooCacheEntry {
  body: string;          // JSON 문자열 (Yahoo 응답 그대로)
  contentType: string;
  expiresAt: number;
}
const YAHOO_PROXY_MAX_ENTRIES = 500;
const _yahooProxyCache = new Map<string, YahooCacheEntry>();
const PROXY_LOG_INTERVAL_MS = 60_000;
let _lastProxyCacheLogAt = 0;

function yahooProxyTtlMs(interval: string | undefined): number {
  const iv = (interval ?? '1d').toLowerCase();
  const baseMs =
    iv === '1d' ? 60 * 60_000 :
    ['1m', '5m', '15m', '30m', '1h', '90m'].includes(iv) ? 5 * 60_000 :
    15 * 60_000;
  return isMarketOpen() ? baseMs : baseMs * 3;
}

export function proxyCacheGet(key: string): YahooCacheEntry | null {
  const hit = _yahooProxyCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _yahooProxyCache.delete(key);
    return null;
  }
  // LRU: 최근 접근 = 뒤로 재삽입
  _yahooProxyCache.delete(key);
  _yahooProxyCache.set(key, hit);
  return hit;
}

export function proxyCacheSet(key: string, entry: YahooCacheEntry): void {
  if (_yahooProxyCache.has(key)) _yahooProxyCache.delete(key);
  _yahooProxyCache.set(key, entry);
  while (_yahooProxyCache.size > YAHOO_PROXY_MAX_ENTRIES) {
    const oldest = _yahooProxyCache.keys().next().value;
    if (oldest === undefined) break;
    _yahooProxyCache.delete(oldest);
  }
}

export function proxyCacheReset(): void { _yahooProxyCache.clear(); }
export function proxyCacheSize(): number { return _yahooProxyCache.size; }

// ── ADR-0010: In-flight Request Coalescing ───────────────────────────────────
// 동일 (symbol,range,interval) 호출이 캐시 set 이전 윈도우에서 N 번 들어와도
// outbound 는 1 번. 진행 중인 Promise 에 편승 → finally 시점에 Map 에서 제거.
const _yahooInflight = new Map<string, Promise<YahooHistoricalSnapshotFetchResult>>();
export function inflightSize(): number { return _yahooInflight.size; }
export function inflightReset(): void { _yahooInflight.clear(); }

// ── ADR-0010: 시장 운영시간 게이트 ──────────────────────────────────────────
// SymbolMarketRegistry 가 심볼 → 시장(KRX/NYSE/TSE) 매핑과 개장 시각을 단독 판정.
// 게이트는 `isMarketOpenFor(symbol)` 단일 호출로 파생된다.
// cache hit 이면 STALE-OFFHOURS 로 stale 서빙, miss 면 204 (OFFHOURS-SKIP).
// 장중이거나 분류 불가 심볼 → pass.
const MARKET_GATED_PATHS = new Set(['/historical-data']);

export type MarketGateDecision =
  | { action: 'pass' }
  | { action: 'stale'; body: string; contentType: string }
  | { action: 'skip' };

/**
 * 순수 함수 — 시장 게이트 판정. 미들웨어 본체와 단위 테스트가 공유.
 * 심볼이 속한 시장이 열려있으면 pass, 닫혀있으면 cache hit → stale, miss → skip.
 */
export function evaluateMarketGate(
  symbol: string,
  range: string,
  interval: string,
  now: Date = new Date(),
): MarketGateDecision {
  if (isMarketOpenFor(symbol, now)) return { action: 'pass' };
  const key = `${symbol}:${range}:${interval}`;
  const cached = proxyCacheGet(key);
  if (cached) return { action: 'stale', body: cached.body, contentType: cached.contentType };
  // PR-32: 인메모리 LRU 미스 시 디스크 영속 스냅샷 폴백 — 재배포 후에도 마지막
  // 장중 값을 서빙해 UI 정보 불일치 원천 차단.
  const snapshot = getSnapshot(key);
  if (snapshot) return { action: 'stale', body: snapshot.body, contentType: snapshot.contentType };
  return { action: 'skip' };
}

router.use((req: Request, res: Response, next) => {
  if (!MARKET_GATED_PATHS.has(req.path)) return next();
  const symbol = String(req.query.symbol ?? '');
  if (!symbol) return next();
  // ADR-0082: 클라이언트가 보낸 '2y' / '5y' / 'max' 등 정책 위반 입력은 자동 cap.
  const range = capYahooRange(typeof req.query.range === 'string' ? req.query.range : undefined);
  const interval = typeof req.query.interval === 'string' && req.query.interval.length > 0 ? req.query.interval : '1d';
  const decision = evaluateMarketGate(symbol, range, interval);
  if (decision.action === 'pass') return next();
  // 다음 개장 시각 힌트 — 프론트엔드 retry 스케줄링 근거 (장외 응답에만 부가).
  try {
    res.setHeader('X-Market-Next-Open', nextOpenAtFor(symbol).toISOString());
  } catch { /* 분류 실패·범위 밖 — 헤더 생략 */ }
  if (decision.action === 'stale') {
    res.setHeader('Content-Type', decision.contentType);
    res.setHeader('X-Cache', 'STALE-OFFHOURS');
    return res.send(decision.body);
  }
  res.setHeader('X-Cache', 'OFFHOURS-SKIP');
  return res.status(204).end();
});

// ─── KRX PER/PBR 조회 — 밸류에이션 매트릭스 클라이언트 표시용 ───────────────
router.get('/krx/valuation', async (req: Request, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'code(6자리 숫자)가 필요합니다.' });
  }
  try {
    const rows = await fetchPerPbr();
    const row = rows.find((r) => r.code === code);
    if (!row) return res.json({ code, per: 0, pbr: 0, eps: 0, bps: 0, found: false });
    return res.json({
      code: row.code,
      name: row.name,
      per: row.per,
      pbr: row.pbr,
      eps: row.eps,
      bps: row.bps,
      dividendYield: row.dividendYield,
      found: true,
    });
  } catch (err: any) {
    console.error('[marketData] /krx/valuation 실패:', err?.message || err);
    return res.status(502).json({ error: 'KRX 조회 실패', detail: err?.message });
  }
});

// ─── Yahoo Finance Historical Data Proxy ────────────────────────────────────
router.get('/historical-data', async (req: Request, res: Response) => {
  const { symbol, range, interval } = req.query;
  if (!symbol) return res.status(400).json({ error: "Symbol is required" });

  const symbolStr = String(symbol);
  // ADR-0082: 사용자 명시 "Yahoo 2y 전역 금지" — 모든 자동 호출 outbound URL 의 range 를
  // 정책 상한 ('1y') 으로 cap. 클라이언트 UI ('2y' 차트 옵션) 가 보내도 서버에서 자동 축소.
  const rangeStr = capYahooRange(typeof range === 'string' ? range : undefined);
  const intervalStr = typeof interval === 'string' && interval.length > 0 ? interval : '1d';

  // ADR-0009: 인프로세스 LRU 캐시.
  const cacheKey = `${symbolStr}:${rangeStr}:${intervalStr}`;
  const cached = proxyCacheGet(cacheKey);
  if (cached) {
    const now = Date.now();
    if (now - _lastProxyCacheLogAt >= PROXY_LOG_INTERVAL_MS) {
      _lastProxyCacheLogAt = now;
      logger.debug('[YahooProxy] cache hit', { symbol: symbolStr, range: rangeStr, interval: intervalStr });
    }
    res.setHeader('Content-Type', cached.contentType);
    res.setHeader('X-Cache', 'HIT');
    return res.send(cached.body);
  }

  // ADR-0010: in-flight coalescing — 캐시 set 이전 윈도우의 동시 요청을 1회 outbound 로 수렴.
  let inflight = _yahooInflight.get(cacheKey);
  let coalesced = false;
  if (inflight) {
    coalesced = true;
  } else {
    inflight = fetchAndStoreYahooHistoricalSnapshot({
      symbol: symbolStr,
      range: rangeStr,
      interval: intervalStr,
      cacheKey,
    })
      .then((result) => {
        if (result.status === 200) {
          proxyCacheSet(cacheKey, {
            body: result.body,
            contentType: result.contentType,
            expiresAt: Date.now() + yahooProxyTtlMs(intervalStr),
          });
        }
        return result;
      })
      .finally(() => { _yahooInflight.delete(cacheKey); });
    _yahooInflight.set(cacheKey, inflight);
  }

  const result = await inflight;
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('X-Cache', coalesced ? 'COALESCED' : 'MISS');
  return res.status(result.status).send(result.body);
});

// ─── ECOS (한국은행 경제통계시스템) API 프록시 ─────────────────────────────
// API 키를 서버에서만 사용하여 클라이언트 노출을 방지합니다.
router.get('/ecos', async (req: Request, res: Response) => {
  const { statCode, period, startDate, endDate, itemCode1, itemCode2 } = req.query;

  if (!process.env.ECOS_API_KEY) {
    return res.status(500).json({ error: 'ECOS_API_KEY 미설정. .env 파일에 ECOS_API_KEY를 추가하세요.' });
  }
  if (!statCode || !period || !startDate || !endDate || !itemCode1) {
    return res.status(400).json({ error: '필수 파라미터 누락: statCode, period, startDate, endDate, itemCode1' });
  }

  // ECOS REST URL: /api/StatisticSearch/{KEY}/{format}/{lang}/{startNo}/{endNo}/{statCode}/{period}/{start}/{end}/{item1}/{item2?}
  const apiKey = process.env.ECOS_API_KEY;
  const item2Part = itemCode2 ? `/${itemCode2}` : '';
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/1000/${statCode}/${period}/${startDate}/${endDate}/${itemCode1}${item2Part}`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error('ECOS proxy error:', error.message);
    res.status(500).json({ error: 'ECOS API 호출 실패', details: error.message });
  }
});

// ECOS 매크로 스냅샷 — 주요 지표 일괄 조회 (서버사이드 직접 호출)
router.get('/ecos/snapshot', async (_req: Request, res: Response) => {
  if (!process.env.ECOS_API_KEY) {
    return res.status(500).json({ error: 'ECOS_API_KEY 미설정' });
  }

  const apiKey = process.env.ECOS_API_KEY;
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const thisMonth = `${now.getFullYear()}${pad2(now.getMonth() + 1)}`;
  const monthAgo6 = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`; })();
  const monthAgo6M = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return `${d.getFullYear()}${pad2(d.getMonth() + 1)}`; })();
  const monthAgo24M = (() => { const d = new Date(); d.setMonth(d.getMonth() - 24); return `${d.getFullYear()}${pad2(d.getMonth() + 1)}`; })();
  const yearAgo3Q = `${now.getFullYear() - 3}Q1`;
  const thisQ = `${now.getFullYear()}Q${Math.ceil((now.getMonth() + 1) / 3)}`;

  const buildUrl = (stat: string, period: string, start: string, end: string, item1: string, item2?: string) => {
    const i2 = item2 ? `/${item2}` : '';
    return `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/500/${stat}/${period}/${start}/${end}/${item1}${i2}`;
  };

  try {
    const [bokRes, fxRes, m2Res, gdpRes, expRes, impRes] = await Promise.allSettled([
      fetch(buildUrl('722Y001', 'D', monthAgo6, today, '0101000')).then(r => r.json()),
      fetch(buildUrl('731Y003', 'D', monthAgo6, today, '0000001', '0000003')).then(r => r.json()),
      fetch(buildUrl('101Y003', 'M', monthAgo24M, thisMonth, 'BBGA00')).then(r => r.json()),
      fetch(buildUrl('111Y002', 'Q', yearAgo3Q, thisQ, '10111')).then(r => r.json()),
      fetch(buildUrl('403Y003', 'M', monthAgo24M, thisMonth, '000000', '1')).then(r => r.json()),
      fetch(buildUrl('403Y003', 'M', monthAgo24M, thisMonth, '000000', '2')).then(r => r.json()),
    ]);

    res.json({
      bokRate: bokRes.status === 'fulfilled' ? bokRes.value : null,
      exchangeRate: fxRes.status === 'fulfilled' ? fxRes.value : null,
      m2: m2Res.status === 'fulfilled' ? m2Res.value : null,
      gdp: gdpRes.status === 'fulfilled' ? gdpRes.value : null,
      exports: expRes.status === 'fulfilled' ? expRes.value : null,
      imports: impRes.status === 'fulfilled' ? impRes.value : null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('ECOS snapshot error:', error.message);
    res.status(500).json({ error: 'ECOS 스냅샷 조회 실패', details: error.message });
  }
});

// ─── Market Indicators — VIX · US10Y · Samsung IRI proxy (Yahoo Finance) ──────
// 브라우저 CORS 우회 + 병렬 수집. getBatchGlobalIntel Phase A에서 사용.
router.get('/market-indicators', async (_req: Request, res: Response) => {
  const fetchYahoo = async (symbol: string, range = '5d'): Promise<any> => {
    for (const host of ['query2', 'query1']) {
      try {
        const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
        const r = await guardedFetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        }, 'REALTIME');
        if (r.ok) {
          const data = await r.json();
          if (data?.chart?.result?.[0]) return data.chart.result[0];
        }
      } catch { /* try next host */ }
    }
    return null;
  };

  const [vixR, us10yR, irxR, samsungR, vkospiR, ks11R, kq11R, ewyR, mtumR] = await Promise.allSettled([
    fetchYahoo('^VIX'),
    fetchYahoo('^TNX'),
    fetchYahoo('^IRX'),          // 13주 T-bill ≈ Fed Funds Rate proxy
    fetchYahoo('005930.KS', '1mo'),
    fetchYahoo('^VKOSPI'),       // 한국 변동성 지수 (KOSPI 200 기반)
    fetchYahoo('^KS11', '1d'),   // KOSPI 지수
    fetchYahoo('^KQ11', '1d'),   // KOSDAQ 지수
    fetchYahoo('EWY', '5d'),     // iShares MSCI Korea ETF (스마트머니 프록시)
    fetchYahoo('MTUM', '5d'),    // iShares MSCI USA Momentum Factor ETF
  ]);

  const getPrice = (r: PromiseSettledResult<any>): number | null =>
    r.status === 'fulfilled' && r.value ? (r.value.meta?.regularMarketPrice ?? null) : null;

  // 지수 정보: price + change + changePercent
  const getQuote = (r: PromiseSettledResult<any>): { price: number; change: number; changePct: number } | null => {
    if (r.status !== 'fulfilled' || !r.value) return null;
    const meta = r.value.meta;
    const price  = meta?.regularMarketPrice ?? null;
    const prev   = meta?.regularMarketPreviousClose ?? meta?.previousClose ?? null;
    if (price === null) return null;
    const change    = prev !== null ? parseFloat((price - prev).toFixed(2)) : 0;
    const changePct = prev !== null ? parseFloat(((price - prev) / prev * 100).toFixed(2)) : 0;
    return { price, change, changePct };
  };

  // ETF 5일 수익률 (스마트머니 흐름 프록시)
  const getEtfReturn = (r: PromiseSettledResult<any>): number | null => {
    if (r.status !== 'fulfilled' || !r.value) return null;
    const closes: (number | null)[] = r.value.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c !== null);
    if (valid.length < 2) return null;
    return parseFloat(((valid[valid.length - 1] - valid[0]) / valid[0] * 100).toFixed(2));
  };

  // Samsung 30-day return → samsungIri (0.5–1.5, neutral=1.0)
  let samsungIri: number | null = null;
  if (samsungR.status === 'fulfilled' && samsungR.value) {
    const closes: (number | null)[] = samsungR.value.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c !== null);
    if (valid.length >= 2) {
      const ret = (valid[valid.length - 1] - valid[0]) / valid[0];
      samsungIri = parseFloat(Math.max(0.5, Math.min(1.5, 1.0 + ret * (0.5 / 0.15))).toFixed(3));
    }
  }

  // ADR-0065 PR-γ: 11 필드를 fresh 응답으로 모은 후 (a) 성공 필드만 snapshot 갱신
  // (b) 실패 (null) 필드는 snapshot 의 last-known-good 으로 fill + X-Field-Stale 헤더에 기록.
  const fresh: MarketIndicatorsFresh = {
    vix:             getPrice(vixR),
    us10yYield:      getPrice(us10yR),
    usShortRate:     getPrice(irxR),
    samsungIri,
    vkospi:          getPrice(vkospiR),
    vkospiDayChange: getQuote(vkospiR)?.changePct ?? null,
    vkospi5dTrend:   getEtfReturn(vkospiR),
    kospi:           getQuote(ks11R),
    kosdaq:          getQuote(kq11R),
    ewyReturn:       getEtfReturn(ewyR),
    mtumReturn:      getEtfReturn(mtumR),
  };

  const capturedAt = new Date().toISOString();
  let staleFields: string[] = [];
  try {
    const current = loadMarketIndicatorsSnapshot();
    const filled = fillMissingFromSnapshot(fresh, current);
    staleFields = filled.staleFields;
    const merged = mergeFreshIntoSnapshot(current, fresh, capturedAt);
    saveMarketIndicatorsSnapshot(merged);

    if (staleFields.length > 0) {
      res.set('X-Field-Stale', staleFields.join(','));
    }

    res.json({
      ...filled.body,
      fetchedAt: capturedAt,
    });
  } catch (e) {
    // snapshot I/O 실패 시 graceful — fresh 그대로 반환 (PR-γ 이전 동작과 동일).
    console.warn('[MarketIndicatorsSnapshot] fill/save 실패 — fresh 응답 그대로 반환:', e instanceof Error ? e.message : e);
    res.json({
      ...fresh,
      fetchedAt: capturedAt,
    });
  }
});

// ─── 글로벌 스캔 보고서 — KST 06:00 자동 생성 결과 조회 ──────────────────────
router.get('/market/global-scan', (_req: Request, res: Response) => {
  const report = loadGlobalScanReport();
  if (!report) return res.status(404).json({ error: '글로벌 스캔 보고서 없음 — KST 06:00 이후 생성됩니다' });
  res.json(report);
});

// ─── 뉴스-수급 시차 학습 DB ─────────────────────────────────────────────────
// GET /api/market/news-supply-patterns — newsType별 T+1·T+3·T+5 평균 패턴
router.get('/market/news-supply-patterns', (_req: Request, res: Response) => {
  const patterns = analyzeNewsSupplyPatterns();
  const records  = loadNewsSupplyRecords();
  res.json({
    patterns,
    totalRecords:    records.length,
    completedCount:  records.filter(r => r.isComplete).length,
    pendingCount:    records.filter(r => !r.isComplete).length,
    updatedAt:       new Date().toISOString(),
  });
});

// ─── FOMC 캘린더 ─────────────────────────────────────────────────────────────
// GET /api/market/fomc — 현재 근접도 + 전체 일정
router.get('/market/fomc', (_req: Request, res: Response) => {
  res.json({
    proximity: getFomcProximity(),
    dates:     FOMC_DATES,
  });
});

// GET /api/market/fomc-calendar.ics — Google Calendar 임포트용 iCalendar 파일
router.get('/market/fomc-calendar.ics', (_req: Request, res: Response) => {
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="fomc-2025-2026.ics"');
  res.send(generateFomcIcs());
});

// ─── FRED API Proxy (TED/HY Spread 무료, Search 대체) ─────────────────────────
router.get('/fred', async (req: Request, res: Response) => {
  const { series_id } = req.query;
  if (!series_id) return res.status(400).json({ error: 'series_id required' });
  const apiKey = process.env.FRED_API_KEY ?? '';
  const url = `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${series_id}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=3`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(r.status).json({ error: `FRED ${r.status}` });
    const data = await r.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: 'FRED fetch failed', details: error.message });
  }
});

// ─── 아이디어 11: MHS 자체 계산 엔진 — ECOS + FRED 결정적 도출 ──────────────
// GET  /api/market/macro-index         — 결정적 MHS + 축별 점수 + 드라이버
// GET  /api/market/macro-index?commentary=1 — 위 결과 + Gemini 해석 코멘트
// POST /api/market/macro-index         — 클라이언트가 VKOSPI/VIX/IRI 주입해 재계산
router.get('/market/macro-index', async (req: Request, res: Response) => {
  try {
    const parseNum = (v: unknown): number | undefined => {
      if (typeof v !== 'string') return undefined;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const result = await computeMacroIndex({
      vkospi:     parseNum(req.query.vkospi),
      vix:        parseNum(req.query.vix),
      samsungIri: parseNum(req.query.samsungIri),
      us10yYield: parseNum(req.query.us10y),
    });
    const wantCommentary = req.query.commentary === '1' || req.query.commentary === 'true';
    const commentary = wantCommentary ? await generateMacroCommentary(result) : null;
    res.json({ ...result, commentary });
  } catch (e: any) {
    console.error('macro-index error:', e?.message ?? e);
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

router.post('/market/macro-index', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    const result = await computeMacroIndex({
      vkospi:      num(body.vkospi),
      vix:         num(body.vix),
      samsungIri:  num(body.samsungIri),
      us10yYield:  num(body.us10yYield),
      usShortRate: num(body.usShortRate),
    });
    const commentary = body.commentary === true ? await generateMacroCommentary(result) : null;
    res.json({ ...result, commentary });
  } catch (e: any) {
    console.error('macro-index POST error:', e?.message ?? e);
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

// GET /api/market/macro-index/context — Gemini 주입 블록 문자열만 반환 (디버깅용)
router.get('/market/macro-index/context', async (_req: Request, res: Response) => {
  try {
    const result = await computeMacroIndex();
    res.type('text/plain').send(buildMacroInterpretContext(result));
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'internal error' });
  }
});

// ─── OHLCV 기반 백테스트 결과 조회 / 실행 ─────────────────────────────────────
// GET  /api/market/backtest — 즉시 실행 + 결과 반환 (처음 호출 or 갱신 필요 시)
// POST /api/market/backtest — 수동 강제 재실행
router.get('/market/backtest', async (_req: Request, res: Response) => {
  try {
    const summary = await runBacktest();
    res.json(summary);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/market/backtest', async (_req: Request, res: Response) => {
  try {
    const summary = await runBacktest();
    res.json(summary);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
