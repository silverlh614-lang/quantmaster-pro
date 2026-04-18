/**
 * AutoTradeHeroKpis — 자동매매 관제실 최상단 4-카드 Hero KPI.
 *
 * 정보 계층화(Step 1) 의 핵심: 세부 패널을 탭으로 접어두기 전에,
 * "한 눈에 파악해야 할 4개 지표" 를 Scoreboard 로 승격한다.
 *   1) 오늘 실현손익 (거래 건수 포함)
 *   2) 실행 효율 (체결 성공률)
 *   3) 활성 포지션 (경보 단계 포함)
 *   4) 리스크 · 엔진 상태 (킬스위치·트리거 규칙 요약)
 */
import React, { useMemo } from 'react';
import { KpiScoreboard, type KpiItem } from '../../ui/kpi-strip';
import type {
  AutoTradingDashboardState,
  ExecutionOrder,
  PositionItem,
  RiskRuleState,
} from '../../services/autoTrading/autoTradingTypes';
import { fmtKrw, fmtPct } from '../../utils/format';

interface AutoTradeHeroKpisProps {
  state: AutoTradingDashboardState;
  isRunning: boolean;
  killSwitchActive?: boolean;
}

export function AutoTradeHeroKpis({
  state,
  isRunning,
  killSwitchActive = false,
}: AutoTradeHeroKpisProps) {
  const items = useMemo<KpiItem[]>(
    () => buildHeroKpis(state, isRunning, killSwitchActive),
    [state, isRunning, killSwitchActive],
  );

  return <KpiScoreboard items={items} />;
}

/* ---------- Pure helpers (순수함수 — 테스트 용이) ---------- */

function buildHeroKpis(
  state: AutoTradingDashboardState,
  isRunning: boolean,
  killSwitchActive: boolean,
): KpiItem[] {
  const pnl = computePnlKpi(state);
  const execution = computeExecutionKpi(state.orders);
  const positions = computePositionsKpi(state.positions);
  const risk = computeRiskKpi(state.riskRules, isRunning, killSwitchActive);

  return [pnl, execution, positions, risk];
}

function computePnlKpi(state: AutoTradingDashboardState): KpiItem {
  const pnl = state.control.todayPnL ?? 0;
  const count = state.control.todayOrderCount ?? 0;
  const status = pnl > 0 ? 'pass' : pnl < 0 ? 'fail' : 'neutral';
  return {
    label: '오늘 실현손익',
    value: fmtKrw(pnl),
    change: `${count}건 체결`,
    trend: pnl > 0 ? 'up' : pnl < 0 ? 'down' : 'neutral',
    status,
  };
}

function computeExecutionKpi(orders: ExecutionOrder[]): KpiItem {
  const total = orders.length;
  const filled = orders.filter(
    (o) => o.status === 'FILLED' || o.status === 'PARTIAL_FILLED',
  ).length;
  const rejected = orders.filter(
    (o) => o.status === 'REJECTED' || o.status === 'BLOCKED' || o.status === 'CANCELLED',
  ).length;

  const fillRate = total > 0 ? (filled / total) * 100 : 0;
  const status =
    total === 0 ? 'neutral' : fillRate >= 80 ? 'pass' : fillRate >= 50 ? 'warn' : 'fail';

  return {
    label: '실행 효율',
    value: total === 0 ? '—' : fmtPct(fillRate, 0),
    change: `${filled}/${total} 체결 · ${rejected} 실패`,
    trend: total === 0 ? 'neutral' : fillRate >= 80 ? 'up' : 'down',
    status,
  };
}

function computePositionsKpi(positions: PositionItem[]): KpiItem {
  const total = positions.length;
  const alert = positions.filter(
    (p) => p.stage === 'ALERT' || p.stage === 'EXIT_PREP',
  ).length;
  const exitReady = positions.filter((p) => p.status === 'EXIT_READY').length;

  const status =
    total === 0 ? 'neutral' : alert > 0 || exitReady > 0 ? 'warn' : 'pass';

  return {
    label: '활성 포지션',
    value: `${total}종목`,
    change: alert > 0 ? `⚠ 경보 ${alert} · 청산대기 ${exitReady}` : '정상 보유',
    trend: 'neutral',
    status,
  };
}

function computeRiskKpi(
  rules: RiskRuleState[],
  isRunning: boolean,
  killSwitchActive: boolean,
): KpiItem {
  const triggered = rules.filter((r) => r.triggered).length;

  if (killSwitchActive) {
    return {
      label: '리스크 · 엔진',
      value: 'KILL',
      change: '킬스위치 활성',
      trend: 'down',
      status: 'fail',
    };
  }

  if (!isRunning) {
    return {
      label: '리스크 · 엔진',
      value: 'IDLE',
      change: triggered > 0 ? `트리거 ${triggered}건` : '엔진 정지',
      trend: 'neutral',
      status: 'warn',
    };
  }

  const status = triggered === 0 ? 'pass' : triggered <= 1 ? 'warn' : 'fail';
  return {
    label: '리스크 · 엔진',
    value: triggered === 0 ? 'OK' : `${triggered} 트리거`,
    change: triggered === 0 ? '규칙 전체 통과' : '규칙 확인 필요',
    trend: triggered === 0 ? 'up' : 'down',
    status,
  };
}
