/**
 * AutoTradePage — 자동매매 관제실.
 *
 * Step 1 (정보 계층화) 리팩토링:
 *   1) 상단 Hero 4-카드 KPI 로 "한 눈 요약" 구축
 *   2) Progressive disclosure: 간단 ↔ 프로 모드 토글
 *   3) 세부 패널은 탭으로 분리 (Position / Execution / Signals / Diagnostics)
 *
 * 기존 모든 로직(Nuclear Reactor Gate, SSE 스트림 등) 은 그대로 유지.
 */
import React, { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { Stack } from '../layout/Stack';
import { PageHeader, LoadingState, EmptyState, ViewModeToggle } from '../ui';
import { AutoTradingControlCenter } from '../components/autoTrading/AutoTradingControlCenter';
import { OrderDetailModal } from '../components/autoTrading/OrderDetailModal';
import { PositionDetailDrawer } from '../components/autoTrading/PositionDetailDrawer';
import { EngineToggleGate } from '../components/autoTrading/EngineToggleGate';
import { EngineHealthBanner } from '../components/autoTrading/EngineHealthBanner';
import { CompositeVerdictCard } from '../components/autoTrading/CompositeVerdictCard';
import { AlertsFeedBell } from '../components/autoTrading/AlertsFeedBell';
import { AutoTradeHeroKpis } from '../components/autoTrading/AutoTradeHeroKpis';
import { AutoTradeTabbedView } from '../components/autoTrading/AutoTradeTabbedView';
import { useAutoTradingDashboard } from '../hooks/useAutoTradingDashboard';
import { useAutoTradeEngine } from '../hooks/autoTrade';
import { useEngineArming } from '../hooks/autoTrade/useEngineArming';
import { useEngineHeartbeat } from '../hooks/autoTrade/useEngineHeartbeat';
import { useKillSwitchStatus } from '../hooks/autoTrade/useKillSwitchStatus';
import { useEngineStream } from '../hooks/autoTrade/useEngineStream';
import { useAlertsFeed } from '../hooks/autoTrade/useAlertsFeed';
import { useSettingsStore } from '../stores/useSettingsStore';

export function AutoTradePage() {
  const {
    data,
    loading,
    error,
    refresh,
    toggleEngine,
    engineToggling,
    isRunning,
    mode,
    emergencyStop,
  } = useAutoTradingDashboard();

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);

  const viewMode = useSettingsStore((s) => s.autoTradeViewMode);
  const setViewMode = useSettingsStore((s) => s.setAutoTradeViewMode);

  const heartbeat = useEngineHeartbeat();
  const killSwitch = useKillSwitchStatus();
  // SSE 실시간 엔진 스트림 — 연결되면 5초 폴링은 cache-hit 로 흡수되어 무해.
  useEngineStream();
  const { engineStatus, buyAudit, gateAudit } = useAutoTradeEngine();
  const alertsFeed = useAlertsFeed();

  // Nuclear Reactor Gate — LIVE 모드 시동 시에만 사용
  const arming = useEngineArming({
    armTimeoutMs: 10_000,
    onCommit: toggleEngine,
  });

  const handleArmLive = () => {
    if (isRunning) return;
    arming.arm();
  };

  const handleResumeShadow = () => {
    void toggleEngine();
  };

  const selectedOrder = useMemo(
    () => data?.orders.find((order) => order.id === selectedOrderId) ?? null,
    [data, selectedOrderId],
  );

  const selectedPosition = useMemo(
    () => data?.positions.find((position) => position.id === selectedPositionId) ?? null,
    [data, selectedPositionId],
  );

  if (loading && !data) {
    return <LoadingState message="정밀 장비를 초기화하는 중입니다..." />;
  }

  if (error && !data) {
    return (
      <EmptyState
        icon={<Activity className="h-8 w-8" />}
        title="관제 데이터를 불러올 수 없습니다"
        description={error}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={<Activity className="h-8 w-8" />}
        title="데이터가 없습니다"
        description="관제실 데이터가 비어 있습니다."
      />
    );
  }

  const gateOpen = arming.state !== 'IDLE';
  const killSwitchActive = Boolean(
    killSwitch.isDowngraded || killSwitch.current?.shouldDowngrade,
  );

  return (
    <>
      <Stack gap="xl">
        <PageHeader
          title="자동매매 관제실"
          subtitle="Precision Instrument · Auto Trading Control Room"
          accentColor="bg-red-500"
          actions={
            <div className="flex items-center gap-2">
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
              <AlertsFeedBell
                entries={alertsFeed.entries}
                unread={alertsFeed.unread}
                onMarkAllRead={alertsFeed.markAllRead}
              />
            </div>
          }
        />

        {/* 최상단: 한 눈 파악용 Hero KPI (4-카드 스코어보드) */}
        <AutoTradeHeroKpis
          state={data}
          isRunning={isRunning}
          killSwitchActive={killSwitchActive}
        />

        {/* 필수 진단: 엔진 건강 + 종합 평결 + 컨트롤 */}
        <EngineHealthBanner heartbeat={heartbeat} killSwitch={killSwitch} />

        {viewMode === 'pro' && (
          <CompositeVerdictCard
            engine={engineStatus}
            heartbeat={heartbeat}
            killSwitch={killSwitch}
            buyAudit={buyAudit}
            brokerConnected={data.broker.connected}
            dataIntegrityOk={!data.control.engineStatus.includes('ERROR')}
          />
        )}

        <AutoTradingControlCenter
          state={data.control}
          engineToggling={engineToggling}
          onPause={() => { void toggleEngine(); }}
          onResume={handleResumeShadow}
          onArmLive={handleArmLive}
          onRefresh={refresh}
          onEmergencyStop={() => { void emergencyStop(); }}
        />

        {/* 세부 패널: 탭으로 계층화 */}
        <AutoTradeTabbedView
          data={data}
          gateAudit={gateAudit}
          viewMode={viewMode}
          onSelectOrder={setSelectedOrderId}
          onSelectPosition={setSelectedPositionId}
          onEmergencyStop={() => { void emergencyStop(); }}
        />
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

      {/* Nuclear Reactor Gate — LIVE 엔진 시동용 3단계 확인 모달 */}
      <EngineToggleGate
        open={gateOpen}
        state={arming.state}
        armCountdown={arming.armCountdown}
        todayToken={arming.todayToken}
        mode={mode}
        onAbort={arming.abort}
        onProceed={arming.proceed}
        onCommit={(t) => arming.commit(t, arming.todayToken)}
      />
    </>
  );
}
