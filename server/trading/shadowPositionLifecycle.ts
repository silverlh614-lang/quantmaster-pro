/**
 * @responsibility Shadow 포지션 lifecycle 6-event SSOT — OPENED/MONITOR/SELL_SIGNAL/SELL_PAPER_FILLED/CLOSED + idempotency + 영속 audit trail
 *
 * Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 사용자 명시 framing (직접 인용):
 *   *"이번 패치로 SHADOW_PAPER_FILLED까지는 살아났다. 하지만 아직 완성된 매매
 *    루프는 아니다. 다음 패치는 Shadow 매수 이후 매도 관리 루프 연결이다."*
 *
 * 사용자 명시 6-state 시퀀스 (절대 변경 금지):
 *   SHADOW_PAPER_FILLED   ← Patch-001 (PR #934, executeShadowBuy) 이미 영속
 *   ↓
 *   SHADOW_POSITION_OPENED ← NEW (본 SSOT, executeShadowBuy 직후 emit)
 *   ↓
 *   SHADOW_POSITION_MONITOR ← NEW (exitEngine SHADOW 루프 진입부 emit, per-cycle)
 *   ↓
 *   SHADOW_SELL_SIGNAL ← NEW (reserveSell SHADOW_ONLY 분기 진입부 emit, per-rule)
 *   ↓
 *   SHADOW_SELL_PAPER_FILLED ← NEW (reserveSell SHADOW_ONLY 분기 fill 직후 emit)
 *   ↓
 *   SHADOW_POSITION_CLOSED ← NEW (remainingQty=0 도달 시 emit, 1회만)
 *
 * 사용자 명시 9 안전 invariants (사용자 §J 직접 인용 — 절대 변경 금지):
 *   1. Live 실주문, 실계좌 매수/매도 로직 변경 0줄
 *   2. Always-On Trading Kernel — Shadow 오류가 Live 매매엔진을 중단시키지 않음
 *      (모든 emit 함수 try/catch 격리)
 *   3. SHADOW_PAPER_FILLED 만 발생하고 OPEN 포지션 생성되지 않는 상태 금지
 *      (executeShadowBuy EXECUTED 직후 emitShadowPositionOpened 의무 wiring)
 *   4. 불일치 발생해도 Live 매매엔진은 멈추지 않음
 *      (verifyShadowPositionRegistryConsistency 는 진단만, return value 만 사용)
 *   5. Shadow 매도는 실제 주문 API 호출 0건 — paper sell fill 처리
 *      (reserveSell SHADOW_ONLY 분기 그대로, 본 SSOT 는 audit emit 만)
 *   6. Telegram 은 상태 변화 이벤트만 발송 — HOLD repeat 0
 *      (lifecycle SSOT 는 appendShadowLog 만, Telegram 은 channelShadowBuyFilled +
 *       channelSellSignal 기존 SSOT 위임)
 *   7. 동일 position_id + sell_reason 에 대해 SELL 중복 실행 차단
 *      (sell idempotency key `${trade_date}:SHADOW:SELL:${symbol}:${position_id}:${sell_reason}`
 *       — 사용자 명시 정확 포맷)
 *   8. CLOSED 포지션 재진입 차단 — 동일 position_id 한 번만 CLOSED emit
 *   9. KIS quota 0 침범 — 본 SSOT 외부 API 호출 0건 (영속 + 메모리 read-only)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 절대 불변식 (TypeScript literal type 컴파일 타임 강제):
 *   - `executionImpact: 'NONE'` literal
 *   - `liveOrderPlaced: false` literal
 *   - `mode: 'SHADOW'` literal (LIVE 호출 시 컴파일 에러)
 *
 * 잘못된 해결 방법 영구 차단:
 *   - LIVE path 에서 본 SSOT 호출 (mode!=SHADOW 시 emit silent skip)
 *   - 외부 KIS 호출 (영속 + read-only 만)
 *   - Telegram 중복 발송 (channelShadowBuyFilled / channelSellSignal 위임)
 *   - 영속 throw 시 매매 흐름 차단 (try/catch 격리 의무)
 *   - 멱등 가드 우회 (in-memory Set dedup)
 *   - ENV default ON (회귀 안전 default OFF)
 *
 * Patch type — ADR 발급 0건, sole CLAUDE.md row.
 */

import { appendShadowLog, type ServerShadowTrade, getRemainingQty } from '../persistence/shadowTradeRepo.js';
import { getOpenPositionByCode } from '../persistence/shadowPositionLedger.js';

// ─── Lifecycle event union ─────────────────────────────────────────────────────

/**
 * 사용자 명시 6-state 시퀀스 (절대 변경 금지). SHADOW_PAPER_FILLED 는
 * Patch-001 의 executeShadowBuy 가 이미 영속하므로 본 SSOT 의 emit 목록에는 포함되지
 * 않는다 (audit trail 통합을 위해 `recordPaperFilledFromExecutionPipeline` 헬퍼만
 * 노출 — 호출자 측 wiring 옵션).
 */
export type ShadowLifecycleEvent =
  | 'SHADOW_PAPER_FILLED'
  | 'SHADOW_POSITION_OPENED'
  | 'SHADOW_POSITION_MONITOR'
  | 'SHADOW_SELL_SIGNAL'
  | 'SHADOW_SELL_PAPER_FILLED'
  | 'SHADOW_POSITION_CLOSED';

/** emit 결과 outcome. */
export type ShadowLifecycleEmitOutcome =
  | 'EMITTED' // 정상 영속
  | 'DEDUPED' // 이미 emit 됨 (idempotency)
  | 'NOT_SHADOW' // trade.mode !== 'SHADOW'
  | 'ENV_DISABLED' // SHADOW_POSITION_LIFECYCLE_DISABLED=true
  | 'PERSIST_FAILED'; // appendShadowLog throw

/**
 * 영속 + 텔레메트리 — TypeScript literal type 컴파일 타임 강제.
 * 호출자 측 invariant 위반 (e.g., `liveOrderPlaced: true`) 즉시 에러.
 */
export interface ShadowLifecycleEmitResult {
  outcome: ShadowLifecycleEmitOutcome;
  event: ShadowLifecycleEvent;
  /** 멱등 키 (audit). OPENED 는 position_id 기반, SELL 은 sell_reason 포함 */
  idempotencyKey: string;
  /** trade.id */
  positionId: string;
  /** 영속 시각 ISO */
  emittedAtIso: string;
  /** 사유 텍스트 (진단) */
  reason?: string;
  /** invariant: 본 SSOT 는 실주문 호출 0건 */
  liveOrderPlaced: false;
  /** invariant: 본 SSOT 는 KIS quota 영향 0건 */
  executionImpact: 'NONE';
  /** invariant: SHADOW 모드만 — LIVE 호출 시 NOT_SHADOW outcome 으로 거부 */
  mode: 'SHADOW' | 'NOT_APPLICABLE';
}

// ─── ENV gate SSOT ─────────────────────────────────────────────────────────────

/**
 * ADR-0157 정확 비교 — `=== 'true'` 만 활성, `'1'`/`'TRUE'`/`'yes'`/빈값 모두 거부.
 *
 * default OFF — Shadow lifecycle SSOT 항상 활성. `true` 명시 시에만 비활성
 * (회귀 안전 fallback — Patch-001 직후 동작 100% 복원).
 */
export function isShadowPositionLifecycleDisabled(): boolean {
  return process.env.SHADOW_POSITION_LIFECYCLE_DISABLED === 'true';
}

// ─── Idempotency key SSOT ─────────────────────────────────────────────────────

/**
 * KST 기준 trade date (YYYY-MM-DD). UTC+9 명시 — `process.env.TZ` 무관.
 */
function deriveTradeDateKst(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 10);
}

/**
 * Position open idempotency key — `${trade_date}:SHADOW:OPEN:${symbol}:${position_id}`.
 *
 * trade.id 가 position_id 역할. 동일 trade 가 다음 cron 사이클에 다시 EXECUTED 되어도
 * dedup.
 */
export function buildOpenIdempotencyKey(
  tradeDate: string,
  symbol: string,
  positionId: string,
): string {
  return `${tradeDate}:SHADOW:OPEN:${symbol}:${positionId}`;
}

/**
 * Monitor cycle idempotency key — `${cycle_iso}:SHADOW:MONITOR:${symbol}:${position_id}`.
 *
 * cycle_iso 는 호출자가 결정 (보통 cron tick ISO). 같은 cycle 안 같은 종목 monitor 중복 방지.
 */
export function buildMonitorIdempotencyKey(
  cycleIso: string,
  symbol: string,
  positionId: string,
): string {
  return `${cycleIso}:SHADOW:MONITOR:${symbol}:${positionId}`;
}

/**
 * Sell signal/fill idempotency key (사용자 §J #7 정확 포맷):
 * `${trade_date}:SHADOW:SELL:${symbol}:${position_id}:${sell_reason}`.
 *
 * sell_reason 별 분리 — 동일 trade 의 HARD_STOP 과 TRAILING 은 별도 idempotency.
 * 동일 reason 의 중복 시도는 차단.
 */
export function buildSellIdempotencyKey(
  tradeDate: string,
  symbol: string,
  positionId: string,
  sellReason: string | undefined,
): string {
  return `${tradeDate}:SHADOW:SELL:${symbol}:${positionId}:${sellReason ?? 'UNKNOWN'}`;
}

/**
 * Position closed idempotency key — `${trade_date}:SHADOW:CLOSED:${symbol}:${position_id}`.
 *
 * 동일 position 의 CLOSED 는 한 번만 emit. trade_date 포함이지만 실제 영구 1회만.
 */
export function buildClosedIdempotencyKey(
  tradeDate: string,
  symbol: string,
  positionId: string,
): string {
  return `${tradeDate}:SHADOW:CLOSED:${symbol}:${positionId}`;
}

// ─── In-memory dedup store ─────────────────────────────────────────────────────

/**
 * 멱등 dedup — 프로세스 시작 후 emit 된 key 집합. process restart 시 휘발하지만
 * appendShadowLog 가 영속 audit trail 을 보장. 같은 cron 사이클 안 중복 방지가 주
 * 목적이라 in-memory 만으로 충분.
 *
 * monitor 키는 cycle_iso 가 매번 달라 누적 폭증하므로 별도 처리.
 */
const _emittedKeys = new Set<string>();
let _monitorCycleIso: string | null = null;
const _monitorKeysThisCycle = new Set<string>();

export function __resetShadowPositionLifecycleStoreForTests(): void {
  _emittedKeys.clear();
  _monitorCycleIso = null;
  _monitorKeysThisCycle.clear();
}

// ─── 공통 emit 헬퍼 ────────────────────────────────────────────────────────────

function envOrNotShadowResult(
  event: ShadowLifecycleEvent,
  trade: ServerShadowTrade,
  idempotencyKey: string,
  now: Date,
): ShadowLifecycleEmitResult | null {
  if (isShadowPositionLifecycleDisabled()) {
    return {
      outcome: 'ENV_DISABLED',
      event,
      idempotencyKey,
      positionId: trade.id,
      emittedAtIso: now.toISOString(),
      reason: 'SHADOW_POSITION_LIFECYCLE_DISABLED=true',
      liveOrderPlaced: false,
      executionImpact: 'NONE',
      mode: 'NOT_APPLICABLE',
    };
  }
  if (trade.mode !== 'SHADOW') {
    return {
      outcome: 'NOT_SHADOW',
      event,
      idempotencyKey,
      positionId: trade.id,
      emittedAtIso: now.toISOString(),
      reason: `trade.mode=${trade.mode ?? 'undefined'} (SHADOW only)`,
      liveOrderPlaced: false,
      executionImpact: 'NONE',
      mode: 'NOT_APPLICABLE',
    };
  }
  return null;
}

function persistEvent(
  event: ShadowLifecycleEvent,
  trade: ServerShadowTrade,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  now: Date,
): ShadowLifecycleEmitResult {
  const emittedAtIso = now.toISOString();
  try {
    appendShadowLog({
      event,
      idempotencyKey,
      positionId: trade.id,
      code: trade.stockCode,
      name: trade.stockName,
      emittedAtIso,
      patch: 'Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002',
      liveOrderPlaced: false,
      executionImpact: 'NONE',
      mode: 'SHADOW',
      ...payload,
    });
  } catch (err) {
    return {
      outcome: 'PERSIST_FAILED',
      event,
      idempotencyKey,
      positionId: trade.id,
      emittedAtIso,
      reason: `appendShadowLog throw — ${err instanceof Error ? err.message : String(err)}`,
      liveOrderPlaced: false,
      executionImpact: 'NONE',
      mode: 'SHADOW',
    };
  }
  return {
    outcome: 'EMITTED',
    event,
    idempotencyKey,
    positionId: trade.id,
    emittedAtIso,
    liveOrderPlaced: false,
    executionImpact: 'NONE',
    mode: 'SHADOW',
  };
}

// ─── SHADOW_POSITION_OPENED ────────────────────────────────────────────────────

/**
 * SHADOW_PAPER_FILLED 직후 호출 — position 이 ShadowPositionLedger 에 등록되었음을
 * 영속 audit + 멱등 가드. 사용자 §J #3 invariant — SHADOW_PAPER_FILLED 만 발생하고
 * OPEN 포지션 생성되지 않는 상태 영구 차단.
 */
export function emitShadowPositionOpened(
  trade: ServerShadowTrade,
  opts: { now?: Date } = {},
): ShadowLifecycleEmitResult {
  const now = opts.now ?? new Date();
  const tradeDate = deriveTradeDateKst(now);
  const idempotencyKey = buildOpenIdempotencyKey(tradeDate, trade.stockCode, trade.id);

  const guard = envOrNotShadowResult('SHADOW_POSITION_OPENED', trade, idempotencyKey, now);
  if (guard) return guard;

  if (_emittedKeys.has(idempotencyKey)) {
    return {
      outcome: 'DEDUPED',
      event: 'SHADOW_POSITION_OPENED',
      idempotencyKey,
      positionId: trade.id,
      emittedAtIso: now.toISOString(),
      reason: 'idempotency key already emitted in current process',
      liveOrderPlaced: false,
      executionImpact: 'NONE',
      mode: 'SHADOW',
    };
  }

  const result = persistEvent(
    'SHADOW_POSITION_OPENED',
    trade,
    idempotencyKey,
    {
      quantity: trade.quantity,
      entryPrice: trade.shadowEntryPrice,
      stopLoss: trade.stopLoss,
      targetPrice: trade.targetPrice,
      watchlistSource: trade.watchlistSource,
      profileType: trade.profileType,
    },
    now,
  );
  if (result.outcome === 'EMITTED') _emittedKeys.add(idempotencyKey);
  return result;
}

// ─── SHADOW_POSITION_MONITOR ───────────────────────────────────────────────────

/**
 * exitEngine 진입부 — SHADOW 포지션이 monitor cycle 에 편입됨을 영속 audit.
 * cycleIso 별로 dedup 누적 (cron tick 시작 시 reset 가능).
 *
 * 호출자: `exitEngine/index.ts` SHADOW 분기 루프 진입부 (per-trade, per-cycle).
 */
export function emitShadowPositionMonitor(
  trade: ServerShadowTrade,
  opts: { cycleIso?: string; now?: Date } = {},
): ShadowLifecycleEmitResult {
  const now = opts.now ?? new Date();
  const cycleIso = opts.cycleIso ?? now.toISOString();
  const idempotencyKey = buildMonitorIdempotencyKey(cycleIso, trade.stockCode, trade.id);

  const guard = envOrNotShadowResult('SHADOW_POSITION_MONITOR', trade, idempotencyKey, now);
  if (guard) return guard;

  // cycle 전환 시 monitor 키 reset (메모리 누적 폭증 차단)
  if (_monitorCycleIso !== cycleIso) {
    _monitorKeysThisCycle.clear();
    _monitorCycleIso = cycleIso;
  }

  if (_monitorKeysThisCycle.has(idempotencyKey)) {
    return {
      outcome: 'DEDUPED',
      event: 'SHADOW_POSITION_MONITOR',
      idempotencyKey,
      positionId: trade.id,
      emittedAtIso: now.toISOString(),
      reason: 'monitor cycle already recorded this position',
      liveOrderPlaced: false,
      executionImpact: 'NONE',
      mode: 'SHADOW',
    };
  }

  const result = persistEvent(
    'SHADOW_POSITION_MONITOR',
    trade,
    idempotencyKey,
    {
      cycleIso,
      remainingQty: getRemainingQty(trade),
      status: trade.status,
    },
    now,
  );
  if (result.outcome === 'EMITTED') _monitorKeysThisCycle.add(idempotencyKey);
  return result;
}

// ─── SHADOW_SELL_SIGNAL ────────────────────────────────────────────────────────

/**
 * exit 규칙이 매도 결정을 내린 직후 — reserveSell 진입부에서 emit.
 * sell_reason 별 분리 idempotency (HARD_STOP / TARGET_HIT / TRAILING / EUPHORIA / RRR_COLLAPSE
 * / DIVERGENCE / CASCADE / MANUAL / END_OF_DAY 등 모두 별도 key).
 */
export function emitShadowSellSignal(
  trade: ServerShadowTrade,
  sellReason: string | undefined,
  opts: { sellQty?: number; price?: number; now?: Date } = {},
): ShadowLifecycleEmitResult {
  const now = opts.now ?? new Date();
  const tradeDate = deriveTradeDateKst(now);
  const idempotencyKey = `${buildSellIdempotencyKey(tradeDate, trade.stockCode, trade.id, sellReason)}:SIGNAL`;

  const guard = envOrNotShadowResult('SHADOW_SELL_SIGNAL', trade, idempotencyKey, now);
  if (guard) return guard;

  if (_emittedKeys.has(idempotencyKey)) {
    return {
      outcome: 'DEDUPED',
      event: 'SHADOW_SELL_SIGNAL',
      idempotencyKey,
      positionId: trade.id,
      emittedAtIso: now.toISOString(),
      reason: `sell signal ${sellReason} already emitted in current process`,
      liveOrderPlaced: false,
      executionImpact: 'NONE',
      mode: 'SHADOW',
    };
  }

  const result = persistEvent(
    'SHADOW_SELL_SIGNAL',
    trade,
    idempotencyKey,
    {
      sellReason,
      sellQty: opts.sellQty ?? trade.quantity,
      price: opts.price ?? trade.shadowEntryPrice,
      remainingBeforeSell: getRemainingQty(trade),
    },
    now,
  );
  if (result.outcome === 'EMITTED') _emittedKeys.add(idempotencyKey);
  return result;
}

// ─── SHADOW_SELL_PAPER_FILLED ──────────────────────────────────────────────────

/**
 * SHADOW_ONLY paper sell fill 직후 — reserveSell 의 appendFill 완료 후 emit.
 * 사용자 §J #5 invariant — Shadow 매도는 실제 주문 API 호출 0건, paper sell fill 처리.
 *
 * sell_reason 별 분리 idempotency. 동일 reason 의 중복 paper-fill 시도 차단.
 */
export function emitShadowSellPaperFilled(
  trade: ServerShadowTrade,
  sellReason: string | undefined,
  opts: {
    fillId?: string;
    fillPrice: number;
    fillQty: number;
    remainingQtyAfter: number;
    pnlPct?: number;
    now?: Date;
  },
): ShadowLifecycleEmitResult {
  const now = opts.now ?? new Date();
  const tradeDate = deriveTradeDateKst(now);
  const idempotencyKey = `${buildSellIdempotencyKey(tradeDate, trade.stockCode, trade.id, sellReason)}:PAPER_FILLED`;

  const guard = envOrNotShadowResult('SHADOW_SELL_PAPER_FILLED', trade, idempotencyKey, now);
  if (guard) return guard;

  if (_emittedKeys.has(idempotencyKey)) {
    return {
      outcome: 'DEDUPED',
      event: 'SHADOW_SELL_PAPER_FILLED',
      idempotencyKey,
      positionId: trade.id,
      emittedAtIso: now.toISOString(),
      reason: `paper sell fill ${sellReason} already recorded in current process`,
      liveOrderPlaced: false,
      executionImpact: 'NONE',
      mode: 'SHADOW',
    };
  }

  const result = persistEvent(
    'SHADOW_SELL_PAPER_FILLED',
    trade,
    idempotencyKey,
    {
      sellReason,
      fillId: opts.fillId,
      fillPrice: opts.fillPrice,
      fillQty: opts.fillQty,
      remainingQtyAfter: opts.remainingQtyAfter,
      pnlPct: opts.pnlPct,
    },
    now,
  );
  if (result.outcome === 'EMITTED') _emittedKeys.add(idempotencyKey);
  return result;
}

// ─── SHADOW_POSITION_CLOSED ────────────────────────────────────────────────────

/**
 * 잔여 수량 0 도달 시 emit. 동일 position 의 CLOSED 는 영구 1회.
 *
 * 호출자: reserveSell SHADOW_ONLY 분기 직후 `remainingQty === 0` 일 때만,
 * 또는 exit 규칙이 status='HIT_STOP'/'HIT_TARGET' + quantity=0 설정 후.
 */
export function emitShadowPositionClosed(
  trade: ServerShadowTrade,
  opts: {
    closeReason: string | undefined;
    finalExitPrice?: number;
    weightedPnlPct?: number;
    realizedPnl?: number;
    now?: Date;
  },
): ShadowLifecycleEmitResult {
  const now = opts.now ?? new Date();
  const tradeDate = deriveTradeDateKst(now);
  const idempotencyKey = buildClosedIdempotencyKey(tradeDate, trade.stockCode, trade.id);

  const guard = envOrNotShadowResult('SHADOW_POSITION_CLOSED', trade, idempotencyKey, now);
  if (guard) return guard;

  if (_emittedKeys.has(idempotencyKey)) {
    return {
      outcome: 'DEDUPED',
      event: 'SHADOW_POSITION_CLOSED',
      idempotencyKey,
      positionId: trade.id,
      emittedAtIso: now.toISOString(),
      reason: 'position already closed in current process',
      liveOrderPlaced: false,
      executionImpact: 'NONE',
      mode: 'SHADOW',
    };
  }

  const result = persistEvent(
    'SHADOW_POSITION_CLOSED',
    trade,
    idempotencyKey,
    {
      closeReason: opts.closeReason,
      finalStatus: trade.status,
      finalExitPrice: opts.finalExitPrice ?? trade.exitPrice,
      weightedPnlPct: opts.weightedPnlPct,
      realizedPnl: opts.realizedPnl,
    },
    now,
  );
  if (result.outcome === 'EMITTED') _emittedKeys.add(idempotencyKey);
  return result;
}

// ─── Position Registry consistency verification ────────────────────────────────

export interface ShadowPositionRegistryConsistencyResult {
  /** 검증 대상 stockCode */
  stockCode: string;
  /** trade.id */
  positionId: string;
  /** trade 의 fills SSOT 기반 잔량 */
  expectedQty: number;
  /** shadowPositionLedger.getOpenPositionByCode 가 반환한 qty (null = 부재) */
  ledgerQty: number | null;
  /** ledger 에 entry 존재 여부 */
  ledgerHasEntry: boolean;
  /** trade 가 OPEN 상태여야 하는데 ledger 부재 OR qty mismatch 시 false */
  consistent: boolean;
  /** 불일치 사유 (consistent=false 일 때) */
  inconsistencyReason?: string;
  /** invariant: 검증은 read-only — 매매 흐름 차단 0 */
  executionImpact: 'NONE';
  /** invariant: KIS 주문 호출 0 */
  liveOrderPlaced: false;
}

/**
 * trade 의 expected 상태 (fills 기반 qty + open status) vs shadowPositionLedger 의
 * 실제 상태 비교. 사용자 §J #4 invariant — 불일치 발생해도 Live 매매엔진은 멈추지 않음.
 * 본 함수는 진단 결과만 반환, 호출자가 사용 결정.
 *
 * 호출자: 운영자 진단 명령 / /scan_blockers runtime 섹션 / 자가학습 audit.
 */
export function verifyShadowPositionRegistryConsistency(
  trade: ServerShadowTrade,
): ShadowPositionRegistryConsistencyResult {
  const baseInvariants = {
    executionImpact: 'NONE' as const,
    liveOrderPlaced: false as const,
  };
  const expectedQty = getRemainingQty(trade);
  let ledgerEntry: ReturnType<typeof getOpenPositionByCode> = null;
  try {
    ledgerEntry = getOpenPositionByCode(trade.stockCode);
  } catch (err) {
    return {
      stockCode: trade.stockCode,
      positionId: trade.id,
      expectedQty,
      ledgerQty: null,
      ledgerHasEntry: false,
      consistent: false,
      inconsistencyReason: `ledger throw — ${err instanceof Error ? err.message : String(err)}`,
      ...baseInvariants,
    };
  }
  const ledgerQty = ledgerEntry?.qty ?? null;
  const ledgerHasEntry = ledgerEntry !== null;

  // 동일 종목 + 동일 trade.id 매칭 보장 (다른 trade 가 같은 stockCode 로 ledger 에 있을 수 있음)
  const ledgerMatchesTrade = ledgerEntry !== null && ledgerEntry.trade.id === trade.id;

  // 진단 — expectedQty > 0 (open) 일 때만 ledger 일치 의무. expectedQty===0 (closed) 시
  // ledger 에 없어야 정합 (또는 다른 trade.id 의 entry 만 존재).
  if (expectedQty > 0) {
    if (!ledgerHasEntry) {
      return {
        stockCode: trade.stockCode,
        positionId: trade.id,
        expectedQty,
        ledgerQty,
        ledgerHasEntry: false,
        consistent: false,
        inconsistencyReason: `expected open position (qty=${expectedQty}) but ledger has no entry`,
        ...baseInvariants,
      };
    }
    if (!ledgerMatchesTrade) {
      return {
        stockCode: trade.stockCode,
        positionId: trade.id,
        expectedQty,
        ledgerQty,
        ledgerHasEntry: true,
        consistent: false,
        inconsistencyReason: `ledger entry trade.id mismatch (expected=${trade.id}, ledger=${ledgerEntry?.trade.id})`,
        ...baseInvariants,
      };
    }
    if (ledgerQty !== expectedQty) {
      return {
        stockCode: trade.stockCode,
        positionId: trade.id,
        expectedQty,
        ledgerQty,
        ledgerHasEntry: true,
        consistent: false,
        inconsistencyReason: `qty mismatch — expected=${expectedQty} ledger=${ledgerQty}`,
        ...baseInvariants,
      };
    }
    return {
      stockCode: trade.stockCode,
      positionId: trade.id,
      expectedQty,
      ledgerQty,
      ledgerHasEntry: true,
      consistent: true,
      ...baseInvariants,
    };
  }

  // expectedQty === 0 — closed 상태. ledger 에 동일 trade.id 가 없어야 정합.
  // 다른 trade.id 의 entry (재진입 후 별도 trade) 는 정합.
  if (ledgerMatchesTrade) {
    return {
      stockCode: trade.stockCode,
      positionId: trade.id,
      expectedQty,
      ledgerQty,
      ledgerHasEntry: true,
      consistent: false,
      inconsistencyReason: `expected closed (qty=0) but ledger still has matching trade.id`,
      ...baseInvariants,
    };
  }
  return {
    stockCode: trade.stockCode,
    positionId: trade.id,
    expectedQty,
    ledgerQty,
    ledgerHasEntry,
    consistent: true,
    ...baseInvariants,
  };
}

// ─── Summary counters + format ─────────────────────────────────────────────────

export interface ShadowLifecycleSummary {
  opened: number;
  monitor: number;
  sellSignal: number;
  sellPaperFilled: number;
  closed: number;
  deduped: number;
  envDisabled: number;
  notShadow: number;
  persistFailed: number;
  /** invariant: 본 SSOT 는 LIVE 영향 0 */
  executionImpact: 'NONE';
}

const _summary: ShadowLifecycleSummary = {
  opened: 0,
  monitor: 0,
  sellSignal: 0,
  sellPaperFilled: 0,
  closed: 0,
  deduped: 0,
  envDisabled: 0,
  notShadow: 0,
  persistFailed: 0,
  executionImpact: 'NONE',
};

export function recordShadowLifecycleOutcome(
  event: ShadowLifecycleEvent,
  outcome: ShadowLifecycleEmitOutcome,
): void {
  if (outcome === 'EMITTED') {
    switch (event) {
      case 'SHADOW_POSITION_OPENED':
        _summary.opened++;
        break;
      case 'SHADOW_POSITION_MONITOR':
        _summary.monitor++;
        break;
      case 'SHADOW_SELL_SIGNAL':
        _summary.sellSignal++;
        break;
      case 'SHADOW_SELL_PAPER_FILLED':
        _summary.sellPaperFilled++;
        break;
      case 'SHADOW_POSITION_CLOSED':
        _summary.closed++;
        break;
      case 'SHADOW_PAPER_FILLED':
        // executeShadowBuy 가 영속 — 본 SSOT 카운터 0
        break;
    }
  } else if (outcome === 'DEDUPED') {
    _summary.deduped++;
  } else if (outcome === 'ENV_DISABLED') {
    _summary.envDisabled++;
  } else if (outcome === 'NOT_SHADOW') {
    _summary.notShadow++;
  } else if (outcome === 'PERSIST_FAILED') {
    _summary.persistFailed++;
  }
}

export function getShadowLifecycleSummary(): ShadowLifecycleSummary {
  return { ..._summary };
}

export function __resetShadowLifecycleSummaryForTests(): void {
  _summary.opened = 0;
  _summary.monitor = 0;
  _summary.sellSignal = 0;
  _summary.sellPaperFilled = 0;
  _summary.closed = 0;
  _summary.deduped = 0;
  _summary.envDisabled = 0;
  _summary.notShadow = 0;
  _summary.persistFailed = 0;
}

/**
 * `/scan_blockers runtime` 출력용 compact section. `[PATCH-RUNTIME]` 태그로
 * ADR-0506 §sectionMatchesMode runtime mode 필터 자동 통과.
 */
export function formatShadowPositionLifecycleSection(): string | null {
  const s = getShadowLifecycleSummary();
  const total = s.opened + s.monitor + s.sellSignal + s.sellPaperFilled + s.closed;
  if (total === 0 && s.deduped === 0 && s.envDisabled === 0 && s.notShadow === 0 && s.persistFailed === 0) {
    return null;
  }
  const lines = [
    '🔁 Shadow Position Lifecycle [PATCH-RUNTIME] (Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002)',
    `• opened=${s.opened} monitor=${s.monitor} sellSignal=${s.sellSignal} sellPaperFilled=${s.sellPaperFilled} closed=${s.closed}`,
  ];
  const other: string[] = [];
  if (s.deduped > 0) other.push(`deduped=${s.deduped}`);
  if (s.envDisabled > 0) other.push(`envDisabled=${s.envDisabled}`);
  if (s.notShadow > 0) other.push(`notShadow=${s.notShadow}`);
  if (s.persistFailed > 0) other.push(`persistFailed=${s.persistFailed}`);
  if (other.length > 0) lines.push(`• ${other.join(' ')}`);
  lines.push(`• executionImpact=${s.executionImpact} liveOrderPlaced=false (audit-only)`);
  return lines.join('\n');
}
