/**
 * @responsibility ADR-0019 entry price drift gate extracted from buyListLoop.
 */

import { applyEntryPriceDrift } from '../../../../screener/watchlistManager.js';
import type { WatchlistEntry } from '../../../../persistence/watchlistRepo.js';
import { resolveDataHoldAction } from '../../../../data/dataHoldRolePolicy.js';
import { isEntryPriceAutoCorrectDisabled } from '../../failureClassifier.js';
import {
  verifyDailyBarContinuity,
  isDailyBarVerificationDisabled,
  activeCorporateActionGapThresholdPct,
} from '../../../corporateActionDetector.js';
import { fetchKisDailyCandles } from '../../../../screener/kisChartDataFetcher.js';
import type { BuyListLoopContext } from '../types.js';

/**
 * ADR-0518 — addedAt 기준 RAW 일봉 스캔 윈도우(캘린더 일수) 계산.
 * daysSince(addedAt)+10 을 [30, 250] 으로 clamp. addedAt 파싱 실패 시 60.
 */
function resolveDailyBarScanWindow(addedAt: string | undefined): number {
  const parsed = addedAt ? Date.parse(addedAt) : NaN;
  if (!Number.isFinite(parsed)) return 60;
  const daysSince = Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000));
  const target = daysSince + 10;
  return Math.min(250, Math.max(30, target));
}

/** 일봉 조회 주입형 시그니처 — 테스트 mock 주입용. default 는 RAW 일봉(분할 갭 보존). */
export type DailyCandleFetcher = (
  code: string,
  calendarDays?: number,
) => Promise<{ date: string; close: number }[]>;

const defaultDailyCandleFetcher: DailyCandleFetcher = (code, days) =>
  fetchKisDailyCandles(code, days, { rawPrices: true });

export type CorporateActionDriftMode = 'IMMUTABLE_REMOVE' | 'AUTO_CORRECT';

export interface CorporateActionDriftMessageInput {
  name: string;
  code: string;
  driftPctText: string;
  oldEntry: number;
  currentPrice: number;
  mode: CorporateActionDriftMode;
}

function formatKrw(value: number): string {
  return value.toLocaleString('ko-KR');
}

export function buildCorporateActionDriftMessage(input: CorporateActionDriftMessageInput): string {
  const header = input.mode === 'IMMUTABLE_REMOVE'
    ? '[Corporate Action Guard - universe excluded]'
    : '[Corporate Action Guard - entryPrice adjusted]';
  const entryLine = input.mode === 'IMMUTABLE_REMOVE'
    ? `entryPrice kept: <b>${formatKrw(input.oldEntry)}</b> (RAW immutable, ADR-0115)`
    : `entryPrice adjusted: <b>${formatKrw(input.oldEntry)} -> ${formatKrw(input.currentPrice)}</b>`;
  const actionLine = input.mode === 'IMMUTABLE_REMOVE'
    ? 'action: watchlist excluded; review DART disclosure before re-entry.'
    : 'action: auto-correction applied; review DART disclosure for split/merge/rights issue.';

  return [
    `<b>${header}</b> ${input.name} (${input.code})`,
    '--------------------',
    `drift: ${input.driftPctText}% (split/merge/rights issue suspected)`,
    entryLine,
    actionLine,
  ].join('\n');
}

export async function checkEntryPriceDrift(
  ctx: BuyListLoopContext,
  stock: WatchlistEntry,
  currentPrice: number,
  stageLog: Record<string, string>,
  pushTrace: () => void,
  fetchCandles: DailyCandleFetcher = defaultDailyCandleFetcher,
): Promise<'SKIP' | 'CONTINUE'> {
  const driftAction = applyEntryPriceDrift(stock, currentPrice);
  if (driftAction === 'DATA_HOLD') {
    const action = resolveDataHoldAction('BUY_CANDIDATE');
    const absDriftPct = Math.abs(((currentPrice - stock.entryPrice) / stock.entryPrice) * 100);
    const reason = `[watchlistManager.drift:${stock.code}] sanity violation absPct=${absDriftPct.toFixed(2)}% > 90% current=${currentPrice}, base=${stock.entryPrice}`;
    if (action.blockBuy) {
      stock.isDataQuarantined = true;
      stock.dataQuality = {
        status: 'STALE_BASE_OR_SPLIT_ADJUSTMENT',
        reason,
        current: currentPrice,
        base: stock.entryPrice,
        source: 'KIS_REALTIME',
        context: `watchlistManager.drift:${stock.code}`,
        updatedAt: new Date().toISOString(),
      };
    }
    ctx.mutables.watchlistMutated.value = true;
    console.warn(`[WatchlistManager] drift update skipped: ${reason}`);
    console.log(`[AutoTrade] ${stock.name}(${stock.code}) WAIT / DATA_HOLD / ${action.reason}`);
    stageLog.drift = 'DATA_HOLD';
    ctx.scanCounters.waitDataHold++;
    pushTrace();
    return 'SKIP';
  }

  if (driftAction === 'CORPORATE_ACTION') {
    const oldEntry = stock.entryPrice;
    const driftPctText = (((currentPrice - oldEntry) / oldEntry) * 100).toFixed(1);

    // ADR-0518 — magnitude-only(>80%) 의심을 RAW 일봉 연속성으로 재검증.
    // addedAt 이후 구간에 단일일 |close-to-close| 갭 > 임계(default 35%) 가 없으면
    // 정상 다일 랠리(GENUINE_RALLY) → corporate action 아님 → 조용히 universe drop.
    // 검증 비활성 ENV / 일봉 미가용(UNVERIFIABLE) / CONFIRMED 는 기존 보수적 동작 유지(무회귀).
    if (!isDailyBarVerificationDisabled()) {
      const scanWindow = resolveDailyBarScanWindow(stock.addedAt);
      // 일봉 조회 실패는 의도적 fallback — 빈 배열 → verifyDailyBarContinuity 가 UNVERIFIABLE
      // 로 보수 처리(provider 장애가 진짜 corp action 을 통과시키지 않도록). /* SDS-ignore: 보수적 fallback */
      const candles = await fetchCandles(stock.code, scanWindow).catch(() => [] as { date: string; close: number }[]);
      const verdict = verifyDailyBarContinuity(candles, { sinceDate: stock.addedAt });
      if (verdict.status === 'GENUINE_RALLY') {
        const threshold = activeCorporateActionGapThresholdPct();
        console.log(
          `[AutoTrade] ${stock.name}(${stock.code}) drift +${driftPctText}% verified ` +
          `GENUINE_RALLY (max single-day ${verdict.maxSingleDayMovePct?.toFixed(1)}% <= ${threshold}% ` +
          `over ${verdict.barsExamined} bars) — universe drop, no corporate action (ADR-0518).`,
        );
        const idx = ctx.watchlist.findIndex(w => w.code === stock.code);
        if (idx >= 0) {
          ctx.watchlist.splice(idx, 1);
          ctx.mutables.watchlistMutated.value = true;
        }
        stageLog.drift = 'GENUINE_RALLY_DROP';
        ctx.scanCounters.waitDriftRemove++;
        pushTrace();
        return 'SKIP';
      }
    }

    if (isEntryPriceAutoCorrectDisabled()) {
      console.warn(
        `[AutoTrade] ${stock.name}(${stock.code}) Corporate Action guard ` +
        `(drift ${driftPctText}%) entryPrice ${formatKrw(oldEntry)} kept ` +
        '(RAW immutable, ADR-0115); universe excluded and DART review requested.',
      );
      try {
        const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
        await sendTelegramAlert(
          buildCorporateActionDriftMessage({
            name: stock.name,
            code: stock.code,
            driftPctText,
            oldEntry,
            currentPrice,
            mode: 'IMMUTABLE_REMOVE',
          }),
          {
            priority: 'HIGH',
            dedupeKey: `corp_action_immutable:${stock.code}`,
            cooldownMs: 24 * 60 * 60 * 1000,
          },
        ).catch(() => undefined);
      } catch (e) {
        console.warn('[CorporateAction] telegram alert failed:', e instanceof Error ? e.message : e);
      }
      const idx = ctx.watchlist.findIndex(w => w.code === stock.code);
      if (idx >= 0) {
        ctx.watchlist.splice(idx, 1);
        ctx.mutables.watchlistMutated.value = true;
      }
      stageLog.drift = 'CORPORATE_ACTION_REMOVE';
    } else {
      stock.entryPrice = currentPrice;
      stock.corporateActionAdjusted = true;
      stock.corporateActionAdjustedAt = new Date().toISOString();
      ctx.mutables.watchlistMutated.value = true;
      console.warn(
        `[AutoTrade] ${stock.name}(${stock.code}) Corporate Action guard ` +
        `(drift ${driftPctText}%) entryPrice ${formatKrw(oldEntry)} -> ${formatKrw(currentPrice)} ` +
        'auto-corrected (ADR-0113 enabled by ENV).',
      );
      try {
        const { sendTelegramAlert } = await import('../../../../alerts/telegramClient.js');
        await sendTelegramAlert(
          buildCorporateActionDriftMessage({
            name: stock.name,
            code: stock.code,
            driftPctText,
            oldEntry,
            currentPrice,
            mode: 'AUTO_CORRECT',
          }),
          {
            priority: 'HIGH',
            dedupeKey: `corp_action:${stock.code}`,
            cooldownMs: 24 * 60 * 60 * 1000,
          },
        ).catch(() => undefined);
      } catch (e) {
        console.warn('[CorporateAction] telegram alert failed:', e instanceof Error ? e.message : e);
      }
      stageLog.drift = 'CORPORATE_ACTION';
    }
    ctx.scanCounters.waitDriftCorpAction++;
    pushTrace();
    return 'SKIP';
  }

  if (driftAction === 'REMOVE') {
    const driftPct = ((currentPrice - stock.entryPrice) / stock.entryPrice * 100).toFixed(1);
    console.log(
      `[AutoTrade] ${stock.name}(${stock.code}) entryPrice drift removal: ` +
      `current ${formatKrw(currentPrice)} vs entryPrice ${formatKrw(stock.entryPrice)} (+${driftPct}%)`,
    );
    const idx = ctx.watchlist.findIndex(w => w.code === stock.code);
    if (idx >= 0) {
      ctx.watchlist.splice(idx, 1);
      ctx.mutables.watchlistMutated.value = true;
    }
    stageLog.drift = 'REMOVE';
    ctx.scanCounters.waitDriftRemove++;
    pushTrace();
    return 'SKIP';
  }

  if (driftAction === 'UPDATE') {
    const oldEntry = stock.entryPrice;
    stock.entryPrice = currentPrice;
    ctx.mutables.watchlistMutated.value = true;
    console.log(
      `[AutoTrade] ${stock.name}(${stock.code}) entryPrice drift update: ` +
      `${formatKrw(oldEntry)} -> ${formatKrw(currentPrice)} (+10% tracking refresh)`,
    );
    stageLog.drift = 'UPDATE';
    pushTrace();
    return 'SKIP';
  }

  return 'CONTINUE';
}
