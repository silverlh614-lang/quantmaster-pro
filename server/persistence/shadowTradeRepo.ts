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

/**
 * 포지션의 총 실현 원화 손익 (모든 SELL Fill의 pnl 합산).
 */
export function getTotalRealizedPnl(trade: ServerShadowTrade): number {
  return (trade.fills ?? [])
    .filter(f => f.type === 'SELL' && f.pnl !== undefined)
    .reduce((sum, f) => sum + (f.pnl ?? 0), 0);
}

/**
 * 포지션의 수량 가중 평균 수익률 %.
 * fills가 없으면 레거시 returnPct로 폴백한다.
 */
export function getWeightedPnlPct(trade: ServerShadowTrade): number {
  const sells = (trade.fills ?? []).filter(f => f.type === 'SELL' && f.pnlPct !== undefined);
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
 */
export function getRemainingQty(trade: ServerShadowTrade): number {
  const fills = trade.fills ?? [];
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
  const fills = trade.fills ?? [];
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
  | 'EUPHORIA_PARTIAL';          // priority 14

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
   * 포지션에 귀속된 모든 체결 이벤트 (매수 + 매도).
   * appendFill()로 추가하고 getWeightedPnlPct() / getTotalRealizedPnl()로 집계한다.
   * 기존 포지션은 fills가 없을 수 있음 — 레거시 returnPct로 폴백.
   */
  fills?: PositionFill[];
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
