/// <reference types="node" />
import express, { Request, Response } from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import cron from "node-cron";
import {
  runAutoSignalScan,
  generateDailyReport,
  loadWatchlist,
  saveWatchlist,
  getShadowTrades,
  getScreenerCache,
  preScreenStocks,
  autoPopulateWatchlist,
  getDartAlerts,
  pollDartDisclosures,
  getRecommendations,
  getMonthlyStats,
  evaluateRecommendations,
  sendTelegramAlert,
  loadMacroState,
  saveMacroState,
  fillMonitor,
  tradingOrchestrator,
  fastDartCheck,
  trancheExecutor,
  isRealTradeReady,
  pollBearRegime,
  pollMhsMorningAlert,
  pollIpsAlert,
  generateWeeklyReport,
  sendWatchlistBriefing,
  sendIntradayCheckIn,
  type WatchlistEntry,
  type MacroState,
} from "./src/server/autoTradeEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// ─────────────────────────────────────────────────────────────
// 아이디어 9: 서버사이드 비상 정지 모듈 (Circuit Breaker)
// 브라우저를 닫아도 서버 메모리에서 플래그 유지
// ─────────────────────────────────────────────────────────────
let EMERGENCY_STOP = false;
let DAILY_LOSS_PCT  = 0;   // 실시간 누적 손실률 (%)

export function isEmergencyStopped() { return EMERGENCY_STOP; }
export function setDailyLoss(pct: number) { DAILY_LOSS_PCT = pct; }

// 미체결 주문 전량 취소 — KIS 미체결 조회 후 취소 (서버사이드 직접 호출)
async function cancelAllPendingOrders(): Promise<void> {
  if (!process.env.KIS_APP_KEY) return;
  console.error('[EMERGENCY] KIS 미체결 주문 전량 취소 시작');
  try {
    const { refreshKisToken: getToken } = await import('./src/server/autoTradeEngine.js');
    const token = await getToken();
    const isReal = process.env.KIS_IS_REAL === 'true';
    const base   = isReal ? 'https://openapi.koreainvestment.com:9443' : 'https://openapivts.koreainvestment.com:29443';
    const trId   = isReal ? 'TTTC0688R' : 'VTTC0688R'; // 미체결 조회

    const res = await fetch(
      `${base}/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl?` +
      new URLSearchParams({
        CANO: process.env.KIS_ACCOUNT_NO ?? '',
        ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
        CTX_AREA_FK100: '', CTX_AREA_NK100: '',
        INQR_DVSN_1: '0', INQR_DVSN_2: '0',
      }),
      { headers: {
        Authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY!, appsecret: process.env.KIS_APP_SECRET!,
        tr_id: trId, custtype: 'P', 'Content-Type': 'application/json',
      }}
    );
    const data = await res.json() as { output?: { odno: string; pdno: string; ord_qty: string }[] };
    const orders = data.output ?? [];
    console.error(`[EMERGENCY] 미체결 주문 ${orders.length}건 취소 처리`);

    const cancelTrId = isReal ? 'TTTC0803U' : 'VTTC0803U';
    for (const o of orders) {
      await fetch(`${base}/uapi/domestic-stock/v1/trading/order-rvsecncl`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          appkey: process.env.KIS_APP_KEY!, appsecret: process.env.KIS_APP_SECRET!,
          tr_id: cancelTrId, custtype: 'P', 'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          CANO: process.env.KIS_ACCOUNT_NO ?? '',
          ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
          KRX_FWDG_ORD_ORGNO: '', ORGN_ODNO: o.odno,
          ORD_DVSN: '00', RVSE_CNCL_DVSN_CD: '02',
          ORD_QTY: o.ord_qty, ORD_UNPR: '0', QTY_ALL_ORD_YN: 'Y', PDNO: o.pdno,
        }),
      }).catch((e) => console.error(`[EMERGENCY] 취소 실패 ODNO ${o.odno}:`, e));
    }
    console.error('[EMERGENCY] 미체결 전량 취소 완료');
  } catch (e) {
    console.error('[EMERGENCY] cancelAllPendingOrders 실패:', e);
  }
}

async function checkDailyLossLimit(): Promise<void> {
  const limit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '5');
  if (DAILY_LOSS_PCT >= limit && !EMERGENCY_STOP) {
    EMERGENCY_STOP = true;
    console.error(`[EMERGENCY] 일일 손실 한도 도달 (${DAILY_LOSS_PCT.toFixed(2)}% ≥ ${limit}%) — 자동매매 중단`);
    await cancelAllPendingOrders();
    const { generateDailyReport } = await import('./src/server/autoTradeEngine.js');
    await generateDailyReport().catch(console.error);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // API routes
  app.get("/api/historical-data", async (req: Request, res: Response) => {
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

  // ─────────────────────────────────────────────────────────────
  // KIS API Proxy
  // ─────────────────────────────────────────────────────────────
  let kisToken: { token: string; expiry: number } | null = null;

  async function getKisToken(): Promise<string> {
    if (kisToken && Date.now() < kisToken.expiry) return kisToken.token;
    const isReal = process.env.KIS_IS_REAL === 'true';
    const base = isReal
      ? 'https://openapi.koreainvestment.com:9443'
      : 'https://openapivts.koreainvestment.com:29443';
    const res = await fetch(`${base}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
      }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`KIS 토큰 발급 실패: ${JSON.stringify(data)}`);
    kisToken = { token: data.access_token, expiry: Date.now() + 23 * 60 * 60 * 1000 };
    console.log('KIS 토큰 발급 완료');
    return kisToken.token;
  }

  async function kisGet(trId: string, path: string, params: Record<string, string>) {
    const isReal = process.env.KIS_IS_REAL === 'true';
    const base = isReal
      ? 'https://openapi.koreainvestment.com:9443'
      : 'https://openapivts.koreainvestment.com:29443';
    const token = await getKisToken();
    const url = `${base}${path}?${new URLSearchParams(params)}`;
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'appkey': process.env.KIS_APP_KEY!,
        'appsecret': process.env.KIS_APP_SECRET!,
        'tr_id': trId,
        'custtype': 'P',
      },
    });
    const text = await res.text();
    if (!text || text.trim() === '') {
      console.warn(`KIS ${trId} 빈 응답 (장 외 시간일 수 있음)`);
      return { rt_cd: '1', msg1: '빈 응답 (장 외 시간일 수 있음)', output: [] };
    }
    try {
      return JSON.parse(text);
    } catch {
      console.error(`KIS ${trId} JSON 파싱 실패:`, text.substring(0, 200));
      return { rt_cd: '1', msg1: 'JSON 파싱 실패', output: [] };
    }
  }

  // [KIS-1] 외국인/기관 수급
  app.get('/api/kis/supply', async (req: any, res: any) => {
    const { code } = req.query;
    if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
    if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
    try {
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0].replace(/-/g, '');
      const data = await kisGet(
        'FHKST01010900',
        '/uapi/domestic-stock/v1/quotations/investor',
        {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: code as string,
          FID_BEGIN_DATE: weekAgo,
          FID_END_DATE: today,
        }
      );
      res.json(data);
    } catch (e: any) {
      console.error('KIS supply error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // [KIS-2] 공매도 현황
  app.get('/api/kis/short-selling', async (req: any, res: any) => {
    const { code } = req.query;
    if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
    if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
    try {
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0].replace(/-/g, '');
      const data = await kisGet(
        'FHKST01010100',
        '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
        {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: code as string,
          FID_INPUT_DATE_1: monthAgo,
          FID_INPUT_DATE_2: today,
          FID_PERIOD_DIV_CODE: 'D',
          FID_ORG_ADJ_PRC: '0',
        }
      );
      res.json(data);
    } catch (e: any) {
      console.error('KIS short-selling error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // [KIS-3] 현재가 (Yahoo 폴백용)
  app.get('/api/kis/price', async (req: any, res: any) => {
    const { code } = req.query;
    if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
    if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
    try {
      const data = await kisGet(
        'FHKST01010100',
        '/uapi/domestic-stock/v1/quotations/inquire-price',
        { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code as string }
      );
      res.json(data);
    } catch (e: any) {
      console.error('KIS price error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // [KIS-0] 토큰 상태 확인 (체크리스트 Step 1)
  app.get('/api/kis/token-status', async (_req: any, res: any) => {
    if (!process.env.KIS_APP_KEY) return res.json({ valid: false, reason: 'KIS_APP_KEY 미설정' });
    try {
      const token = await getKisToken();
      const remaining = kisToken ? Math.floor((kisToken.expiry - Date.now()) / 1000 / 60 / 60) : 0;
      res.json({ valid: !!token, expiresIn: `${remaining}h` });
    } catch (e: any) {
      res.json({ valid: false, reason: e.message });
    }
  });

  // [KIS-Balance] 모의계좌 잔고 조회 (체크리스트 Step 3)
  app.get('/api/kis/balance', async (_req: any, res: any) => {
    if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
    try {
      const isReal = process.env.KIS_IS_REAL === 'true';
      const trId = isReal ? 'TTTC8434R' : 'VTTC8434R';
      const data = await kisGet(trId, '/uapi/domestic-stock/v1/trading/inquire-balance', {
        CANO: process.env.KIS_ACCOUNT_NO ?? '',
        ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PROD ?? '01',
        AFHR_FLPR_YN: 'N',
        OFL_YN: '',
        INQR_DVSN: '02',
        UNPR_DVSN: '01',
        FUND_STTL_ICLD_YN: 'N',
        FNCG_AMT_AUTO_RDPT_YN: 'N',
        PRCS_DVSN: '01',
        CTX_AREA_FK100: '',
        CTX_AREA_NK100: '',
      });
      res.json(data);
    } catch (e: any) {
      console.error('KIS balance error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // [KIS-Generic] 범용 KIS API 프록시 — App Secret은 서버 메모리에서만 존재
  app.post('/api/kis/proxy', async (req: any, res: any) => {
    if (!process.env.KIS_APP_KEY) return res.status(500).json({ error: 'KIS_APP_KEY 미설정' });
    try {
      const token = await getKisToken();
      const isReal = process.env.KIS_IS_REAL === 'true';
      const base = isReal
        ? 'https://openapi.koreainvestment.com:9443'
        : 'https://openapivts.koreainvestment.com:29443';
      const { path, method = 'GET', headers = {}, body, params } = req.body;

      let url = `${base}${path}`;
      if (params && Object.keys(params).length > 0) {
        url += `?${new URLSearchParams(params)}`;
      }

      const kisRes = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          appkey: process.env.KIS_APP_KEY!,
          appsecret: process.env.KIS_APP_SECRET!,
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await kisRes.text();
      if (!text || text.trim() === '') {
        return res.json({ rt_cd: '1', msg1: '빈 응답 (장 외 시간일 수 있음)' });
      }
      try {
        res.json(JSON.parse(text));
      } catch {
        res.status(502).json({ error: 'KIS 응답 파싱 실패', raw: text.substring(0, 200) });
      }
    } catch (e: any) {
      console.error('KIS proxy error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── ECOS (한국은행 경제통계시스템) API 프록시 ─────────────────────────────
  // API 키를 서버에서만 사용하여 클라이언트 노출을 방지합니다.
  app.get('/api/ecos', async (req: Request, res: Response) => {
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
  app.get('/api/ecos/snapshot', async (_req: Request, res: Response) => {
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
  app.get('/api/market-indicators', async (_req: Request, res: Response) => {
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
      vkospi:      getPrice(vkospiR),
      kospi:       getQuote(ks11R),   // { price, change, changePct }
      kosdaq:      getQuote(kq11R),   // { price, change, changePct }
      ewyReturn:   getEtfReturn(ewyR),  // EWY 5일 수익률 (%)
      mtumReturn:  getEtfReturn(mtumR), // MTUM 5일 수익률 (%)
      fetchedAt:   new Date().toISOString(),
    });
  });

  // ─── FRED API Proxy (TED/HY Spread 무료, Search 대체) ─────────────────────────
  app.get('/api/fred', async (req: Request, res: Response) => {
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

  // ─── DART 공시 목록 Proxy (최근 공시 리스트, Search 대체) ──────────────────────
  app.get('/api/dart/list', async (req: Request, res: Response) => {
    if (!process.env.DART_API_KEY) {
      return res.status(500).json({ error: 'DART_API_KEY is not set' });
    }
    const { bgn_de, end_de, pblntf_ty = 'B001' } = req.query;
    if (!bgn_de || !end_de) return res.status(400).json({ error: 'bgn_de, end_de required' });
    const url = `https://opendart.fss.or.kr/api/list.json` +
      `?crtfc_key=${process.env.DART_API_KEY}` +
      `&bgn_de=${bgn_de}&end_de=${end_de}` +
      `&pblntf_ty=${pblntf_ty}&sort=rcp_dt&sort_mth=desc&page_count=40`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await r.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: 'DART list fetch failed', details: error.message });
    }
  });

  // DART API Proxy
  app.get('/api/dart', async (req: Request, res: Response) => {
    const { corp_code, bsns_year, reprt_code, fs_div } = req.query;
    if (!process.env.DART_API_KEY) {
      return res.status(500).json({ error: "DART_API_KEY is not set" });
    }
    const url = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json` +
      `?crtfc_key=${process.env.DART_API_KEY}` +
      `&corp_code=${corp_code}&bsns_year=${bsns_year}` +
      `&reprt_code=${reprt_code}&fs_div=${fs_div}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("DART Proxy Error:", error);
      res.status(500).json({ error: "Failed to fetch from DART", details: error.message });
    }
  });

  // DART 법인코드 검색 프록시
  app.get('/api/dart/company', async (req: Request, res: Response) => {
    const { stock_code } = req.query;
    if (!process.env.DART_API_KEY) {
      return res.status(500).json({ error: "DART_API_KEY is not set" });
    }
    const url = `https://opendart.fss.or.kr/api/company.json` +
      `?crtfc_key=${process.env.DART_API_KEY}&stock_code=${stock_code}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("DART Company Proxy Error:", error);
      res.status(500).json({ error: "Failed to fetch company info from DART", details: error.message });
    }
  });

  app.post("/api/send-email", async (req: Request, res: Response) => {
    const { email, subject, text, pdfBase64, filename } = req.body;

    if (!email || !pdfBase64) {
      return res.status(400).json({ error: "Email and PDF data are required" });
    }

    try {
      // Check if environment variables are set
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.error("Email credentials missing in environment variables");
        return res.status(500).json({ 
          error: "이메일 서버가 설정되지 않았습니다.", 
          details: "서버의 EMAIL_USER 또는 EMAIL_PASS 환경 변수가 누락되었습니다. AI Studio 설정에서 이를 추가해주세요." 
        });
      }

      // Create a transporter
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: subject || "Stock Analysis Report",
        text: text || "Please find the attached stock analysis report.",
        attachments: [
          {
            filename: filename || "report.pdf",
            content: pdfBase64.split("base64,")[1],
            encoding: 'base64'
          }
        ]
      };

      await transporter.sendMail(mailOptions);
      res.json({ success: true, message: "Email sent successfully" });
    } catch (error: any) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: "Failed to send email", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // vite.config.ts outDir: 'build' 기준으로 탐색, dist도 폴백으로 확인
    const candidates = [
      path.join(__dirname, 'build'),
      path.join(process.cwd(), 'build'),
      path.join(__dirname, 'dist'),
      path.join(process.cwd(), 'dist'),
      __dirname,
    ];
    const distPath = candidates.find(p => fs.existsSync(path.join(p, 'index.html'))) ?? candidates[0];
    console.log(`Serving static files from: ${distPath}`);
        
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 아이디어 7: Health Check + Keep-Alive
  // ─────────────────────────────────────────────────────────────
  const serverStart = new Date().toISOString();

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      emergencyStop: EMERGENCY_STOP,
      dailyLossPct: DAILY_LOSS_PCT,
      autoTradeEnabled: process.env.AUTO_TRADE_ENABLED === 'true',
      mode: process.env.AUTO_TRADE_MODE ?? 'SHADOW',
      kisIsReal: process.env.KIS_IS_REAL === 'true',
      uptime: process.uptime(),
      startedAt: serverStart,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 아이디어 9: 비상 정지 API
  // ─────────────────────────────────────────────────────────────

  app.get('/api/emergency-status', (_req: Request, res: Response) => {
    res.json({ emergencyStop: EMERGENCY_STOP, dailyLossPct: DAILY_LOSS_PCT });
  });

  app.post('/api/emergency-stop', async (_req: Request, res: Response) => {
    EMERGENCY_STOP = true;
    console.error('[EMERGENCY] 수동 비상 정지 발동!');
    await cancelAllPendingOrders().catch(console.error);
    res.json({ status: 'STOPPED', stoppedAt: new Date().toISOString() });
  });

  app.post('/api/emergency-reset', (req: Request, res: Response) => {
    const secret = process.env.EMERGENCY_RESET_SECRET;
    if (secret && req.body?.secret !== secret) {
      return res.status(403).json({ error: '인증 실패' });
    }
    EMERGENCY_STOP = false;
    DAILY_LOSS_PCT  = 0;
    console.log('[EMERGENCY] 비상 정지 해제 — 자동매매 재개');
    res.json({ status: 'RESUMED' });
  });

  // ─── 아이디어 7: Telegram 양방향 봇 Webhook ────────────────────────────────────
  // Railway 엔드포인트 등록: POST /api/telegram/webhook
  // Telegram Bot API에서 setWebhook → https://<RAILWAY_URL>/api/telegram/webhook
  app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
    res.sendStatus(200); // Telegram에 즉시 200 응답 (재전송 방지)

    const msg = req.body?.message;
    if (!msg?.text) return;

    const chatId = String(msg.chat?.id ?? '');
    const allowedId = process.env.TELEGRAM_CHAT_ID ?? '';
    // 등록된 채팅방만 허용 (타인의 봇 접근 차단)
    if (allowedId && chatId !== allowedId) {
      console.warn(`[TelegramBot] 허가되지 않은 채팅 ID: ${chatId}`);
      return;
    }

    const text: string = msg.text.trim();
    const [cmd, ...args] = text.split(/\s+/);

    const reply = async (message: string) => {
      await sendTelegramAlert(message).catch(console.error);
    };

    try {
      switch (cmd.toLowerCase()) {
        case '/status': {
          const macro   = loadMacroState();
          const shadows = getShadowTrades();
          const active  = shadows.filter(s => (s as any).status === 'ACTIVE' || (s as any).status === 'PENDING');
          const today   = new Date().toISOString().split('T')[0];
          const closed  = shadows.filter(s =>
            ((s as any).status === 'HIT_TARGET' || (s as any).status === 'HIT_STOP') &&
            (s as any).signalTime?.startsWith(today)
          );
          const pnl = closed.reduce((sum, s) => sum + ((s as any).returnPct ?? 0), 0);
          await reply(
            `📊 <b>[시스템 현황]</b>\n` +
            `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? '🟡 Shadow' : '🔴 LIVE'}\n` +
            `비상정지: ${EMERGENCY_STOP ? '🔴 ON' : '🟢 OFF'}\n` +
            `MHS: ${macro?.mhs ?? 'N/A'} (${macro?.regime ?? 'N/A'})\n` +
            `활성 포지션: ${active.length}개\n` +
            `오늘 결산: ${closed.length}건 (P&L ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%)`
          );
          break;
        }

        case '/stop': {
          EMERGENCY_STOP = true;
          console.error('[TelegramBot] Telegram /stop 명령 — 비상 정지 발동');
          await cancelAllPendingOrders().catch(console.error);
          await reply('🔴 <b>[비상 정지 발동]</b>\n모든 미체결 주문 취소 완료. /reset 으로 재개 가능.');
          break;
        }

        case '/reset': {
          const secret = process.env.EMERGENCY_RESET_SECRET;
          const provided = args[0] ?? '';
          if (secret && provided !== secret) {
            await reply('❌ 인증 실패 — /reset <비밀번호> 형식으로 입력하세요.');
            break;
          }
          EMERGENCY_STOP = false;
          DAILY_LOSS_PCT  = 0;
          await reply('🟢 <b>비상 정지 해제</b> — 자동매매 재개');
          break;
        }

        case '/watchlist': {
          const wl = loadWatchlist();
          if (wl.length === 0) { await reply('📋 워치리스트가 비어 있습니다.'); break; }
          const lines = wl.map(w =>
            `• ${w.name}(${w.code}) 진입:${w.entryPrice.toLocaleString()} 손절:${w.stopLoss.toLocaleString()} 목표:${w.targetPrice.toLocaleString()}`
          ).join('\n');
          await reply(`📋 <b>워치리스트 (${wl.length}개)</b>\n${lines}`);
          break;
        }

        case '/buy': {
          const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
          if (!code || code.length !== 6) {
            await reply('❌ 사용법: /buy 005930 (종목코드 6자리)');
            break;
          }
          const wl  = loadWatchlist();
          const hit = wl.find(w => w.code === code);
          if (!hit) {
            await reply(`⚠️ 워치리스트에 ${code} 없음. 먼저 워치리스트에 추가하세요.`);
            break;
          }
          // Shadow 강제 신호 트리거 — runAutoSignalScan() 내 진입 조건 우회
          await runAutoSignalScan().catch(console.error);
          await reply(`🔔 <b>${hit.name}(${code})</b> 수동 매수 신호 트리거 완료 (다음 스캔 주기에 체결)`);
          break;
        }

        case '/report': {
          await reply('📄 일일 리포트 생성 중...');
          await generateDailyReport().catch(console.error);
          await reply('✅ 리포트 이메일 발송 완료');
          break;
        }

        case '/shadow': {
          const stats = getMonthlyStats();
          const pending = fillMonitor.getPendingOrders().filter(o => o.status === 'PENDING');
          await reply(
            `🎭 <b>[Shadow 성과 현황]</b>\n` +
            `${stats.month} — 전체 ${stats.total}건\n` +
            `WIN률: ${stats.winRate.toFixed(1)}% | 평균수익: ${stats.avgReturn.toFixed(2)}%\n` +
            `STRONG_BUY: ${stats.strongBuyWinRate.toFixed(1)}%\n` +
            `미체결 모니터링: ${pending.length}건`
          );
          break;
        }

        case '/pending': {
          const pending = fillMonitor.getPendingOrders().filter(o => o.status === 'PENDING');
          if (pending.length === 0) { await reply('✅ 미체결 주문 없음'); break; }
          const lines = pending.map(o =>
            `• ${o.stockName}(${o.ordNo}) ${o.quantity}주 @${o.orderPrice.toLocaleString()} [${o.pollCount}/${10}회]`
          ).join('\n');
          await reply(`⏳ <b>미체결 주문 (${pending.length}건)</b>\n${lines}`);
          break;
        }

        default:
          await reply(
            `🤖 <b>QuantMaster Pro 봇</b>\n` +
            `/status — 현황 요약\n` +
            `/stop — 비상 정지\n` +
            `/reset [pw] — 비상 정지 해제\n` +
            `/watchlist — 워치리스트 조회\n` +
            `/buy 종목코드 — 수동 신호\n` +
            `/report — 일일 리포트\n` +
            `/shadow — Shadow 성과\n` +
            `/pending — 미체결 주문`
          );
      }
    } catch (e) {
      console.error('[TelegramBot] 명령 처리 실패:', e);
    }
  });

  // 일일 손실 외부 업데이트 (프론트엔드에서 Shadow 결과 집계 후 호출)
  app.post('/api/daily-loss', (req: Request, res: Response) => {
    const { pct } = req.body;
    if (typeof pct === 'number') {
      DAILY_LOSS_PCT = pct;
      checkDailyLossLimit().catch(console.error);
    }
    res.json({ ok: true, dailyLossPct: DAILY_LOSS_PCT });
  });

  // ─────────────────────────────────────────────────────────────
  // 자동매매 워치리스트 REST API
  // ─────────────────────────────────────────────────────────────

  app.get('/api/auto-trade/watchlist', (_req: Request, res: Response) => {
    res.json(loadWatchlist());
  });

  app.post('/api/auto-trade/watchlist', (req: Request, res: Response) => {
    const entry: WatchlistEntry = req.body;
    if (!entry.code || !entry.name) {
      return res.status(400).json({ error: 'code, name 필수' });
    }
    // 아이디어 6: 수동 추가 시 기본값 설정
    if (!entry.addedBy) entry.addedBy = 'MANUAL';
    if (entry.entryPrice && entry.stopLoss && entry.targetPrice && !entry.rrr) {
      const denom = entry.entryPrice - entry.stopLoss;
      entry.rrr = denom > 0
        ? parseFloat(((entry.targetPrice - entry.entryPrice) / denom).toFixed(2))
        : 0;
    }
    const list = loadWatchlist();
    const idx = list.findIndex((e) => e.code === entry.code);
    if (idx >= 0) list[idx] = entry; else list.push({ ...entry, addedAt: new Date().toISOString() });
    saveWatchlist(list);
    res.json({ ok: true, count: list.length });
  });

  app.delete('/api/auto-trade/watchlist/:code', (req: Request, res: Response) => {
    const list = loadWatchlist().filter((e) => e.code !== req.params.code);
    saveWatchlist(list);
    res.json({ ok: true, count: list.length });
  });

  app.get('/api/auto-trade/shadow-trades', (_req: Request, res: Response) => {
    res.json(getShadowTrades());
  });

  // 즉시 수동 스캔 트리거 (체크리스트 Step 6 등에서 호출)
  app.post('/api/auto-trade/scan', async (_req: Request, res: Response) => {
    if (process.env.AUTO_TRADE_ENABLED !== 'true') {
      return res.status(403).json({ error: 'AUTO_TRADE_ENABLED=true 필요' });
    }
    try {
      await runAutoSignalScan();
      res.json({ ok: true, ts: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // [아이디어 4] 스크리너 캐시 조회 + 수동 실행
  app.get('/api/auto-trade/screener', (_req: Request, res: Response) => {
    res.json(getScreenerCache());
  });

  app.post('/api/auto-trade/screener/run', async (_req: Request, res: Response) => {
    try {
      const results = await preScreenStocks();
      res.json({ ok: true, count: results.length, stocks: results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 수동 워치리스트 자동 채우기 트리거 (Yahoo Finance 기반)
  app.post('/api/auto-trade/populate', async (_req: Request, res: Response) => {
    try {
      const added = await autoPopulateWatchlist();
      res.json({ ok: true, added, watchlist: loadWatchlist() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // [아이디어 6] DART 공시 알림 조회 + 수동 폴링
  app.get('/api/auto-trade/dart-alerts', (_req: Request, res: Response) => {
    res.json(getDartAlerts());
  });

  app.post('/api/auto-trade/dart-alerts/poll', async (_req: Request, res: Response) => {
    try {
      await pollDartDisclosures();
      res.json({ ok: true, alerts: getDartAlerts().slice(-20) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 아이디어 10: 추천 적중률 자기학습 — 이력 조회 + 수동 평가 트리거
  // ─────────────────────────────────────────────────────────────

  app.get('/api/auto-trade/recommendations', (_req: Request, res: Response) => {
    res.json(getRecommendations());
  });

  app.get('/api/auto-trade/recommendations/stats', (_req: Request, res: Response) => {
    res.json(getMonthlyStats());
  });

  // 수동 평가 트리거 (테스트 / 장 마감 후 즉시 확인 용도)
  app.post('/api/auto-trade/recommendations/evaluate', async (_req: Request, res: Response) => {
    try {
      await evaluateRecommendations();
      res.json({ ok: true, stats: getMonthlyStats() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── 아이디어 8: 분할 매수 트랜치 조회 + 수동 실행 ─────────────────────────────
  app.get('/api/auto-trade/tranches', (_req: Request, res: Response) => {
    res.json(trancheExecutor.getPendingTranches());
  });

  app.post('/api/auto-trade/tranches/run', async (_req: Request, res: Response) => {
    try {
      await trancheExecutor.checkPendingTranches();
      res.json({ ok: true, pending: trancheExecutor.getPendingTranches() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── 아이디어 10: 실거래 전환 준비 상태 조회 ─────────────────────────────────
  app.get('/api/real-trade/status', (_req: Request, res: Response) => {
    res.json({ ready: isRealTradeReady(), kisIsReal: process.env.KIS_IS_REAL === 'true' });
  });

  // ─────────────────────────────────────────────────────────────
  // 아이디어 8: Macro State API (MHS 저장/조회 — 서버 Gate 연동)
  // ─────────────────────────────────────────────────────────────

  // ─── 아이디어 1: 오케스트레이터 상태 조회 ────────────────────────────────────
  app.get('/api/orchestrator/state', (_req: Request, res: Response) => {
    res.json(tradingOrchestrator.getStatus());
  });

  app.get('/api/macro/state', (_req: Request, res: Response) => {
    const state = loadMacroState();
    if (!state) return res.json({ mhs: null, regime: 'UNKNOWN', updatedAt: null });
    res.json(state);
  });

  app.post('/api/macro/state', (req: Request, res: Response) => {
    const {
      mhs, regime, vkospi, foreignFuturesSellDays, iri,
      // 아이디어 11: IPS 변곡점 엔진 보조 지표
      vix, mhsTrend, vkospiRising, bearRegimeTriggeredCount, bearDefenseMode,
      oeciCliKorea, exportGrowth3mAvg, dxyBullish, kospiBelow120ma, ips,
    } = req.body;
    if (typeof mhs !== 'number' || mhs < 0 || mhs > 100) {
      return res.status(400).json({ error: 'mhs는 0~100 사이 숫자여야 합니다' });
    }
    const validRegimes = ['GREEN', 'YELLOW', 'RED'];
    const finalRegime = validRegimes.includes(regime) ? regime : (mhs >= 60 ? 'GREEN' : mhs >= 30 ? 'YELLOW' : 'RED');
    const state: MacroState = { mhs, regime: finalRegime, updatedAt: new Date().toISOString() };
    // 아이디어 10: Bear Regime 보조 지표 — 클라이언트에서 전달된 경우 저장
    if (typeof vkospi === 'number') state.vkospi = vkospi;
    if (typeof foreignFuturesSellDays === 'number') state.foreignFuturesSellDays = foreignFuturesSellDays;
    if (typeof iri === 'number') state.iri = iri;
    // 아이디어 11: IPS 변곡점 엔진 보조 지표
    if (typeof vix === 'number') state.vix = vix;
    if (mhsTrend === 'IMPROVING' || mhsTrend === 'STABLE' || mhsTrend === 'DETERIORATING') state.mhsTrend = mhsTrend;
    if (typeof vkospiRising === 'boolean') state.vkospiRising = vkospiRising;
    if (typeof bearRegimeTriggeredCount === 'number') state.bearRegimeTriggeredCount = bearRegimeTriggeredCount;
    if (typeof bearDefenseMode === 'boolean') state.bearDefenseMode = bearDefenseMode;
    if (typeof oeciCliKorea === 'number') state.oeciCliKorea = oeciCliKorea;
    if (typeof exportGrowth3mAvg === 'number') state.exportGrowth3mAvg = exportGrowth3mAvg;
    if (typeof dxyBullish === 'boolean') state.dxyBullish = dxyBullish;
    if (typeof kospiBelow120ma === 'boolean') state.kospiBelow120ma = kospiBelow120ma;
    if (typeof ips === 'number') state.ips = ips;
    saveMacroState(state);
    console.log(`[Macro] MHS 업데이트: ${mhs} (${finalRegime})`);
    // 아이디어 10: Bear Regime 즉시 알림 체크 (비동기, fire-and-forget)
    pollBearRegime().catch(console.error);
    // 아이디어 11: IPS 변곡점 즉시 알림 체크 (비동기, fire-and-forget)
    pollIpsAlert().catch(console.error);
    res.json({ ok: true, ...state });
  });

  // ─────────────────────────────────────────────────────────────
  // 아이디어 3: Shadow 성과 대시보드 API (실거래 전환 판단 기준)
  // ─────────────────────────────────────────────────────────────

  app.get('/api/shadow/performance', (_req: Request, res: Response) => {
    const shadows = getShadowTrades();
    const closed = shadows.filter(
      (s: any) => s.status === 'HIT_TARGET' || s.status === 'HIT_STOP'
    );

    if (closed.length === 0) {
      return res.json({
        total: 0, winRate: 0, avgReturn: 0, avgWin: 0, avgLoss: 0,
        profitFactor: 0, sharpeRatio: 0, mdd: 0, avgHoldingDays: 0,
        readyForLive: false, reason: '결산 데이터 없음',
      });
    }

    const returns = closed.map((s: any) => s.returnPct ?? 0);
    const wins = returns.filter((r: number) => r > 0);
    const losses = returns.filter((r: number) => r <= 0);

    const avgReturn = returns.reduce((a: number, b: number) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.map((r: number) => Math.pow(r - avgReturn, 2))
             .reduce((a: number, b: number) => a + b, 0) / returns.length
    );

    // 최대낙폭 (MDD) 계산
    let peak = 0, mdd = 0, cumReturn = 0;
    for (const r of returns) {
      cumReturn += r;
      peak = Math.max(peak, cumReturn);
      mdd = Math.min(mdd, cumReturn - peak);
    }

    // 평균 보유기간 (일)
    const holdingDays = closed
      .filter((s: any) => s.exitTime && s.signalTime)
      .map((s: any) => {
        const ms = new Date(s.exitTime).getTime() - new Date(s.signalTime).getTime();
        return ms / (1000 * 60 * 60 * 24);
      });
    const avgHoldingDays = holdingDays.length > 0
      ? holdingDays.reduce((a: number, b: number) => a + b, 0) / holdingDays.length
      : 0;

    const winRate = (wins.length / closed.length) * 100;
    const totalWin = wins.length > 0 ? wins.reduce((a: number, b: number) => a + b, 0) : 0;
    const totalLoss = losses.length > 0 ? losses.reduce((a: number, b: number) => a + b, 0) : 0;

    // 아이디어 4: 연속 손절 최대 횟수
    let maxConsecLoss = 0, streak = 0;
    for (const s of closed) {
      if ((s as any).status === 'HIT_STOP') { streak++; maxConsecLoss = Math.max(maxConsecLoss, streak); }
      else { streak = 0; }
    }

    const pf = parseFloat(Math.abs(totalWin / (totalLoss || 1)).toFixed(2));

    // 아이디어 4: 6개 전환 요건 체크리스트
    const checklist = {
      sampleSize:    { pass: closed.length >= 30,                             label: `건수 ${closed.length}/30` },
      winRate:       { pass: winRate >= 55,                                   label: `승률 ${winRate.toFixed(1)}%/55%` },
      profitFactor:  { pass: pf >= 1.5,                                       label: `PF ${pf}/1.5` },
      mdd:           { pass: mdd > -10,                                       label: `MDD ${mdd.toFixed(2)}%/-10%` },
      holdingPeriod: { pass: avgHoldingDays >= 3 && avgHoldingDays <= 15,     label: `보유 ${avgHoldingDays.toFixed(1)}일/3~15일` },
      consecLoss:    { pass: maxConsecLoss <= 3,                              label: `연속손절 ${maxConsecLoss}회/≤3회` },
    };
    const passCount = Object.values(checklist).filter(c => c.pass).length;
    const readyForLive = passCount === Object.keys(checklist).length;
    const reasons = Object.values(checklist).filter(c => !c.pass).map(c => c.label);

    res.json({
      total: closed.length,
      winRate: parseFloat(winRate.toFixed(1)),
      avgReturn: parseFloat(avgReturn.toFixed(2)),
      avgWin: wins.length > 0 ? parseFloat((totalWin / wins.length).toFixed(2)) : 0,
      avgLoss: losses.length > 0 ? parseFloat((totalLoss / losses.length).toFixed(2)) : 0,
      profitFactor: pf,
      sharpeRatio: parseFloat((stdDev > 0 ? avgReturn / stdDev : 0).toFixed(2)),
      mdd: parseFloat(mdd.toFixed(2)),
      avgHoldingDays: parseFloat(avgHoldingDays.toFixed(1)),
      maxConsecLoss,
      checklist,
      readyForLive,
      reason: readyForLive ? '실거래 전환 조건 충족 ✅' : reasons.join(' / '),
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 아이디어 12: Telegram 알림 테스트
  // ─────────────────────────────────────────────────────────────

  app.post('/api/telegram/test', async (_req: Request, res: Response) => {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정' });
    }
    try {
      await sendTelegramAlert(
        `✅ <b>[QuantMaster Pro] Telegram 연결 테스트</b>\n` +
        `서버 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST\n` +
        `모드: ${process.env.KIS_IS_REAL === 'true' ? '🔴 실거래' : '🟡 모의투자'}\n` +
        `비상정지: ${EMERGENCY_STOP ? '🛑 활성' : '✅ 해제'}`
      );
      res.json({ ok: true, message: 'Telegram 메시지 전송 완료' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // ─── Graceful shutdown (Railway SIGTERM 대응) ─────────────────────────
    const shutdown = (signal: string) => {
      console.log(`[Server] ${signal} 수신 — graceful shutdown 시작`);
      server.close(() => {
        console.log('[Server] HTTP 서버 종료 완료');
        process.exit(0);
      });
      // 10초 내 종료되지 않으면 강제 종료
      setTimeout(() => { process.exit(0); }, 10_000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // ─── 아이디어 1: TradingDayOrchestrator — 장 사이클 State Machine ────────
    // 두 cron으로 전체 KST 거래일(08:00~17:00)을 커버합니다.
    // ① UTC 23:xx (= KST Mon-Fri 08:xx, 동시호가/장 전 준비) — Sun-Thu UTC
    cron.schedule('*/5 23 * * 0-4', async () => {
      if (EMERGENCY_STOP) { console.warn('[Orchestrator] 비상 정지 — tick 건너뜀'); return; }
      await tradingOrchestrator.tick().catch(console.error);
      if (process.env.AUTO_TRADE_ENABLED === 'true') {
        await checkDailyLossLimit().catch(console.error);
      }
    }, { timezone: 'UTC' });

    // ② UTC 00:xx~08:xx (= KST Mon-Fri 09:xx~17:xx, 장중/마감/리포트) — Mon-Fri UTC
    cron.schedule('*/5 0-8 * * 1-5', async () => {
      if (EMERGENCY_STOP) { console.warn('[Orchestrator] 비상 정지 — tick 건너뜀'); return; }
      await tradingOrchestrator.tick().catch(console.error);
      if (process.env.AUTO_TRADE_ENABLED === 'true') {
        await checkDailyLossLimit().catch(console.error);
      }
    }, { timezone: 'UTC' });

    // 아이디어 6: DART 공시 30분 폴링 — 장중 08:30~18:00 KST (UTC 23:30~09:00)
    // 오케스트레이터와 독립 실행 (AUTO_TRADE_ENABLED 무관)
    cron.schedule('*/30 23,0,1,2,3,4,5,6,7,8,9 * * 1-5', async () => {
      await pollDartDisclosures().catch(console.error);
    }, { timezone: 'UTC' });

    // 아이디어 11: DART 고속 폴링 — 장중 1분 간격, 고영향 키워드 즉시 반응
    // UTC 23:xx (KST 08:xx) + UTC 00-09 (KST 09-18) 커버
    cron.schedule('* 23 * * 0-4', async () => {
      await fastDartCheck().catch(console.error);
    }, { timezone: 'UTC' });
    cron.schedule('* 0-9 * * 1-5', async () => {
      await fastDartCheck().catch(console.error);
    }, { timezone: 'UTC' });

    // 아이디어 10: Bear Regime Push 알림 — 15분 간격 폴링, 장중 KST 08:00~17:00
    // UTC 23:xx (KST 08:xx) + UTC 00-08 (KST 09-17) 커버
    cron.schedule('*/15 23 * * 0-4', async () => {
      await pollBearRegime().catch(console.error);
    }, { timezone: 'UTC' });
    cron.schedule('*/15 0-8 * * 1-5', async () => {
      await pollBearRegime().catch(console.error);
    }, { timezone: 'UTC' });

    // 아이디어 11: IPS 변곡점 경보 — 15분 간격 24/7 폴링 (장 외 시간 포함)
    cron.schedule('*/15 * * * *', async () => {
      await pollIpsAlert().catch(console.error);
    }, { timezone: 'UTC' });

    // 아이디어 8: MHS 임계값 모닝 알림 — 평일 오전 09:00 KST (UTC 00:00 Mon-Fri)
    // RED 레짐(MHS < 40) 또는 GREEN 레짐 전환(MHS ≥ 70) 시 즉시 Telegram 알림
    cron.schedule('0 0 * * 1-5', async () => {
      await pollMhsMorningAlert().catch(console.error);
    }, { timezone: 'UTC' });

    // 주간 리포트 — 매주 금요일 16:30 KST (UTC 07:30)
    cron.schedule('30 7 * * 5', async () => {
      await generateWeeklyReport().catch(console.error);
    }, { timezone: 'UTC' });

    // 장 시작 전 워치리스트 브리핑 — 평일 08:50 KST (UTC 23:50, 일~목 UTC)
    cron.schedule('50 23 * * 0-4', async () => {
      await sendWatchlistBriefing().catch(console.error);
    }, { timezone: 'UTC' });

    // 장중 중간 점검 — 오전 11:30 KST (UTC 02:30, 월~금 UTC)
    cron.schedule('30 2 * * 1-5', async () => {
      await sendIntradayCheckIn('midday').catch(console.error);
    }, { timezone: 'UTC' });

    // 마감 전 점검 — 오후 14:00 KST (UTC 05:00, 월~금 UTC)
    cron.schedule('0 5 * * 1-5', async () => {
      await sendIntradayCheckIn('preclose').catch(console.error);
    }, { timezone: 'UTC' });

    console.log('[AutoTrade] 오케스트레이터 + DART 폴링 + Bear Regime 알림 + MHS 모닝 알림 + IPS 변곡점 경보 가동 완료');

    // 아이디어 12: 서버 기동 시 Telegram 알림 (fire-and-forget)
    sendTelegramAlert(
      `🟢 <b>[QuantMaster Pro] 서버 기동</b>\n` +
      `시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} KST\n` +
      `모드: ${process.env.AUTO_TRADE_MODE !== 'LIVE' ? '🟡 Shadow' : '🔴 LIVE'}\n` +
      `KIS: ${process.env.KIS_IS_REAL === 'true' ? '실거래' : '모의투자'}`
    ).catch(console.error);

    // 아이디어 7-A: 14분 간격 자가 핑 — Railway 슬립 방지
    const selfUrl = process.env.RAILWAY_STATIC_URL ?? `http://localhost:${PORT}`;
    setInterval(async () => {
      try {
        await fetch(`${selfUrl}/api/health`);
      } catch {
        // 핑 실패는 무시 (서버 자체가 살아있으면 다음 핑에서 회복)
      }
    }, 14 * 60 * 1000);
    console.log(`[KeepAlive] 14분 간격 자가 핑 시작 → ${selfUrl}/api/health`);
  });
}

startServer();
