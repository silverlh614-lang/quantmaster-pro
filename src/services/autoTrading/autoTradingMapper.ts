import type {
  BuyAuditData,
  EngineStatus as ServerEngineStatus,
  KisHolding,
  ServerShadowTrade,
} from '../../api';
import type { AccountSummary } from '../../hooks/useAutoTradeDashboard';
import type {
  AutoTradingDashboardState,
  BrokerConnectionState,
  ControlCenterState,
  EmergencyActionState,
  EngineStatus,
  ExecutionOrder,
  OrderStatus,
  PositionItem,
  RiskRuleState,
  TradingMode,
} from './autoTradingTypes';

function formatKst(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour12: false,
  });
}

function mapTradingMode(mode: string | null | undefined): TradingMode {
  const normalized = (mode ?? '').toUpperCase();
  if (normalized === 'LIVE') return 'LIVE';
  if (normalized === 'VTS' || normalized === 'PAPER') return 'PAPER';
  if (normalized === 'SHADOW') return 'SHADOW';
  return 'MANUAL';
}

function mapEngineStatus(engine: ServerEngineStatus | null): EngineStatus {
  if (!engine) return 'STOPPED';
  if (engine.emergencyStop) return 'ERROR';
  if (!engine.running) return 'PAUSED';
  const state = (engine.currentState ?? '').toUpperCase();
  if (state.includes('SYNC')) return 'SYNCING';
  if (state.includes('ERROR')) return 'ERROR';
  return 'RUNNING';
}

function mapOrderStatus(trade: ServerShadowTrade): OrderStatus {
  const status = (trade.status ?? '').toUpperCase();
  if (status === 'REJECTED') return 'REJECTED';
  if (status === 'PENDING') return 'QUEUED';
  if (status === 'ACTIVE') return 'SENT';
  if (status === 'HIT_TARGET' || status === 'HIT_STOP') return 'FILLED';
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'DETECTED';
}

function sideFromTrade(trade: ServerShadowTrade): 'BUY' | 'SELL' {
  const status = (trade.status ?? '').toUpperCase();
  if (status === 'HIT_TARGET' || status === 'HIT_STOP') return 'SELL';
  return 'BUY';
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toControlCenterState(
  engineStatus: ServerEngineStatus | null,
  accountSummary: AccountSummary | null,
): ControlCenterState {
  return {
    mode: mapTradingMode(engineStatus?.mode),
    engineStatus: mapEngineStatus(engineStatus),
    brokerConnected: Boolean(engineStatus?.autoTradeEnabled && !engineStatus?.emergencyStop),
    lastScanAt: formatKst(engineStatus?.lastScanAt),
    lastOrderAt: formatKst(engineStatus?.lastBuySignalAt),
    todayOrderCount: (engineStatus?.todayStats?.buys ?? 0) + (engineStatus?.todayStats?.exits ?? 0),
    todayPnL: accountSummary?.totalPnlAmt ?? 0,
  };
}

export function toExecutionOrders(trades: ServerShadowTrade[]): ExecutionOrder[] {
  return trades
    .slice()
    .sort((a, b) => new Date(b.signalTime).getTime() - new Date(a.signalTime).getTime())
    .slice(0, 30)
    .map((trade, index) => ({
      id: trade.id ?? `${trade.stockCode}-${index}`,
      symbol: trade.stockCode,
      name: trade.stockName,
      side: sideFromTrade(trade),
      quantity: toNumber(trade.quantity ?? trade.originalQuantity),
      orderPrice: toNumber(trade.signalPrice, NaN),
      filledPrice: toNumber(trade.shadowEntryPrice ?? trade.exitPrice, NaN),
      status: mapOrderStatus(trade),
      createdAt: formatKst(trade.signalTime) ?? '-',
      updatedAt: formatKst(trade.resolvedAt ?? trade.exitTime),
      failureReason: mapOrderStatus(trade) === 'REJECTED' ? '주문 거절 또는 조건 미충족' : undefined,
    }))
    .map((order) => ({
      ...order,
      orderPrice: Number.isFinite(order.orderPrice ?? NaN) ? order.orderPrice : undefined,
      filledPrice: Number.isFinite(order.filledPrice ?? NaN) ? order.filledPrice : undefined,
    }));
}

export function toRiskRules(
  engineStatus: ServerEngineStatus | null,
  buyAudit: BuyAuditData | null,
): RiskRuleState[] {
  const rules: RiskRuleState[] = [];

  if (buyAudit) {
    rules.push({
      id: 'daily-loss',
      name: '일일 손실 제한',
      enabled: true,
      triggered: buyAudit.emergencyStop,
      message: buyAudit.emergencyStop ? '비상정지 발동 상태' : '비상정지 미발동',
    });

    rules.push({
      id: 'vix-gating',
      name: '변동성 게이트',
      enabled: true,
      triggered: buyAudit.vixGating.noNewEntry,
      message: buyAudit.vixGating.reason,
    });

    rules.push({
      id: 'fomc-gating',
      name: 'FOMC 이벤트 게이트',
      enabled: true,
      triggered: buyAudit.fomcGating.noNewEntry,
      message: buyAudit.fomcGating.description,
    });
  }

  rules.push({
    id: 'engine-emergency-stop',
    name: '엔진 비상정지',
    enabled: true,
    triggered: Boolean(engineStatus?.emergencyStop),
    message: engineStatus?.emergencyStop ? '엔진 비상정지 상태' : '정상 운용 중',
  });

  return rules;
}

export function toPositions(holdings: KisHolding[]): PositionItem[] {
  return holdings.slice(0, 20).map((holding) => {
    const quantity = toNumber(holding.hldg_qty);
    const avgPrice = toNumber(holding.pchs_avg_pric);
    const currentPrice = toNumber(holding.prpr);
    const pnlPct = toNumber(holding.evlu_pfls_rt);

    return {
      id: holding.pdno,
      symbol: holding.pdno,
      name: holding.prdt_name,
      enteredAt: '-',
      entryReason: '자동매매 포지션 추적 중',
      avgPrice,
      currentPrice,
      quantity,
      pnlPct,
      status: pnlPct < -2 ? 'REDUCE' : pnlPct > 5 ? 'EXIT_READY' : 'HOLD',
      warningMessage: pnlPct < -3 ? '손실 구간 진입: 리스크 점검 필요' : undefined,
    };
  });
}

const fallbackBroker: BrokerConnectionState = {
  brokerName: 'UNKNOWN',
  connected: false,
  orderAvailable: false,
  lastError: '브로커 상태 정보 없음',
};

const fallbackEmergency: EmergencyActionState = {
  newBuyBlocked: false,
  autoTradingPaused: false,
  positionManageOnly: false,
};

export function mapAutoTradingDashboard(raw: AutoTradingDashboardState): AutoTradingDashboardState {
  return {
    ...raw,
    orders: raw.orders ?? [],
    positions: raw.positions ?? [],
    riskRules: raw.riskRules ?? [],
    signals: raw.signals ?? [],
    logs: raw.logs ?? [],
    broker: raw.broker ?? fallbackBroker,
    emergency: raw.emergency ?? fallbackEmergency,
  };
}
