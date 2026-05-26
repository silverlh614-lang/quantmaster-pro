/**
 * @responsibility 장 마감 후 Gate3 outcome seed 의 d1/d3/d5/d10 forward-return 을 갱신하는 학습 전용 cron. executionImpact=NONE.
 */

import {
  listPendingGate3Outcomes,
  persistGate3OutcomeSeed,
} from '../persistence/gate3OutcomeRepo.js';
import {
  updatePendingGate3Outcomes,
  type Gate3ForwardHorizon,
  type Gate3ForwardPriceSnapshot,
} from '../quant/gate3ForwardReturn.js';
import { tradingDaysBetween } from '../quant/gate3EvidenceWarmup.js';
import type { Gate3OutcomeSeed } from '../quant/gate3OutcomeSeed.js';
import { addBusinessDaysFromKstDate } from './krxHolidays.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

// 영업일 계산은 krxHolidays.ts SSOT(addBusinessDaysFromKstDate) 위임 — 인라인 복제 금지.
// trancheExecutor 의 무거운 import 체인(LIVE 주문/스크리너)에 묶이지 않도록 SSOT 는 경량 krxHolidays 에 둔다.
// KIS 단일 통로 원칙은 fetchCurrentPrice 로 그대로 준수.

/** d{N} horizon → 목표 영업일 수. */
const HORIZON_BUSINESS_DAYS: Record<Gate3ForwardHorizon, number> = {
  d1: 1,
  d3: 3,
  d5: 5,
  d10: 10,
};

const HORIZONS = Object.keys(HORIZON_BUSINESS_DAYS) as Gate3ForwardHorizon[];

/**
 * ENV `GATE3_FORWARD_RETURN_CRON_ENABLED` 정확 비교 (ADR-0157).
 *   - default ON — 학습 증거 갱신은 기본 동작. `=== 'false'` 1줄로 즉시 비활성.
 */
export function isGate3ForwardReturnCronEnabled(): boolean {
  return process.env.GATE3_FORWARD_RETURN_CRON_ENABLED !== 'false';
}

/** 오늘 KST 날짜 (YYYY-MM-DD). */
function getTodayKst(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 한 seed 에서 오늘 기준 갱신 대상인 horizon 목록.
 *   - 목표 영업일(tradeDate + N영업일) 도달(`todayKst >= 목표일`)
 *   - 아직 forwardReturns[dN] 가 null
 */
function dueHorizonsForSeed(seed: Gate3OutcomeSeed, todayKst: string): Gate3ForwardHorizon[] {
  const due: Gate3ForwardHorizon[] = [];
  for (const horizon of HORIZONS) {
    const targetYmd = addBusinessDaysFromKstDate(seed.tradeDate, HORIZON_BUSINESS_DAYS[horizon]);
    if (todayKst >= targetYmd && seed.forwardReturns[horizon] === null) {
      due.push(horizon);
    }
  }
  return due;
}

export interface Gate3ForwardReturnCronResult {
  pending: number;
  seedsWithDueHorizon: number;
  symbolsQueried: number;
  symbolsFailed: number;
  seedsUpdated: number;
  skipped: boolean;
}

export interface Gate3ForwardReturnCronOptions {
  now?: Date;
  /** 종가(현재가) 조회기 — 테스트 주입용. 기본은 kisClient.fetchCurrentPrice (단일 통로). */
  priceFetcher?: (symbol: string) => Promise<number | null | undefined>;
}

/**
 * 장 마감 후 Gate3 forward-return 갱신 잡.
 *
 * 9대 불변식 준수:
 *   - #2 Shadow 무중단 — 학습 증거만 갱신, executionImpact=NONE.
 *   - #6 providerIssue ≠ marketSignal — 종가 조회 실패는 해당 seed skip (다음 실행 재시도),
 *     절대 약세 신호로 변환하지 않는다.
 * KIS 호출은 kisClient 단일 통로(fetchCurrentPrice) + per-symbol 캐시로 quota 보호.
 */
export async function runUpdateGate3ForwardReturnsJob(
  options: Gate3ForwardReturnCronOptions = {},
): Promise<Gate3ForwardReturnCronResult> {
  const now = options.now ?? new Date();
  const todayKst = getTodayKst(now);

  if (!isGate3ForwardReturnCronEnabled()) {
    console.log('[Gate3ForwardReturn] GATE3_FORWARD_RETURN_CRON_ENABLED=false — skip');
    return {
      pending: 0,
      seedsWithDueHorizon: 0,
      symbolsQueried: 0,
      symbolsFailed: 0,
      seedsUpdated: 0,
      skipped: true,
    };
  }

  const fetchPrice = options.priceFetcher ?? ((symbol: string) => fetchCurrentPrice(symbol));
  const pendingSeeds = listPendingGate3Outcomes();

  // 1) seed 별 갱신 대상 horizon 산출 + 조회 대상 symbol 집합.
  const dueBySeedId = new Map<string, Gate3ForwardHorizon[]>();
  const symbolsToQuery = new Set<string>();
  for (const seed of pendingSeeds) {
    const due = dueHorizonsForSeed(seed, todayKst);
    if (due.length > 0) {
      dueBySeedId.set(seed.id, due);
      symbolsToQuery.add(seed.symbol);
    }
  }

  if (dueBySeedId.size === 0) {
    console.log(`[Gate3ForwardReturn] ${todayKst} 갱신 대상 horizon 없음 (pending=${pendingSeeds.length})`);
    return {
      pending: pendingSeeds.length,
      seedsWithDueHorizon: 0,
      symbolsQueried: 0,
      symbolsFailed: 0,
      seedsUpdated: 0,
      skipped: false,
    };
  }

  // 2) per-symbol 종가 조회 (캐시로 중복 KIS 호출 방지 — quota 보호).
  const priceCache = new Map<string, number>();
  let symbolsFailed = 0;
  for (const symbol of symbolsToQuery) {
    try {
      const price = await fetchPrice(symbol);
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
        priceCache.set(symbol, price);
      } else {
        // providerIssue: 값 없음 — 약세 신호로 변환하지 않고 다음 실행 재시도.
        symbolsFailed += 1;
        console.warn(`[Gate3ForwardReturn] ${symbol} 종가 비유효 — skip (providerIssue, marketSignal=false)`);
      }
    } catch (error) {
      // providerIssue: 조회 실패 — seed skip, 다음 cron 주기 재시도.
      symbolsFailed += 1;
      console.warn(
        `[Gate3ForwardReturn] ${symbol} 종가 조회 실패 — skip (providerIssue, marketSignal=false):`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  // 3) 갱신 가능한 seed 만 추려 horizon snapshot 구성.
  const updatableSeeds: Gate3OutcomeSeed[] = [];
  const snapshots: Gate3ForwardPriceSnapshot[] = [];
  for (const seed of pendingSeeds) {
    const due = dueBySeedId.get(seed.id);
    if (!due) continue;
    const price = priceCache.get(seed.symbol);
    if (price === undefined) continue; // 종가 조회 실패 — 이번 주기 skip.
    updatableSeeds.push(seed);
    for (const horizon of due) {
      snapshots.push({ symbol: seed.symbol, horizon, price });
    }
  }

  // 4) seed 별 경과 영업일을 라벨 산정에 사용 (gate3EvidenceWarmup.tradingDaysBetween 재사용).
  let seedsUpdated = 0;
  for (const seed of updatableSeeds) {
    const elapsedTradingDays = tradingDaysBetween(seed.tradeDate, now);
    const [updated] = updatePendingGate3Outcomes([seed], snapshots, { elapsedTradingDays });
    if (updated && updated !== seed) {
      const persisted = persistGate3OutcomeSeed(updated);
      if (persisted) seedsUpdated += 1;
    }
  }

  console.log(
    `[Gate3ForwardReturn] ${todayKst} 갱신 완료 — pending=${pendingSeeds.length} dueSeeds=${dueBySeedId.size} symbolsQueried=${priceCache.size} symbolsFailed=${symbolsFailed} updated=${seedsUpdated}`,
  );

  if (seedsUpdated > 0) {
    await sendTelegramAlert(
      `📊 <b>[Gate3 증거 갱신]</b>\n장 마감 후 ${seedsUpdated}건의 Gate3 outcome forward-return(d1~d10) 갱신 완료 (학습 전용, 실거래 영향 없음).`,
      { priority: 'LOW', category: 'learning' },
    ).catch((e) => console.error('[Gate3ForwardReturn] Telegram 알림 실패:', e));
  }

  return {
    pending: pendingSeeds.length,
    seedsWithDueHorizon: dueBySeedId.size,
    symbolsQueried: priceCache.size,
    symbolsFailed,
    seedsUpdated,
    skipped: false,
  };
}
