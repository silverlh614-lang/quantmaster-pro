export type TradingMode = 'LIVE' | 'PAPER' | 'SHADOW' | 'MANUAL';

export type EngineStatus =
  | 'RUNNING'
  | 'PAUSED'
  | 'ERROR'
  | 'SYNCING'
  | 'STOPPED';

export type OrderStatus =
  | 'DETECTED'
  | 'QUEUED'
  | 'SENT'
  | 'PARTIAL_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'BLOCKED';

export interface ControlCenterState {
  mode: TradingMode;
  engineStatus: EngineStatus;
  brokerConnected: boolean;
  lastScanAt?: string;
  lastOrderAt?: string;
  todayOrderCount: number;
  todayPnL: number;
}

export interface ExecutionOrder {
  id: string;
  symbol: string;
  name: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderPrice?: number;
  filledPrice?: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt?: string;
  failureReason?: string;
  brokerLatencyMs?: number;
}

export interface RiskRuleState {
  id: string;
  name: string;
  enabled: boolean;
  triggered: boolean;
  message?: string;
}

/**
 * 포지션 생애주기 5단계 (positionLifecycleEngine 과 동일 스키마).
 * UI 표시 시 Phase 4 LifecycleStageGauge 가 이 값을 기반으로 5단계 진행바 렌더.
 */
export type PositionLifecycleStage = 'ENTRY' | 'HOLD' | 'ALERT' | 'EXIT_PREP' | 'FULL_EXIT';

export interface PositionItem {
  id: string;
  symbol: string;
  name: string;
  enteredAt: string;
  entryReason: string;
  avgPrice: number;
  currentPrice: number;
  quantity: number;
  pnlPct: number;
  stopLossPrice?: number;
  targetPrice1?: number;
  targetPrice2?: number;
  trailingStopEnabled?: boolean;
  /** 레거시 status (하위 호환) — Phase 4 부터는 `stage` 를 우선 참조. */
  status: 'HOLD' | 'REDUCE' | 'EXIT_READY';
  /** Phase 4 신설: 5단계 생애주기 표기. */
  stage?: PositionLifecycleStage;
  /** 단계 전이에서 이탈된 조건 (툴팁/상세 모달용). */
  breachedConditions?: string[];
  warningMessage?: string;
}

export interface SignalItem {
  id: string;
  symbol: string;
  name: string;
  createdAt: string;
  grade: 'STRONG_BUY' | 'BUY' | 'HOLD';
  gate1Passed: number;
  gate2Passed: number;
  gate3Passed: number;
  rrr?: number;
  status: OrderStatus;
  blockedReason?: string;
}

export interface TradingLogItem {
  id: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
  createdAt: string;
}

export interface BrokerConnectionState {
  brokerName: string;
  connected: boolean;
  accountMasked?: string;
  orderAvailable: boolean;
  balanceSyncedAt?: string;
  quoteSyncedAt?: string;
  lastError?: string;
}

export interface EmergencyActionState {
  newBuyBlocked: boolean;
  autoTradingPaused: boolean;
  positionManageOnly: boolean;
}

export interface AutoTradingDashboardState {
  control: ControlCenterState;
  orders: ExecutionOrder[];
  positions: PositionItem[];
  riskRules: RiskRuleState[];
  signals: SignalItem[];
  logs: TradingLogItem[];
  broker: BrokerConnectionState;
  emergency: EmergencyActionState;
}
