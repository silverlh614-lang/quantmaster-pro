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
  SignalItem,
  TradingLogItem,
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
    brokerConnected: Boolean(engineStatus?.kisStreamConnected),
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

/**
 * 보유 포지션 수익률만으로 5단계 Lifecycle Stage 를 휴리스틱 추정.
 * 서버에 전용 lifecycle 엔드포인트가 생기기 전까지의 과도기 추정값이며
 * 구체적 분기는 positionLifecycleEngine 의 규칙을 단순화한 것이다.
 */
function inferLifecycleStage(pnlPct: number): PositionItem['stage'] {
  if (pnlPct <= -5) return 'FULL_EXIT';     // 손절 임박/발동
  if (pnlPct <= -2) return 'EXIT_PREP';     // 분할 축소 필요 구간
  if (pnlPct <= -0.5) return 'ALERT';       // 주의 구간
  if (pnlPct >= 5) return 'HOLD';           // 수익 정상 유지
  return 'HOLD';
}

export function toPositions(holdings: KisHolding[]): PositionItem[] {
  return holdings.slice(0, 20).map((holding) => {
    const quantity = toNumber(holding.hldg_qty);
    const avgPrice = toNumber(holding.pchs_avg_pric);
    const currentPrice = toNumber(holding.prpr);
    const pnlPct = toNumber(holding.evlu_pfls_rt);

    const stage = inferLifecycleStage(pnlPct);
    const breachedConditions: string[] = [];
    if (pnlPct <= -3) breachedConditions.push('-3% 이상 손실 — 리스크 재평가');
    if (pnlPct <= -5) breachedConditions.push('손절 라인 임박');
    if (quantity <= 0) breachedConditions.push('잔여 수량 0');

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
      stage,
      breachedConditions: breachedConditions.length ? breachedConditions : undefined,
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

// ── Shadow Trades 로부터 신호 큐 파생 ───────────────────────────
// 전용 신호 엔드포인트가 없으므로 최근 shadow trade 들을 신호로 역추정.
// Phase 3+ 에서 `/api/auto-trade/signals/queue` 엔드포인트 추가 시 교체.
export function deriveSignalsFromShadowTrades(trades: ServerShadowTrade[]): SignalItem[] {
  return trades
    .slice()
    .sort((a, b) => new Date(b.signalTime).getTime() - new Date(a.signalTime).getTime())
    .slice(0, 20)
    .map((t, i) => {
      const status = mapOrderStatus(t);
      const blocked = status === 'REJECTED' || status === 'BLOCKED';
      return {
        id: t.id ?? `sig-${t.stockCode}-${i}`,
        symbol: t.stockCode,
        name: t.stockName,
        createdAt: formatKst(t.signalTime) ?? '-',
        grade: 'BUY' as const,
        gate1Passed: 0,
        gate2Passed: 0,
        gate3Passed: 0,
        rrr: undefined,
        status,
        blockedReason: blocked ? '서버 측 필터에 의해 실행 차단' : undefined,
      };
    });
}

// ── Shadow Trades 로부터 로그 타임라인 파생 ─────────────────────
export function deriveLogsFromShadowTrades(trades: ServerShadowTrade[]): TradingLogItem[] {
  const logs: TradingLogItem[] = [];
  trades
    .slice()
    .sort((a, b) => new Date(b.signalTime).getTime() - new Date(a.signalTime).getTime())
    .slice(0, 30)
    .forEach((t, i) => {
      const status = (t.status ?? '').toUpperCase();
      const level: TradingLogItem['level'] =
        status === 'REJECTED' ? 'ERROR'
        : status === 'HIT_TARGET' ? 'SUCCESS'
        : status === 'HIT_STOP' ? 'WARNING'
        : 'INFO';
      const verb =
        status === 'HIT_TARGET' ? '익절 체결'
        : status === 'HIT_STOP' ? '손절 체결'
        : status === 'ACTIVE' ? '주문 체결'
        : status === 'PENDING' ? '신호 탐지'
        : status === 'REJECTED' ? '주문 거부'
        : '상태 갱신';
      logs.push({
        id: `log-${t.id ?? t.stockCode}-${i}`,
        level,
        message: `${t.stockName} (${t.stockCode}) — ${verb}`,
        createdAt: formatKst(t.resolvedAt ?? t.exitTime ?? t.signalTime) ?? '-',
      });
    });
  return logs;
}

// ── 브로커 연결 상태 파생 ───────────────────────────────────────
export function deriveBrokerState(
  engineStatus: ServerEngineStatus | null,
  accountSummary: AccountSummary | null,
): BrokerConnectionState {
  if (!engineStatus) return fallbackBroker;
  // 브로커 연결의 진실 소스는 실시간 호가 WebSocket 상태(kisStreamConnected).
  // autoTradeEnabled·accountSummary 는 연결이 아닌 "설정/조회 여부" 를 의미하므로 분리.
  const connected = Boolean(engineStatus.kisStreamConnected);
  const lastError = engineStatus.emergencyStop
    ? '비상정지 활성'
    : !connected
      ? 'KIS 실시간 호가 스트림 미연결'
      : undefined;
  return {
    brokerName: 'KIS',
    connected,
    accountMasked: accountSummary ? '자동 매핑됨' : undefined,
    orderAvailable: connected && engineStatus.autoTradeEnabled && !engineStatus.emergencyStop,
    balanceSyncedAt: formatKst(engineStatus.lastRun),
    quoteSyncedAt: formatKst(engineStatus.lastScanAt),
    lastError,
  };
}

// ── 긴급 액션 상태 파생 ─────────────────────────────────────────
export function deriveEmergencyState(
  engineStatus: ServerEngineStatus | null,
  buyAudit: BuyAuditData | null,
): EmergencyActionState {
  if (!engineStatus && !buyAudit) return fallbackEmergency;
  const newBuyBlocked = Boolean(
    buyAudit?.vixGating.noNewEntry ||
    buyAudit?.fomcGating.noNewEntry ||
    buyAudit?.emergencyStop,
  );
  const autoTradingPaused = Boolean(engineStatus?.emergencyStop || !engineStatus?.running);
  return {
    newBuyBlocked,
    autoTradingPaused,
    positionManageOnly: newBuyBlocked && !autoTradingPaused,
  };
}

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
