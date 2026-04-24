/**
 * qualityScorecard.ts — 장마감 워치리스트 품질 스코어카드 (Close-of-Day Quality Scorecard)
 *
 * 매일 장마감 후(15:40 KST) 자동으로 계산되는 4단계 Pipeline Yield 스코어카드.
 * "오늘 워치리스트에 올라온 종목들이 실제로 Gate를 얼마나 통과했고
 *  그 중 몇 개가 수익을 냈는가"의 파이프라인 수율을 측정한다.
 *
 * ┌─ 4단계 Pipeline Yield ────────────────────────────────────────────────────────┐
 * │  ① Discovery Yield:  발굴 → Gate1 통과율                                     │
 * │     Stage1 전체 스캔 종목 중 Stage2+3 워치리스트까지 도달한 비율               │
 * │                                                                              │
 * │  ② Gate Yield:       Gate1 → Gate2+3 통과율                                  │
 * │     장중 스캔에서 Gate 평가를 받은 종목 중 SKIP이 아닌 신호를 받은 비율         │
 * │                                                                              │
 * │  ③ Signal Yield:     Gate 통과 → 실제 매수 신호 발생율                        │
 * │     Gate 통과 종목 중 실제 매수(SHADOW/LIVE) 실행까지 도달한 비율              │
 * │                                                                              │
 * │  ④ Trade Yield:      신호 → 수익 체결율                                       │
 * │     당일 발생한 매수 신호(Shadow Trade) 중 수익으로 청산된 비율                 │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * 데이터 소스:
 *   - Stage1 캐시 (stage1-cache.json) → Discovery 분모
 *   - 워치리스트 (watchlist.json) → Discovery 분자
 *   - 스캔 트레이스 (scan_trace_YYYYMMDD.json) → Gate/Signal 계산
 *   - Shadow Trades (shadow-trades.json) → Trade Yield 계산
 *
 * 스케줄: 매일 15:40 KST (UTC 06:40, 월~금)
 */

import fs from 'fs';
import { sendTelegramAlert } from './telegramClient.js';
import { callGemini } from '../clients/geminiClient.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { SCORECARD_FILE, STAGE1_CACHE_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadTodayScanTraces, summarizeScanTraces } from '../trading/scanTracer.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface PipelineYield {
  /** 발굴 → Gate1 통과율 (%) */
  discoveryYield: number;
  /** Gate1 → Gate2+3 통과율 (%) */
  gateYield: number;
  /** Gate 통과 → 실제 매수 신호 발생율 (%) */
  signalYield: number;
  /** 신호 → 수익 체결율 (%) */
  tradeYield: number;
}

export interface ScorecardEntry {
  date: string;                    // YYYY-MM-DD
  createdAt: string;               // ISO
  // ── 파이프라인 카운트 ───────────────────────────────────────────────────────
  universeScanned: number;         // Stage1 스캔 종목 수
  stage1Passed: number;            // Stage1 통과 (캐시 후보)
  watchlistCount: number;          // 장마감 시 워치리스트 수
  scanCandidates: number;          // 장중 스캔 후보 수
  gatePassed: number;              // Gate 평가 통과 수
  buyExecuted: number;             // 매수 실행 수
  todayTradesTotal: number;        // 당일 총 신호 수
  todayTradesClosed: number;       // 당일 결산 수
  todayTradesWon: number;          // 당일 수익 수
  todayTradesLost: number;         // 당일 손실 수
  // ── 4단계 수율 ──────────────────────────────────────────────────────────────
  yields: PipelineYield;
  // ── 컨텍스트 ──────────────────────────────────────────────────────────────
  regime: string;
  mhs: number;
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function todayKstDate(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function pctSafe(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // 소수 첫째 자리까지
}

function yieldEmoji(pct: number): string {
  if (pct >= 50) return '🟢';
  if (pct >= 25) return '🟡';
  if (pct >= 10) return '🟠';
  return '🔴';
}

function yieldBar(pct: number, maxWidth: number = 10): string {
  const filled = Math.round((Math.min(pct, 100) / 100) * maxWidth);
  return '█'.repeat(filled) + '░'.repeat(maxWidth - filled);
}

// ── Stage1 캐시 로드 (universeScanner와 동일 인터페이스) ──────────────────────

interface Stage1CacheData {
  cachedAt: string;
  candidates: Array<{ code: string; name: string }>;
}

function loadStage1CacheCount(): { total: number; stage1Passed: number } {
  ensureDataDir();
  // STOCK_UNIVERSE 크기 — 환경에 따라 동적이지만 기본 220개
  const universeSize = parseInt(process.env.STOCK_UNIVERSE_SIZE ?? '220', 10);

  if (!fs.existsSync(STAGE1_CACHE_FILE)) {
    return { total: universeSize, stage1Passed: 0 };
  }
  try {
    const data: Stage1CacheData = JSON.parse(fs.readFileSync(STAGE1_CACHE_FILE, 'utf-8'));
    return { total: universeSize, stage1Passed: data.candidates?.length ?? 0 };
  } catch {
    return { total: universeSize, stage1Passed: 0 };
  }
}

// ── 스코어카드 영속화 ──────────────────────────────────────────────────────────

function loadScorecardHistory(): ScorecardEntry[] {
  ensureDataDir();
  if (!fs.existsSync(SCORECARD_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SCORECARD_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveScorecardHistory(entries: ScorecardEntry[]): void {
  ensureDataDir();
  // 최근 90일분만 보관
  const trimmed = entries.slice(-90);
  fs.writeFileSync(SCORECARD_FILE, JSON.stringify(trimmed, null, 2));
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * 장마감 Pipeline Yield 스코어카드 생성 + Telegram 발송.
 * scheduler.ts에서 매일 15:40 KST에 호출.
 */
export async function generateQualityScorecard(): Promise<void> {
  console.log('[Scorecard] 장마감 Pipeline Yield 스코어카드 생성 시작');

  const today = todayKstDate();

  // ── 1. 데이터 수집 ─────────────────────────────────────────────────────────

  // Stage1 캐시 → Discovery 분모/분자
  const { total: universeScanned, stage1Passed } = loadStage1CacheCount();

  // 워치리스트 현황
  const watchlist = loadWatchlist();
  const watchlistCount = watchlist.length;

  // 장중 스캔 트레이스 → Gate/Signal 계산
  const traces = loadTodayScanTraces();
  const traceSummary = summarizeScanTraces(traces);

  const scanCandidates = traceSummary.totalCandidates;
  const yahooFail = traceSummary.yahooFail;
  const gateFail = traceSummary.gateFail;
  const priceFail = traceSummary.priceFail;
  const rrrFail = traceSummary.rrrFail;
  const buyExecuted = traceSummary.buyExecuted;

  // Gate 통과 = 전체 - (yahoo실패 + gate실패) — 가격/RRR 실패는 Gate 이후 단계
  // 더 정확하게: Gate까지 도달한 종목 = 전체 - yahooFail
  // Gate 통과 종목 = Gate 도달 - gateFail
  const gateReached = scanCandidates - yahooFail;
  const gatePassed = gateReached - gateFail;

  // Shadow Trades → Trade Yield 계산
  const shadows = loadShadowTrades();
  const todayTrades = shadows.filter((s) => s.signalTime.startsWith(today));
  const todayTradesTotal = todayTrades.length;
  const closed = todayTrades.filter(
    (s) => s.status === 'HIT_TARGET' || s.status === 'HIT_STOP',
  );
  const todayTradesClosed = closed.length;
  const todayTradesWon = closed.filter((s) => s.status === 'HIT_TARGET').length;
  const todayTradesLost = todayTradesClosed - todayTradesWon;

  // 매크로 컨텍스트
  const macro = loadMacroState();
  const regime = macro?.regime ?? 'N/A';
  const mhs = macro?.mhs ?? 0;

  // ── 2. 4단계 수율 계산 ─────────────────────────────────────────────────────

  // ① Discovery Yield: Stage1 스캔 → 워치리스트 도달률
  //    분모: 유니버스 전체(~220) / 분자: 현재 워치리스트(Stage2+3 통과)
  const discoveryYield = pctSafe(watchlistCount, universeScanned);

  // ② Gate Yield: 장중 스캔에서 Gate 평가 도달 → Gate 통과율
  //    분모: Gate 평가 도달(yahoo 성공) / 분자: Gate 점수 충족(SKIP 아닌 신호)
  const gateYield = pctSafe(gatePassed, gateReached);

  // ③ Signal Yield: Gate 통과 → 실제 매수 신호 발생율
  //    분모: Gate 통과 종목 / 분자: 매수 실행
  const signalYield = pctSafe(buyExecuted, gatePassed);

  // ④ Trade Yield: 매수 신호 → 수익 체결율
  //    분모: 당일 결산 완료 거래 / 분자: 수익 거래
  //    아직 ACTIVE인 거래는 미결산이므로 결산 건수 기준
  const tradeYield = pctSafe(todayTradesWon, todayTradesClosed);

  const yields: PipelineYield = {
    discoveryYield,
    gateYield,
    signalYield,
    tradeYield,
  };

  // ── 3. 스코어카드 영속화 ───────────────────────────────────────────────────

  const entry: ScorecardEntry = {
    date: today,
    createdAt: new Date().toISOString(),
    universeScanned,
    stage1Passed,
    watchlistCount,
    scanCandidates,
    gatePassed,
    buyExecuted,
    todayTradesTotal,
    todayTradesClosed,
    todayTradesWon,
    todayTradesLost,
    yields,
    regime,
    mhs,
  };

  const history = loadScorecardHistory();
  // 같은 날짜 중복 방지 — 덮어쓰기
  const existingIdx = history.findIndex((e) => e.date === today);
  if (existingIdx >= 0) {
    history[existingIdx] = entry;
  } else {
    history.push(entry);
  }
  saveScorecardHistory(history);

  // ── 4. 7일 이동 평균 계산 (추세 분석) ──────────────────────────────────────

  const recent7 = history.slice(-7);
  const avg7 = (field: keyof PipelineYield): number => {
    if (recent7.length === 0) return 0;
    const sum = recent7.reduce((acc, e) => acc + e.yields[field], 0);
    return Math.round((sum / recent7.length) * 10) / 10;
  };

  const avg7Discovery = avg7('discoveryYield');
  const avg7Gate = avg7('gateYield');
  const avg7Signal = avg7('signalYield');
  const avg7Trade = avg7('tradeYield');

  // ── 5. Telegram 스코어카드 발송 ────────────────────────────────────────────

  const overallYield = pctSafe(
    todayTradesWon,
    Math.max(universeScanned, 1),
  );

  const message =
    `📋 <b>[Pipeline Yield 스코어카드] ${today}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `\n` +
    `${yieldEmoji(discoveryYield)} <b>① Discovery Yield</b> (발굴 → 워치리스트)\n` +
    `   ${yieldBar(discoveryYield)} ${discoveryYield}%\n` +
    `   ${universeScanned}개 스캔 → ${watchlistCount}개 워치리스트\n` +
    `\n` +
    `${yieldEmoji(gateYield)} <b>② Gate Yield</b> (Gate 평가 → 통과)\n` +
    `   ${yieldBar(gateYield)} ${gateYield}%\n` +
    `   ${gateReached}개 평가 → ${gatePassed}개 통과\n` +
    `\n` +
    `${yieldEmoji(signalYield)} <b>③ Signal Yield</b> (Gate 통과 → 매수 신호)\n` +
    `   ${yieldBar(signalYield)} ${signalYield}%\n` +
    `   ${gatePassed}개 통과 → ${buyExecuted}개 매수\n` +
    `\n` +
    `${yieldEmoji(tradeYield)} <b>④ Trade Yield</b> (신호 → 수익 체결)\n` +
    `   ${yieldBar(tradeYield)} ${tradeYield}%\n` +
    `   ${todayTradesClosed}개 결산 → ${todayTradesWon}승 ${todayTradesLost}패` +
    `${todayTradesTotal - todayTradesClosed > 0 ? ` (${todayTradesTotal - todayTradesClosed}개 미결산)` : ''}\n` +
    `\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>End-to-End Yield:</b> ${overallYield}% (${universeScanned} → ${todayTradesWon}승)\n` +
    `\n` +
    `<b>7일 평균 추세:</b>\n` +
    `  Discovery ${avg7Discovery}% | Gate ${avg7Gate}%\n` +
    `  Signal ${avg7Signal}% | Trade ${avg7Trade}%\n` +
    `\n` +
    `레짐: ${regime} | MHS: ${mhs}`;

  await sendTelegramAlert(message).catch(console.error);

  // ── 6. 병목 자동 진단 (Gemini) ─────────────────────────────────────────────

  // 수율이 극단적으로 낮은 구간을 Gemini가 진단
  const bottleneckStages: string[] = [];
  if (discoveryYield < 5 && universeScanned > 0) bottleneckStages.push(`Discovery ${discoveryYield}% (스크리닝 기준 과도?)`);
  if (gateYield < 20 && gateReached > 0) bottleneckStages.push(`Gate ${gateYield}% (Gate 조건 과다?)`);
  if (signalYield < 10 && gatePassed > 3) bottleneckStages.push(`Signal ${signalYield}% (진입 조건 과도?)`);
  if (tradeYield < 30 && todayTradesClosed >= 3) bottleneckStages.push(`Trade ${tradeYield}% (손절 기준 점검 필요?)`);

  if (bottleneckStages.length > 0) {
    const diagPrompt = [
      '한국 주식 자동매매 시스템의 파이프라인 병목 구간이 감지됐다.',
      `레짐: ${regime}, MHS: ${mhs}`,
      `병목 구간: ${bottleneckStages.join(' / ')}`,
      `Stage1 후보: ${stage1Passed}개, 워치리스트: ${watchlistCount}개, 매수: ${buyExecuted}건, 수익: ${todayTradesWon}건`,
      '',
      '각 병목에 대해 가능한 원인 1개와 개선 방향 1개를 한국어 bullet point로, 150자 이내로 작성하라.',
    ].join('\n');

    const diagnosis = await callGemini(diagPrompt, 'quality-scorecard').catch(() => null);
    if (diagnosis) {
      await sendTelegramAlert(
        `🔬 <b>[병목 자동 진단]</b>\n${diagnosis}`,
      ).catch(console.error);
    }
  }

  console.log(
    `[Scorecard] 완료 — Discovery ${discoveryYield}% | Gate ${gateYield}% | ` +
    `Signal ${signalYield}% | Trade ${tradeYield}%`,
  );
}
