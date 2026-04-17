import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '../ui/cn';
import { PageHeader } from '../ui/page-header';
import { KpiStrip } from '../ui/kpi-strip';
import { Stack } from '../layout/Stack';
import { PageGrid } from '../layout/PageGrid';
import { TradingChecklist } from '../components/trading/TradingChecklist';
import { TradingSettingsPanel } from '../components/trading/TradingSettingsPanel';
import { SessionRecoveryBanner } from '../components/trading/SessionRecoveryBanner';
import { ShadowPortfolioPanel } from '../components/trading/ShadowPortfolioPanel';
import { Card } from '../ui/card';
import {
  EngineControlCard, ReconcileCard, ShadowForcedInputCard, AccountSummaryStrip,
  BuyAuditCard, ConditionWeightsCard, GateAuditCard,
  RiskGaugeCard, RrrDistributionCard, TradingTimelineCard,
  OcoOrdersCard, WatchlistHoldingsCard, RecommendationStatsCard,
  ShadowTradesSection, DailyLedgerCard, AuditTrailModal,
  type RiskGauge, type RrrBucket, type TimelineEvent,
} from '../components/trading/autoTrade';
import { useAutoTradeDashboard } from '../hooks/useAutoTradeDashboard';
import { useQueryParam } from '../hooks/useQueryParam';
import {
  getWeightedPnlPct,
} from '../components/trading/autoTrade/shadowTradeFills';
import type { ServerShadowTrade, PositionEvent } from '../api';

/**
 * 자동매매 센터 — 12개 이상의 원격 상태를 조합해 보여주는 대시보드.
 *
 * 페이지 본체는 훅(`useAutoTradeDashboard`) 이 제공하는 상태를 각
 * 하위 카드 컴포넌트에 전달하는 얇은 뷰 레이어만 담당한다. 데이터
 * 페칭·폴링은 Phase 2, shadow trade 동기화는 Phase 4, 개별 카드는
 * Phase 5 에서 각각 분리되었다.
 */
type TabKey = 'dashboard' | 'settings';
const TAB_KEYS = ['dashboard', 'settings'] as const satisfies readonly TabKey[];

export function AutoTradePage() {
  // ?tab=settings 쿼리와 상태를 양방향 동기화. 값이 없으면 'dashboard'.
  const [activeTab, setActiveTab] = useQueryParam<TabKey>('tab', 'dashboard', TAB_KEYS);

  const {
    engineStatus,
    serverShadowTrades,
    serverRecStats,
    watchlist,
    holdings,
    buyAudit,
    gateAudit,
    conditionDebug,
    ocoOrders,
    reconcileData,
    accountSummary,
    toggleEngine,
    engineToggling,
    runReconcile,
    reconcileRunning,
    loadPositionEvents,
    refetchAll,
  } = useAutoTradeDashboard();

  // ── 감사 추적 뷰어 모달 상태 ──────────────────────────────────────
  const [auditTrade, setAuditTrade] = useState<ServerShadowTrade | null>(null);
  const [auditEvents, setAuditEvents] = useState<PositionEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const openAudit = async (t: ServerShadowTrade) => {
    setAuditTrade(t);
    setAuditLoading(true);
    setAuditEvents([]);
    try {
      setAuditEvents(await loadPositionEvents(t.id ?? ''));
    } finally {
      setAuditLoading(false);
    }
  };

  // ── 파생 통계 ─────────────────────────────────────────────────────
  // fills 가중평균 기준 — returnPct 오염 차단
  const serverShadowStats = useMemo(() => {
    const settled = serverShadowTrades.filter((t) =>
      t.status === 'HIT_TARGET' || t.status === 'HIT_STOP',
    );
    if (settled.length === 0) return { count: serverShadowTrades.length, winRate: 0, avgReturn: 0 };
    const wins = settled.filter((t) => getWeightedPnlPct(t) > 0).length;
    const winRate = Math.round((wins / settled.length) * 100);
    const avgReturn = settled.reduce((s, t) => s + getWeightedPnlPct(t), 0) / settled.length;
    return { count: serverShadowTrades.length, winRate, avgReturn };
  }, [serverShadowTrades]);

  const riskGauge: RiskGauge | null = useMemo(() => {
    if (!accountSummary) return null;
    const totalAsset = accountSummary.totalEvalAmt + accountSummary.availableCash;
    if (totalAsset <= 0) return null;
    const exposureRate = (accountSummary.totalEvalAmt / totalAsset) * 100;
    const cashRate = (accountSummary.availableCash / totalAsset) * 100;
    const maxLoss = watchlist.reduce((sum, w) => {
      const lossRate = Math.abs((w.stopLoss - w.entryPrice) / w.entryPrice);
      const posSize = accountSummary.totalEvalAmt / Math.max(watchlist.length, 1);
      return sum + lossRate * posSize;
    }, 0);
    return { exposureRate, cashRate, maxLoss };
  }, [accountSummary, watchlist]);

  const rrrBuckets: RrrBucket[] = useMemo(() => {
    const settled = serverShadowTrades.filter((t) =>
      t.status === 'HIT_TARGET' || t.status === 'HIT_STOP',
    );
    return [
      { name: '손실',   value: settled.filter((t) => getWeightedPnlPct(t) < 0).length },
      { name: '0~5%',  value: settled.filter((t) => { const p = getWeightedPnlPct(t); return p >= 0 && p < 5; }).length },
      { name: '5~10%', value: settled.filter((t) => { const p = getWeightedPnlPct(t); return p >= 5 && p < 10; }).length },
      { name: '10%+',  value: settled.filter((t) => getWeightedPnlPct(t) >= 10).length },
    ];
  }, [serverShadowTrades]);

  const timeline = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];
    for (const t of serverShadowTrades) {
      const wpct = getWeightedPnlPct(t);
      if (t.status === 'HIT_TARGET') events.push({ time: t.resolvedAt ?? t.signalTime, type: 'TARGET_HIT', stock: t.stockName, detail: `+${wpct.toFixed(1)}%` });
      else if (t.status === 'HIT_STOP') events.push({ time: t.resolvedAt ?? t.signalTime, type: 'STOP_HIT', stock: t.stockName, detail: `${wpct.toFixed(1)}%` });
      else if (t.status === 'ACTIVE') events.push({ time: t.signalTime, type: 'BUY', stock: t.stockName, detail: `${t.shadowEntryPrice?.toLocaleString()}원` });
    }
    for (const w of watchlist.slice(0, 5)) {
      events.push({ time: w.addedAt, type: 'WATCHLIST', stock: w.name, detail: `${w.addedBy} 추가` });
    }
    return events
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 8);
  }, [serverShadowTrades, watchlist]);

  const settledCount = serverShadowTrades.filter(
    (t) => t.status === 'HIT_TARGET' || t.status === 'HIT_STOP',
  ).length;

  return (
    <motion.div
      key="auto-trade-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Stack gap="lg">
        <SessionRecoveryBanner />

        <PageHeader
          title="자동매매 센터"
          subtitle="KIS 모의계좌 연동 · Shadow Trading · OCO 자동 등록"
          accentColor="bg-violet-500"
        />

        {/* ① 엔진 마스터 스위치 + 오늘 KPI */}
        <EngineControlCard engineStatus={engineStatus} toggling={engineToggling} onToggle={toggleEngine} />

        {/* Reconciliation 정합성 대시보드 */}
        {reconcileData && (
          <ReconcileCard data={reconcileData} running={reconcileRunning} onRun={runReconcile} />
        )}

        {/* Shadow 불일치 강제 입력 · 수동 동기화 */}
        <ShadowForcedInputCard trades={serverShadowTrades} onSynced={refetchAll} />

        {/* ② 실시간 포트폴리오 P&L 헤더 */}
        {accountSummary && <AccountSummaryStrip summary={accountSummary} />}

        {/* KPI Strip — Shadow 통계 스코어보드 */}
        <KpiStrip size="lg" items={[
          { label: 'Shadow 건수', value: serverShadowStats.count, status: 'neutral' },
          { label: '적중률', value: `${serverShadowStats.winRate}%`, status: serverShadowStats.winRate >= 60 ? 'pass' : serverShadowStats.winRate >= 40 ? 'warn' : 'fail', change: serverShadowStats.winRate >= 50 ? '목표 충족' : '목표 미달' },
          { label: '평균수익', value: `${serverShadowStats.avgReturn.toFixed(2)}%`, status: serverShadowStats.avgReturn >= 0 ? 'pass' : 'fail', trend: serverShadowStats.avgReturn >= 0 ? 'up' : 'down' },
        ]} />

        {/* Tab Switcher: 대시보드 / 트레이딩 설정 */}
        <div className="flex items-center gap-2 p-1 bg-white/5 rounded-xl border border-theme-border w-fit">
          {TAB_KEYS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-1.5 text-xs font-bold rounded-lg transition-all',
                activeTab === tab
                  ? 'bg-violet-500 text-white shadow-[0_0_12px_rgba(139,92,246,0.3)]'
                  : 'text-theme-text-muted hover:text-theme-text hover:bg-white/5'
              )}
            >
              {tab === 'dashboard' ? '대시보드' : '트레이딩 설정'}
            </button>
          ))}
        </div>

        {activeTab === 'settings' && <TradingSettingsPanel />}

        {activeTab === 'dashboard' && <>
          {buyAudit && <BuyAuditCard audit={buyAudit} />}
          {conditionDebug && <ConditionWeightsCard debug={conditionDebug} />}
          {gateAudit && Object.keys(gateAudit).length > 0 && <GateAuditCard audit={gateAudit} />}
          {riskGauge && accountSummary && (
            <RiskGaugeCard
              gauge={riskGauge}
              totalAsset={accountSummary.totalEvalAmt + accountSummary.availableCash}
            />
          )}

          {/* RRR 분포 + 최근 활동 */}
          <PageGrid columns="2" gap="sm">
            {rrrBuckets.some(b => b.value > 0) && (
              <RrrDistributionCard buckets={rrrBuckets} settledCount={settledCount} />
            )}
            {timeline.length > 0 && <TradingTimelineCard events={timeline} />}
          </PageGrid>

          {(ocoOrders.active.length > 0 || ocoOrders.history.length > 0) && (
            <OcoOrdersCard orders={ocoOrders} />
          )}

          <WatchlistHoldingsCard watchlist={watchlist} holdings={holdings} />

          {serverRecStats && <RecommendationStatsCard stats={serverRecStats} />}

          <ShadowTradesSection trades={serverShadowTrades} onOpenAudit={openAudit} />

          <DailyLedgerCard trades={serverShadowTrades} />

          {/* 섀도우 계좌 포트폴리오 패널 */}
          <Card padding="md">
            <ShadowPortfolioPanel />
          </Card>

          <TradingChecklist />
        </>}
      </Stack>

      <AuditTrailModal
        trade={auditTrade}
        events={auditEvents}
        loading={auditLoading}
        onClose={() => setAuditTrade(null)}
      />
    </motion.div>
  );
}
