import React, { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { Stack } from '../layout/Stack';
import { PageHeader } from '../ui/page-header';
import { PageGrid } from '../layout/PageGrid';
import { LoadingState } from '../ui/loading-state';
import { EmptyState } from '../ui/empty-state';
import { AutoTradingControlCenter } from '../components/autoTrading/AutoTradingControlCenter';
import { ExecutionMonitor } from '../components/autoTrading/ExecutionMonitor';
import { RiskControlPanel } from '../components/autoTrading/RiskControlPanel';
import { PositionLifecyclePanel } from '../components/autoTrading/PositionLifecyclePanel';
import { SignalQueuePanel } from '../components/autoTrading/SignalQueuePanel';
import { EventLogPanel } from '../components/autoTrading/EventLogPanel';
import { BrokerConnectionPanel } from '../components/autoTrading/BrokerConnectionPanel';
import { EmergencyActionsPanel } from '../components/autoTrading/EmergencyActionsPanel';
import { OrderDetailModal } from '../components/autoTrading/OrderDetailModal';
import { PositionDetailDrawer } from '../components/autoTrading/PositionDetailDrawer';
import { useAutoTradingDashboard } from '../hooks/useAutoTradingDashboard';

export function AutoTradePage() {
  const { data, loading, error, refresh } = useAutoTradingDashboard();
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);

  const selectedOrder = useMemo(
    () => data?.orders.find((order) => order.id === selectedOrderId) ?? null,
    [data, selectedOrderId],
  );

  const selectedPosition = useMemo(
    () => data?.positions.find((position) => position.id === selectedPositionId) ?? null,
    [data, selectedPositionId],
  );

  if (loading && !data) {
    return <LoadingState message="자동매매 관제 데이터를 불러오는 중입니다..." />;
  }

  if (error && !data) {
    return (
      <EmptyState
        icon={<Activity className="h-8 w-8" />}
        title="자동매매 데이터를 불러올 수 없습니다"
        description={error}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={<Activity className="h-8 w-8" />}
        title="데이터가 없습니다"
        description="자동매매 대시보드 데이터가 비어 있습니다."
      />
    );
  }

  return (
    <>
      <Stack gap="xl">
        <PageHeader
          title="자동매매 관제실"
          subtitle="Auto Trading Control Room"
          accentColor="bg-red-500"
        />

        <AutoTradingControlCenter
          state={data.control}
          onPause={() => console.log('pause')}
          onResume={() => console.log('resume')}
          onRefresh={refresh}
          onEmergencyStop={() => console.log('emergency stop')}
        />

        <PageGrid columns="2-1" gap="md">
          <SignalQueuePanel signals={data.signals} />
          <EventLogPanel logs={data.logs} />
        </PageGrid>

        <PageGrid columns="2" gap="md">
          <div onDoubleClick={() => data.orders[0] && setSelectedOrderId(data.orders[0].id)}>
            <ExecutionMonitor orders={data.orders} />
          </div>
          <RiskControlPanel rules={data.riskRules} />
        </PageGrid>

        <div onDoubleClick={() => data.positions[0] && setSelectedPositionId(data.positions[0].id)}>
          <PositionLifecyclePanel positions={data.positions} />
        </div>

        <PageGrid columns="2" gap="md">
          <BrokerConnectionPanel broker={data.broker} />
          <EmergencyActionsPanel
            state={data.emergency}
            onBlockNewBuy={() => console.log('block new buy')}
            onPauseAutoTrading={() => console.log('pause auto trading')}
            onManageOnly={() => console.log('manage only')}
            onEmergencyLiquidation={() => console.log('emergency liquidation')}
          />
        </PageGrid>
      </Stack>

      <OrderDetailModal
        order={selectedOrder}
        open={!!selectedOrder}
        onClose={() => setSelectedOrderId(null)}
      />

      <PositionDetailDrawer
        position={selectedPosition}
        open={!!selectedPosition}
        onClose={() => setSelectedPositionId(null)}
      />
    </>
  );
}
