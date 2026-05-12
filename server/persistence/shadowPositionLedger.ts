// @responsibility Shadow 보유 포지션 SSOT — 학습 entry 5중 가드 차단 (ADR-0504).
/**
 * shadowPositionLedger.ts — Shadow 보유 포지션 단일 진실 출처 (ADR-0504).
 *
 * 결함 진원지:
 *   - positionAggregator.aggregateAllPositions() 가 shadow-trades.json + shadow-log.json
 *     합집합 후 stage !== 'CLOSED' filter — 학습 entry / 실제 보유 entry 분리 0건.
 *   - ADR-0452 SHADOW_NEAR_BREAKOUT entry (`watchlistSource='SHADOW_NEAR_BREAKOUT'` +
 *     mode='SHADOW' + quantity=1) 가 공통 shadow-trades.json 에 영속 → realizedQty=0
 *     → stage='ENTRY' → Morning Card 가짜 보유 노출.
 *
 * 본 SSOT 의 5중 가드 (사용자 명시 7중 → 가드 4/5 deprecated 확정 — schema 부재):
 *   1. loadShadowTrades() 영속 read
 *   2. isOpenShadowStatus(s.status) — PENDING/ORDER_SUBMITTED/PARTIALLY_FILLED/ACTIVE/EUPHORIA_PARTIAL
 *   3. s.watchlistSource !== 'SHADOW_NEAR_BREAKOUT' — ADR-0452 학습 entry 차단
 *   6. getRemainingQty(s) > 0 — fills SSOT 잔량 (BUY-SELL)
 *   7. BUY fill ≥ 1 — orphan 차단 (fills 부재 entry 거부)
 *
 * 가드 4 (learningTag) / 5 (executionImpact) 는 ServerShadowTrade schema 에 영속
 * 필드 부재로 deprecated. ADR-0452 SHADOW_NEAR_BREAKOUT 식별은 watchlistSource
 * 단독으로 충분 (가드 3 가 흡수).
 *
 * ENV `SHADOW_POSITION_LEDGER_GUARDS_DISABLED=true` — default OFF (ADR-0157
 * 정확 비교). 활성 시 가드 3/7 skip → 가드 1/2/6 만 적용 (legacy 동작 부분 복원).
 */
import {
  loadShadowTrades,
  getRemainingQty,
  isActiveFill,
  type ServerShadowTrade,
} from './shadowTradeRepo.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';

export interface OpenPositionEntry {
  trade: ServerShadowTrade;
  source: 'SHADOW_POSITION_LEDGER';
  qty: number;
  hasBuyFill: boolean;
}

/**
 * 가드 비활성 ENV — default OFF. 활성 시 가드 3/7 skip (가드 1/2/6 만 적용 =
 * 학습 entry 가 카드에 노출될 위험, 운영자 명시적 우회 의도).
 */
export function isShadowPositionLedgerGuardsDisabled(): boolean {
  return process.env.SHADOW_POSITION_LEDGER_GUARDS_DISABLED === 'true';
}

/**
 * 보유 포지션 entries — 5중 가드 통과만 반환.
 *
 * 핵심: ADR-0452 SHADOW_NEAR_BREAKOUT 학습 entry 영구 차단. fills 부재 entry
 * (orphan) 도 거부 — BUY fill ≥ 1 의무.
 */
export function getOpenPositions(): OpenPositionEntry[] {
  const guardsDisabled = isShadowPositionLedgerGuardsDisabled();
  const trades = loadShadowTrades(); // 가드 1
  const result: OpenPositionEntry[] = [];

  for (const trade of trades) {
    // 가드 2: open status 만
    if (!isOpenShadowStatus(trade.status)) continue;

    // 가드 3: SHADOW_NEAR_BREAKOUT 학습 entry 차단 (ADR-0452)
    if (!guardsDisabled && trade.watchlistSource === 'SHADOW_NEAR_BREAKOUT') {
      continue;
    }

    // 가드 6: fills SSOT 잔량
    const qty = getRemainingQty(trade);
    if (qty <= 0) continue;

    // 가드 7: BUY fill ≥ 1 (orphan 차단)
    const hasBuyFill = (trade.fills ?? []).some(
      (f) => f.type === 'BUY' && isActiveFill(f),
    );
    if (!guardsDisabled && !hasBuyFill) continue;

    result.push({
      trade,
      source: 'SHADOW_POSITION_LEDGER',
      qty,
      hasBuyFill,
    });
  }

  return result;
}

/**
 * 단일 stockCode 매칭 — getOpenPositions().find(...) shortcut.
 */
export function getOpenPositionByCode(code: string): OpenPositionEntry | null {
  if (!code) return null;
  const positions = getOpenPositions();
  return positions.find((p) => p.trade.stockCode === code) ?? null;
}
