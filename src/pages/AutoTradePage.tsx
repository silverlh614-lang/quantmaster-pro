// @responsibility AutoTradePage 페이지 컴포넌트
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
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { Stack } from '../layout/Stack';
import { PageHeader, LoadingState, EmptyState, ViewModeToggle, FadeInOnScroll } from '../ui';
import type { AutoTradeTabId } from '../stores/useSettingsStore';
import { AutoTradingControlCenter } from '../components/autoTrading/AutoTradingControlCenter';
import { OrderDetailModal } from '../components/autoTrading/OrderDetailModal';
import { PositionDetailDrawer } from '../components/autoTrading/PositionDetailDrawer';
import { EngineToggleGate } from '../components/autoTrading/EngineToggleGate';
import { EngineHealthBanner } from '../components/autoTrading/EngineHealthBanner';
import { CompositeVerdictCard } from '../components/autoTrading/CompositeVerdictCard';
import { AlertsFeedBell } from '../components/autoTrading/AlertsFeedBell';
import { AutoTradeHeroKpis } from '../components/autoTrading/AutoTradeHeroKpis';
import { AutoTradeTabbedView } from '../components/autoTrading/AutoTradeTabbedView';
import { ProDiagnosticsStrip } from '../components/autoTrading/ProDiagnosticsStrip';
import { ApiConnectionLamps } from '../components/autoTrading/ApiConnectionLamps';
import { TelegramConnectionTest } from '../components/autoTrading/TelegramConnectionTest';
import { AutoTradeContextSection } from '../components/autoTrading/AutoTradeContextSection';
import { AutoTradeContextualLayout } from '../components/autoTrading/AutoTradeContextualLayout';
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
  const setActiveTab = useSettingsStore((s) => s.setAutoTradeActiveTab);

  // Hero KPI 클릭 시 탭 전환 후 부드럽게 스크롤.
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const handleKpiDrilldown = useCallback(
    (tab: AutoTradeTabId) => {
      setActiveTab(tab);
      // 탭 전환이 리렌더된 후 스크롤 — 다음 프레임에 예약.
      requestAnimationFrame(() => {
        tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [setActiveTab],
  );

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
    // 이미 가동 중이거나 토글 전환이 진행 중인 경우 ARM 재진입 차단 — 중복 전환 방지.
    if (isRunning || engineToggling) return;
    // Nuclear Reactor Gate 가 이미 열려 있다면 재 무장하지 않는다(카운트다운 리셋 방지).
    if (arming.state !== 'IDLE') return;
    arming.arm();
  };

  const handleResumeShadow = () => {
    // 토글이 진행 중인 동안에는 재시동 금지 — 브로커 세션 교란 방지.
    if (engineToggling) return;
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
    // Skeleton 대시보드 — KPI grid + 카드 쌍 + 테이블로 실제 레이아웃 힌트.
    return (
      <LoadingState
        message="정밀 장비를 초기화하는 중입니다..."
        skeleton="dashboard"
      />
    );
  }

  if (error && !data) {
    return (
      <EmptyState
        variant="error"
        icon={<Activity className="h-8 w-8" />}
        title="관제 데이터를 불러올 수 없습니다"
        description={error}
        cta={{
          label: '다시 시도',
          icon: <RefreshCw className="h-4 w-4" />,
          onClick: refresh,
          variant: 'secondary',
        }}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        variant="inviting"
        icon={<Activity className="h-8 w-8" />}
        title="데이터가 없습니다"
        description="관제실 데이터가 비어 있습니다. 엔진 상태를 확인하거나 새로고침 해보세요."
        cta={{
          label: '새로고침',
          icon: <RefreshCw className="h-4 w-4" />,
          onClick: refresh,
          variant: 'primary',
        }}
      />
    );
  }

  const gateOpen = arming.state !== 'IDLE';
  const killSwitchActive = Boolean(
    killSwitch.isDowngraded || killSwitch.current?.shouldDowngrade,
  );

  const isPro = viewMode === 'pro';

  return (
    <>
      <Stack gap="xl">
        <PageHeader
          title={isPro ? '자동매매 관제실 — PRO' : '자동매매 관제실'}
          subtitle={
            isPro
              ? 'Full Command Console · 신호 큐 · 게이트 진단 · 응급 조치'
              : '요약 대시보드 · 포지션 · 주문 모니터링'
          }
          accentColor={
            isPro
              ? 'bg-gradient-to-b from-amber-400 via-orange-500 to-rose-500'
              : 'bg-gradient-to-b from-sky-400 to-blue-500'
          }
          actions={
            <div className="flex items-center gap-2">
              <span
                className={
                  isPro
                    ? 'hidden sm:inline-flex px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.25em] rounded-lg bg-gradient-to-r from-amber-500/[0.18] via-orange-500/[0.14] to-rose-500/[0.1] text-amber-200 border-2 border-amber-400/30 shadow-[2px_2px_0px_rgba(0,0,0,0.35)]'
                    : 'hidden sm:inline-flex px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.25em] rounded-lg bg-sky-500/[0.1] text-sky-200 border-2 border-sky-400/25 shadow-[2px_2px_0px_rgba(0,0,0,0.3)]'
                }
              >
                {isPro ? 'PRO · FULL' : 'SIMPLE'}
              </span>
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
              <AlertsFeedBell
                entries={alertsFeed.entries}
                unread={alertsFeed.unread}
                onMarkAllRead={alertsFeed.markAllRead}
              />
            </div>
          }
        />

        {/*
          ADR-0043 — Context-Adaptive Layout.
          각 섹션이 자기 priorityByContext 를 declare → AutoTradeContextualLayout 가 정렬.
          기존 컴포넌트 본체는 단 한 줄도 수정하지 않음.
        */}
        <AutoTradeContextualLayout>
          {/* 진단 스트립 — 프로 전용 + LIVE/POST 우선, OVERNIGHT/WEEKEND 접힘 */}
          {isPro && (
            <AutoTradeContextSection
              id="pro-diagnostics"
              label="고밀도 진단 스트립"
              priorityByContext={{
                LIVE_MARKET: 1,
                POST_MARKET: 2,
                PRE_MARKET: 3,
                OVERNIGHT: 6,
                WEEKEND_HOLIDAY: 7,
              }}
              collapsedByContext={{ OVERNIGHT: true, WEEKEND_HOLIDAY: true }}
            >
              <ProDiagnosticsStrip
                data={data}
                isRunning={isRunning}
                killSwitchActive={killSwitchActive}
              />
            </AutoTradeContextSection>
          )}

          {/* Hero KPI — 모든 컨텍스트에서 항상 상위 (LIVE/POST 1순위, 그 외 2~3) */}
          <AutoTradeContextSection
            id="hero-kpi"
            label="Hero KPI"
            priorityByContext={{
              LIVE_MARKET: 2,
              POST_MARKET: 1,
              PRE_MARKET: 2,
              OVERNIGHT: 3,
              WEEKEND_HOLIDAY: 3,
            }}
          >
            <AutoTradeHeroKpis
              state={data}
              isRunning={isRunning}
              killSwitchActive={killSwitchActive}
              viewMode={viewMode}
              onDrilldown={handleKpiDrilldown}
            />
          </AutoTradeContextSection>

          {/* 외부 API 연결 상태 램프 — 모든 컨텍스트에서 중하위 (정상 동작 시 시각 노이즈 최소화) */}
          <AutoTradeContextSection
            id="api-lamps"
            label="외부 API 연결 상태"
            priorityByContext={{
              LIVE_MARKET: 4,
              POST_MARKET: 5,
              PRE_MARKET: 3,
              OVERNIGHT: 5,
              WEEKEND_HOLIDAY: 6,
            }}
            collapsedByContext={{ WEEKEND_HOLIDAY: true }}
          >
            <ApiConnectionLamps />
          </AutoTradeContextSection>

          {/* Telegram 연결 테스트 — PRE_MARKET 우선 (장 시작 전 도달성 점검) */}
          <AutoTradeContextSection
            id="telegram-test"
            label="텔레그램 연결 테스트"
            priorityByContext={{
              PRE_MARKET: 4,
              LIVE_MARKET: 6,
              POST_MARKET: 6,
              OVERNIGHT: 6,
              WEEKEND_HOLIDAY: 5,
            }}
            collapsedByContext={{ LIVE_MARKET: true, POST_MARKET: true, OVERNIGHT: true }}
          >
            <TelegramConnectionTest />
          </AutoTradeContextSection>

          {/* 엔진 건강 — LIVE 시 1순위, 그 외 중상위 */}
          <AutoTradeContextSection
            id="engine-health"
            label="엔진 건강"
            priorityByContext={{
              LIVE_MARKET: 3,
              POST_MARKET: 4,
              PRE_MARKET: 2,
              OVERNIGHT: 4,
              WEEKEND_HOLIDAY: 5,
            }}
          >
            <EngineHealthBanner heartbeat={heartbeat} killSwitch={killSwitch} />
          </AutoTradeContextSection>

          {/* 종합 평결 — pro 전용 + 모든 컨텍스트에서 중상위 */}
          {viewMode === 'pro' && (
            <AutoTradeContextSection
              id="composite-verdict"
              label="종합 평결"
              priorityByContext={{
                LIVE_MARKET: 4,
                POST_MARKET: 3,
                PRE_MARKET: 4,
                OVERNIGHT: 4,
                WEEKEND_HOLIDAY: 4,
              }}
            >
              <FadeInOnScroll>
                <CompositeVerdictCard
                  engine={engineStatus}
                  heartbeat={heartbeat}
                  killSwitch={killSwitch}
                  buyAudit={buyAudit}
                  brokerConnected={data.broker.connected}
                  dataIntegrityOk={!data.control.engineStatus.includes('ERROR')}
                  onRefresh={refresh}
                />
              </FadeInOnScroll>
            </AutoTradeContextSection>
          )}

          {/* 컨트롤 센터 — PRE_MARKET 1순위 (엔진 무장 준비), LIVE/POST 중상위 */}
          <AutoTradeContextSection
            id="control-center"
            label="자동매매 컨트롤"
            priorityByContext={{
              PRE_MARKET: 1,
              LIVE_MARKET: 5,
              POST_MARKET: 6,
              OVERNIGHT: 5,
              WEEKEND_HOLIDAY: 6,
            }}
          >
            <AutoTradingControlCenter
              state={data.control}
              engineToggling={engineToggling}
              onPause={() => { void toggleEngine(); }}
              onResume={handleResumeShadow}
              onArmLive={handleArmLive}
              onRefresh={refresh}
              onEmergencyStop={() => { void emergencyStop(); }}
            />
          </AutoTradeContextSection>

          {/* 세부 탭 — LIVE 시 1순위 (신호 큐·포지션 모니터링), 그 외 중하위 */}
          <AutoTradeContextSection
            id="tabbed-view"
            label="세부 탭"
            priorityByContext={{
              LIVE_MARKET: 1,
              POST_MARKET: 2,
              PRE_MARKET: 5,
              OVERNIGHT: 6,
              WEEKEND_HOLIDAY: 7,
            }}
            collapsedByContext={{ WEEKEND_HOLIDAY: true }}
          >
            <FadeInOnScroll delay={0.05}>
              <AutoTradeTabbedView
                ref={tabsRef}
                data={data}
                gateAudit={gateAudit}
                viewMode={viewMode}
                onSelectOrder={setSelectedOrderId}
                onSelectPosition={setSelectedPositionId}
                onEmergencyStop={() => { void emergencyStop(); }}
              />
            </FadeInOnScroll>
          </AutoTradeContextSection>
        </AutoTradeContextualLayout>
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
