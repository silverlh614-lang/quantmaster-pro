/**
 * AutoTradeTabbedView — 자동매매 관제실 상세 패널 집합을 탭으로 분리.
 *
 * 정보 계층화(Step 1 v2):
 *   - "간단 모드"  → 포지션·주문 두 탭만 노출 (기본값)
 *   - "프로 모드" → 전체 탭(신호/주문/포지션/진단/히트맵) 노출
 *   - 활성 탭은 useSettingsStore 에 영속되어 페이지 재진입에도 유지.
 *   - 탭 count 뱃지는 "주의 필요" 값(대기 신호, 트리거된 리스크)에 한정 —
 *     정상 상태(예: 주문 50건)로 시각 노이즈를 만들지 않음.
 */
import React, { forwardRef, useEffect, useMemo } from 'react';
import {
  Activity,
  FileClock,
  LayoutList,
  ShieldCheck,
} from 'lucide-react';
import { Tabs } from '../../ui/tabs';
import { PageGrid } from '../../layout/PageGrid';
import { SignalQueuePanel } from './SignalQueuePanel';
import { EventLogPanel } from './EventLogPanel';
import { ExecutionMonitor } from './ExecutionMonitor';
import { RiskControlPanel } from './RiskControlPanel';
import { PositionLifecyclePanel } from './PositionLifecyclePanel';
import { GatePassRateHeatmap } from './GatePassRateHeatmap';
import { BrokerConnectionPanel } from './BrokerConnectionPanel';
import { EmergencyActionsPanel } from './EmergencyActionsPanel';
import { OcoOrdersCard } from '../trading/autoTrade/OcoOrdersCard';
import { GlobalSignalsPanel } from './GlobalSignalsPanel';
import { useOcoOrdersQuery } from '../../hooks/autoTrade';
import type { AutoTradingDashboardState } from '../../services/autoTrading/autoTradingTypes';
import type { GateAuditData } from '../../api';
import {
  useSettingsStore,
  type ViewDensity,
  type AutoTradeTabId,
} from '../../stores/useSettingsStore';

interface AutoTradeTabbedViewProps {
  data: AutoTradingDashboardState;
  gateAudit: GateAuditData | null;
  viewMode: ViewDensity;
  onSelectOrder: (orderId: string) => void;
  onSelectPosition: (positionId: string) => void;
  onEmergencyStop: () => void;
}

export const AutoTradeTabbedView = forwardRef<HTMLDivElement, AutoTradeTabbedViewProps>(
  function AutoTradeTabbedView(
    {
      data,
      gateAudit,
      viewMode,
      onSelectOrder,
      onSelectPosition,
      onEmergencyStop,
    },
    ref,
  ) {
    const activeTab = useSettingsStore((s) => s.autoTradeActiveTab);
    const setActiveTab = useSettingsStore((s) => s.setAutoTradeActiveTab);

    const ocoQuery = useOcoOrdersQuery();
    const ocoOrders = ocoQuery.data ?? { active: [], history: [] };

    const tabs = useMemo(() => buildTabs(data, viewMode), [data, viewMode]);

    // viewMode 전환 후 이전 탭이 더 이상 유효하지 않으면 첫 탭으로 보정.
    useEffect(() => {
      const valid = tabs.some((t) => t.id === activeTab);
      if (!valid) setActiveTab(tabs[0].id as AutoTradeTabId);
    }, [viewMode, tabs, activeTab, setActiveTab]);

    // 보정 전 일시적 불일치를 대비한 안전한 현재 탭.
    const current: AutoTradeTabId = tabs.some((t) => t.id === activeTab)
      ? activeTab
      : (tabs[0].id as AutoTradeTabId);

    return (
      <div ref={ref} className="space-y-4" data-autotrade-tabs>
        <Tabs
          tabs={tabs}
          value={current}
          onChange={(id) => setActiveTab(id as AutoTradeTabId)}
          className="overflow-x-auto"
          tone={viewMode === 'pro' ? 'amber' : 'blue'}
        />

        {current === 'positions' && (
          <div
            className="space-y-4"
            onDoubleClick={() =>
              data.positions[0] && onSelectPosition(data.positions[0].id)
            }
          >
            <PositionLifecyclePanel positions={data.positions} />
            {/* OCO 주문 현황 — 포지션별 손절/익절 주문번호와 상태를 한 눈에 표시. */}
            <OcoOrdersCard orders={ocoOrders} />
          </div>
        )}

        {current === 'execution' && (
          <PageGrid columns="2" gap="md">
            <div
              onDoubleClick={() =>
                data.orders[0] && onSelectOrder(data.orders[0].id)
              }
            >
              <ExecutionMonitor orders={data.orders} />
            </div>
            <RiskControlPanel rules={data.riskRules} />
          </PageGrid>
        )}

        {current === 'signals' && (
          <PageGrid columns="2-1" gap="md">
            <SignalQueuePanel signals={data.signals} />
            <EventLogPanel logs={data.logs} />
          </PageGrid>
        )}

        {current === 'diagnostics' && (
          <div className="space-y-4">
            <GatePassRateHeatmap data={gateAudit} />
            <PageGrid columns="2" gap="md">
              <BrokerConnectionPanel broker={data.broker} />
              <EmergencyActionsPanel
                state={data.emergency}
                onEmergencyLiquidation={onEmergencyStop}
              />
            </PageGrid>
            {/* 진단 탭 하단: ADR·Pre-Market·DXY·섹터 ETF 글로벌 신호 요약 */}
            <GlobalSignalsPanel />
          </div>
        )}
      </div>
    );
  },
);

/* ---------- Tab builder (pure) ---------- */

function buildTabs(state: AutoTradingDashboardState, viewMode: ViewDensity) {
  const positionsCount = state.positions.length;
  // "주의 필요" 카운트만 노출 — 정상 상태에서는 뱃지 생략.
  const positionsAlert = state.positions.filter(
    (p) => p.stage === 'ALERT' || p.stage === 'EXIT_PREP' || p.status === 'EXIT_READY',
  ).length;
  const pendingSignals = state.signals.filter(
    (s) => s.status === 'DETECTED' || s.status === 'QUEUED',
  ).length;
  const triggeredRisk = state.riskRules.filter((r) => r.triggered).length;

  const base = [
    {
      id: 'positions' as const,
      label: '포지션',
      icon: <LayoutList className="h-3.5 w-3.5" />,
      // 항상 총 개수 노출 — 포지션은 0/없음도 의미 있는 상태.
      count: positionsCount,
    },
    {
      id: 'execution' as const,
      label: '주문·리스크',
      icon: <Activity className="h-3.5 w-3.5" />,
      // 트리거된 리스크가 있을 때만 주의 뱃지.
      count: triggeredRisk > 0 ? triggeredRisk : undefined,
    },
  ];

  if (viewMode === 'simple') return base;

  return [
    ...base,
    {
      id: 'signals' as const,
      label: '신호·이벤트',
      icon: <FileClock className="h-3.5 w-3.5" />,
      count: pendingSignals > 0 ? pendingSignals : undefined,
    },
    {
      id: 'diagnostics' as const,
      label: '진단',
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      count: positionsAlert > 0 ? positionsAlert : undefined,
    },
  ];
}
