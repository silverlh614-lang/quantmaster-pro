// @responsibility intradayScanner 스크리너 모듈
/**
 * intradayScanner.ts — 장중 Intraday Watchlist 발굴·갱신
 *
 * 장중에 새롭게 조건을 충족하는 종목을 탐색하여 IntradayWatchlistEntry로 등록하고,
 * 이미 등록된 항목에 대해 15분 경과 + 가격 강도 재검증을 수행하여
 * intradayReady 플래그를 갱신한다.
 *
 * 2가지 발굴 경로:
 *
 * [경로 A — 돌파형] isBreakoutStrong:
 *   ① 거래량 폭발: volume > avgVolume × BREAKOUT_VOLUME_RATIO (2×)
 *   ② 가격 강도: currentPrice > dayOpen AND changeRatePct ≥ BREAKOUT_PRICE_CHANGE_PCT (+1.5%)
 *   ③ 고점 돌파: currentPrice > high20d
 *
 * [경로 B — 수급형] isSupplyDemandStrong:
 *   ① 거래량 증가: volume > avgVolume × SUPPLY_VOLUME_RATIO (2.5×)
 *   ② 양봉: currentPrice > dayOpen AND changeRatePct ≥ SUPPLY_PRICE_CHANGE_PCT (0%)
 *   ③ MA20 위: currentPrice > ma20
 *   ④ 외국인/기관 매집 또는 눌림목 셋업
 *
 * intradayReady 전환 조건:
 *   ④ 15분(INTRADAY_MIN_HOLD_MS) 이상 목록 유지
 *   ⑤ 재검증: currentPrice > dayOpen AND changeRatePct ≥ CONFIRM_PRICE_CHANGE_PCT
 *
 * 즉시 매수 금지 — signalScanner는 intradayReady=true 항목만 진입 후보로 처리한다.
 */

import { loadIntradayWatchlist, saveIntradayWatchlist, type IntradayWatchlistEntry } from '../persistence/intradayWatchlistRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { isBlacklisted } from '../persistence/blacklistRepo.js';
import { fetchYahooQuote, getScreenerCache, STOCK_UNIVERSE } from './stockScreener.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { isPullbackSetup } from './pipelineHelpers.js';
import { getKstMarketElapsedMinutes, MORNING_VOLUME_DISCOUNT, MORNING_END_MINUTES } from '../trading/entryEngine.js';
import { evaluateServerGate } from '../quantFilter.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import type { YahooQuoteExtended } from './stockScreener.js';
import type { RegimeLevel } from '../../src/types/core.js';

// ── 상수 ───────────────────────────────────────────────────────────────────────

// ─ 경로 A: 돌파형 (Breakout) ─
/** 돌파형 거래량 최소 배율 */
export const BREAKOUT_VOLUME_RATIO = 2.0;
/** 돌파형 최소 등락률 (%) */
export const BREAKOUT_PRICE_CHANGE_PCT = 1.5;

// ─ 경로 B: 수급형 (Supply-Demand) ─
/** 수급형 거래량 최소 배율 */
export const SUPPLY_VOLUME_RATIO = 2.5;
/** 수급형 최소 등락률 (%) — 양봉이면 충분 */
export const SUPPLY_PRICE_CHANGE_PCT = 0.0;

/** 하위 호환: 기존 코드/테스트 참조용 — 돌파형 기준값 사용 */
export const VOLUME_SURGE_RATIO = BREAKOUT_VOLUME_RATIO;
export const MIN_PRICE_CHANGE_PCT = BREAKOUT_PRICE_CHANGE_PCT;

/** intradayReady 전환 재검증 최소 등락률 (%) — 돌파형 기준의 70% */
export const CONFIRM_PRICE_CHANGE_PCT = BREAKOUT_PRICE_CHANGE_PCT * 0.7;

/** 최소 목록 유지 시간 — 15분 (ms) */
export const INTRADAY_MIN_HOLD_MS = 15 * 60_000;

/** 동시 장중 포지션 최대 수 */
export const MAX_INTRADAY_POSITIONS = 3;

/** 장중 포지션 비중 축소 계수 (기존의 50%) */
export const INTRADAY_POSITION_PCT_FACTOR = 0.5;

/** 장중 손절 비율 — 돌파형 (진입가 대비) */
export const INTRADAY_STOP_LOSS_PCT = 0.05;

/** 장중 손절 비율 — 눌림목형 (더 타이트한 -4%) */
export const INTRADAY_PULLBACK_STOP_LOSS_PCT = 0.04;

/** 장중 목표 비율 (진입가 대비) */
export const INTRADAY_TARGET_PCT = 0.10;

/** 발굴 경로 유형 */
export type IntradayEntryPath = 'BREAKOUT' | 'SUPPLY_DEMAND' | 'PULLBACK';

/** 레짐별 Intraday 진입 최소 Gate 점수 — 점수 미달 시 발굴 후보에서 제외 */
const INTRADAY_GATE_BY_REGIME: Record<RegimeLevel, number> = {
  R1_TURBO:   5,
  R2_BULL:    5,
  R3_EARLY:   5,
  R4_NEUTRAL: 4,   // 상승횡보장 포착 — 기존 5에서 4로 완화
  R5_CAUTION: 7,
  R6_DEFENSE: 99,  // 진입 금지
};

/** 발굴 스캔 기본 간격 — 10분 (ms) */
const DISCOVERY_INTERVAL_DEFAULT_MS = 10 * 60_000;

/** 상승 레짐(R1~R4) 발굴 스캔 단축 간격 — 5분 (ms) */
const DISCOVERY_INTERVAL_BULL_MS = 5 * 60_000;

/** 현재 레짐에 따른 발굴 간격 반환 */
function getDiscoveryInterval(regime: RegimeLevel): number {
  if (regime === 'R1_TURBO' || regime === 'R2_BULL' || regime === 'R3_EARLY' || regime === 'R4_NEUTRAL') {
    return DISCOVERY_INTERVAL_BULL_MS;
  }
  return DISCOVERY_INTERVAL_DEFAULT_MS;
}

/** 1회 발굴 스캔 최대 Yahoo 호출 수 (rate limit 방지) */
const MAX_YAHOO_CALLS_PER_DISCOVERY = 15;

// ── 모듈 상태 ─────────────────────────────────────────────────────────────────

let lastDiscoveryAt = 0; // ms timestamp

/** 테스트·진단용: 모듈 상태 초기화 */
export function resetIntradayScanState(): void {
  lastDiscoveryAt = 0;
}

// ── 핵심 판단 함수 ─────────────────────────────────────────────────────────────

/**
 * 오전 시간대 보정된 거래량 기준 배율을 반환한다.
 * 오전(12:00 KST 이전)에는 누적 거래량이 풀장 대비 낮으므로
 * 기준 배율을 MORNING_VOLUME_DISCOUNT(0.7)만큼 추가 하향한다.
 */
function getMorningAdjustedRatio(baseRatio: number): number {
  const elapsed = getKstMarketElapsedMinutes();
  if (elapsed < MORNING_END_MINUTES) {
    return baseRatio * MORNING_VOLUME_DISCOUNT;
  }
  return baseRatio;
}

/**
 * [경로 A — 돌파형] 거래량 터지면서 상승 + 고점 돌파.
 *
 * 조건:
 *   ① volume > avgVolume × BREAKOUT_VOLUME_RATIO (2×, 오전 보정 적용)
 *   ② price > dayOpen (시가 대비 강세)
 *   ③ changeRatePct ≥ BREAKOUT_PRICE_CHANGE_PCT (+1.5%)
 *   ④ price > high20d (20일 고점 돌파)
 */
export function isBreakoutStrong(quote: YahooQuoteExtended): boolean {
  const adjustedRatio = getMorningAdjustedRatio(BREAKOUT_VOLUME_RATIO);
  const volumeSurge = quote.avgVolume > 0 && quote.volume > quote.avgVolume * adjustedRatio;
  const aboveOpen   = quote.price > quote.dayOpen;
  const strongGain  = quote.changePercent >= BREAKOUT_PRICE_CHANGE_PCT;
  const high20Break = quote.high20d > 0 && quote.price > quote.high20d;

  return volumeSurge && aboveOpen && strongGain && high20Break;
}

/**
 * [경로 B — 수급형] 외국인 조용히 매집 중이거나 MA20 눌림목 반등 초입.
 *
 * 조건:
 *   ① volume > avgVolume × SUPPLY_VOLUME_RATIO (2.5×, 오전 보정 적용)
 *   ② price > dayOpen AND changeRatePct ≥ SUPPLY_PRICE_CHANGE_PCT (0%)
 *   ③ price > ma20 (20일선 위)
 *   ④ 눌림목(pullback) 셋업 감지
 */
export function isSupplyDemandStrong(quote: YahooQuoteExtended): boolean {
  const adjustedRatio = getMorningAdjustedRatio(SUPPLY_VOLUME_RATIO);
  const volumeSurge = quote.avgVolume > 0 && quote.volume > quote.avgVolume * adjustedRatio;
  const aboveOpen   = quote.price > quote.dayOpen;
  const positiveDay = quote.changePercent >= SUPPLY_PRICE_CHANGE_PCT;
  const aboveMA20   = quote.ma20 > 0 && quote.price > quote.ma20;
  const pullback    = isPullbackSetup(quote);

  return volumeSurge && aboveOpen && positiveDay && aboveMA20 && pullback;
}

/**
 * 통합 장중 강도 판별 — 돌파형(A) 또는 수급형(B) 중 하나 충족 시 true.
 * 하위 호환: 기존 isIntradayStrong과 동일 시그니처.
 */
export function isIntradayStrong(quote: YahooQuoteExtended): boolean {
  return isBreakoutStrong(quote) || isSupplyDemandStrong(quote);
}

/**
 * 발굴 경로 판별 — 종목이 어떤 경로로 발굴되었는지 반환.
 */
export function classifyEntryPath(quote: YahooQuoteExtended): IntradayEntryPath {
  if (isBreakoutStrong(quote)) return 'BREAKOUT';
  if (isSupplyDemandStrong(quote)) return 'SUPPLY_DEMAND';
  return 'PULLBACK';
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

function calcIntradayStop(price: number, path: IntradayEntryPath = 'BREAKOUT'): number {
  const pct = (path === 'SUPPLY_DEMAND' || path === 'PULLBACK')
    ? INTRADAY_PULLBACK_STOP_LOSS_PCT
    : INTRADAY_STOP_LOSS_PCT;
  return Math.round(price * (1 - pct));
}

function calcIntradayTarget(price: number): number {
  return Math.round(price * (1 + INTRADAY_TARGET_PCT));
}

// ── 발굴 스캔 ─────────────────────────────────────────────────────────────────

/**
 * STOCK_UNIVERSE 120개 + screenerCache 이중 소스 기반 장중 후보 발굴.
 * 레짐별 발굴 간격(상승장 5분 / 기본 10분)으로만 실행; 이미 목록에 있거나 Pre-Market 목록에 있는 종목은 건너뜀.
 * R6_DEFENSE(gate=99)에서는 사실상 진입 불가.
 */
async function discoverIntradayCandidates(): Promise<void> {
  const regime = getLiveRegime(loadMacroState());
  const minGate = INTRADAY_GATE_BY_REGIME[regime] ?? 99;

  // R6_DEFENSE — 장중 발굴 완전 차단
  if (minGate >= 99) return;

  const now = Date.now();
  const discoveryInterval = getDiscoveryInterval(regime);
  if (now - lastDiscoveryAt < discoveryInterval) return;
  lastDiscoveryAt = now;

  const intradayList   = loadIntradayWatchlist();
  const preMarketList  = loadWatchlist();
  const intradayCodes  = new Set(intradayList.map(e => e.code));
  const preMarketCodes = new Set(preMarketList.map(e => e.code));

  // ── 이중 소스: STOCK_UNIVERSE(+동적확장) + screenerCache 병합 (코드 기준 중복 제거) ─
  const seenCodes = new Set<string>();
  const mergedCandidates: { code: string; name: string; symbol?: string }[] = [];

  // 소스 1: 확장 유니버스 (정적 + 동적 주간 확장)
  const { getExpandedUniverse } = await import('./dynamicUniverseExpander.js');
  const expandedUniverse = getExpandedUniverse();
  for (const stock of expandedUniverse) {
    if (!stock.code || seenCodes.has(stock.code)) continue;
    if (intradayCodes.has(stock.code) || preMarketCodes.has(stock.code)) continue;
    if (isBlacklisted(stock.code)) continue;
    seenCodes.add(stock.code);
    mergedCandidates.push({ code: stock.code, name: stock.name, symbol: stock.symbol });
  }

  // 소스 2: screenerCache (KIS 거래량 상위 종목 — 실시간 시장 반영)
  const screenerCache = getScreenerCache();
  for (const stock of screenerCache) {
    if (!stock.code || seenCodes.has(stock.code)) continue;
    if (intradayCodes.has(stock.code) || preMarketCodes.has(stock.code)) continue;
    if (isBlacklisted(stock.code)) continue;
    seenCodes.add(stock.code);
    mergedCandidates.push({ code: stock.code, name: stock.name });
  }

  if (mergedCandidates.length === 0) {
    console.log('[IntradayScan] 후보 없음 — 발굴 스킵');
    return;
  }

  // Yahoo 호출 수 제한 — 1회당 최대 MAX_YAHOO_CALLS_PER_DISCOVERY개
  const candidates = mergedCandidates.slice(0, MAX_YAHOO_CALLS_PER_DISCOVERY);
  let newCount = 0;

  for (const stock of candidates) {
    try {
      const quote = stock.symbol
        ? (await fetchYahooQuote(stock.symbol).catch(() => null))
        : (await fetchYahooQuote(`${stock.code}.KS`).catch(() => null)) ??
          (await fetchYahooQuote(`${stock.code}.KQ`).catch(() => null));

      if (!quote || quote.price <= 0) continue;

      if (!isIntradayStrong(quote)) continue;

      // 레짐별 Gate 점수 필터 — minGate 미달 종목은 발굴 제외
      const gateResult = evaluateServerGate(quote);
      if (gateResult.gateScore < minGate) continue;

      const entryPath = classifyEntryPath(quote);
      const pathLabel = entryPath === 'BREAKOUT' ? '돌파형' : entryPath === 'SUPPLY_DEMAND' ? '수급형' : '눌림목형';

      const entry: IntradayWatchlistEntry = {
        code:           stock.code,
        name:           stock.name,
        addedAt:        new Date().toISOString(),
        firstSeenPrice: quote.price,
        openPrice:      quote.dayOpen,
        high20d:        quote.high20d,
        volumeRatio:    quote.avgVolume > 0 ? quote.volume / quote.avgVolume : 0,
        changeRatePct:  quote.changePercent,
        entryPrice:     quote.price,
        stopLoss:       calcIntradayStop(quote.price, entryPath),
        targetPrice:    calcIntradayTarget(quote.price),
        intradayReady:  false,
        entryPath,
      };
      intradayList.push(entry);
      newCount++;

      console.log(
        `[IntradayScan] 신규 등록 [${pathLabel}]: ${stock.name}(${stock.code}) ` +
        `@${quote.price.toLocaleString()} Vol×${entry.volumeRatio.toFixed(1)} +${quote.changePercent.toFixed(1)}%`,
      );

      const pathDesc = entryPath === 'BREAKOUT'
        ? `거래량 배율: ×${entry.volumeRatio.toFixed(1)} | 20일 고점 돌파 ✅`
        : `거래량 배율: ×${entry.volumeRatio.toFixed(1)} | MA20 위 + 눌림목 셋업 ✅`;

      await sendTelegramAlert(
        `📡 <b>[장중 발굴 — ${pathLabel}]</b> ${stock.name} (${stock.code})\n` +
        `현재가: ${quote.price.toLocaleString()}원 (+${quote.changePercent.toFixed(1)}%)\n` +
        `${pathDesc}\n` +
        `손절: ${entry.stopLoss.toLocaleString()}원 (${entryPath === 'BREAKOUT' ? '-5%' : '-4%'})\n` +
        `⏳ 15분 관찰 후 재검증 → 진입 후보 전환 예정`,
        {
          dedupeKey: `intraday_new:${stock.code}:${entryPath}`,
          cooldownMs: 4 * 60 * 60 * 1000,  // 4시간 — 같은 종목·경로로 세션 중 재발송 차단
        },
      ).catch(console.error);

      await new Promise(r => setTimeout(r, 300)); // Yahoo rate limit 방지
    } catch (e) {
      console.error(`[IntradayScan] ${stock.code} 발굴 오류:`, e instanceof Error ? e.message : e);
    }
  }

  if (newCount > 0) {
    saveIntradayWatchlist(intradayList);
    console.log(`[IntradayScan] 발굴 완료: ${newCount}개 신규 등록 (총 ${intradayList.length}개)`);
  }
}

// ── intradayReady 갱신 ────────────────────────────────────────────────────────

/**
 * 이미 등록된 항목 중 30분 경과 + 가격 강도 조건을 만족하는 항목에 intradayReady=true 설정.
 * 조건 소멸(급락·시가 하회) 종목은 목록에서 제거.
 */
async function updateIntradayReadiness(): Promise<void> {
  const intradayList = loadIntradayWatchlist();
  if (intradayList.length === 0) return;

  const now = Date.now();
  let mutated = false;
  const toRemove: string[] = [];

  for (const entry of intradayList) {
    try {
      const quote =
        (await fetchYahooQuote(`${entry.code}.KS`).catch(() => null)) ??
        (await fetchYahooQuote(`${entry.code}.KQ`).catch(() => null));

      if (!quote || quote.price <= 0) continue;

      const holdMs = now - new Date(entry.addedAt).getTime();

      // 조건 소멸: 시가 하회 또는 등락률 0% 미만 → 목록 제거
      if (quote.price <= quote.dayOpen || quote.changePercent < 0) {
        toRemove.push(entry.code);
        mutated = true;
        console.log(
          `[IntradayScan] 조건 소멸 제거: ${entry.name}(${entry.code}) ` +
          `현재가=${quote.price} 시가=${quote.dayOpen} 등락=${quote.changePercent.toFixed(1)}%`,
        );
        continue;
      }

      // 아직 intradayReady가 아닌 경우: 30분 경과 + 재검증 체크
      if (!entry.intradayReady) {
        if (holdMs < INTRADAY_MIN_HOLD_MS) continue; // 30분 미경과

        const stillStrong =
          quote.price > quote.dayOpen &&
          quote.changePercent >= CONFIRM_PRICE_CHANGE_PCT;

        if (stillStrong) {
          entry.intradayReady  = true;
          entry.confirmedAt    = new Date().toISOString();
          // 현재 시세로 진입가/손절/목표 갱신 (경로별 손절 적용)
          entry.entryPrice     = quote.price;
          entry.stopLoss       = calcIntradayStop(quote.price, entry.entryPath);
          entry.targetPrice    = calcIntradayTarget(quote.price);
          mutated = true;

          console.log(
            `[IntradayScan] ✅ 진입 준비 완료: ${entry.name}(${entry.code}) ` +
            `@${quote.price.toLocaleString()} (30분 경과 + 재검증)`,
          );

          const readyPathLabel = entry.entryPath === 'BREAKOUT' ? '돌파형' : entry.entryPath === 'SUPPLY_DEMAND' ? '수급형' : '눌림목형';
          await sendTelegramAlert(
            `✅ <b>[장중 진입 준비 완료 — ${readyPathLabel}]</b> ${entry.name} (${entry.code})\n` +
            `현재가: ${quote.price.toLocaleString()}원 (+${quote.changePercent.toFixed(1)}%)\n` +
            `진입가: ${entry.entryPrice.toLocaleString()} | 손절: ${entry.stopLoss.toLocaleString()} | 목표: ${entry.targetPrice.toLocaleString()}\n` +
            `📌 장중 포지션 50% 비중 / 최대 ${MAX_INTRADAY_POSITIONS}개 동시 진입 제한`,
            {
              dedupeKey: `intraday_ready:${entry.code}`,
              cooldownMs: 4 * 60 * 60 * 1000,  // 4시간 — intradayReady 플래그 세팅 실패 시 중복 발송 방지
            },
          ).catch(console.error);
        }
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`[IntradayScan] ${entry.code} 재검증 오류:`, e instanceof Error ? e.message : e);
    }
  }

  if (mutated) {
    const filtered = intradayList.filter(e => !toRemove.includes(e.code));
    saveIntradayWatchlist(filtered);
  }
}

// ── 메인 진입점 ───────────────────────────────────────────────────────────────

/**
 * tradingOrchestrator의 INTRADAY tick마다 호출.
 * ① 10분 간격 발굴 스캔 (스크리너 캐시 → Yahoo 재검증)
 * ② 기존 항목 intradayReady 갱신 (30분 경과 + 재검증)
 */
export async function scanAndUpdateIntradayWatchlist(): Promise<void> {
  await discoverIntradayCandidates();
  await updateIntradayReadiness();
}
