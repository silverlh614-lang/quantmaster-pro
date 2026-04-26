// @responsibility sectorEtfMomentum 알림 모듈
/**
 * sectorEtfMomentum.ts — 미국 섹터 ETF 30분봉 모멘텀 교차 스캐너
 *
 * ┌─ 아이디어 ─────────────────────────────────────────────────────────────────┐
 * │ 간밤 NY 세션 중 미국 섹터 ETF 5개의 30분봉 RS(Relative Strength)를          │
 * │ 교차 분석해 "오늘 어느 섹터로 자금이 몰렸는가" 를 정량화하고,               │
 * │ 한국 섹터 매핑 테이블과 결합해 개장 전 "선점 우선순위"를 생성한다.          │
 * │                                                                              │
 * │ 미국 → 한국 선행성                                                           │
 * │   XLK (Tech)       → 반도체 · IT·플랫폼        (1~3일 선행)                  │
 * │   XLB (Materials)  → 철강 · 화학 · 2차전지 소재 (2~4일 선행)                 │
 * │   XLE (Energy)     → 정유 · 조선 해양플랜트    (2~4일 선행)                  │
 * │   IYT (Transports) → 조선 · 항공 · 해운         (3~5일 선행)                 │
 * │   XLF (Financials) → 금융 · 증권 · 보험         (1~2일 선행)                 │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * 모멘텀 합성 (composite score):
 *   0.5 × (당일 누적 %) + 0.3 × (직전 2h %) + 0.2 × (직전 30m %)
 *
 * 랭킹 후 상위 2개 섹터 → 한국 매핑 → 선점 후보 리스트 → Telegram.
 * Top 섹터 composite ≥ +0.8% 또는 Bottom ≤ -0.8% 시에만 경보 (소음 차단).
 *
 * cron: 미국 장 마감 직후 KST 06:15 (UTC 21:15 일~목)
 */

import fs from 'fs';
import { sendTelegramAlert } from './telegramClient.js';
import { SECTOR_ETF_MOMENTUM_FILE, ensureDataDir } from '../persistence/paths.js';
import { logNewsSupplyEvent } from '../learning/newsSupplyLogger.js';
import { guardedFetch } from '../utils/egressGuard.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface SectorEtfConfig {
  symbol:       string;
  label:        string;
  koreaSectors: string;   // Telegram 노출용
  koreaCodes:   string[]; // 대표 KOSPI .KS 심볼 — newsSupplyLogger 추적
  leadDays:     string;
}

export interface SectorMomentum {
  symbol:      string;
  label:       string;
  koreaSectors: string;
  last:        number | null;
  return30m:   number | null;   // %
  return2h:    number | null;   // %
  returnDay:   number | null;   // %
  composite:   number | null;   // %
  barsUsed:    number;
}

export interface SectorMomentumReport {
  createdAt:    string;
  momentums:    SectorMomentum[];
  topBullish:   SectorMomentum | null;
  topBearish:   SectorMomentum | null;
  alertSent:    boolean;
}

interface PersistedState {
  history: SectorMomentumReport[];   // 최근 30건
}

// ── 섹터 ETF 매핑 ─────────────────────────────────────────────────────────────

export const SECTOR_ETFS: SectorEtfConfig[] = [
  { symbol: 'XLK', label: 'Tech (XLK)',        koreaSectors: '반도체·IT·플랫폼',
    koreaCodes: ['005930.KS', '000660.KS'],    leadDays: '1~3일' },
  { symbol: 'XLB', label: 'Materials (XLB)',   koreaSectors: '철강·화학·2차전지 소재',
    koreaCodes: ['005490.KS', '051910.KS'],    leadDays: '2~4일' },
  { symbol: 'XLE', label: 'Energy (XLE)',      koreaSectors: '정유·조선 해양플랜트',
    koreaCodes: ['010950.KS', '009830.KS'],    leadDays: '2~4일' },
  { symbol: 'IYT', label: 'Transports (IYT)',  koreaSectors: '조선·항공·해운',
    koreaCodes: ['009540.KS', '003490.KS'],    leadDays: '3~5일' },
  { symbol: 'XLF', label: 'Financials (XLF)',  koreaSectors: '금융·증권·보험',
    koreaCodes: ['105560.KS', '055550.KS'],    leadDays: '1~2일' },
];

// ── 임계값 ────────────────────────────────────────────────────────────────────

const COMPOSITE_ALERT_THRESHOLD = 0.8;   // %

// ── Yahoo 30분봉 fetch ────────────────────────────────────────────────────────

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'application/json',
};

interface IntradayBars {
  closes: number[];
  /** 각 bar의 UNIX epoch(초) — 당일 경계 필터링용 */
  times:  number[];
}

async function fetch30mBars(symbol: string, range = '5d'): Promise<IntradayBars | null> {
  const urls = [
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=30m`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=30m`,
  ];
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 12000);
      const res  = await guardedFetch(url, { headers: YF_HEADERS, signal: ctrl.signal }, 'REALTIME');
      clearTimeout(tid);
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      const rawCloses: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
      const rawTimes:  number[]          = result?.timestamp ?? [];
      const closes: number[] = [];
      const times:  number[] = [];
      for (let i = 0; i < rawCloses.length; i++) {
        const v = rawCloses[i];
        const t = rawTimes[i];
        if (v == null || !Number.isFinite(v) || typeof t !== 'number') continue;
        closes.push(v);
        times.push(t);
      }
      if (closes.length > 0) return { closes, times };
    } catch { /* retry */ }
  }
  return null;
}

// ── 모멘텀 계산 ───────────────────────────────────────────────────────────────

function pctChange(cur: number, prev: number): number | null {
  if (!prev || prev <= 0) return null;
  return ((cur - prev) / prev) * 100;
}

function toUtcDateKey(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

function computeMomentum(cfg: SectorEtfConfig, bars: IntradayBars): SectorMomentum {
  const { closes, times } = bars;
  const n = closes.length;
  if (n < 2) {
    return { symbol: cfg.symbol, label: cfg.label, koreaSectors: cfg.koreaSectors,
      last: null, return30m: null, return2h: null, returnDay: null, composite: null, barsUsed: n };
  }
  const last     = closes[n - 1];
  const prev30m  = closes[n - 2];
  const prev2h   = n >= 5 ? closes[n - 5] : closes[0];       // 4 × 30m
  // 당일 시가 = 당일 첫 bar — UTC 날짜 경계로 당일 범위 분리
  const lastDate = toUtcDateKey(times[n - 1]);
  let   dayOpen  = closes[0];
  for (let i = 0; i < n; i++) {
    if (toUtcDateKey(times[i]) === lastDate) { dayOpen = closes[i]; break; }
  }

  const return30m = pctChange(last, prev30m);
  const return2h  = pctChange(last, prev2h);
  const returnDay = pctChange(last, dayOpen);

  let composite: number | null = null;
  if (return30m != null && return2h != null && returnDay != null) {
    composite = parseFloat(
      (0.5 * returnDay + 0.3 * return2h + 0.2 * return30m).toFixed(2),
    );
  }

  return {
    symbol:      cfg.symbol,
    label:       cfg.label,
    koreaSectors: cfg.koreaSectors,
    last:        parseFloat(last.toFixed(2)),
    return30m:   return30m != null ? parseFloat(return30m.toFixed(2)) : null,
    return2h:    return2h  != null ? parseFloat(return2h.toFixed(2))  : null,
    returnDay:   returnDay != null ? parseFloat(returnDay.toFixed(2)) : null,
    composite,
    barsUsed:    n,
  };
}

// ── 알림 포맷 ─────────────────────────────────────────────────────────────────

function formatAlert(report: SectorMomentumReport): string {
  const sorted = [...report.momentums]
    .filter(m => m.composite != null)
    .sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0));

  const rankLines = sorted.map((m, idx) => {
    const sign  = (m.composite ?? 0) >= 0 ? '+' : '';
    const arrow = (m.composite ?? 0) >= 0 ? '▲' : '▼';
    return (
      `${idx + 1}. ${arrow} <b>${m.label}</b> ${sign}${m.composite}% ` +
      `(30m ${m.return30m}% / 2h ${m.return2h}% / day ${m.returnDay}%)\n` +
      `   → ${m.koreaSectors}`
    );
  });

  const bull   = report.topBullish;
  const bear   = report.topBearish;
  const priority = bull
    ? `🎯 <b>선점 1순위</b> — ${bull.koreaSectors} (${bull.label} +${bull.composite}%)`
    : '선점 후보 없음 (모든 섹터 임계 미달)';

  const caution = bear && (bear.composite ?? 0) <= -COMPOSITE_ALERT_THRESHOLD
    ? `⛔ <b>회피 섹터</b> — ${bear.koreaSectors} (${bear.label} ${bear.composite}%)`
    : '';

  return (
    `💠 <b>[美 섹터 ETF 30분 RS 스캔]</b> 06:15 KST\n` +
    `━━━━━━━━━━━━━━━━\n` +
    rankLines.join('\n\n') +
    `\n\n${priority}` +
    (caution ? `\n${caution}` : '')
  );
}

// ── 학습 DB 연동 ──────────────────────────────────────────────────────────────

function logToNewsSupply(report: SectorMomentumReport): void {
  const top = report.topBullish;
  if (!top || top.composite == null || top.composite < COMPOSITE_ALERT_THRESHOLD) return;
  const cfg = SECTOR_ETFS.find(c => c.symbol === top.symbol);
  if (!cfg) return;
  const comp = top.composite;
  logNewsSupplyEvent({
    newsType:         '섹터ETF모멘텀',
    source:           'SECTOR_FLOW',
    sector:           cfg.koreaSectors,
    koreanStockCodes: cfg.koreaCodes,
    koreanNames:      [],
    detectedAt:       report.createdAt,
    newsHeadline:     `${cfg.label} 30분 RS Top (composite ${comp >= 0 ? '+' : ''}${comp}%) — 한국 ${cfg.koreaSectors} ${cfg.leadDays} 선행`,
    significance:     'HIGH',
  });
}

// ── 영속성 ────────────────────────────────────────────────────────────────────

function loadState(): PersistedState {
  ensureDataDir();
  if (!fs.existsSync(SECTOR_ETF_MOMENTUM_FILE)) return { history: [] };
  try { return JSON.parse(fs.readFileSync(SECTOR_ETF_MOMENTUM_FILE, 'utf-8')); } catch { return { history: [] }; }
}

/** 최신 섹터 ETF 모멘텀 리포트. 다른 모듈에서 대시보드 소재로 읽어갈 때 사용. */
export function getLatestSectorEtfReport(): SectorMomentumReport | null {
  const state = loadState();
  return state.history.length > 0 ? state.history[state.history.length - 1] : null;
}

function saveState(state: PersistedState): void {
  ensureDataDir();
  const kept = state.history.slice(-30);
  fs.writeFileSync(SECTOR_ETF_MOMENTUM_FILE, JSON.stringify({ history: kept }, null, 2));
}

// ── 메인 엔트리 ───────────────────────────────────────────────────────────────

/**
 * 5개 미국 섹터 ETF 30분봉 fetch → 합성 모멘텀 → 랭킹 →
 * Top ≥ +0.8% 또는 Bottom ≤ -0.8% 일 때만 Telegram 발송.
 */
export async function runSectorEtfMomentumScan(): Promise<SectorMomentumReport> {
  const momentums: SectorMomentum[] = [];

  for (const cfg of SECTOR_ETFS) {
    const bars = await fetch30mBars(cfg.symbol).catch(err => {
      console.warn(`[SectorETF] ${cfg.symbol} 30m fetch 실패:`, err?.message ?? err);
      return null;
    });
    if (!bars) {
      momentums.push({
        symbol: cfg.symbol, label: cfg.label, koreaSectors: cfg.koreaSectors,
        last: null, return30m: null, return2h: null, returnDay: null, composite: null, barsUsed: 0,
      });
      continue;
    }
    momentums.push(computeMomentum(cfg, bars));
  }

  const valid = momentums.filter(m => m.composite != null);
  const sorted = [...valid].sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0));
  const topBullish = sorted[0] ?? null;
  const topBearish = sorted[sorted.length - 1] ?? null;

  const report: SectorMomentumReport = {
    createdAt:  new Date().toISOString(),
    momentums,
    topBullish,
    topBearish,
    alertSent:  false,
  };

  const bullishTrigger = topBullish && (topBullish.composite ?? 0) >=  COMPOSITE_ALERT_THRESHOLD;
  const bearishTrigger = topBearish && (topBearish.composite ?? 0) <= -COMPOSITE_ALERT_THRESHOLD;

  if (valid.length < 3) {
    console.warn(`[SectorETF] 유효 섹터 ${valid.length}개 — 3개 미만으로 경보 스킵`);
  } else if (bullishTrigger || bearishTrigger) {
    await sendTelegramAlert(formatAlert(report), {
      priority:  'HIGH',
      dedupeKey: `sector_etf_momentum:${new Date().toISOString().slice(0, 10)}`,
    }).catch(console.error);
    report.alertSent = true;
    logToNewsSupply(report);
  } else {
    console.log('[SectorETF] 임계 미달 — 알림 스킵');
  }

  console.log(
    `[SectorETF] 스캔 완료 — ` +
    valid.map(m => `${m.symbol}=${m.composite}%`).join(', '),
  );

  const state = loadState();
  state.history.push(report);
  saveState(state);

  return report;
}
