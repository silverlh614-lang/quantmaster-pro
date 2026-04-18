/**
 * AutoTradeTabbedView — 자동매매 관제실 상세 패널 집합을 탭으로 분리.
 *
 * 정보 계층화(Step 1):
 *   - "간단 모드"  → 포지션·주문 두 탭만 노출 (기본값)
 *   - "프로 모드" → 전체 탭(신호/주문/포지션/진단/히트맵) 노출
 */
import React, { useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  FileClock,
  Flame,
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
import type { AutoTradingDashboardState } from '../../services/autoTrading/autoTradingTypes';
import type { GateAuditData } from '../../api';
import type { ViewDensity } from '../../stores/useSettingsStore';

type TabId = 'positions' | 'execution' | 'signals' | 'diagnostics';

interface AutoTradeTabbedViewProps {
  data: AutoTradingDashboardState;
  gateAudit: GateAuditData | null;
  viewMode: ViewDensity;
  onSelectOrder: (orderId: string) => void;
  onSelectPosition: (positionId: string) => void;
  onEmergencyStop: () => void;
}

export function AutoTradeTabbedView({
  data,
  gateAudit,
  viewMode,
  onSelectOrder,
  onSelectPosition,
  onEmergencyStop,
}: AutoTradeTabbedViewProps) {
  const tabs = useMemo(() => buildTabs(data, viewMode), [data, viewMode]);

  // viewMode 변경 시 현재 탭이 사라지면 첫 번째 탭으로 리셋.
  const [activeTab, setActiveTab] = useState<TabId>(tabs[0].id as TabId);
  const activeExists = tabs.some((t) => t.id === activeTab);
  const current: TabId = activeExists ? activeTab : (tabs[0].id as TabId);

  return (
    <div className="space-y-4">
      <Tabs
        tabs={tabs}
        value={current}
        onChange={(id) => setActiveTab(id as TabId)}
        className="overflow-x-auto"
      />

      {current === 'positions' && (
        <div
          onDoubleClick={() =>
            data.positions[0] && onSelectPosition(data.positions[0].id)
          }
        >
          <PositionLifecyclePanel positions={data.positions} />
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
              onBlockNewBuy={() => {
                /* Phase 2 실제 엔드포인트 연결 예정 */
              }}
              onPauseAutoTrading={() => {
                /* Phase 2 실제 엔드포인트 연결 예정 */
              }}
              onManageOnly={() => {
                /* Phase 2 실제 엔드포인트 연결 예정 */
              }}
              onEmergencyLiquidation={onEmergencyStop}
            />
          </PageGrid>
        </div>
      )}
    </div>
  );
}

/* ---------- Tab builder (pure) ---------- */

function buildTabs(state: AutoTradingDashboardState, viewMode: ViewDensity) {
  const positionsCount = state.positions.length;
  const ordersCount = state.orders.length;
  const pendingSignals = state.signals.filter(
    (s) => s.status === 'DETECTED' || s.status === 'QUEUED',
  ).length;
  const triggeredRisk = state.riskRules.filter((r) => r.triggered).length;

  const base = [
    {
      id: 'positions' as const,
      label: '포지션',
      icon: <LayoutList className="h-3.5 w-3.5" />,
      count: positionsCount,
    },
    {
      id: 'execution' as const,
      label: '주문·리스크',
      icon: <Activity className="h-3.5 w-3.5" />,
      count: ordersCount + triggeredRisk,
    },
  ];

  if (viewMode === 'simple') return base;

  return [
    ...base,
    {
      id: 'signals' as const,
      label: '신호·이벤트',
      icon: <FileClock className="h-3.5 w-3.5" />,
      count: pendingSignals,
    },
    {
      id: 'diagnostics' as const,
      label: '진단',
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
    },
  ];
}

// 보조 아이콘 — 추후 확장 시 참조용 export.
export const AutoTradeTabIcons = {
  heatmap: <Flame className="h-3.5 w-3.5" />,
  chart: <BarChart3 className="h-3.5 w-3.5" />,
};
