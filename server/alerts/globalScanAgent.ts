/**
 * globalScanAgent.ts — 새벽 자동 글로벌 스캔 에이전트 (Layer 13·14 통합)
 *
 * 매일 KST 06:00 (UTC 21:00, 일~목) 자동 실행.
 * 9개 글로벌 지수를 Yahoo Finance에서 수집 → Gemini 요약 → Telegram 알림.
 *
 * ┌─ Layer 13: EWY vs KODEX 200 괴리 감시 (외국인 수급 예비 경보) ──────────────┐
 * │  EWY(MSCI Korea ETF)는 외국인이 국내 시장 개입 전 사전 창구로 활용한다.     │
 * │  EWY 전일 대비 ±1.5% 초과 시 "외국인 수급 예비 경보" Telegram 발동.        │
 * │  선행성: 외국인 Passive 수급 1~2일 전 반응 확률 73%+                        │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ Layer 14: 글로벌 섹터 ETF 자금흐름 선행 레이어 ───────────────────────────┐
 * │  ETF         한국 선행 대상                   선행 기간                    │
 * │  ITA(방산)   한화에어로/LIG넥스원/현대로템     3~5일                        │
 * │  SOXX(반도체)삼성전자/SK하이닉스               1~3일                        │
 * │  XLE(에너지) S-Oil/HD현대오일뱅크              2~4일                        │
 * │  WOOD(조선)  조선 빅3                          3~5일                        │
 * │  임계값 ±2% 초과 시 "선행 수급 경보" 태그 부착                              │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * 수집: ^GSPC / ^IXIC / ^DJI / ^VIX / EWY / ITA / SOXX / XLE / WOOD
 */

import fs from 'fs';
import { fetchCloses } from '../trading/marketDataRefresh.js';
import { callGemini } from '../clients/geminiClient.js';
import { sendTelegramAlert } from './telegramClient.js';
import { loadMacroState, saveMacroState } from '../persistence/macroStateRepo.js';
import { GLOBAL_SCAN_FILE, ensureDataDir } from '../persistence/paths.js';
import { runSupplyChainScan } from './supplyChainAgent.js';
import { logNewsSupplyEvent } from '../learning/newsSupplyLogger.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface SymbolResult {
  symbol:    string;
  label:     string;
  price:     number | null;
  changePct: number | null;
  /** 5일 수익률 (%) — 첫 종가 대비 최신 종가. ETF 섹터 부스트 판단에 사용. */
  return5d?: number | null;
}

export interface SectorAlert {
  symbol:       string;                        // ETF 심볼
  label:        string;                        // ETF 이름
  changePct:    number;                        // 전일 대비 변화율 (%)
  direction:    'BULLISH' | 'BEARISH';
  koreaSectors: string;                        // 연관 한국 섹터/종목
  leadDays:     string;                        // 선행 기간
  alertType:    'EWY_FOREIGN' | 'SECTOR_FLOW'; // Layer 13 | Layer 14
}

export interface GlobalScanReport {
  createdAt:    string;
  symbols:      SymbolResult[];
  vix:          number | null;
  aiSummary:    string | null;
  sectorAlerts: SectorAlert[];                 // Layer 13·14 경보 목록
}

// ── 섹터 ETF 설정 (Layer 13·14) ──────────────────────────────────────────────

interface SectorETFConfig {
  symbol:       string;
  label:        string;
  threshold:    number;  // 경보 임계값 절대값 (%)
  koreaSectors: string;
  leadDays:     string;
  alertType:    'EWY_FOREIGN' | 'SECTOR_FLOW';
}

const SECTOR_ETF_CONFIG: SectorETFConfig[] = [
  // Layer 13 — EWY 외국인 수급 창구 (낮은 임계값)
  {
    symbol: 'EWY', label: 'EWY (MSCI Korea)', threshold: 1.5,
    koreaSectors: 'KOSPI 외국인 수급 전체', leadDays: '1~2일',
    alertType: 'EWY_FOREIGN',
  },
  // Layer 14 — 섹터 ETF 자금흐름
  {
    symbol: 'ITA', label: 'ITA (방산)', threshold: 2.0,
    koreaSectors: '한화에어로스페이스 / LIG넥스원 / 현대로템', leadDays: '3~5일',
    alertType: 'SECTOR_FLOW',
  },
  {
    symbol: 'SOXX', label: 'SOXX (반도체)', threshold: 2.0,
    koreaSectors: '삼성전자 / SK하이닉스', leadDays: '1~3일',
    alertType: 'SECTOR_FLOW',
  },
  {
    symbol: 'XLE', label: 'XLE (에너지)', threshold: 2.0,
    koreaSectors: 'S-Oil / HD현대오일뱅크', leadDays: '2~4일',
    alertType: 'SECTOR_FLOW',
  },
  {
    symbol: 'WOOD', label: 'WOOD (조선/목재)', threshold: 2.0,
    koreaSectors: '조선 빅3 (HD한국조선해양 / 삼성중공업 / 한화오션)', leadDays: '3~5일',
    alertType: 'SECTOR_FLOW',
  },
];

// ── 유틸 ──────────────────────────────────────────────────────────────────────

/** 최근 2거래일 종가로 당일 변화율(%) 계산 */
async function fetchSymbolResult(symbol: string, label: string): Promise<SymbolResult> {
  const closes = await fetchCloses(symbol, '5d');
  if (!closes || closes.length < 2) {
    return { symbol, label, price: null, changePct: null };
  }
  const prev      = closes[closes.length - 2];
  const current   = closes[closes.length - 1];
  const changePct = ((current - prev) / prev) * 100;
  const first5d   = closes[0];
  const return5d  = first5d > 0 ? ((current - first5d) / first5d) * 100 : null;
  return {
    symbol,
    label,
    price:     parseFloat(current.toFixed(2)),
    changePct: parseFloat(changePct.toFixed(2)),
    return5d:  return5d === null ? null : parseFloat(return5d.toFixed(2)),
  };
}

/** Layer 13·14: 임계값 초과 ETF → SectorAlert 배열 반환 */
function computeSectorAlerts(results: SymbolResult[]): SectorAlert[] {
  const alerts: SectorAlert[] = [];
  for (const cfg of SECTOR_ETF_CONFIG) {
    const r = results.find(r => r.symbol === cfg.symbol);
    if (!r || r.changePct === null) continue;
    if (Math.abs(r.changePct) < cfg.threshold) continue;
    alerts.push({
      symbol:       cfg.symbol,
      label:        cfg.label,
      changePct:    r.changePct,
      direction:    r.changePct > 0 ? 'BULLISH' : 'BEARISH',
      koreaSectors: cfg.koreaSectors,
      leadDays:     cfg.leadDays,
      alertType:    cfg.alertType,
    });
  }
  return alerts;
}

/** VIX 이력 갱신: 최신값 추가, 최대 5개 유지 */
function updateVixHistory(existing: number[], newVix: number): number[] {
  return [...existing, newVix].slice(-5);
}

/** VIX > 30 → 50% 현금화 권고 (직전 VIX가 30 이하였을 때만 발송) */
function shouldAlertVixEmergency(prevVix: number | undefined, newVix: number): boolean {
  if (newVix <= 30) return false;
  return !prevVix || prevVix <= 30;
}

/** VIX 반등 신호: 30 초과 이후 3거래일 연속 하락 */
function checkVixReboundInternal(history: number[]): boolean {
  if (history.length < 4) return false;
  const peakIdx  = history.findIndex(v => v > 30);
  if (peakIdx < 0) return false;
  const afterPeak = history.slice(peakIdx + 1);
  if (afterPeak.length < 3) return false;
  const last3 = afterPeak.slice(-3);
  return last3[0] > last3[1] && last3[1] > last3[2];
}

/** 변화율 포맷 헬퍼 */
function fmtPct(v: number | null): string {
  if (v === null) return 'N/A';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// ── ETF 섹터 Gate 부스트 (Layer 14 gateScore 연계) ──────────────────────────────
//
// globalScanAgent가 수집·저장한 ETF 5일 수익률을 KIS 워치리스트 Gate Score에 연계.
// ETF 5일 수익률이 양수(자금 유입)이고 종목 섹터가 일치하면 gateScore += boostGate.
//
// 'EWY' (한국 ETF)  — 전체 외국인 선행 수급 신호 (모든 섹터 소폭 부스트)
// 'ITA' (방산 ETF)  — 방산 섹터 3~5일 선행 상승 신호
// 'SOXX'(반도체 ETF)— 반도체/반도체소재/반도체부품/반도체장비 섹터 1~3일 선행
// 'XLE' (에너지 ETF)— 에너지 섹터 2~4일 선행

interface EtfBoostConfig {
  symbol:      string;
  /** '전체' 또는 실제 섹터 키워드. '전체'는 모든 섹터에 적용. */
  sectorMatch: string;
  /** Gate Score에 더할 부스트 (0.3 ~ 0.5) */
  boostGate:   number;
}

const ETF_SECTOR_BOOST: EtfBoostConfig[] = [
  { symbol: 'EWY',  sectorMatch: '전체',   boostGate: 0.3 },
  { symbol: 'ITA',  sectorMatch: '방산',   boostGate: 0.5 },
  { symbol: 'SOXX', sectorMatch: '반도체', boostGate: 0.5 },
  { symbol: 'XLE',  sectorMatch: '에너지', boostGate: 0.3 },
];

export interface EtfSectorBoostResult {
  /** 부스트 총합 (gateScore에 더할 값) */
  boost:   number;
  /** 기여한 ETF의 설명 레이블 — gate details에 추가 */
  reasons: string[];
}

/**
 * 종목 섹터로부터 globalScanReport의 ETF 5일 수익률을 읽어 Gate 부스트 계산.
 * 보고서 없거나 해당 ETF 데이터 없으면 boost=0, reasons=[] 반환(안전한 default).
 *
 * @param sector 종목 섹터 문자열 (SECTOR_MAP의 값). 미분류면 '전체' 매칭만 적용.
 */
export function computeEtfSectorBoost(sector: string | undefined): EtfSectorBoostResult {
  const report = loadGlobalScanReport();
  if (!report) return { boost: 0, reasons: [] };

  const normalizedSector = sector ?? '미분류';
  let totalBoost = 0;
  const reasons: string[] = [];

  for (const cfg of ETF_SECTOR_BOOST) {
    const symResult = report.symbols.find(s => s.symbol === cfg.symbol);
    if (!symResult || symResult.return5d == null || symResult.return5d <= 0) continue;

    // '전체'는 모든 섹터에 적용, 그 외엔 섹터명 부분 일치로 매칭
    const matches = cfg.sectorMatch === '전체'
      ? true
      : normalizedSector.includes(cfg.sectorMatch);
    if (!matches) continue;

    totalBoost += cfg.boostGate;
    reasons.push(`ETF:${cfg.symbol}+${symResult.return5d.toFixed(1)}%(5d)→+${cfg.boostGate}`);
  }

  return { boost: parseFloat(totalBoost.toFixed(2)), reasons };
}

// ── 보고서 저장/로드 ──────────────────────────────────────────────────────────

export function loadGlobalScanReport(): GlobalScanReport | null {
  ensureDataDir();
  if (!fs.existsSync(GLOBAL_SCAN_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(GLOBAL_SCAN_FILE, 'utf-8')); } catch { return null; }
}

function saveGlobalScanReport(report: GlobalScanReport): void {
  ensureDataDir();
  fs.writeFileSync(GLOBAL_SCAN_FILE, JSON.stringify(report, null, 2));
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * 글로벌 스캔 에이전트 실행.
 * scheduler.ts에서 매일 KST 06:00에 호출.
 */
export async function runGlobalScanAgent(): Promise<void> {
  console.log('[GlobalScan] 새벽 글로벌 스캔 시작 (Layer 13·14 포함)');

  // ── 1. 9개 지수 병렬 수집 ────────────────────────────────────────────────
  const SYMBOLS: Array<[string, string]> = [
    ['^GSPC', 'S&P500'],
    ['^IXIC', '나스닥'],
    ['^DJI',  '다우'],
    ['^VIX',  'VIX'],
    ['EWY',   'EWY(한국ETF)'],   // Layer 13
    ['ITA',   'ITA(방산ETF)'],   // Layer 14
    ['SOXX',  'SOXX(반도체ETF)'],// Layer 14
    ['XLE',   'XLE(에너지ETF)'], // Layer 14
    ['WOOD',  'WOOD(조선ETF)'],  // Layer 14
  ];

  const results = await Promise.all(
    SYMBOLS.map(([sym, label]) => fetchSymbolResult(sym, label))
  );

  const vixResult = results.find(r => r.symbol === '^VIX');
  const ewyResult = results.find(r => r.symbol === 'EWY');
  const vix       = vixResult?.price ?? null;

  // ── 2. Layer 13·14 경보 계산 ─────────────────────────────────────────────
  const sectorAlerts = computeSectorAlerts(results);
  const ewyAlert     = sectorAlerts.find(a => a.alertType === 'EWY_FOREIGN');
  const sectorFlows  = sectorAlerts.filter(a => a.alertType === 'SECTOR_FLOW');

  // ── 3. MacroState — vix + vixHistory + ewyDayChange 갱신 ─────────────────
  const macroState = loadMacroState();
  const prevVix    = macroState?.vix;
  if (macroState) {
    if (vix !== null) {
      const prevHistory     = macroState.vixHistory ?? [];
      macroState.vix        = vix;
      macroState.vixHistory = updateVixHistory(prevHistory, vix);
      console.log(`[GlobalScan] VIX 갱신: ${vix} (이력 ${macroState.vixHistory.length}개)`);
    }
    if (ewyResult?.changePct != null) {
      macroState.ewyDayChange = ewyResult.changePct;
      console.log(`[GlobalScan] EWY 당일 변화율: ${ewyResult.changePct.toFixed(2)}%`);
    }
    macroState.updatedAt = new Date().toISOString();
    saveMacroState(macroState);
  }

  // ── 4. Gemini 3-줄 요약 생성 ─────────────────────────────────────────────
  const dataLines = results
    .filter(r => r.price !== null)
    .map(r => `${r.label}: ${r.price} (${fmtPct(r.changePct)})`)
    .join('\n');

  const alertContext = sectorAlerts.length > 0
    ? `\n\n경보 발동 ETF:\n${sectorAlerts.map(a =>
        `${a.label} ${fmtPct(a.changePct)} → ${a.koreaSectors}`
      ).join('\n')}`
    : '';

  const prompt =
    `간밤 주요 글로벌 지수 종가 데이터:\n${dataLines}${alertContext}\n\n` +
    `위 데이터를 바탕으로 오늘 한국 주식시장 관점에서 다음 3가지를 각 1~2문장으로 분석하라:\n` +
    `1. KOSPI 전망 (방향과 핵심 이유)\n` +
    `2. 주목할 섹터 (ETF 경보 데이터 기반, 경보 없으면 전반적 강세/약세 섹터)\n` +
    `3. 주요 리스크 또는 회피할 섹터\n\n` +
    `JSON·마크다운 없이 순수 텍스트만 출력하라.`;

  const aiSummary = await callGemini(prompt, 'global-scan').catch(() => null);

  // ── 5. 보고서 저장 ───────────────────────────────────────────────────────
  const report: GlobalScanReport = {
    createdAt:    new Date().toISOString(),
    symbols:      results,
    vix,
    aiSummary:    aiSummary ?? null,
    sectorAlerts,
  };
  saveGlobalScanReport(report);

  // ── 6. Telegram — 메인 리포트 ────────────────────────────────────────────
  const sp500 = results.find(r => r.symbol === '^GSPC');
  const ndx   = results.find(r => r.symbol === '^IXIC');
  const dji   = results.find(r => r.symbol === '^DJI');
  const ita   = results.find(r => r.symbol === 'ITA');
  const soxx  = results.find(r => r.symbol === 'SOXX');
  const xle   = results.find(r => r.symbol === 'XLE');
  const wood  = results.find(r => r.symbol === 'WOOD');

  const vixLine = vix !== null
    ? `VIX: ${vix.toFixed(1)} (${fmtPct(vixResult?.changePct ?? null)})`
    : 'VIX: N/A';

  let message =
    `🌏 <b>[글로벌 스캔 06:00]</b> 간밤 시장 요약\n` +
    `S&P500: ${sp500?.price?.toLocaleString() ?? 'N/A'} (${fmtPct(sp500?.changePct ?? null)})\n` +
    `나스닥: ${ndx?.price?.toLocaleString() ?? 'N/A'} (${fmtPct(ndx?.changePct ?? null)})\n` +
    `다우: ${dji?.price?.toLocaleString() ?? 'N/A'} (${fmtPct(dji?.changePct ?? null)})\n` +
    `${vixLine}\n` +
    `EWY: ${fmtPct(ewyResult?.changePct ?? null)} | ITA: ${fmtPct(ita?.changePct ?? null)} | ` +
    `SOXX: ${fmtPct(soxx?.changePct ?? null)}\n` +
    `XLE: ${fmtPct(xle?.changePct ?? null)} | WOOD: ${fmtPct(wood?.changePct ?? null)}\n` +
    `──────────────────`;

  if (aiSummary) {
    message += `\n🤖 <b>Gemini 분석:</b>\n${aiSummary}`;
  }

  await sendTelegramAlert(message).catch(console.error);

  // ── 7. Layer 13 — EWY 외국인 수급 예비 경보 ─────────────────────────────
  if (ewyAlert) {
    const dir = ewyAlert.direction === 'BULLISH' ? '급등' : '급락';
    const emoji = ewyAlert.direction === 'BULLISH' ? '📈' : '📉';
    await sendTelegramAlert(
      `${emoji} <b>[Layer 13] 외국인 수급 예비 경보</b>\n` +
      `EWY ${fmtPct(ewyAlert.changePct)} (임계값 ±1.5%) — ${dir} 감지\n` +
      `선행 대상: ${ewyAlert.koreaSectors}\n` +
      `예상 반응: ${ewyAlert.leadDays} 내 외국인 Passive 수급 동일 방향 확률 73%+`
    ).catch(console.error);
  }

  // ── 8. Layer 14 — 섹터 ETF 선행 수급 경보 ───────────────────────────────
  if (sectorFlows.length > 0) {
    const lines = sectorFlows.map(a => {
      const emoji = a.direction === 'BULLISH' ? '🟢' : '🔴';
      return `${emoji} ${a.label} ${fmtPct(a.changePct)} → ${a.koreaSectors} (${a.leadDays} 선행)`;
    }).join('\n');

    await sendTelegramAlert(
      `🔔 <b>[Layer 14] 글로벌 섹터 ETF 선행 경보</b>\n` +
      `임계값 ±2% 초과 ETF 감지:\n` +
      `${lines}`
    ).catch(console.error);
  }

  // ── 9. VIX 특별 경보 ─────────────────────────────────────────────────────
  if (vix !== null && macroState) {
    const vixHistory = macroState.vixHistory ?? [];

    if (shouldAlertVixEmergency(prevVix, vix)) {
      await sendTelegramAlert(
        `🚨 <b>[VIX 위험] VIX ${vix.toFixed(1)} > 30 돌파</b>\n` +
        `극도의 시장 공포 감지 — 신규 매수 자동 중단\n` +
        `기존 포지션 50% 현금화 검토 권고\n` +
        `자동매매 시스템이 진입을 차단합니다.`
      ).catch(console.error);
    }

    if (checkVixReboundInternal(vixHistory)) {
      await sendTelegramAlert(
        `📈 <b>[VIX 반등 신호]</b>\n` +
        `VIX 30 초과 이후 3거래일 연속 하락 감지\n` +
        `현재 VIX: ${vix.toFixed(1)}\n` +
        `리스크 온 전환 검토 — 보수적 재진입 허용 (Kelly ×0.70)`
      ).catch(console.error);
    }
  }

  // ── 10. Layer 13·14 경보를 NewsSupplyLogger에 기록 (T+1·T+3·T+5 추적 시작) ─
  for (const alert of sectorAlerts) {
    logNewsSupplyEvent({
      newsType:         alert.alertType === 'EWY_FOREIGN' ? 'EWY경보' : `섹터ETF경보_${alert.symbol}`,
      source:           alert.alertType,
      sector:           alert.koreaSectors,
      koreanStockCodes: [],  // ETF 경보는 개별 코드 없음 — EWY 프록시로 추적
      koreanNames:      [alert.koreaSectors],
      detectedAt:       new Date().toISOString(),
      newsHeadline:     `${alert.label} ${alert.changePct >= 0 ? '+' : ''}${alert.changePct.toFixed(2)}% (임계값 ±${alert.alertType === 'EWY_FOREIGN' ? 1.5 : 2.0}%)`,
      significance:     Math.abs(alert.changePct) >= 3 ? 'HIGH' : 'MEDIUM',
    });
  }

  // ── 11. 공급망 역추적 스캔 (Gemini Search — 비용 절감을 위해 fire-and-forget) ─
  runSupplyChainScan().catch(e =>
    console.error('[GlobalScan] 공급망 스캔 오류:', e instanceof Error ? e.message : e)
  );

  const alertSummary = sectorAlerts.length > 0
    ? `경보 ${sectorAlerts.length}건 (${sectorAlerts.map(a => a.symbol).join(', ')})`
    : '경보 없음';
  console.log(`[GlobalScan] 완료 — VIX: ${vix ?? 'N/A'}, ${alertSummary}, AI: ${aiSummary ? 'OK' : '실패'}`);
}
