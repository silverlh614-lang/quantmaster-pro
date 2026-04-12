import React, { useMemo, useRef, useEffect } from 'react';
import { RefreshCw, Download, X, CheckCircle2, Sparkles, Radar, CheckSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Radar as RechartsRadar, RadarChart, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer
} from 'recharts';
import { cn } from '../ui/cn';
import { QuantDashboard } from './QuantDashboard';
import { CandleChart } from './CandleChart';
import { AnalysisViewToggle, AnalysisViewButtons } from './AnalysisViewToggle';
import { evaluateStock } from '../services/quant/gateEngine';
import { useGlobalIntelStore, useMarketStore, useRecommendationStore, useSettingsStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import { buildShadowTrade } from '../services/autoTrading';
import { MASTER_CHECKLIST_STEPS } from '../constants/checklist';
import type { StockRecommendation } from '../services/stockService';
import type { ChecklistKey } from '../types/quant';
import { CHECKLIST_KEY_TO_CONDITION_ID } from '../types/quant';
import { debugLog, debugWarn } from '../utils/debug';

// Sub-components
import { ModalHeader } from './DeepAnalysisModal/ModalHeader';
import { MarketPositionSection } from './DeepAnalysisModal/MarketPositionSection';
import { AIIntelligenceSection } from './DeepAnalysisModal/AIIntelligenceSection';
import { GateFilterSection } from './DeepAnalysisModal/GateFilterSection';
import { SellChecklistSection } from './DeepAnalysisModal/SellChecklistSection';
import { SectorAnalysisSection } from './DeepAnalysisModal/SectorAnalysisSection';
import { TechnicalAnalysisColumn } from './DeepAnalysisModal/TechnicalAnalysisColumn';
import { FundamentalsColumn } from './DeepAnalysisModal/FundamentalsColumn';
import { SentimentSection } from './DeepAnalysisModal/SentimentSection';
import { RiskChecklistSection } from './DeepAnalysisModal/RiskChecklistSection';
import { ModalFooter } from './DeepAnalysisModal/ModalFooter';

interface DeepAnalysisModalProps {
  stock: StockRecommendation | null;
  onClose: () => void;
  analysisReportRef: React.RefObject<HTMLDivElement | null>;
  weeklyRsiValues: number[];
  onExportPDF: () => Promise<void>;
  isExporting: boolean;
}

export function DeepAnalysisModal({ stock, onClose, analysisReportRef, weeklyRsiValues, onExportPDF, isExporting }: DeepAnalysisModalProps) {
  if (!stock) {
    debugWarn('DeepAnalysisModal: stock is null - modal will not render');
  } else {
    debugLog('DeepAnalysisModal OPEN', { name: stock.name, code: stock.code });
  }

  const globalIntelStore = useGlobalIntelStore();
  const macroEnv = globalIntelStore.macroEnv;
  const exportRatio = globalIntelStore.exportRatio;
  const currentRoeType = globalIntelStore.currentRoeType;
  const economicRegimeData = globalIntelStore.economicRegimeData;
  const extendedRegimeData = globalIntelStore.extendedRegimeData;
  const smartMoneyData = globalIntelStore.smartMoneyData;
  const exportMomentumData = globalIntelStore.exportMomentumData;
  const geoRiskData = globalIntelStore.geoRiskData;
  const creditSpreadData = globalIntelStore.creditSpreadData;
  const globalCorrelation = globalIntelStore.globalCorrelation;
  const newsFrequencyScores = globalIntelStore.newsFrequencyScores;
  const supplyChainData = globalIntelStore.supplyChainData;
  const financialStressData = globalIntelStore.financialStressData;
  const { marketOverview } = useMarketStore();
  const { watchlist, setWatchlist } = useRecommendationStore();
  const { setView } = useSettingsStore();
  const { addShadowTrade } = useShadowTradeStore();

  const kisBalance = 100_000_000;

  const deepAnalysisGateSignals = useMemo(() => {
    if (!stock) return [];
    if (stock.type === 'STRONG_BUY' || stock.type === 'BUY') {
      return [{ time: new Date().toISOString().split('T')[0], type: stock.type === 'STRONG_BUY' ? 'STRONG_BUY' as const : 'BUY' as const, label: stock.type }];
    }
    return [];
  }, [stock?.code, stock?.type]);

  const getRadarData = (s: StockRecommendation) => {
    const categories = [
      { name: '기본적 분석', keys: ['roeType3', 'earningsSurprise', 'performanceReality', 'ocfQuality', 'marginAcceleration', 'interestCoverage', 'economicMoatVerified'] },
      { name: '기술적 분석', keys: ['momentumRanking', 'ichimokuBreakout', 'technicalGoldenCross', 'volumeSurgeVerified', 'turtleBreakout', 'fibonacciLevel', 'elliottWaveVerified', 'vcpPattern', 'divergenceCheck'] },
      { name: '수급 분석', keys: ['supplyInflow', 'institutionalBuying', 'consensusTarget'] },
      { name: '시장 주도력', keys: ['cycleVerified', 'riskOnEnvironment', 'notPreviousLeader', 'policyAlignment'] },
      { name: '전략/심리', keys: ['mechanicalStop', 'psychologicalObjectivity', 'catalystAnalysis'] }
    ];
    return categories.map(cat => {
      const passed = cat.keys.filter(key => s.checklist ? s.checklist[key as keyof StockRecommendation['checklist']] : 0).length;
      const total = cat.keys.length;
      return { subject: cat.name, A: Math.round((passed / total) * 100), fullMark: 100 };
    });
  };

  const canCloseRef = useRef(false);
  useEffect(() => {
    if (!stock) { canCloseRef.current = false; return; }
    const timer = setTimeout(() => { canCloseRef.current = true; }, 300);
    return () => { clearTimeout(timer); canCloseRef.current = false; };
  }, [stock?.code]);

  return (
    <AnimatePresence>
      {stock && (
        <motion.div
          key="deep-analysis-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex items-center justify-center p-4 md:p-6 bg-black/90 backdrop-blur-md"
          onClick={(e: React.MouseEvent) => {
            if (e.target === e.currentTarget && canCloseRef.current) onClose();
          }}
        >
          <motion.div
            key="deep-analysis-content"
            ref={analysisReportRef}
            initial={{ scale: 0.95, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 30 }}
            className="glass-3d rounded-[3rem] w-full max-w-[1600px] max-h-[94vh] border border-white/10 shadow-2xl overflow-hidden relative flex flex-col print-section"
            onClick={e => e.stopPropagation()}
          >
            <AnalysisViewToggle>
            {(analysisView, setAnalysisView) => (<>
            {/* Action Buttons - Absolute Positioned */}
            <div className="absolute top-6 right-6 z-[160] flex items-center gap-3 no-print">
              <AnalysisViewButtons analysisView={analysisView} setAnalysisView={setAnalysisView} />
              <button
                onClick={onExportPDF}
                disabled={isExporting}
                className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center hover:bg-blue-500 transition-all group active:scale-90 border border-white/10 backdrop-blur-md shadow-2xl"
                title="PDF 리포트 저장"
              >
                {isExporting ? (
                  <RefreshCw className="w-6 h-6 text-white/50 animate-spin" />
                ) : (
                  <Download className="w-6 h-6 text-white/50 group-hover:text-white transition-colors" />
                )}
              </button>
              <button
                onClick={() => onClose()}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 transition-all group active:scale-90 border border-white/10 backdrop-blur-md shadow-2xl"
                title="닫기"
              >
                <span className="text-[10px] font-black uppercase tracking-widest text-white/40 group-hover:text-white transition-colors">Close</span>
                <X className="w-6 h-6 text-white/50 group-hover:text-white transition-colors" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar">
              {analysisView === 'QUANT' ? (
                <QuantDashboard result={evaluateStock(
                  Object.fromEntries(
                    MASTER_CHECKLIST_STEPS.map(step => [
                      CHECKLIST_KEY_TO_CONDITION_ID[step.key as ChecklistKey],
                      stock?.checklist?.[step.key as keyof typeof stock.checklist] ? 10 : 0
                    ])
                  ) as Record<number, number>,
                  {
                    type: (['BULL', 'RISK_ON'].includes(stock.aiConvictionScore?.marketPhase || '') ? '상승초기' :
                           ['BEAR', 'RISK_OFF'].includes(stock.aiConvictionScore?.marketPhase || '') ? '하락' :
                           stock.aiConvictionScore?.marketPhase === 'SIDEWAYS' ? '횡보' : '변동성'),
                    weightMultipliers: marketOverview?.dynamicWeights || {},
                    vKospi: stock.marketSentiment?.vkospi || 15,
                    samsungIri: stock.marketSentiment?.iri || 3.5
                  },
                  stock.marketCapCategory === 'LARGE' ? 'A' : 'B',
                  {
                    name: stock.relatedSectors?.[0] || 'Unknown',
                    rank: 1,
                    strength: stock.confidenceScore || 0,
                    isLeading: stock.isSectorTopPick || false,
                    sectorLeaderNewHigh: stock.sectorLeaderNewHigh || false
                  },
                  0, // euphoriaSignals
                  false, // emergencyStop
                  stock.currentPrice > 0 && stock.stopLoss > 0 && stock.targetPrice > stock.currentPrice
                    ? (stock.targetPrice - stock.currentPrice) / (stock.currentPrice - stock.stopLoss)
                    : 2.1,
                  (stock.sellSignals || []).map((_, i) => i),
                  stock.multiTimeframe,
                  stock.enemyChecklist,
                  stock.seasonality,
                  stock.attribution,
                  stock.isPullbackVolumeLow || false,
                  macroEnv ?? undefined,
                  exportRatio,
                  {
                    smartMoney: smartMoneyData ?? undefined,
                    exportMomentum: exportMomentumData ?? undefined,
                    geoRisk: geoRiskData ?? undefined,
                    creditSpread: creditSpreadData ?? undefined,
                    economicRegime: extendedRegimeData?.regime ?? economicRegimeData?.regime,
                    supplyChain: supplyChainData ?? undefined,
                    financialStress: financialStressData ?? undefined,
                    newsPhase: (newsFrequencyScores.find((n: any) => n.code === stock.code)?.phase) as any ?? undefined,
                    catalystDescription: stock.reason,
                    weeklyRsiValues: weeklyRsiValues.length > 0 ? weeklyRsiValues : undefined,
                    institutionalAmounts: stock.supplyData?.institutionalDailyAmounts ?? undefined,
                  },
                  {
                    kospi60dVolatility: extendedRegimeData?.uncertaintyMetrics?.kospi60dVolatility,
                    leadingSectorCount: extendedRegimeData?.uncertaintyMetrics?.leadingSectorCount,
                    foreignFlowDirection: extendedRegimeData?.uncertaintyMetrics?.foreignFlowDirection,
                    kospiSp500Correlation: globalCorrelation?.kospiSp500,
                    financialStress: financialStressData ?? undefined,
                  },
                  stock.relatedSectors?.[0],
                )}
                economicRegime={extendedRegimeData ?? economicRegimeData ?? undefined}
                currentRoeType={currentRoeType}
                marketOverview={marketOverview}
                stockCode={stock?.code}
                stockName={stock?.name}
                currentPrice={stock?.currentPrice}
                onShadowTrade={(code, name, price) => {
                  const totalAssets = kisBalance;
                  const mockSignal = {
                    positionSize: stock?.confidenceScore && stock.confidenceScore >= 80 ? 20 : 10,
                    rrr: 2,
                    lastTrigger: stock?.type === 'STRONG_BUY',
                    recommendation: stock?.type === 'STRONG_BUY' ? '풀 포지션' : '절반 포지션',
                    profile: { stopLoss: -8 },
                  } as any;
                  const trade = buildShadowTrade(mockSignal, code, name, price, totalAssets);
                  addShadowTrade(trade);
                  setView('AUTO_TRADE');
                }}
              />
              ) : (
                <>
                  <ModalHeader stock={stock} />

                  {/* AI 분석결과 요약 */}
                  <div className="mb-8 p-6 sm:p-8 rounded-[2rem] bg-orange-500/5 border border-orange-500/10 relative overflow-hidden">
                    <div className="flex items-center gap-3 mb-4">
                      <Sparkles className="w-4 h-4 text-orange-500" />
                      <span className="text-xs font-black text-white/40 uppercase tracking-[0.25em]">AI 분석결과 요약</span>
                    </div>
                    <p className="text-white/90 text-sm sm:text-base lg:text-lg leading-relaxed font-bold tracking-tight break-words">
                      {stock.reason}
                    </p>
                  </div>

                  {/* Candle Chart with Technical Overlays */}
                  <div className="mb-10">
                    <CandleChart
                      stockCode={stock.code}
                      stockName={stock.name}
                      gateSignals={deepAnalysisGateSignals}
                      height={480}
                    />
                  </div>

                  {/* Radar Chart & Checklist Overview */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-10 mb-12">
                    <div className="glass-3d rounded-[3rem] p-10 border border-white/10 flex flex-col items-center justify-center min-h-[500px]">
                      <div className="w-full flex items-center justify-between mb-10">
                        <div className="flex items-center gap-4">
                          <Radar className="w-6 h-6 text-orange-500" />
                          <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">27단계 마스터 분석 레이더</span>
                        </div>
                        <div className="px-4 py-2 bg-orange-500/10 rounded-xl border border-orange-500/20">
                          <span className="text-xs font-black text-orange-500">{Object.values(stock?.checklist || {}).filter(Boolean).length} / 27 Passed</span>
                        </div>
                      </div>

                      <div className="w-full h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={getRadarData(stock)}>
                            <PolarGrid stroke="rgba(255,255,255,0.1)" />
                            <PolarAngleAxis
                              dataKey="subject"
                              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 900 }}
                            />
                            <PolarRadiusAxis
                              angle={30}
                              domain={[0, 100]}
                              tick={false}
                              axisLine={false}
                            />
                            <RechartsRadar
                              name={stock.name}
                              dataKey="A"
                              stroke="#f97316"
                              fill="#f97316"
                              fillOpacity={0.5}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="glass-3d rounded-[3rem] p-10 border border-white/10">
                      <div className="flex items-center gap-4 mb-10">
                        <CheckSquare className="w-6 h-6 text-green-400" />
                        <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">핵심 체크리스트 현황</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {[
                          { label: '성장성 (Growth)', keys: ['roeType3', 'earningsSurprise', 'performanceReality', 'ocfQuality', 'marginAcceleration'] },
                          { label: '기술적 분석 (Technical)', keys: ['momentumRanking', 'ichimokuBreakout', 'technicalGoldenCross', 'volumeSurgeVerified', 'turtleBreakout'] },
                          { label: '수급 (Supply)', keys: ['supplyInflow', 'institutionalBuying', 'consensusTarget'] },
                          { label: '시장 주도력 (Market)', keys: ['cycleVerified', 'riskOnEnvironment', 'notPreviousLeader', 'policyAlignment'] },
                        ].map((group, gIdx) => (
                          <div key={gIdx} className="space-y-3">
                            <h5 className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-4 border-b border-white/5 pb-2">{group.label}</h5>
                            {group.keys.map(key => {
                              const step = MASTER_CHECKLIST_STEPS.find(s => s.key === key);
                              const isPassed = stock.checklist?.[key as keyof StockRecommendation['checklist']];
                              return (
                                <div key={key} className="flex items-center gap-3">
                                  <div className={cn(
                                    "w-5 h-5 rounded-lg flex items-center justify-center border transition-all",
                                    isPassed ? "bg-green-500/20 border-green-500/30" : "bg-white/5 border-white/10 opacity-30"
                                  )}>
                                    {isPassed && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                                  </div>
                                  <span className={cn(
                                    "text-xs font-bold transition-colors",
                                    isPassed ? "text-white/80" : "text-white/20"
                                  )}>
                                    {step?.title.split(' (')[0]}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <MarketPositionSection stock={stock} />

                  <AIIntelligenceSection stock={stock} />

                  {stock.gateEvaluation && <GateFilterSection stock={stock} />}

                  {stock.sellSignals && stock.sellSignals.length > 0 && <SellChecklistSection stock={stock} />}

                  {stock.sectorAnalysis && <SectorAnalysisSection stock={stock} />}

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-7 space-y-6">
                      <TechnicalAnalysisColumn stock={stock} />
                    </div>
                    <div className="lg:col-span-5 space-y-6">
                      <FundamentalsColumn stock={stock} />
                    </div>
                    <SentimentSection stock={stock} />
                    <RiskChecklistSection stock={stock} />
                  </div>
                </>
              )}
            </div>
            </>)}
            </AnalysisViewToggle>

            <ModalFooter
              stock={stock}
              onClose={onClose}
              watchlist={watchlist}
              setWatchlist={setWatchlist}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
