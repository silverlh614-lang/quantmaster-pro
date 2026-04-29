// @responsibility FOMC DAY 보유 포지션 강제 전량 청산 + 사전 경보 진입점 (ADR-0061)
/**
 * fomcDayLiquidation.ts — FOMC 발표 당일(KST) 평일 14:30~15:20 사이 활성
 * LIVE/SHADOW 보유 포지션을 시장가 전량 청산.
 *
 * 진입점:
 *   - liquidateAllForFomc(now?, opts?)        — orchestratorJobs 의 14:30 cron 이 호출
 *   - runFomcDayMorningAlert(now?)            — 09:00 사전 경보
 *   - runFomcDayPreLiquidationAlert(now?)     — 14:00 30분 전 경보
 *
 * KIS 호출은 reserveSell SSOT 만 경유 — kisClient.placeKisSellOrder 를 호출 후
 * 결과를 reserveSell 에 위임 (절대 규칙 #2/#4 — kisClient 단일 통로 / autoTradeEngine
 * 외 LIVE 실주문 금지). 청산 자체가 매매 본체이므로 본 모듈이 placeKisSellOrder 를
 * 직접 부르되, fill 회계는 reserveSell 의 PROVISIONAL/CONFIRMED/FAILED 분기를 그대로
 * 따른다 (exitEngine 의 r6EmergencyExit 패턴과 동일).
 */

import {
  loadShadowTrades,
  getRemainingQty,
  syncPositionCache,
  buildExitAttribution,
  appendShadowLog,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import { reserveSell } from './exitEngine/helpers/reserveSell.js';
import { placeKisSellOrder } from '../clients/kisClient.js';
import { addSellOrder } from './fillMonitor.js';
import { sendPrivateAlert } from '../alerts/telegramClient.js';
import { getEmergencyStop } from '../state.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from './regimeBridge.js';
import {
  shouldExecuteLiquidationAt,
  getDefaultFomcDayLiquidationConfig,
  getFomcProximity,
  type FomcDayLiquidationConfig,
  type LiquidationGuardReason,
} from './fomcCalendar.js';

export interface LiquidationItemResult {
  tradeId: string;
  stockCode: string;
  stockName: string;
  qty: number;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  reason?: string;
}

export interface FomcLiquidationResult {
  /** 가드 통과 후 실제 루프 진입 여부 — false 면 guardReason 으로 차단 사유. */
  executed: boolean;
  guardReason: LiquidationGuardReason;
  totalActive: number;
  results: LiquidationItemResult[];
  successCount: number;
  failedCount: number;
  dryRun: boolean;
}

/**
 * FOMC DAY 활성 포지션 전량 청산 진입점.
 * cron(orchestratorJobs:14:30 KST) 이 호출. 5중 가드 통과 시 reserveSell 루프 실행.
 */
export async function liquidateAllForFomc(
  now: Date = new Date(),
  opts?: { dryRunOverride?: boolean },
): Promise<FomcLiquidationResult> {
  const config: FomcDayLiquidationConfig = getDefaultFomcDayLiquidationConfig();
  if (opts?.dryRunOverride !== undefined) {
    config.dryRun = opts.dryRunOverride;
  }

  const guard = shouldExecuteLiquidationAt(now, { config, getEmergencyStop });
  if (!guard.execute) {
    return {
      executed: false,
      guardReason: guard.reason,
      totalActive: 0,
      results: [],
      successCount: 0,
      failedCount: 0,
      dryRun: config.dryRun,
    };
  }

  const trades = loadShadowTrades();
  const active = trades.filter(
    (t) => t.status === 'ACTIVE' || t.status === 'PARTIALLY_FILLED',
  );

  const dateKst = kstDate(now);

  if (active.length === 0) {
    await sendPrivateAlert(
      `🟢 [FOMC DAY 청산] 활성 포지션 0건 — 작업 없음.`,
      {
        priority: 'NORMAL',
        dedupeKey: `fomc_day_liq_result:${dateKst}`,
        cooldownMs: 20 * 3600_000,
      },
    ).catch((e) => {
      console.error('[fomcDayLiquidation] sendPrivateAlert(no-active) 실패:', e);
    });
    return {
      executed: true,
      guardReason: 'OK',
      totalActive: 0,
      results: [],
      successCount: 0,
      failedCount: 0,
      dryRun: config.dryRun,
    };
  }

  const regime = safeGetLiveRegime();
  const results: LiquidationItemResult[] = [];

  for (const trade of active) {
    const qty = getRemainingQty(trade);
    if (qty <= 0) {
      results.push({
        tradeId: trade.id,
        stockCode: trade.stockCode,
        stockName: trade.stockName,
        qty: 0,
        status: 'SKIPPED',
        reason: 'NO_REMAINING_QTY',
      });
      continue;
    }

    if (config.dryRun) {
      console.log(
        `[fomcDayLiquidation] dryRun ${trade.stockName}(${trade.stockCode}) — ${qty}주 (실주문 없음)`,
      );
      results.push({
        tradeId: trade.id,
        stockCode: trade.stockCode,
        stockName: trade.stockName,
        qty,
        status: 'SUCCESS',
        reason: 'DRY_RUN',
      });
      continue;
    }

    try {
      // exitEngine.r6EmergencyExit 와 동일 패턴: placeKisSellOrder → reserveSell.
      // SHADOW 모드는 placeKisSellOrder 가 outcome='SHADOW_ONLY' 반환 → reserveSell 이 가상 체결.
      // LIVE 실패는 outcome='LIVE_FAILED' 반환 → reserveSell 이 status='FAILED' 반환.
      trade.exitRuleTag = 'FOMC_DAY_LIQUIDATION';
      appendShadowLog({
        event: 'FOMC_DAY_LIQUIDATION',
        ...trade,
        soldQty: qty,
        regime,
      });

      // ADR-0104 — FOMC DAY 자동 청산은 'FOMC_DAY_LIQUIDATION' reason 으로 발송 →
      // 텔레그램 메시지가 "🔴 [SHADOW 손절]" 가 아닌 "📅 [SHADOW FOMC 자동청산]" 로 표기.
      // 사용자 보고 (4/29): "수익인 종목도 손실 표현됨" 의 오해 차단.
      const orderRes = await placeKisSellOrder(
        trade.stockCode,
        trade.stockName,
        qty,
        'FOMC_DAY_LIQUIDATION',
      );

      const ts = new Date().toISOString();
      const pnl = (0 - trade.shadowEntryPrice) * qty; // 시장가라 실제 체결가 모름 — placeholder
      const r = reserveSell(
        trade,
        orderRes,
        {
          type: 'SELL',
          subType: 'FULL_CLOSE',
          qty,
          price: 0, // 시장가 — pollSellFills 가 CCLD 후 실제 체결가로 보정
          pnl,
          pnlPct: 0,
          reason: 'FOMC DAY 자동 전량 청산',
          exitRuleTag: 'FOMC_DAY_LIQUIDATION',
          timestamp: ts,
          attribution: buildExitAttribution(
            'FOMC_DAY_LIQUIDATION',
            ['fomc_day_force_close'],
            regime,
          ),
        },
        'FOMC_DAY_LIQ',
      );

      if (r.kind === 'FAILED') {
        results.push({
          tradeId: trade.id,
          stockCode: trade.stockCode,
          stockName: trade.stockName,
          qty,
          status: 'FAILED',
          reason: r.reason,
        });
      } else {
        syncPositionCache(trade);
        if (r.kind === 'PENDING') {
          // LIVE 주문 접수 성공 → fillMonitor 폴링 등록 (ADR-0104 — originalReason 도 정합)
          addSellOrder({
            ordNo: r.ordNo,
            stockCode: trade.stockCode,
            stockName: trade.stockName,
            quantity: qty,
            originalReason: 'FOMC_DAY_LIQUIDATION',
            placedAt: ts,
            relatedTradeId: trade.id,
          });
        }
        results.push({
          tradeId: trade.id,
          stockCode: trade.stockCode,
          stockName: trade.stockName,
          qty,
          status: 'SUCCESS',
        });
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(
        `[fomcDayLiquidation] ${trade.stockName}(${trade.stockCode}) 청산 throw:`,
        e,
      );
      results.push({
        tradeId: trade.id,
        stockCode: trade.stockCode,
        stockName: trade.stockName,
        qty,
        status: 'FAILED',
        reason,
      });
    }
  }

  const successCount = results.filter((r) => r.status === 'SUCCESS').length;
  const failedCount = results.filter((r) => r.status === 'FAILED').length;

  await sendPrivateAlert(
    formatLiquidationResultMessage({
      totalActive: active.length,
      results,
      successCount,
      failedCount,
      dryRun: config.dryRun,
    }),
    {
      priority: failedCount > 0 ? 'CRITICAL' : 'HIGH',
      dedupeKey: `fomc_day_liq_result:${dateKst}`,
      cooldownMs: 20 * 3600_000,
    },
  ).catch((e) => {
    console.error('[fomcDayLiquidation] sendPrivateAlert(result) 실패:', e);
  });

  return {
    executed: true,
    guardReason: 'OK',
    totalActive: active.length,
    results,
    successCount,
    failedCount,
    dryRun: config.dryRun,
  };
}

export interface LiquidationResultMessageInput {
  totalActive: number;
  results: LiquidationItemResult[];
  successCount: number;
  failedCount: number;
  dryRun: boolean;
}

/** 청산 결과 텔레그램 메시지 빌더 (단위 테스트 가능). */
export function formatLiquidationResultMessage(input: LiquidationResultMessageInput): string {
  const header = input.dryRun
    ? '🟢 [FOMC DAY 청산 — dryRun]'
    : input.failedCount > 0
      ? '🔴 [FOMC DAY 청산 — 일부 실패]'
      : '🔴 [FOMC DAY 청산 완료]';

  const summary = input.dryRun
    ? `대상: ${input.totalActive}건 (실행 안 됨)`
    : `성공: ${input.successCount}건 / 실패: ${input.failedCount}건 (총 ${input.totalActive}건)`;

  const tail = !input.dryRun && input.failedCount > 0
    ? `\n⚠️ 실패 종목 수동 청산 필요`
    : '';

  return `${header}\n${summary}${tail}`;
}

/**
 * 09:00 KST 사전 경보 — DAY phase 일 때만 발송.
 * orchestratorJobs 가 평일 09:00 cron 으로 호출.
 */
export async function runFomcDayMorningAlert(now: Date = new Date()): Promise<void> {
  const proximity = getFomcProximity();
  if (proximity.phase !== 'DAY') return;
  const dateKst = kstDate(now);
  await sendPrivateAlert(
    `🟡 <b>[FOMC 발표 당일]</b>\n` +
    `오늘 14:30 KST 부터 보유 포지션 자동 전량 청산 예정.\n` +
    `수동 개입 가능 — 14:30 전까지 /sell 또는 KIS HTS 직접 청산.`,
    {
      priority: 'HIGH',
      dedupeKey: `fomc_day_morning:${dateKst}`,
      cooldownMs: 20 * 3600_000,
    },
  ).catch((e) => {
    console.error('[fomcDayLiquidation] morning alert 실패:', e);
  });
}

/**
 * 14:00 KST 30분 전 경보 — DAY phase 일 때만 발송.
 * 활성 포지션 카운트를 메시지에 포함.
 */
export async function runFomcDayPreLiquidationAlert(now: Date = new Date()): Promise<void> {
  const proximity = getFomcProximity();
  if (proximity.phase !== 'DAY') return;
  const trades = loadShadowTrades();
  const active = trades.filter(
    (t) => t.status === 'ACTIVE' || t.status === 'PARTIALLY_FILLED',
  );
  const dateKst = kstDate(now);
  await sendPrivateAlert(
    `⚠️ <b>[FOMC DAY — 30분 후 자동 청산]</b>\n` +
    `14:30 KST 부터 보유 포지션 ${active.length}건 자동 전량 청산.\n` +
    `수동 청산 원할 시 지금.`,
    {
      priority: 'HIGH',
      dedupeKey: `fomc_day_pre_liq:${dateKst}`,
      cooldownMs: 20 * 3600_000,
    },
  ).catch((e) => {
    console.error('[fomcDayLiquidation] pre-liquidation alert 실패:', e);
  });
}

/** KST 일자 (YYYY-MM-DD) — dedupeKey 용. */
function kstDate(now: Date): string {
  const kstMs = now.getTime() + 9 * 3600_000;
  return new Date(kstMs).toISOString().slice(0, 10);
}

/** macroState 로드 + getLiveRegime 안전 호출. 실패 시 'UNKNOWN' fallback. */
function safeGetLiveRegime(): string {
  try {
    const macro = loadMacroState();
    return getLiveRegime(macro);
  } catch (e) {
    console.warn('[fomcDayLiquidation] getLiveRegime 실패 — UNKNOWN fallback:', e);
    return 'UNKNOWN';
  }
}
