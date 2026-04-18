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
  status: 'HOLD' | 'REDUCE' | 'EXIT_READY';
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
