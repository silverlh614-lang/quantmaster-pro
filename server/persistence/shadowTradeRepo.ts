import fs from 'fs';
import { SHADOW_FILE, SHADOW_LOG_FILE, ensureDataDir } from './paths.js';

// ─── Fill(체결 이벤트) 모델 ────────────────────────────────────────────────────

/**
 * 포지션에 귀속되는 단일 체결 이벤트.
 * 매수(BUY) + 매도(SELL) 모두 기록하여 포지션의 전체 생애를 추적한다.
 */
export interface PositionFill {
  id: string;
  type: 'BUY' | 'SELL';
  subType?:
    | 'INITIAL_BUY'    // 최초 진입 체결
    | 'TRANCHE_BUY'    // 분할 매수 체결
    | 'PARTIAL_TP'     // 부분 익절 (RRR 붕괴, 다이버전스, EUPHORIA, TRANCHE)
    | 'TRAILING_TP'    // 트레일링 스톱 수익 청산
    | 'FULL_CLOSE'     // 목표가 전량 청산
    | 'STOP_LOSS'      // 손절 청산 (HARD_STOP, CASCADE)
    | 'EMERGENCY';     // 긴급 청산 (R6, MA60)
  qty: number;
  price: number;
  /** 매도 시 원화 실현 손익 */
  pnl?: number;
  /** 매도 시 수익률 % (진입가 기준) */
  pnlPct?: number;
  /** 사람이 읽을 수 있는 청산 이유 */
  reason: string;
  exitRuleTag?: string;
  timestamp: string;   // ISO
  /**
   * LIVE 모드 매도 시 KIS 주문번호 (ODNO).
   * 값이 있으면 아직 CCLD 확인 대기 상태 — pollSellFills가 실체결량(qty/
   * price/pnl)으로 Fill을 덮어쓰고 덮어쓴 뒤 ordNo를 undefined로 삭제한다.
   * SHADOW 모드 또는 KIS 주문 실패/미송신 시 처음부터 undefined.
   */
  ordNo?: string;
  /**
   * Fill 상태 — 주문 접수 직후 "선반영"된 Fill 과 실체결 확인된 Fill 을 구분한다.
   *
   * - `PROVISIONAL` : LIVE 주문 접수만 성공, CCLD 미확인. pollSellFills 가 체결을
   *                   확인하면 CONFIRMED 로 전환, 체결 실패/만료 시 REVERTED 로 전환.
   * - `CONFIRMED`   : 체결 확인 완료(또는 SHADOW 모드의 가상 체결). 회계·집계 대상.
   * - `REVERTED`    : 주문 실패/만료로 되돌려진 fill. 잔량·손익 집계에서 제외된다.
   *
   * 값이 없는 레거시 fill 은 CONFIRMED 로 간주한다 (하위 호환).
   */
  status?: 'PROVISIONAL' | 'CONFIRMED' | 'REVERTED';
  /** PROVISIONAL → CONFIRMED 전환 시각 (CCLD 확인 또는 SHADOW 즉시 확정) */
  confirmedAt?: string;
  /** PROVISIONAL → REVERTED 전환 시각 */
  revertedAt?: string;
  /** 되돌림 사유 — Telegram 디버깅·사후 추적용 */
  revertReason?: string;
  /**
   * 이 fill 이 REVERTED 로 전환될 때 함께 초기화해야 할 "중복 방지 플래그" 이름.
   * exitEngine 의 DIVERGENCE/RRR/EUPHORIA/CASCADE 같은 1회성 청산 경로는 중복 실행
   * 방지용 boolean 플래그를 사용하므로, 주문 실패 시 플래그도 함께 되돌려야 다음
   * 기회에 재시도가 가능하다. pollSellFills 에서 revertProvisionalFill() 호출 시
   * 참조된다.
   */
  flagToClearOnRevert?:
    | 'divergencePartialSold'
    | 'rrrCollapsePartialSold'
    | 'r6EmergencySold';
}

/** REVERTED 가 아닌 "살아 있는" fill 만 true. 레거시(status 미정) 는 CONFIRMED 간주. */
export function isActiveFill(fill: PositionFill): boolean {
  return fill.status !== 'REVERTED';
}

// ─── Fill 헬퍼 함수 ────────────────────────────────────────────────────────────

let _fillSeq = 0;
function newFillId(): string {
  return `f${Date.now()}-${(++_fillSeq).toString(36)}`;
}

/**
 * 포지션에 Fill을 추가한다.
 * saveShadowTrades() 전에 호출해야 영속화된다.
 */
export function appendFill(
  trade: ServerShadowTrade,
  fill: Omit<PositionFill, 'id'>,
): void {
  if (!trade.fills) trade.fills = [];
  trade.fills.push({ ...fill, id: newFillId() });
}

// ─── PR-7 #13: SHADOW BUY fill 백필 ───────────────────────────────────────────
//
// 배경: 기존 buyPipeline SHADOW 경로는 appendShadowLog 만 호출하고 BUY fill 을
// `fills[]` 에 추가하지 않았다. 그 결과 getRemainingQty / syncPositionCache /
// computeShadowAccount 가 전부 `trade.quantity` 캐시 fallback 으로 떨어졌고,
// SHADOW SELL 후에도 캐시가 갱신되지 않아 잔량이 원본 값으로 고정되던 고질
// 버그의 근본 원인.
//
// 이 함수는 **멱등**이며 두 지점에서 호출한다:
//  1) 서버 부팅 시 1회 — 레거시 레코드 전체 마이그레이션
//  2) exitEngine updateShadowResults 시작부 — 새 trade 도 커버
//
// 조건: mode=SHADOW && BUY fill 없음 && (originalQuantity>0 or quantity>0).
// 이미 BUY fill 이 존재하면 건너뛴다.
//
// @returns backfill 된 trade 수 (0 이면 할 일 없음)
export function backfillShadowBuyFills(trades: ServerShadowTrade[]): number {
  let count = 0;
  for (const t of trades) {
    if (t.mode !== 'SHADOW') continue;
    // REJECTED 는 체결 자체가 없었던 상태 — 백필 금지.
    if (t.status === 'REJECTED') continue;
    const fills = t.fills ?? [];
    if (fills.some(f => f.type === 'BUY')) continue; // 이미 있음
    const buyQty = t.originalQuantity && t.originalQuantity > 0 ? t.originalQuantity : t.quantity;
    if (!buyQty || buyQty <= 0) continue;
    const buyPrice = t.shadowEntryPrice ?? t.signalPrice;
    if (!buyPrice || buyPrice <= 0) continue;

    appendFill(t, {
      type:        'BUY',
      subType:     'INITIAL_BUY',
      qty:         buyQty,
      price:       buyPrice,
      reason:      'SHADOW 가상 진입 (backfill)',
      timestamp:   t.signalTime,
      status:      'CONFIRMED',
      confirmedAt: t.signalTime,
    });
    // originalQuantity 가 비어있던 레거시는 이 시점에 안정화.
    if (!t.originalQuantity || t.originalQuantity <= 0) {
      t.originalQuantity = buyQty;
    }
    count++;
  }
  return count;
}

/**
 * 포지션의 총 실현 원화 손익 (모든 SELL Fill의 pnl 합산).
 * REVERTED fill 은 주문 실패로 되돌려진 것이므로 집계에서 제외한다.
 */
export function getTotalRealizedPnl(trade: ServerShadowTrade): number {
  return (trade.fills ?? [])
    .filter(f => f.type === 'SELL' && f.pnl !== undefined && isActiveFill(f))
    .reduce((sum, f) => sum + (f.pnl ?? 0), 0);
}

/**
 * 포지션의 수량 가중 평균 수익률 %.
 * fills가 없으면 레거시 returnPct로 폴백한다.
 * REVERTED fill 은 집계 대상에서 제외.
 */
export function getWeightedPnlPct(trade: ServerShadowTrade): number {
  const sells = (trade.fills ?? []).filter(f => f.type === 'SELL' && f.pnlPct !== undefined && isActiveFill(f));
  if (sells.length === 0) return trade.returnPct ?? 0;
  const totalQty = sells.reduce((s, f) => s + f.qty, 0);
  if (totalQty === 0) return 0;
  return sells.reduce((s, f) => s + (f.pnlPct ?? 0) * f.qty, 0) / totalQty;
}

/**
 * fills 배열을 단일 진실 원천으로 삼아 계산한 현재 보유 수량.
 * BUY fill이 하나라도 있으면 Σ(BUY.qty) - Σ(SELL.qty), 없으면 레거시 trade.quantity.
 *
 * 이 함수는 `trade.quantity` 캐시를 **신뢰하지 않고** 매번 fills에서 파생한다.
 * 청산 판정·UI 집계·회계 로직은 이 함수를 써야 캐시 불일치에 영향받지 않는다.
 *
 * 중요: PROVISIONAL SELL fill 도 차감에 반영 (보수적 기준). 이는 주문 접수 직후
 * 같은 수량이 다음 루프에서 다시 매도 대상으로 선택되는 "이중 매도" 를 방지하기
 * 위한 것이다. PROVISIONAL 이 CCLD 미확인으로 REVERTED 되면 그 즉시 remaining 이
 * 회복된다. REVERTED fill 만 집계에서 제외된다.
 */
export function getRemainingQty(trade: ServerShadowTrade): number {
  const fills = (trade.fills ?? []).filter(isActiveFill);
  const buyQty  = fills.filter(f => f.type === 'BUY').reduce((s, f) => s + f.qty, 0);
  const sellQty = fills.filter(f => f.type === 'SELL').reduce((s, f) => s + f.qty, 0);
  if (buyQty > 0) return Math.max(0, buyQty - sellQty);
  return trade.quantity ?? 0;
}

/**
 * Fill 합산을 단일 진실 원천으로 삼아 포지션의 캐시 필드
 * (`quantity`, `originalQuantity`)를 동기화한다. **멱등**이며, fills가 없는
 * 레거시 거래는 건드리지 않는다.
 *
 * 주의: `status` 전환(HIT_TARGET/HIT_STOP 등)은 호출측 책임이다. 이 함수는
 * 파생 수량 캐시만 갱신한다. 상태 자동 닫힘까지 포함한 전체 교정은
 * `reconcileShadowQuantities()`를 사용하라.
 *
 * @returns 캐시 필드가 실제로 바뀌었는지 여부
 */
export function syncPositionCache(trade: ServerShadowTrade): boolean {
  const fills = (trade.fills ?? []).filter(isActiveFill);
  const buyQty = fills.filter(f => f.type === 'BUY').reduce((s, f) => s + f.qty, 0);
  if (buyQty === 0) return false; // 레거시 — 건드리지 않음

  const sellQty = fills.filter(f => f.type === 'SELL').reduce((s, f) => s + f.qty, 0);
  const remaining = Math.max(0, buyQty - sellQty);

  let changed = false;
  if (trade.quantity !== remaining) {
    trade.quantity = remaining;
    changed = true;
  }
  if (!trade.originalQuantity || trade.originalQuantity < buyQty) {
    trade.originalQuantity = buyQty;
    changed = true;
  }
  return changed;
}

/**
 * 주문 접수 시 선반영된 PROVISIONAL fill 을 되돌린다.
 * pollSellFills 가 CCLD 미확인 + 시장가 재발행 실패(status=FAILED) 경로에서 호출.
 *
 * - 대상 fill 을 `status='REVERTED'` 로 마킹 (레코드 자체는 유지 — 감사 추적용)
 * - `flagToClearOnRevert` 가 있으면 대응 flag (e.g. `divergencePartialSold`)를
 *   `false` 로 복구하여 다음 기회에 동일 규칙이 재실행될 수 있게 한다.
 * - `quantity` 캐시를 fills SSOT 기준으로 재동기화.
 *
 * @returns 되돌린 fill 이 있었으면 true
 */
export function revertProvisionalFill(
  trade: ServerShadowTrade,
  ordNo: string,
  reason: string,
): boolean {
  const fill = (trade.fills ?? []).find(
    f => f.ordNo === ordNo && f.status === 'PROVISIONAL' && f.type === 'SELL',
  );
  if (!fill) return false;

  fill.status = 'REVERTED';
  fill.revertedAt = new Date().toISOString();
  fill.revertReason = reason;

  // 중복 방지 플래그 복구 — 다음 기회에 동일 규칙이 다시 평가될 수 있도록.
  const flagKey = fill.flagToClearOnRevert;
  if (flagKey) {
    (trade as unknown as Record<string, unknown>)[flagKey] = false;
  }

  // REVERTED 를 반영한 잔량으로 캐시 재동기화.
  syncPositionCache(trade);
  return true;
}

// ─── Invariant 보호 래퍼 ──────────────────────────────────────────────────────

/**
 * Object.assign(shadow, patch) 의 안전한 대체재.
 *
 * 불변 규칙:
 *  1. `returnPct` — fills에서 파생 가능하므로 저장 금지. 패치에 포함되면 자동 제거.
 *  2. `originalQuantity` — 진입 시 한 번만 결정. 이미 양수이면 변경 차단.
 */
export function updateShadow(
  shadow: ServerShadowTrade,
  patch: Partial<ServerShadowTrade>,
): void {
  const safe = { ...patch } as any;

  // 규칙 1: returnPct 제거 — getWeightedPnlPct(fills) 에서 항상 파생 가능
  if ('returnPct' in safe) {
    delete safe.returnPct;
  }

  // 규칙 2: originalQuantity 불변 — 이미 양수로 확정된 경우 덮어쓰기 차단
  if ('originalQuantity' in safe && shadow.originalQuantity && shadow.originalQuantity > 0) {
    console.error(
      `[INVARIANT] ${shadow.id ?? shadow.stockCode} originalQuantity(${shadow.originalQuantity}) ` +
      `변경 시도(→${safe.originalQuantity}) 차단`,
    );
    delete safe.originalQuantity;
  }

  Object.assign(shadow, safe);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * 청산/감축 규칙 태그 (EXIT_RULE_PRIORITY_TABLE 규칙명과 1:1 대응).
 * exitRuleTag 필드에 사용되며, EXIT_RULE_PRIORITY_TABLE 우선순위 순서로 평가된다.
 * 새 규칙 추가 시 이 타입과 EXIT_RULE_PRIORITY_TABLE을 함께 갱신해야 한다.
 */
export type ExitRuleTag =
  | 'R6_EMERGENCY_EXIT'          // priority 1
  | 'HARD_STOP'                  // priority 2
  | 'MA60_DEATH_FORCE_EXIT'      // priority 3 — 60일선 역배열 5영업일 유예 만료 → 강제 청산
  | 'CASCADE_FINAL'              // priority 4
  | 'LIMIT_TRANCHE_TAKE_PROFIT'  // priority 5
  | 'TRAILING_PROTECTIVE_STOP'   // priority 6
  | 'TARGET_EXIT'                // priority 7
  | 'CASCADE_HALF_SELL'          // priority 8
  | 'CASCADE_WARN_BLOCK'         // priority 9
  | 'RRR_COLLAPSE_PARTIAL'       // priority 10
  | 'DIVERGENCE_PARTIAL'         // priority 11
  | 'MA60_DEATH_WATCH'           // priority 12 — 60일선 역배열 최초 감지: 유예 스케줄만 설정
  | 'STOP_APPROACH_ALERT'        // priority 13
  | 'EUPHORIA_PARTIAL'           // priority 14
  | 'MANUAL_EXIT';               // priority 99 — "규칙 외" 수동 청산 (Telegram /sell, UI 수동 매도)
                                 //               자동 평가 루프에서 절대 선택되지 않으며, 오직 외부 주입 전용.

/**
 * 진입 시점 Kelly 사이징 스냅샷 (Idea 1).
 *
 * buildBuyTrade() 가 ServerShadowTrade 를 생성하는 순간의 Kelly 의사결정 컨텍스트를
 * 하나의 구조체로 동결한다. 이후 포지션이 "왜 이 크기로 들어갔는가" 를 단일 지렛점으로
 * 재구성할 수 있게 하며, /kelly 텔레그램 헬스 카드·포지션 감쇠 추적·사후 복기에서 공통 참조한다.
 *
 * 레거시 포지션(필드 누락) 은 undefined 로 폴백되며 호출부는 `?.` 로 안전 접근한다.
 */
export interface EntryKellySnapshot {
  /** 사이징 티어 — CONVICTION(×1.0) / STANDARD(×0.6) / PROBING(×0.25). */
  tier: 'CONVICTION' | 'STANDARD' | 'PROBING';
  /** 신호 등급 — Fractional Kelly 캡이 결정되는 키. */
  signalGrade: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'PROBING';
  /**
   * 진입 순간에 누적된 "캡 적용 전" Kelly 비율 =
   *   computeRawPositionPct(gate) × kellyMultiplier(레짐·VIX·FOMC·IPS·예외·계좌)
   *   × mtasMult × sectionFactor × tierDecision.kellyFactor
   * applyFractionalKelly() 로 자르기 직전 값.
   */
  rawKellyMultiplier: number;
  /** applyFractionalKelly() 로 캡 적용된 실제 진입 Kelly 배율. */
  effectiveKelly: number;
  /** 이 grade 에 적용된 Fractional Kelly 캡 (진단·헬스 카드용). */
  fractionalCap: number;
  /** 진입 순간 IPS 변곡 점수 (0~100). */
  ipsAtEntry: number;
  /** 진입 순간 매크로 레짐 (예: 'R2_BULL'). */
  regimeAtEntry: string;
  /** 진입 순간 계좌 누적 R 합 (%). accountRiskBudget.openRiskPct 스냅샷. */
  accountRiskBudgetPctAtEntry: number;
  /** RRR/Gate/MTAS 종합 신뢰도 보정자 (0~1.2). */
  confidenceModifier: number;
  /** 스냅샷 동결 시각 (ISO). */
  snapshotAt: string;
}

export interface ServerShadowTrade {
  id: string;
  stockCode: string;
  stockName: string;
  signalTime: string;
  signalPrice: number;
  shadowEntryPrice: number;
  quantity: number;
  stopLoss: number;
  /**
   * stopLoss 분해 기록:
   * - initialStopLoss: 진입 구조 훼손 기준의 고정 손절
   * - regimeStopLoss: 시장 레짐 악화 기준의 레짐 손절
   * - hardStopLoss: 실제 강제 청산 기준 (= 두 값 중 더 높은 가격, 즉 더 촘촘한 손절)
   */
  initialStopLoss?: number;
  regimeStopLoss?: number;
  hardStopLoss?: number;
  stopLossExitType?: 'INITIAL' | 'REGIME' | 'INITIAL_AND_REGIME' | 'PROFIT_PROTECTION';
  exitRuleTag?: ExitRuleTag;
  targetPrice: number;
  /** 거래 모드: 'LIVE' = 실주문, 'SHADOW' = 가상 추적 */
  mode?: 'LIVE' | 'SHADOW';
  status: 'PENDING' | 'ORDER_SUBMITTED' | 'PARTIALLY_FILLED' | 'ACTIVE' | 'REJECTED' | 'HIT_TARGET' | 'HIT_STOP' | 'EUPHORIA_PARTIAL';
  exitPrice?: number;
  exitTime?: string;
  returnPct?: number;
  price7dAgo?: number;       // 과열 탐지 신호 3용 (7일 전 가격)
  originalQuantity?: number; // 최초 진입 수량 — EUPHORIA 부분 매도 후 실보유 추적용
  cascadeStep?: 0 | 1 | 2;  // 0=없음, 1=-7% 경고, 2=-15% 반매도
  addBuyBlocked?: boolean;   // -7% 이후 추가 매수 차단 플래그
  halfSoldAt?: string;       // -15% 반매도 시각 (ISO)
  stopApproachAlerted?: boolean; // 손절가 5% 이내 접근 경고 발송 여부 (레거시 — stopApproachStage로 대체)
  /** 손절 접근 3단계 경보 단계: 0=없음, 1=접근(-5%), 2=임박(-3%), 3=집행임박(-1%) */
  stopApproachStage?: 0 | 1 | 2 | 3;
  // ─── 레짐 연결 필드 (regimeBridge 연결 후 신규 거래부터 기록) ──────────────
  entryRegime?: string;          // 진입 시점 RegimeLevel (예: 'R2_BULL')
  profileType?: 'A' | 'B' | 'C' | 'D'; // 종목 프로파일 (A=대형주도 B=중형성장 C=소형모멘텀 D=촉매)
  profitTranches?: { price: number; ratio: number; taken: boolean }[]; // L3 분할 익절 타겟
  trailingHighWaterMark?: number; // 트레일링 스톱 고점 기준
  trailPct?: number;              // 트레일링 스톱 낙폭 비율 (예: 0.10 = 10%)
  trailingEnabled?: boolean;      // 전체 LIMIT 트랜치 완료 후 트레일링 활성화
  r6EmergencySold?: boolean;      // R6_DEFENSE 30% 긴급 청산 완료 여부 (중복 방지)
  rrrCollapsePartialSold?: boolean; // RRR 붕괴 50% 익절 완료 여부 (중복 방지)
  /** 하락 다이버전스 부분 익절 완료 여부 (중복 방지) */
  divergencePartialSold?: boolean;
  /**
   * MA60 역배열("60일선 죽음") 최초 감지 ISO 타임스탬프.
   * 설정되면 ma60ForceExitDate까지 유예되며, 유예 만료 시 강제 청산된다.
   */
  ma60DeathDetectedAt?: string;
  /** MA60 역배열 유예 만료일(YYYY-MM-DD). 이 날짜 이후 currentPrice가 여전히 역배열이면 강제 청산. */
  ma60ForceExitDate?: string;
  /** MA60_DEATH_FORCE_EXIT가 이미 실행되었는지 여부 (중복 청산 방지) */
  ma60DeathForced?: boolean;
  /** 워치리스트 출처 — Pre-Market(기본), Intraday(장중 발굴), Pre-Breakout(돌파 전 선취매) */
  watchlistSource?: 'PRE_MARKET' | 'INTRADAY' | 'PRE_BREAKOUT' | 'PRE_BREAKOUT_FOLLOWTHROUGH';
  /** 진입 시점 14일 ATR — ATR 기반 동적 손절 계산에 사용 */
  entryATR14?: number;
  /** ATR 기반 동적 손절가 — evaluateDynamicStop()으로 계산된 초기 동적 손절 */
  dynamicStopPrice?: number;
  /**
   * 매수 직전 Gemini가 생성한 "실패 시나리오" Pre-Mortem 체크리스트.
   * 이 거래가 -10% 손실로 끝난다면 가장 가능성 높은 원인 3가지를 1줄씩 기록한다.
   * 진입 승인 메시지에 함께 표시되며, 사후 복기(postmortem)의 비교 기준이 된다.
   */
  preMortem?: string;
  /**
   * Phase 3-⑫: 구조화된 Pre-Mortem (자유 문자열 대비 기계 매칭 가능).
   * 모든 매수 승인 시 필수 기록. exitEngine 이 종결 시점에 어떤 invalidation
   * 이 트리거되었는지 매칭하여 exitInvalidationMatch 필드에 기록한다.
   */
  preMortemStructured?: {
    /** "왜 지금 매수하는가" — 진입 근거의 단일 핵심 명제 */
    primaryThesis: string;
    /** 어떤 구체 조건이 깨지면 thesis 가 무효화되는가 (기계 매칭 가능한 촉발 조건 목록) */
    invalidationConditions: Array<{
      id: string;                // 'MA60_BREAK' | 'VOLUME_DROP' | 'SECTOR_RS_DOWN' ...
      description: string;       // 사람이 읽을 수 있는 설명
      watch: Record<string, number | string>; // 측정 임계값 (예: { ma60: 68000 })
    }>;
    /** 손절 발동 구조 — 가격·레짐·ATR 기준의 구체 트리거 */
    stopLossTrigger: {
      hardStop: number;
      regime: string;
      rationale: string;         // 이 stop 이 왜 이 가격에 설정됐는지
    };
    /** 목표 달성 시나리오 — 목표가 + 예상 소요 기간 + 분할 익절 구조 */
    targetScenario: {
      targetPrice: number;
      expectedDays: number;
      rrr: number;
      profitTrancheCount: number;
    };
  };
  /**
   * Phase 3-⑫: exitEngine 이 종결 시 preMortemStructured.invalidationConditions
   * 중 어느 id 가 트리거되었는지 기록. 동일 id 가 전역 3회 이상 손절로 이어지면
   * FailurePatternDB 로 자동 승급된다.
   */
  exitInvalidationMatch?: {
    id: string;
    matchedAt: string;
    observedValue?: number | string;
  };
  /**
   * 포지션에 귀속된 모든 체결 이벤트 (매수 + 매도).
   * appendFill()로 추가하고 getWeightedPnlPct() / getTotalRealizedPnl()로 집계한다.
   * 기존 포지션은 fills가 없을 수 있음 — 레거시 returnPct로 폴백.
   */
  fills?: PositionFill[];
  /**
   * Phase 2차 C5 — Sample Quarantine Protocol:
   * 치명 버그(incident) 발생 시각 이후에 생성된 Shadow 샘플에 자동 부착되는 태그.
   * 값 = incident ISO 타임스탬프. 이 태그가 있는 샘플은 캘리브레이션·워크포워드
   * 분석에서 자동 제외된다 (사람이 삭제하지 않아도 통계에서 자동 격리).
   */
  incidentFlag?: string;
  /**
   * 수동 청산(MANUAL_EXIT) 발생 시점에 자동 캡처되는 컨텍스트.
   * exitRuleTag === 'MANUAL_EXIT' 과 한 쌍으로, 반성 엔진이 "왜 수동 청산했는가"를
   * 학습할 수 있게 한다. 기계가 대기 중이던 규칙·손절/목표가까지 거리·편향 추정·
   * 사용자 자유 노트를 포함한다.
   */
  manualExitContext?: ManualExitContext;
  /**
   * Idea 1: 진입 시점 Kelly 의사결정 스냅샷.
   * buildBuyTrade() 가 생성 시 반드시 채운다. 레거시 포지션은 undefined.
   * 이 단일 필드가 /kelly 헬스 카드·포지션 감쇠 추적·사후 복기의 공통 참조점.
   */
  entryKellySnapshot?: EntryKellySnapshot;
}

// ─── Manual Exit Context ──────────────────────────────────────────────────────

/**
 * Telegram /sell 명령어 또는 UI 수동 매도 시 외부에서 주입되는 메타데이터.
 * 자동 손절/익절 경로에서는 기록되지 않는다 (exitRuleTag === 'MANUAL_EXIT' 전용).
 */
export interface ManualExitContext {
  /** 수동 청산 트리거 시각 (KST ISO) */
  triggeredAt: string;
  /** 사용자가 선택한 청산 사유 카테고리 */
  reasonCode: 'USER_NEWS' | 'USER_PANIC' | 'USER_CORRECTION' | 'USER_OTHER';
  /** 기계는 그 시점에 무엇을 판단하고 있었나 — 수동 개입 vs 자동 판단의 괴리 측정 */
  currentMachineVerdict: {
    /** 대기 중이던 규칙 (있으면) */
    activeRule?: ExitRuleTag;
    /** 손절가까지의 거리 (%) — 현재가 기준 음수면 이미 손절선 하향 돌파 */
    distanceToStop: number;
    /** 목표가까지의 거리 (%) */
    distanceToTarget: number;
  };
  /** 행동 편향 자동 추정 (0~1) — 반성 엔진이 패턴화할 수 있도록 수치로 기록 */
  biasAssessment: {
    /** 후회 회피 — 더 큰 손실 우려로 선제 청산 */
    regretAvoidance: number;
    /** 보유 효과 — 근거 없는 지속 보유 선호 반전 */
    endowmentEffect: number;
    /** 패닉 매도 — 감정적 일괄 청산 경향 */
    panicSelling: number;
  };
  /** 선택적 사용자 자유 노트 */
  userNote?: string;
}

export function loadShadowTrades(): ServerShadowTrade[] {
  ensureDataDir();
  if (!fs.existsSync(SHADOW_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SHADOW_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveShadowTrades(trades: ServerShadowTrade[]): void {
  ensureDataDir();
  fs.writeFileSync(SHADOW_FILE, JSON.stringify(trades, null, 2));
}

export function appendShadowLog(entry: Record<string, unknown>): void {
  ensureDataDir();
  const logs: unknown[] = fs.existsSync(SHADOW_LOG_FILE)
    ? JSON.parse(fs.readFileSync(SHADOW_LOG_FILE, 'utf-8'))
    : [];
  logs.push({ ...entry, ts: new Date().toISOString() });
  // 최근 500건만 보관
  fs.writeFileSync(SHADOW_LOG_FILE, JSON.stringify(logs.slice(-500), null, 2));
}

// ─── STRONG_BUY 분류 헬퍼 (ADR-0005) ─────────────────────────────────────────
/**
 * SHADOW 월간 집계에서 사용하는 STRONG_BUY 판정 함수.
 *
 * Primary: entryKellySnapshot.signalGrade === 'STRONG_BUY'
 * Fallback (레거시 trade 용): profileType A/B + RRR ≥ 3.0 + 강세 레짐(R1/R2/R3).
 *   signalScanner.ts:1222 의 isStrongBuy (gateScore >= 9) 기준을 충족하는 신호는
 *   대개 강세 레짐에서 대/중형 주도 프로파일을 가지며 RRR 3 이상을 설계한다는 점을
 *   반영한 휴리스틱이다. 신규 샘플에는 영향을 주지 않고 집계 시점에만 복원한다.
 */
export function isStrongBuyTrade(t: ServerShadowTrade): boolean {
  if (t.entryKellySnapshot?.signalGrade === 'STRONG_BUY') return true;
  if (t.entryKellySnapshot?.signalGrade) return false; // 명시적 다른 grade 면 fallback 금지
  const rrr = t.preMortemStructured?.targetScenario?.rrr ?? 0;
  const strongRegime = t.entryRegime === 'R1_TURBO'
    || t.entryRegime === 'R2_BULL'
    || t.entryRegime === 'R3_EARLY';
  const strongProfile = t.profileType === 'A' || t.profileType === 'B';
  return rrr >= 3.0 && strongRegime && strongProfile;
}

// ─── Shadow 월간 집계 (SSOT: fills) ───────────────────────────────────────────

/** Shadow 포지션이 종결(HIT_TARGET / HIT_STOP) 된 상태인지. */
export function isClosedShadowStatus(status: ServerShadowTrade['status']): boolean {
  return status === 'HIT_TARGET' || status === 'HIT_STOP';
}

export interface ShadowMonthlyStats {
  /** 'YYYY-MM' */
  month: string;
  /** 당월 종결 건수 (HIT_TARGET/HIT_STOP) */
  totalClosed: number;
  wins: number;
  losses: number;
  /** 0~100 */
  winRate: number;
  /** 단순평균 netPct */
  avgReturnPct: number;
  /** ∏(1+r) - 1 (%) */
  compoundReturnPct: number;
  /** |손실합| > 0 이면 승익합/|손실합|, 아니면 null */
  profitFactor: number | null;
  /** (signalType === STRONG_BUY) 만 모아서 낸 승률 — 레거시 필드 없을 수도 있어 0 fallback */
  strongBuyWinRate: number;
  /** 표본 ≥ 5 인지 */
  sampleSufficient: boolean;
  /** 미결(진행 중) 포지션 수 — fills 기반 */
  openPositions: number;
}

const _SHADOW_MIN_SAMPLE = 5;

/**
 * 당월(또는 지정월) Shadow 포지션의 종결·미결 집계를 한 번에 계산한다.
 * getMonthlyStats(recommendationTracker) 는 recommendations.json 을 읽어 계산하므로
 * 본 함수와 범위가 다르다 — 이 함수는 shadow-trades.json(실제 포지션 장부) 기반.
 *
 * - closed: exitTime 이 해당 월에 포함된 것 (HIT_TARGET/HIT_STOP).
 * - netPct: getWeightedPnlPct(fills SSOT). fills 없는 레거시는 trade.returnPct.
 * - strongBuy: 런타임 필드는 없으므로, entryKellySnapshot.signalGrade === 'STRONG_BUY' 로 판정.
 */
export function computeShadowMonthlyStats(monthISO?: string): ShadowMonthlyStats {
  const month = monthISO ?? new Date().toISOString().slice(0, 7);
  const all = loadShadowTrades();

  // 종결 건: exitTime 이 해당 월에 속하는 HIT_TARGET / HIT_STOP.
  const closed = all.filter(t => {
    if (!isClosedShadowStatus(t.status)) return false;
    const exitIso = t.exitTime ?? '';
    return exitIso.startsWith(month);
  });

  const openPositions = all.filter(t => isOpenShadowStatusStatus(t.status)).length;

  const returns = closed.map(t => getWeightedPnlPct(t));
  const wins = returns.filter(r => r > 0).length;
  const losses = returns.filter(r => r < 0).length;
  const totalClosed = closed.length;

  const avgReturnPct = totalClosed > 0
    ? returns.reduce((s, r) => s + r, 0) / totalClosed
    : 0;

  const compoundReturnPct = totalClosed > 0
    ? (returns.reduce((acc, r) => acc * (1 + r / 100), 1) - 1) * 100
    : 0;

  const winSum = returns.filter(r => r > 0).reduce((s, r) => s + r, 0);
  const lossAbs = Math.abs(returns.filter(r => r < 0).reduce((s, r) => s + r, 0));
  const profitFactor = lossAbs > 0 ? winSum / lossAbs : null;

  // STRONG_BUY 승률 — Primary: entryKellySnapshot.signalGrade.
  // ADR-0005 Fallback: 레거시 trade (snapshot 없음) 에 대해
  //   preMortemStructured.targetScenario.rrr >= 3.0 AND
  //   profileType ∈ {A, B} AND
  //   entryRegime ∈ {R1_TURBO, R2_BULL, R3_EARLY}
  // 을 STRONG_BUY 로 복원하여 SHADOW 졸업 조건 산정이 레거시 구간에서 막히지 않게 한다.
  const sb = closed.filter(t => isStrongBuyTrade(t));
  const sbWins = sb.filter(t => getWeightedPnlPct(t) > 0).length;
  const strongBuyWinRate = sb.length > 0 ? (sbWins / sb.length) * 100 : 0;

  return {
    month,
    totalClosed,
    wins,
    losses,
    winRate: totalClosed > 0 ? (wins / totalClosed) * 100 : 0,
    avgReturnPct,
    compoundReturnPct,
    profitFactor,
    strongBuyWinRate,
    sampleSufficient: totalClosed >= _SHADOW_MIN_SAMPLE,
    openPositions,
  };
}

// 내부 helper — entryEngine.isOpenShadowStatus 와 동일 로직. 순환 import 회피를 위해 중복 정의.
function isOpenShadowStatusStatus(status: ServerShadowTrade['status']): boolean {
  return status === 'PENDING'
      || status === 'ORDER_SUBMITTED'
      || status === 'PARTIALLY_FILLED'
      || status === 'ACTIVE'
      || status === 'EUPHORIA_PARTIAL';
}
