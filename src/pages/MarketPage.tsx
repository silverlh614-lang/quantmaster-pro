import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, Activity } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MarketDashboard } from '../components/MarketDashboard';
import { EventCalendar } from '../components/EventCalendar';
import { MacroIntelligenceDashboard } from '../components/MacroIntelligenceDashboard';
import { MHSHistoryChart } from '../components/MHSHistoryChart';
import { IntelligenceRadar } from '../components/IntelligenceRadar';
import { useMarketStore, useGlobalIntelStore, useRecommendationStore } from '../stores';
import { evaluateGate0 } from '../services/quantEngine';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MarketPageProps {
  onFetchMarketOverview: (force?: boolean) => Promise<void>;
}

export function MarketPage({ onFetchMarketOverview }: MarketPageProps) {
  const { marketOverview, marketContext, loadingMarket } = useMarketStore();
  const globalIntelStore = useGlobalIntelStore();
  const { recommendations } = useRecommendationStore();

  const macroEnv = globalIntelStore.macroEnv;
  const currentRoeType = globalIntelStore.currentRoeType;
  const economicRegimeData = globalIntelStore.economicRegimeData;
  const extendedRegimeData = globalIntelStore.extendedRegimeData;
  const smartMoneyData = globalIntelStore.smartMoneyData;
  const exportMomentumData = globalIntelStore.exportMomentumData;
  const geoRiskData = globalIntelStore.geoRiskData;
  const creditSpreadData = globalIntelStore.creditSpreadData;
  const globalCorrelation = globalIntelStore.globalCorrelation;
  const supplyChainData = globalIntelStore.supplyChainData;
  const sectorOrderData = globalIntelStore.sectorOrderData;
  const financialStressData = globalIntelStore.financialStressData;
  const fomcSentimentData = globalIntelStore.fomcSentimentData;
  const mhsHistory = globalIntelStore.mhsHistory;

  const gate0Result = useMemo(() => macroEnv ? evaluateGate0(macroEnv) : undefined, [macroEnv]);

  const triageSummary = useMemo(() => {
    const summary = { gate1: 0, gate2: 0, gate3: 0, total: (recommendations || []).length };
    (recommendations || []).forEach(rec => {
      if (rec.gate === 1) summary.gate1++;
      else if (rec.gate === 2) summary.gate2++;
      else if (rec.gate === 3) summary.gate3++;
    });
    return summary;
  }, [recommendations]);

  return (
    <motion.div
      key="market-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-12"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tight mb-2">시장 대시보드</h2>
          <p className="text-sm font-bold text-white/30 uppercase tracking-[0.2em]">Global Market Overview</p>
        </div>
        <button
          onClick={() => onFetchMarketOverview(true)}
          disabled={loadingMarket}
          className="flex items-center gap-3 px-6 py-3 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-all group disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4 text-indigo-400", loadingMarket ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500")} />
          <span className="text-sm font-black text-white/60 uppercase tracking-widest">데이터 갱신</span>
        </button>
      </div>

      {loadingMarket && !marketOverview ? (
        <div className="py-32 flex flex-col items-center justify-center space-y-6">
          <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
          <p className="text-indigo-300 font-bold animate-pulse">AI가 실시간 시장 데이터를 분석 중입니다...</p>
        </div>
      ) : marketOverview ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2">
            <MarketDashboard data={marketOverview} triageSummary={triageSummary} />
          </div>
          <div className="lg:col-span-1">
            <EventCalendar events={marketContext?.upcomingEvents || []} />
          </div>
        </div>
      ) : (
        <div className="py-32 text-center glass-3d rounded-[3rem] border border-white/10 border-dashed">
          <Activity className="w-16 h-16 text-white/10 mx-auto mb-6" />
          <p className="text-white/30 font-bold">시장 데이터를 불러올 수 없습니다. 다시 시도해 주세요.</p>
        </div>
      )}

      {/* 거시 인텔리전스 대시보드 */}
      <div>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-3 h-10 bg-purple-600 rounded-full shadow-[0_0_20px_rgba(147,51,234,0.5)]" />
          <div>
            <h2 className="text-2xl font-black text-white tracking-tight uppercase">거시 인텔리전스</h2>
            <p className="text-xs font-bold text-white/30 uppercase tracking-[0.2em]">Gate 0 · Macro Intelligence Dashboard</p>
          </div>
          {!macroEnv && (
            <span className="ml-auto text-[10px] font-black text-amber-400/70 uppercase tracking-widest animate-pulse">
              데이터 수집 중...
            </span>
          )}
          {macroEnv && gate0Result && (
            <span className={`ml-auto text-[10px] font-black uppercase tracking-widest ${gate0Result.buyingHalted ? 'text-red-400' : gate0Result.mhsLevel === 'HIGH' ? 'text-green-400' : 'text-amber-400'}`}>
              MHS {gate0Result.macroHealthScore} · {gate0Result.mhsLevel === 'HIGH' ? '정상 매수' : gate0Result.mhsLevel === 'MEDIUM' ? 'Kelly 축소' : '매수 중단'}
            </span>
          )}
        </div>
        <MacroIntelligenceDashboard
          gate0Result={gate0Result}
          currentRoeType={currentRoeType}
          externalRegime={extendedRegimeData ?? economicRegimeData ?? undefined}
          marketOverview={marketOverview ? {
            sectorRotation: (marketOverview.sectorRotation?.topSectors || []).map((s: any) => ({
              sector: s.sector || s.name || '',
              momentum: s.strength ?? s.momentum ?? 0,
              flow: s.flow || 'NEUTRAL',
            })),
            globalEtfMonitoring: (marketOverview.globalEtfMonitoring || []).map((e: any) => ({
              name: e.name || e.ticker || '',
              flow: e.flow || 'NEUTRAL',
              change: e.priceChange ?? e.change ?? 0,
            })),
            exchangeRates: (marketOverview.exchangeRates || []).map((r: any) => ({
              name: r.name || r.currency || '',
              value: r.value ?? r.rate ?? 0,
              change: r.change ?? 0,
            })),
          } : undefined}
          externalSupplyChain={supplyChainData ?? undefined}
          externalSectorOrders={sectorOrderData ?? undefined}
          externalFsi={financialStressData ?? undefined}
          externalFomcSentiment={fomcSentimentData ?? undefined}
        />
      </div>

      {/* MHS 히스토리 차트 */}
      <MHSHistoryChart records={mhsHistory} height={280} />

      {/* 글로벌 인텔리전스 통합 레이더 */}
      <IntelligenceRadar
        gate0={gate0Result}
        smartMoney={smartMoneyData}
        exportMomentum={exportMomentumData}
        geoRisk={geoRiskData}
        creditSpread={creditSpreadData}
        correlation={globalCorrelation}
        supplyChain={supplyChainData}
        sectorOrders={sectorOrderData}
        fsi={financialStressData}
        fomcSentiment={fomcSentimentData}
      />
    </motion.div>
  );
}
