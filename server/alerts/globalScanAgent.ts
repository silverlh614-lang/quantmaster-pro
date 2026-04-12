/**
 * globalScanAgent.ts — 새벽 자동 글로벌 스캔 에이전트
 *
 * 매일 KST 06:00 (UTC 21:00, 일~목) 자동 실행.
 * 간밤 주요 글로벌 지수를 Yahoo Finance에서 수집하고
 * Gemini로 한국 시장 관점의 3-줄 요약을 생성해 Telegram으로 알린다.
 *
 * 수집 지수: S&P500(^GSPC), 나스닥(^IXIC), 다우(^DJI),
 *           VIX(^VIX), EWY, ITA(방산), SOXX(반도체)
 */

import fs from 'fs';
import { fetchCloses } from '../trading/marketDataRefresh.js';
import { callGemini } from '../clients/geminiClient.js';
import { sendTelegramAlert } from './telegramClient.js';
import { loadMacroState, saveMacroState } from '../persistence/macroStateRepo.js';
import { GLOBAL_SCAN_FILE, ensureDataDir } from '../persistence/paths.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface SymbolResult {
  symbol:      string;
  label:       string;
  price:       number | null;
  changePct:   number | null;
}

export interface GlobalScanReport {
  createdAt:  string;
  symbols:    SymbolResult[];
  vix:        number | null;
  aiSummary:  string | null;
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

/** 최근 2거래일 종가로 당일 변화율(%) 계산 */
async function fetchSymbolResult(symbol: string, label: string): Promise<SymbolResult> {
  const closes = await fetchCloses(symbol, '5d');
  if (!closes || closes.length < 2) {
    return { symbol, label, price: null, changePct: null };
  }
  const prev    = closes[closes.length - 2];
  const current = closes[closes.length - 1];
  const changePct = ((current - prev) / prev) * 100;
  return {
    symbol,
    label,
    price:     parseFloat(current.toFixed(2)),
    changePct: parseFloat(changePct.toFixed(2)),
  };
}

/** VIX 이력 갱신: 최신값 추가, 최대 5개 유지 */
function updateVixHistory(existing: number[], newVix: number): number[] {
  const updated = [...existing, newVix];
  return updated.slice(-5);
}

/** VIX > 30 → 50% 현금화 권고 (직전 VIX가 30 이하였을 때만 발송) */
function shouldAlertVixEmergency(prevVix: number | undefined, newVix: number): boolean {
  if (newVix <= 30) return false;
  return !prevVix || prevVix <= 30; // 처음 30 초과 시만
}

/** VIX 반등 신호: 30 초과 이후 3거래일 연속 하락 */
function checkVixReboundInternal(history: number[]): boolean {
  if (history.length < 4) return false;
  const peakIdx = history.findIndex(v => v > 30);
  if (peakIdx < 0) return false;
  const afterPeak = history.slice(peakIdx + 1);
  if (afterPeak.length < 3) return false;
  const last3 = afterPeak.slice(-3);
  return last3[0] > last3[1] && last3[1] > last3[2];
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
  console.log('[GlobalScan] 새벽 글로벌 스캔 시작');

  // ── 1. 7개 지수 병렬 수집 ────────────────────────────────────────────────
  const SYMBOLS: Array<[string, string]> = [
    ['^GSPC',    'S&P500'],
    ['^IXIC',    '나스닥'],
    ['^DJI',     '다우'],
    ['^VIX',     'VIX'],
    ['EWY',      'EWY(한국ETF)'],
    ['ITA',      'ITA(방산ETF)'],
    ['SOXX',     'SOXX(반도체ETF)'],
  ];

  const results = await Promise.all(
    SYMBOLS.map(([sym, label]) => fetchSymbolResult(sym, label))
  );

  const vixResult = results.find(r => r.symbol === '^VIX');
  const vix       = vixResult?.price ?? null;

  // ── 2. MacroState — vix + vixHistory 갱신 ────────────────────────────────
  const macroState = loadMacroState();
  const prevVix    = macroState?.vix;
  if (macroState && vix !== null) {
    const prevHistory = macroState.vixHistory ?? [];
    macroState.vix        = vix;
    macroState.vixHistory = updateVixHistory(prevHistory, vix);
    macroState.updatedAt  = new Date().toISOString();
    saveMacroState(macroState);
    console.log(`[GlobalScan] VIX 갱신: ${vix} (이력 ${macroState.vixHistory.length}개)`);
  }

  // ── 3. Gemini 3-줄 요약 생성 ─────────────────────────────────────────────
  const dataLines = results
    .filter(r => r.price !== null)
    .map(r => `${r.label}: ${r.price} (${r.changePct !== null && r.changePct >= 0 ? '+' : ''}${r.changePct?.toFixed(2)}%)`)
    .join('\n');

  const prompt = `간밤 주요 글로벌 지수 종가 데이터:\n${dataLines}\n\n` +
    `위 데이터를 바탕으로 오늘 한국 주식시장 관점에서 다음 3가지를 각 1~2문장으로 분석하라:\n` +
    `1. KOSPI 전망 (방향과 핵심 이유)\n` +
    `2. 주목할 섹터 (ETF 데이터 기반)\n` +
    `3. 주요 리스크 또는 회피할 섹터\n\n` +
    `JSON·마크다운 없이 순수 텍스트만 출력하라.`;

  const aiSummary = await callGemini(prompt).catch(() => null);

  // ── 4. 보고서 저장 ───────────────────────────────────────────────────────
  const report: GlobalScanReport = {
    createdAt:  new Date().toISOString(),
    symbols:    results,
    vix,
    aiSummary:  aiSummary ?? null,
  };
  saveGlobalScanReport(report);

  // ── 5. Telegram 알림 ─────────────────────────────────────────────────────
  const formatChange = (r: SymbolResult) => {
    if (r.price === null) return 'N/A';
    const sign = (r.changePct ?? 0) >= 0 ? '+' : '';
    return `${r.price.toLocaleString()} (${sign}${r.changePct?.toFixed(2)}%)`;
  };

  const sp500  = results.find(r => r.symbol === '^GSPC');
  const nasdaq = results.find(r => r.symbol === '^IXIC');
  const dji    = results.find(r => r.symbol === '^DJI');
  const ewy    = results.find(r => r.symbol === 'EWY');
  const ita    = results.find(r => r.symbol === 'ITA');
  const soxx   = results.find(r => r.symbol === 'SOXX');

  const vixLine = vix !== null
    ? `VIX: ${vix.toFixed(1)} (${(vixResult?.changePct ?? 0) >= 0 ? '+' : ''}${(vixResult?.changePct ?? 0).toFixed(2)}%)`
    : 'VIX: N/A';

  let message =
    `🌏 <b>[글로벌 스캔 06:00]</b> 간밤 시장 요약\n` +
    `S&P500: ${formatChange(sp500!)}\n` +
    `나스닥: ${formatChange(nasdaq!)}\n` +
    `다우: ${formatChange(dji!)}\n` +
    `${vixLine}\n` +
    `EWY: ${(ewy?.changePct ?? 0) >= 0 ? '+' : ''}${(ewy?.changePct ?? 0).toFixed(2)}% | ` +
    `ITA: ${(ita?.changePct ?? 0) >= 0 ? '+' : ''}${(ita?.changePct ?? 0).toFixed(2)}% | ` +
    `SOXX: ${(soxx?.changePct ?? 0) >= 0 ? '+' : ''}${(soxx?.changePct ?? 0).toFixed(2)}%\n` +
    `──────────────────`;

  if (aiSummary) {
    message += `\n🤖 <b>Gemini 분석:</b>\n${aiSummary}`;
  }

  await sendTelegramAlert(message).catch(console.error);

  // ── 6. VIX 특별 경보 ─────────────────────────────────────────────────────
  if (vix !== null && macroState) {
    const vixHistory = macroState.vixHistory ?? [];

    // VIX > 30 첫 진입 → 50% 현금화 권고
    if (shouldAlertVixEmergency(prevVix, vix)) {
      await sendTelegramAlert(
        `🚨 <b>[VIX 위험] VIX ${vix.toFixed(1)} > 30 돌파</b>\n` +
        `극도의 시장 공포 감지 — 신규 매수 자동 중단\n` +
        `기존 포지션 50% 현금화 검토 권고\n` +
        `자동매매 시스템이 진입을 차단합니다.`
      ).catch(console.error);
    }

    // VIX 반등 신호 → 리스크 온 전환 권고
    if (checkVixReboundInternal(vixHistory)) {
      await sendTelegramAlert(
        `📈 <b>[VIX 반등 신호]</b>\n` +
        `VIX 30 초과 이후 3거래일 연속 하락 감지\n` +
        `현재 VIX: ${vix.toFixed(1)}\n` +
        `리스크 온 전환 검토 — 보수적 재진입 허용 (Kelly ×0.70)`
      ).catch(console.error);
    }
  }

  console.log(`[GlobalScan] 완료 — VIX: ${vix ?? 'N/A'}, AI 요약: ${aiSummary ? '생성됨' : '실패'}`);
}
