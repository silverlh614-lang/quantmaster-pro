import React, { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiFetchSafe } from '../api/client';
import { QuantScreener } from '../components/analysis/QuantScreener';
import { GateWizard } from '../components/analysis/GateWizard';
import { WeightConfigPanel } from '../components/analysis/WeightConfigPanel';
import { UniverseSelector, DEFAULT_UNIVERSE } from '../components/analysis/UniverseSelector';
import { BearScreenerPanel } from '../components/bear/BearScreenerPanel';
import { DartPreNewsPanel } from '../components/signals/DartPreNewsPanel';
import { SectionErrorBoundary } from '../components/common/SectionErrorBoundary';
import { PipelineYieldTicker } from '../components/common/PipelineYieldTicker';
import { useRecommendationStore, useAnalysisStore, useGlobalIntelStore } from '../stores';
import { PageHeader } from '../ui/page-header';
import { Card } from '../ui/card';
import { Stack } from '../layout/Stack';
import { ALL_CONDITIONS } from '../services/quant/evolutionEngine';
import type { StockFilters, StockRecommendation, UniverseConfig } from '../services/stockService';

// ─── KIS Stream 연결 상태 디버그 타입 ─────────────────────────────────────────
interface KisStreamDebug {
  connected: boolean;
  subscribedCount: number;
  activePrices: number;
  reconnectCount: number;
  lastPongAt: string | null;
  recentEvents: { ts: string; event: string; detail: string }[];
}

interface ScreenerPageProps {
  onScreen: (filters: StockFilters) => Promise<void>;
}

export function ScreenerPage({ onScreen }: ScreenerPageProps) {
  const { loading, screenerRecommendations } = useRecommendationStore();
  const { setSelectedDetailStock } = useAnalysisStore();
  const bearRegimeResult = useGlobalIntelStore(s => s.bearRegimeResult);
  const bearScreenerResult = useGlobalIntelStore(s => s.bearScreenerResult);

  // ── Gate-0: Universe Selection State ───────────────────────────────────────
  const [universe, setUniverse] = useState<UniverseConfig>(DEFAULT_UNIVERSE);

  // ── Factor Weights State ───────────────────────────────────────────────────
  const [factorWeights, setFactorWeights] = useState<Record<number, number>>(() => {
    const defaults: Record<number, number> = {};
    for (let id = 1; id <= 27; id++) defaults[id] = ALL_CONDITIONS[id]?.baseWeight ?? 1;
    return defaults;
  });

  // VKOSPI from global intel store (fallback to 18)
  const vkospiResult = useGlobalIntelStore(s => s.vkospiTriggerResult);
  const currentVkospi = vkospiResult?.vkospi ?? 18;

  // ── KIS Stream 디버그 상태 (30초 폴링, TanStack Query) ─────────────────────
  // PR-2 #2: silent-fail fetch 대신 useQuery 로 캐시·retry·백오프 일관 적용.
  // 실패해도 전역 onError 토스트만 뜨고 데이터는 undefined 로 남아 패널이 숨김 처리.
  const [showStreamLog, setShowStreamLog] = useState(false);
  const { data: streamDebug = null } = useQuery<KisStreamDebug | null>({
    queryKey: ['pipeline-health', 'kis-stream'],
    queryFn: async () => {
      const data = await apiFetchSafe<{ kisStream?: KisStreamDebug }>(
        '/api/health/pipeline',
        {},
        { kisStream: undefined },
      );
      return data.kisStream ?? null;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });

  // ── Gate Wizard: selected stock for evaluation ─────────────────────────────
  const [wizardStock, setWizardStock] = useState<StockRecommendation | null>(null);

  const handleScreenWithUniverse = useCallback(async (filters: StockFilters) => {
    await onScreen({ ...filters, universe });
  }, [onScreen, universe]);

  const handleBearScreen = async () => {
    await handleScreenWithUniverse({ mode: 'BEAR_SCREEN' });
  };

  const handleStockClickForWizard = useCallback((stock: StockRecommendation) => {
    setSelectedDetailStock(stock);
    setWizardStock(stock);
  }, [setSelectedDetailStock]);

  // Build condition scores from the selected stock's checklist data
  const wizardConditionScores = React.useMemo(() => {
    if (!wizardStock?.checklist) return undefined;
    const scores: Record<number, number> = {};
    Object.values(wizardStock.checklist).forEach((value, idx) => {
      const id = idx + 1;
      if (typeof value === 'number') {
        scores[id] = value;
      } else if (value && typeof value === 'object') {
        const item = value as { score?: number; passed?: boolean };
        scores[id] = typeof item.score === 'number' ? item.score : (item.passed ? 7 : 3);
      }
    });
    return scores;
  }, [wizardStock]);

  return (
    <motion.div
      key="screener-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Stack gap="xl">
        <PageHeader
          title="Quant Screener + AI Pipeline"
          subtitle="정량 필터 → AI 질적 분석"
          accentColor="bg-blue-600"
        >
          정량적 필터로 후보군을 압축하고, AI가 질적 분석을 통해 최종 주도주를 선정하는 2단계 파이프라인입니다.
        </PageHeader>

        {/* IPYL — 장중 Pipeline Yield 3-막대 실시간 티커 */}
        <PipelineYieldTicker />

        {/* KIS Stream 연결 상태 디버그 배지 */}
        {streamDebug && (
          <div className="bg-[#0d0e11] border border-white/10 rounded-lg px-4 py-2.5">
            <button
              type="button"
              onClick={() => setShowStreamLog(prev => !prev)}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${streamDebug.connected ? 'bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-red-400 shadow-[0_0_6px_rgba(239,68,68,0.6)]'}`} />
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  KIS 실시간
                </span>
                <span className={`text-[11px] font-black ${streamDebug.connected ? 'text-green-400' : 'text-red-400'}`}>
                  {streamDebug.connected ? '연결됨' : '미연결'}
                </span>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-gray-500">
                <span>구독 {streamDebug.subscribedCount}종목</span>
                <span>가격 {streamDebug.activePrices}건</span>
                {streamDebug.reconnectCount > 0 && (
                  <span className="text-amber-400">재연결 {streamDebug.reconnectCount}회</span>
                )}
                {streamDebug.lastPongAt && (
                  <span>PONG {new Date(streamDebug.lastPongAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                )}
                <span className="text-gray-600">{showStreamLog ? '▲' : '▼'}</span>
              </div>
            </button>
            {showStreamLog && streamDebug.recentEvents && streamDebug.recentEvents.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/5 max-h-40 overflow-y-auto space-y-1">
                {streamDebug.recentEvents.slice().reverse().map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-[9px] font-mono">
                    <span className="text-gray-600 shrink-0">
                      {new Date(ev.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className={`shrink-0 font-bold ${
                      ev.event === 'OPEN' ? 'text-green-400' :
                      ev.event === 'CLOSE' || ev.event === 'ERROR' ? 'text-red-400' :
                      ev.event === 'RECONNECT' ? 'text-amber-400' :
                      ev.event === 'PONG_TIMEOUT' ? 'text-red-500' :
                      ev.event === 'STOP' ? 'text-red-600' :
                      'text-blue-400'
                    }`}>
                      [{ev.event}]
                    </span>
                    <span className="text-gray-400">{ev.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Gate-0: Universe Selector */}
        <SectionErrorBoundary sectionName="Universe Selector">
          <UniverseSelector value={universe} onChange={setUniverse} />
        </SectionErrorBoundary>

        {/* Factor Weight Control Panel — 27조건 가중치 */}
        <SectionErrorBoundary sectionName="Weight Config">
          <WeightConfigPanel
            weights={factorWeights}
            onWeightsChange={setFactorWeights}
            vkospi={currentVkospi}
          />
        </SectionErrorBoundary>

        {/* Bear Screener 패널 — Bear Regime 감지 시 자동 활성화 */}
        <SectionErrorBoundary sectionName="Bear Screener">
          <BearScreenerPanel
            bearScreenerResult={bearScreenerResult}
            loading={loading}
            recommendations={bearRegimeResult?.regime === 'BEAR' && screenerRecommendations.length > 0
              ? screenerRecommendations
              : []}
            onBearScreen={handleBearScreen}
            onStockClick={(stock: StockRecommendation) => setSelectedDetailStock(stock)}
          />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Quant Screener">
          <QuantScreener
            onScreen={handleScreenWithUniverse}
            loading={loading}
            recommendations={screenerRecommendations}
            onStockClick={handleStockClickForWizard}
            bearRegimeResult={bearRegimeResult}
          />
        </SectionErrorBoundary>

        {/* 3-Gate Wizard Flow — 종목 선택 시 활성화 */}
        <SectionErrorBoundary sectionName="Gate Wizard">
          <Card padding="lg">
            <div className="flex items-center gap-3 mb-5 sm:mb-6">
              <span className="text-micro">3-Gate 위저드 플로우 — 27조건 피라미드</span>
              {wizardStock && (
                <span className="text-xs font-black text-orange-400">
                  {wizardStock.name} ({wizardStock.code})
                </span>
              )}
            </div>
            <GateWizard
              stockName={wizardStock?.name}
              stockCode={wizardStock?.code}
              conditionScores={wizardConditionScores}
            />
          </Card>
        </SectionErrorBoundary>

        {/* DART Pre-News 스크리너 — 공시 기반 선행 포착 */}
        <SectionErrorBoundary sectionName="DART Pre-News">
          <DartPreNewsPanel />
        </SectionErrorBoundary>
      </Stack>
    </motion.div>
  );
}
