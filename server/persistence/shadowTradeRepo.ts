import fs from 'fs';
import { SHADOW_FILE, SHADOW_LOG_FILE, ensureDataDir } from './paths.js';

/**
 * 청산/감축 규칙 태그 (EXIT_RULE_PRIORITY_TABLE 규칙명과 1:1 대응).
 * exitRuleTag 필드에 사용되며, EXIT_RULE_PRIORITY_TABLE 우선순위 순서로 평가된다.
 * 새 규칙 추가 시 이 타입과 EXIT_RULE_PRIORITY_TABLE을 함께 갱신해야 한다.
 */
export type ExitRuleTag =
  | 'R6_EMERGENCY_EXIT'          // priority 1
  | 'HARD_STOP'                  // priority 2
  | 'CASCADE_FINAL'              // priority 3
  | 'LIMIT_TRANCHE_TAKE_PROFIT'  // priority 4
  | 'TRAILING_PROTECTIVE_STOP'   // priority 5
  | 'TARGET_EXIT'                // priority 6
  | 'CASCADE_HALF_SELL'          // priority 7
  | 'CASCADE_WARN_BLOCK'         // priority 8
  | 'RRR_COLLAPSE_PARTIAL'       // priority 9
  | 'DIVERGENCE_PARTIAL'         // priority 10
  | 'STOP_APPROACH_ALERT'        // priority 11
  | 'EUPHORIA_PARTIAL';          // priority 12

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
