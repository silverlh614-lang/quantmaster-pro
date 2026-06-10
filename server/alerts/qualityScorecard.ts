/**
 * @responsibility 장마감 4단계 yield(Discovery/Gate/Signal/Trade) 스코어카드 — fill SSOT
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
import {
  collectTodayBuyEvents,
  collectTodayRealizations,
  summarizeTodayBuyEvents,
  summarizeTodayRealizations,
} from './reportGenerator.js';

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
  const quoteFail = traceSummary.quoteFail;
  const gateFail = traceSummary.gateFail;
  const priceFail = traceSummary.priceFail;
  const rrrFail = traceSummary.rrrFail;
  const buyExecuted = traceSummary.buyExecuted;

  // Gate 통과 = 전체 - (yahoo실패 + gate실패) — 가격/RRR 실패는 Gate 이후 단계
  // 더 정확하게: Gate까지 도달한 종목 = 전체 - quoteFail
  // Gate 통과 종목 = Gate 도달 - gateFail
  const gateReached = scanCandidates - quoteFail;
  const gatePassed = gateReached - gateFail;

  // PR-17: Shadow Trades → Trade Yield (fill SSOT 전환).
  //   · todayTradesTotal: 오늘 실제 BUY 체결된 trade 수 (신규+기존 tranche)
  //   · todayTradesClosed: 오늘 CONFIRMED SELL fill 수 (부분매도 포함)
  //   · todayTradesWon/Lost: fill 단위 이익/손실 수
  // "매수했지만 결산 안 됨" 과 "부분매도 익절" 이 Trade Yield 에서 누락되던 문제 해소.
  const shadows = loadShadowTrades();
  const buyEvents = collectTodayBuyEvents(shadows, today);
  const realizations = collectTodayRealizations(shadows, today);
  const buyStats = summarizeTodayBuyEvents(buyEvents);
  const realizationStats = summarizeTodayRealizations(realizations);
  const todayTradesTotal = buyStats.totalBuys;
  const todayTradesClosed = realizationStats.realizationCount;
  const todayTradesWon = realizationStats.wins;
  const todayTradesLost = realizationStats.losses;

  // 매크로 컨텍스트
  const macro = loadMacroState();
  const regime = macro?.regime ?? 'N/A';
  const mhs = macro?.mhs ?? 0;

  // ── 2. 4단계 수율 계산 ─────────────────────────────────────────────────────

  // ① Discovery Yield: Stage1 스캔 → 워치리스트 도달률
  //    분모: 유니버스 전체(~220) / 분자: 현재 워치리스트(Stage2+3 통과)
  const discoveryYield = pctSafe(watchlistCount, universeScanned);

  // ② Gate Yield: 장중 스캔에서 Gate 평가 도달 → Gate 통과율
  //    분모: Gate 평가 도달(quote(KIS) 조회 성공) / 분자: Gate 점수 충족(SKIP 아닌 신호)
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
    // ADR-0107 (사용자 진단 4/29): 0개 평가 시 차단 사유 맥락 안내 — Gate 결함 vs 게이팅 차단 구분.
    (gateReached === 0 ? `   ${formatGateZeroContext(macro)}\n` : '') +
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

  // 추세 상대 감지 — 절대 임계값이 아니라 "자기 7일 평균 대비 급락" 한 단계만 병목으로 본다.
  const bottleneckStages = detectBottleneckStages([
    { label: 'Discovery', today: discoveryYield, avg7: avg7Discovery, hasSample: universeScanned > 0, absoluteFloor: 5, hint: '스크리닝 기준 과도?' },
    { label: 'Gate', today: gateYield, avg7: avg7Gate, hasSample: gateReached > 0, absoluteFloor: 20, hint: 'Gate 조건 과다?' },
    { label: 'Signal', today: signalYield, avg7: avg7Signal, hasSample: gatePassed > 3, absoluteFloor: 10, hint: '진입 조건 과도?' },
    { label: 'Trade', today: tradeYield, avg7: avg7Trade, hasSample: todayTradesClosed >= 3, absoluteFloor: 30, hint: '손절 기준 점검 필요?' },
  ]);

  if (bottleneckStages.length > 0) {
    const diagPrompt = [
      '한국 주식 자동매매 시스템의 파이프라인 병목 구간이 감지됐다.',
      `레짐: ${regime}, MHS: ${mhs}`,
      `병목 구간(오늘): ${bottleneckStages.join(' / ')}`,
      `7일 평균 기준선: Discovery ${avg7Discovery}% / Gate ${avg7Gate}% / Signal ${avg7Signal}% / Trade ${avg7Trade}%`,
      `Stage1 후보: ${stage1Passed}개, 워치리스트: ${watchlistCount}개, 매수: ${buyExecuted}건, 수익: ${todayTradesWon}건`,
      '',
      '각 병목은 7일 평균 대비 급락한 단계다. 상시 보수성이 아니라 "오늘 평소 대비 무엇이 바뀌어 급락했는가"(데이터 결측/provider 이슈/레짐 전환 등 일시 원인 포함)에 초점을 맞춰,',
      '가능한 원인 1개와 개선 방향 1개를 한국어 bullet point로, 150자 이내로 작성하라.',
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

/**
 * ADR-0107 (사용자 진단 4/29): Gate 0개 평가 시 맥락 안내 SSOT.
 *
 * 사용자 보고 (4/29 PM 3:35 Pipeline Yield): "Gate 0% (0개 평가 → 0개 통과)" —
 * 7일 평균 14.1% 와 충돌해 운영자 결함 의심.
 *
 * 진단 결과: Gate 0개 평가는 *결함이 아니라 의도된 시그널* — FOMC DAY /
 * R6_DEFENSE / VIX 게이팅 등 macro 게이트 차단으로 *Gate 평가 단계 도달 자체*
 * 가 차단된 결과. 본 헬퍼는 macroState 기반 차단 사유 분기 안내 라인 생성 —
 * 운영자가 결함 vs 정책 즉시 구분.
 *
 * 분기 우선순위:
 *   - bearDefenseMode=true → "🛑 Bear 방어 모드 — Gate 평가 차단 (R6_DEFENSE)"
 *   - mhs < 30 (DEFENSE 임계) → "🛑 MHS 매수중단 임계 — Gate 평가 차단"
 *   - regime='RED' → "🟠 매크로 RED — Gate 평가 차단"
 *   - 그 외 → "ℹ️ 평가 도달 0건 — 운영자 진단 필요 (스캔 cron 점검)"
 */
export function formatGateZeroContext(
  macro: { mhs?: number; regime?: string; bearDefenseMode?: boolean } | null,
): string {
  if (!macro) return 'ℹ️ 평가 도달 0건 — macroState 부재';
  if (macro.bearDefenseMode === true) {
    return '🛑 Bear 방어 모드 — Gate 평가 차단 (R6_DEFENSE)';
  }
  if (typeof macro.mhs === 'number' && macro.mhs < 30) {
    return `🛑 MHS ${macro.mhs} (매수중단 임계 30 미만) — Gate 평가 차단`;
  }
  if (macro.regime === 'RED') {
    return '🟠 매크로 RED — Gate 평가 차단';
  }
  return 'ℹ️ 평가 도달 0건 — 운영자 진단 필요 (FOMC/VIX 게이팅 또는 스캔 cron 점검)';
}

// ── 병목 자동 진단 — 추세 상대(trend-relative) 감지 ───────────────────────────

/** 자기 7일 평균의 이 비율 미만으로 하락한 단계만 병목으로 판정 (40%+ 급락). */
const BOTTLENECK_RELATIVE_FLOOR = 0.6;
/** 최소 유의 하락폭(%p) — 저베이스 단계(예: Signal)의 미세 변동 노이즈 차단. */
const BOTTLENECK_MIN_DROP_PP = 2;

export interface StageYieldSnapshot {
  /** 단계 라벨 (Discovery/Gate/Signal/Trade) */
  label: string;
  /** 오늘 수율 (%) */
  today: number;
  /** 7일 평균 수율 (%) — 기준선. 0 이면 부트스트랩(이력 부재). */
  avg7: number;
  /** 평가 표본 충분 여부 (단계별 카운트 가드) */
  hasSample: boolean;
  /** 부트스트랩(평균 부재) 시 폴백할 절대 바닥값 (%) */
  absoluteFloor: number;
  /** 부트스트랩 폴백 발화 시 원인 힌트 (프롬프트용) */
  hint: string;
}

/**
 * 병목 단계 판정 (추세 상대).
 *
 * 기존 절대 임계값 방식(today < 고정값)은 두 가지 결함이 있었다:
 *   1) 자기 7일 평균이 임계값보다 구조적으로 낮은 단계(예: Signal 평균 2.3% < 임계 10%)는
 *      *매일* 발화 → 알림 노이즈가 진짜 병목을 묻는다.
 *   2) 오늘 평소보다 *좋은데도* 절대값이 낮으면 병목으로 오진 → Gemini 가 "조건 완화"라는
 *      정반대 처방을 낸다.
 *
 * 본 함수는 "자기 7일 평균 대비 40%+ 급락(+ 최소 유의 하락폭)" 한 단계만 병목으로 본다.
 * 이력이 없는 부트스트랩 구간에서만 절대 바닥값으로 폴백한다.
 */
export function detectBottleneckStages(stages: StageYieldSnapshot[]): string[] {
  const out: string[] = [];
  for (const s of stages) {
    if (!s.hasSample) continue;
    const isRegression =
      s.avg7 > 0
        ? s.today < s.avg7 * BOTTLENECK_RELATIVE_FLOOR &&
          s.avg7 - s.today >= BOTTLENECK_MIN_DROP_PP
        : s.today < s.absoluteFloor; // 부트스트랩(평균 부재) 폴백
    if (!isRegression) continue;
    const reason = s.avg7 > 0 ? `평소 ${s.avg7}% 대비 급락` : s.hint;
    out.push(`${s.label} ${s.today}% (${reason})`);
  }
  return out;
}
