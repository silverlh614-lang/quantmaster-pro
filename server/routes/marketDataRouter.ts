// server/routes/marketDataRouter.ts
// 외부 시장 데이터 라우터 — server.ts에서 분리
// ECOS(한국은행), FRED, Yahoo Finance 프록시, 시장지표 일괄 조회
import { Router, Request, Response } from 'express';
import { loadGlobalScanReport } from '../alerts/globalScanAgent.js';

const router = Router();

// ─── Yahoo Finance Historical Data Proxy ────────────────────────────────────
router.get('/historical-data', async (req: Request, res: Response) => {
  const { symbol, range, interval } = req.query;
  if (!symbol) return res.status(400).json({ error: "Symbol is required" });

  // Try query2 first as it's often more reliable/less throttled
  const urls = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range || '1y'}&interval=${interval || '1d'}`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range || '1y'}&interval=${interval || '1d'}`
  ];

  let lastError = null;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`Proxying request to Yahoo (${url.includes('query2') ? 'query2' : 'query1'}): ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        // Check if we actually got data
        if (data.chart?.result?.[0]) {
          return res.json(data);
        } else if (data.chart?.error) {
          console.warn(`Yahoo API returned error for ${symbol}:`, data.chart.error);
          lastError = data.chart.error;
          // Wait a bit before trying next URL
          if (i < urls.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
      } else if (response.status === 404) {
        console.warn(`Yahoo API symbol not found (404) for ${symbol}`);
        return res.status(404).json({ error: "Symbol not found", symbol });
      }

      const errorText = await response.text();
      console.error(`Yahoo API error (${response.status}) for ${symbol}:`, errorText);
      lastError = { status: response.status, details: errorText };
      // Wait a bit before trying next URL
      if (i < urls.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error: any) {
      console.error(`Proxy error for ${symbol} using ${url.includes('query2') ? 'query2' : 'query1'}:`, error.message);
      lastError = error;
      // Wait a bit before trying next URL
      if (i < urls.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  res.status(502).json({
    error: "Failed to fetch data from Yahoo after multiple attempts",
    details: lastError?.message || lastError?.details || "Unknown error",
    symbol
  });
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
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });
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
    const prev   = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
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

  res.json({
    vix:         getPrice(vixR),
    us10yYield:  getPrice(us10yR),
    usShortRate: getPrice(irxR),
    samsungIri,
    vkospi:          getPrice(vkospiR),
    vkospiDayChange: getQuote(vkospiR)?.changePct ?? null,  // VKOSPI 당일 변화율 (%)
    vkospi5dTrend:   getEtfReturn(vkospiR),                 // VKOSPI 5일 추세 (%)
    kospi:       getQuote(ks11R),   // { price, change, changePct }
    kosdaq:      getQuote(kq11R),   // { price, change, changePct }
    ewyReturn:   getEtfReturn(ewyR),  // EWY 5일 수익률 (%)
    mtumReturn:  getEtfReturn(mtumR), // MTUM 5일 수익률 (%)
    fetchedAt:   new Date().toISOString(),
  });
});

// ─── 글로벌 스캔 보고서 — KST 06:00 자동 생성 결과 조회 ──────────────────────
router.get('/market/global-scan', (_req: Request, res: Response) => {
  const report = loadGlobalScanReport();
  if (!report) return res.status(404).json({ error: '글로벌 스캔 보고서 없음 — KST 06:00 이후 생성됩니다' });
  res.json(report);
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

export default router;
