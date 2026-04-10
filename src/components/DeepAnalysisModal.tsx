import React, { useMemo, useRef, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, Search, RefreshCw, BarChart3, Info,
  ChevronRight, ExternalLink, Target, CheckCircle2, AlertTriangle,
  Zap, Star, Bookmark, ChevronDown, ChevronUp, History, ArrowUpRight,
  ArrowDownRight, ShieldCheck, Lightbulb, X, Shield, Cloud, Activity,
  ArrowUpCircle, XCircle, DollarSign, Download, Award, FileText,
  Clock, Globe, Brain, Sparkles, Newspaper, Radar, Copy, Wallet,
  Percent, Maximize2, ArrowRightLeft, ShieldAlert, Flame, Crown,
  CheckSquare, Hash, Layers, AlertCircle, Users, Minus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Radar as RechartsRadar, RadarChart, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { QuantDashboard } from './QuantDashboard';
import { ConfidenceBadge } from './ConfidenceBadge';
import { CandleChart } from './CandleChart';
import { AnalysisViewToggle, AnalysisViewButtons } from './AnalysisViewToggle';
import { evaluateStock, evaluateGate0 } from '../services/quantEngine';
import { useGlobalIntelStore, useMarketStore, useAnalysisStore, useRecommendationStore, useSettingsStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import { buildShadowTrade } from '../services/autoTrading';
import { MASTER_CHECKLIST_STEPS, SELL_CHECKLIST_STEPS, getMarketPhaseInfo } from '../constants/checklist';
import type { StockRecommendation } from '../services/stockService';
import type { Gate0Result, ChecklistKey } from '../types/quant';
import { CHECKLIST_KEY_TO_CONDITION_ID } from '../types/quant';
import { debugLog, debugWarn } from '../utils/debug';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


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

  // KIS 잔고 기본값 (App.tsx에서 조회하지만 DeepAnalysisModal에서는 기본값 사용)
  const kisBalance = 100_000_000;

  const gate0Result = useMemo(() => macroEnv ? evaluateGate0(macroEnv) : undefined, [macroEnv]);

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

  // Prevent ghost clicks from immediately closing the modal on mobile
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
                      // 판단엔진 고도화 입력: 뉴스 빈도 → 사이클 위치
                      newsPhase: (newsFrequencyScores.find((n: any) => n.code === stock.code)?.phase) as any ?? undefined,
                      // 촉매 설명 텍스트 → 촉매 등급 A/B/C
                      catalystDescription: stock.reason,
                      // Gap 2a: 주봉 RSI 3주 추이
                      weeklyRsiValues: weeklyRsiValues.length > 0 ? weeklyRsiValues : undefined,
                      // Gap 2b: 기관 일별 순매수 수량 시계열 (supplyData에서 추출)
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
                    {/* Modal Header Area */}
                    <div className="mb-10 flex flex-col lg:flex-row lg:items-end justify-between gap-8">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 sm:gap-4 flex-wrap min-w-0">
                      <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tighter text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.1)] break-words max-w-full leading-tight">
                        {stock.name}
                      </h2>
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <span className="text-xs sm:text-sm font-black text-white/60 bg-white/10 px-4 py-2 rounded-2xl border border-white/20 tracking-[0.2em] uppercase shadow-2xl backdrop-blur-xl">
                          {stock.code}
                        </span>
                        {stock.isSectorTopPick && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-xl shadow-lg">
                            <Award className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Sector Top Pick</span>
                          </div>
                        )}
                        {stock.aiConvictionScore?.marketPhase && (
                          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                            <div className={cn(
                              "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border backdrop-blur-md shadow-lg flex items-center gap-2 whitespace-nowrap shrink-0",
                              stock.aiConvictionScore.marketPhase === 'RISK_ON' || stock.aiConvictionScore.marketPhase === 'BULL' ? "bg-green-500/20 text-green-400 border-green-500/30" :
                              stock.aiConvictionScore.marketPhase === 'RISK_OFF' || stock.aiConvictionScore.marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400 border-red-500/30" : 
                              stock.aiConvictionScore.marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                              stock.aiConvictionScore.marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
                              "bg-white/10 text-white/40 border-white/10"
                            )} title={getMarketPhaseInfo(stock.aiConvictionScore.marketPhase).description}>
                              {getMarketPhaseInfo(stock.aiConvictionScore.marketPhase).label}
                              <Info className="w-3 h-3 opacity-50" />
                            </div>
                            <a 
                              href={(() => {
                                const cleanCode = String(stock.code).replace(/[^0-9]/g, '');
                                return cleanCode.length === 6
                                  ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
                                  : `https://search.naver.com/search.naver?query=${encodeURIComponent(stock.name)}+주가`;
                              })()}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-orange-500 hover:text-white border border-white/10 rounded-xl transition-all group/link shadow-lg active:scale-95"
                            >
                              <span className="text-[10px] font-black uppercase tracking-widest">Chart</span>
                              <ExternalLink className="w-3 h-3 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="h-1.5 w-24 bg-gradient-to-r from-orange-500 via-orange-500/50 to-transparent rounded-full" />
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                        <span className="text-[11px] font-black text-orange-500 uppercase tracking-[0.4em]">Institutional Grade AI Analysis</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Quick Stats in Header */}
                  <div className="flex items-center gap-4 sm:gap-8 bg-white/[0.03] p-4 sm:p-6 rounded-[2rem] sm:rounded-[2.5rem] border border-white/10 backdrop-blur-xl shadow-2xl flex-wrap lg:flex-nowrap justify-center lg:justify-start">
                    <div className="flex flex-col min-w-fit">
                      <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 sm:mb-2">Current Price</span>
                      <div className="flex flex-col">
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl sm:text-3xl font-black text-white tracking-tighter">₩{stock.currentPrice?.toLocaleString() || '0'}</span>
                          <span className="text-[10px] font-bold text-white/20 uppercase">KRW</span>
                        </div>
                        {(stock.priceUpdatedAt || stock.dataSource) && (
                          <div className="text-[8px] font-black text-white/30 uppercase tracking-tighter mt-1">
                            {stock.priceUpdatedAt} {stock.dataSource && `via ${stock.dataSource}`}
                          </div>
                        )}
                        {stock.financialUpdatedAt && (
                          <div className="text-[8px] font-black text-blue-400/40 uppercase tracking-tighter mt-0.5 flex items-center gap-1">
                            <ShieldCheck className="w-2 h-2" />
                            DART: {stock.financialUpdatedAt}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="hidden sm:block w-px h-10 sm:h-12 bg-white/10" />
                    <div className="flex flex-col min-w-fit">
                      <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 sm:mb-2">Value / Momentum</span>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="flex flex-col items-center">
                          <span className="text-lg sm:text-xl font-black text-blue-400">{stock.scores?.value || 0}</span>
                          <span className="text-[7px] sm:text-[8px] font-black text-white/20 uppercase tracking-widest">VALUE</span>
                        </div>
                        <div className="w-px h-5 sm:h-6 bg-white/10" />
                        <div className="flex flex-col items-center">
                          <span className="text-lg sm:text-xl font-black text-orange-400">{stock.scores?.momentum || 0}</span>
                          <span className="text-[7px] sm:text-[8px] font-black text-white/20 uppercase tracking-widest">MOMENTUM</span>
                        </div>
                      </div>
                    </div>
                    <div className="hidden sm:block w-px h-10 sm:h-12 bg-white/10" />
                    <div className="flex flex-col min-w-fit">
                      <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 sm:mb-2">AI Conviction</span>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl sm:text-3xl font-black text-orange-500 tracking-tighter">{stock.aiConvictionScore?.totalScore || 0}</span>
                        <span className="text-[10px] font-bold text-white/20">/ 100</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI 분석결과 요약 - Moved from Card */}
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

                {/* Market Position Section */}
                <div className="mb-10">
                  <div className="flex items-center gap-3 mb-6 px-4">
                    <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
                    <h3 className="text-xl font-black text-white uppercase tracking-tighter">Market Position</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Momentum Rank</span>
                      <span className="text-3xl font-black text-blue-400">#{stock.momentumRank}</span>
                      <span className="text-[9px] font-bold text-white/40 mt-1">Top {Math.round((stock.momentumRank / 2500) * 100)}% of Market</span>
                    </div>
                    
                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Supply Quality</span>
                      <div className="flex gap-2">
                        <div className={cn("px-3 py-1 rounded-full text-[10px] font-black border", 
                          stock.supplyQuality?.active ? "bg-orange-500/20 text-orange-400 border-orange-500/30" : "bg-white/5 text-white/20 border-white/10")}>
                          ACTIVE
                        </div>
                        <div className={cn("px-3 py-1 rounded-full text-[10px] font-black border", 
                          stock.supplyQuality?.passive ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-white/5 text-white/20 border-white/10")}>
                          PASSIVE
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Sector Status</span>
                      <div className="flex flex-col items-center">
                        <span className={cn("text-sm font-black mb-1", stock.isLeadingSector ? "text-orange-400" : "text-white/40")}>
                          {stock.isLeadingSector ? "LEADING SECTOR" : "SECONDARY SECTOR"}
                        </span>
                        <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">
                          {stock.isPreviousLeader ? "PREVIOUS LEADER" : "NEW LEADER CANDIDATE"}
                        </span>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Peak Distance</span>
                      <div className="flex flex-col items-center">
                        <span className="text-xl font-black text-white">₩{stock.peakPrice?.toLocaleString()}</span>
                        <span className="text-[10px] font-black text-red-400 mt-1">
                          -{Math.round((1 - (stock.currentPrice / (stock.peakPrice || 1))) * 100)}% from Peak
                        </span>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Market Cap</span>
                      <span className="text-lg font-black text-white uppercase tracking-tight">{stock.marketCapCategory} CAP</span>
                      <span className="text-[9px] font-bold text-white/40 mt-1">₩{(stock.marketCap / 100000000).toFixed(1)}B</span>
                    </div>
                  </div>
                </div>



                {/* AI Advanced Intelligence Section */}
                <div className="mb-8">
                  <div className="flex items-center gap-3 mb-6 px-4">
                    <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
                    <h3 className="text-xl font-black text-white uppercase tracking-tighter">AI Advanced Intelligence</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {/* AI Conviction Score */}
                    <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
                        <Brain className="w-12 h-12 text-orange-500" />
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                          <Target className="w-5 h-5 text-orange-500" />
                        </div>
                        <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">AI Conviction Score</span>
                      </div>
                      <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-4xl font-black text-white tracking-tighter">{stock.aiConvictionScore?.totalScore || 0}</span>
                        <span className="text-sm font-bold text-white/20">/ 100</span>
                      </div>
                      <div className="bg-orange-500/10 p-3 rounded-xl border border-orange-500/20 mb-4">
                        <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest block mb-1">Market Context Weighting</span>
                        <p className="text-[11px] text-orange-400/80 font-bold leading-tight">
                          {stock.aiConvictionScore?.description}
                        </p>
                      </div>
                      <div className="space-y-2 mb-4">
                        {(stock.aiConvictionScore?.factors || []).map((f, i) => (
                          <div key={i} className="flex items-center justify-between text-[10px]">
                            <span className="text-white/40 font-bold">{f.name}</span>
                            <div className="flex items-center gap-2 flex-1 mx-4">
                              <div className="h-1 bg-white/5 flex-1 rounded-full overflow-hidden">
                                <div className="h-full bg-orange-500/50" style={{ width: `${f.score}%` }} />
                              </div>
                            </div>
                            <span className="text-white/60 font-black">{f.score}</span>
                          </div>
                        ))}
                      </div>
                      <div className="pt-4 border-t border-white/5">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className={cn(
                            "px-2 py-0.5 rounded text-[8px] font-black uppercase",
                            stock.aiConvictionScore?.marketPhase === 'RISK_ON' || stock.aiConvictionScore?.marketPhase === 'BULL' ? "bg-green-500/20 text-green-400" :
                            stock.aiConvictionScore?.marketPhase === 'RISK_OFF' || stock.aiConvictionScore?.marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400" : 
                            stock.aiConvictionScore?.marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400" :
                            stock.aiConvictionScore?.marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400" :
                            "bg-white/10 text-white/40"
                          )}>
                            {getMarketPhaseInfo(stock.aiConvictionScore?.marketPhase).label}
                          </div>
                          <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Phase Analysis</span>
                        </div>
                        
                        <div className="bg-white/5 rounded-xl p-3 border border-white/5 mb-3">
                          <div className="flex items-center gap-2 mb-1">
                            <Lightbulb className="w-3 h-3 text-yellow-500" />
                            <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Recommendation</span>
                          </div>
                          <p className="text-[11px] text-white/80 font-bold leading-relaxed">
                            {getMarketPhaseInfo(stock.aiConvictionScore?.marketPhase).recommendation}
                          </p>
                        </div>

                        <p className="text-[11px] text-white/40 leading-relaxed font-medium italic break-words">
                          {stock.aiConvictionScore?.description}
                        </p>
                      </div>
                    </div>

                    {/* Catalyst Analysis */}
                    <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
                        <Zap className="w-12 h-12 text-orange-500" />
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                          <Flame className="w-5 h-5 text-orange-500" />
                        </div>
                        <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Catalyst Analysis</span>
                      </div>
                      <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-4xl font-black text-white tracking-tighter">{stock.catalystDetail?.score || 0}</span>
                        <span className="text-sm font-bold text-white/20">/ 20 bonus</span>
                        {stock.catalystSummary && (
                          <span className="ml-auto px-3 py-1 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-[10px] font-black text-yellow-500 uppercase tracking-widest">
                            {stock.catalystSummary}
                          </span>
                        )}
                      </div>
                      <div className="space-y-4">
                        <div>
                          <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-2">Key Catalyst</span>
                          <p className="text-xs text-white/70 font-bold leading-relaxed">
                            {stock.catalystDetail?.description || '발굴된 촉매제가 없습니다.'}
                          </p>
                        </div>
                        {stock.catalystDetail?.upcomingEvents && stock.catalystDetail.upcomingEvents.length > 0 && (
                          <div>
                            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-2">Upcoming Events</span>
                            <div className="space-y-1.5">
                              {(stock.catalystDetail?.upcomingEvents || []).map((event, i) => (
                                <div key={i} className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
                                  <Clock className="w-3 h-3 text-orange-500" />
                                  <span className="text-[10px] font-bold text-white/60">{event}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Visual Report Summary */}
                    <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
                        <FileText className="w-12 h-12 text-orange-500" />
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                          <CheckCircle2 className="w-5 h-5 text-orange-500" />
                        </div>
                        <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Visual Report</span>
                      </div>
                      <div className="grid grid-cols-1 gap-3 mb-4">
                        {[
                          { label: 'Financial', grade: stock.visualReport?.financial, color: 'text-blue-400' },
                          { label: 'Technical', grade: stock.visualReport?.technical, color: 'text-orange-400' },
                          { label: 'Supply', grade: stock.visualReport?.supply, color: 'text-green-400' }
                        ].map((item, i) => (
                          <div key={i} className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">{item.label}</span>
                            <div className="flex items-center gap-2">
                              <div className="flex gap-0.5">
                                {[1, 2, 3, 4, 5].map(star => (
                                  <Star 
                                    key={star} 
                                    className={cn(
                                      "w-2.5 h-2.5", 
                                      star <= (6 - (item.grade || 5)) ? item.color + " fill-current" : "text-white/10"
                                    )} 
                                  />
                                ))}
                              </div>
                              <span className={cn("text-xs font-black", item.color)}>{item.grade}등급</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                        <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">AI Verdict</span>
                        <p className="text-[11px] text-white/70 font-bold leading-tight italic">
                          "{stock.visualReport?.summary}"
                        </p>
                      </div>
                    </div>

                    {/* KIS 실시간 수급 카드 */}
                    {stock.supplyData && (
                      <div className="glass-3d rounded-[2.5rem] p-8 border border-white/10 mb-6">
                        <div className="flex items-center gap-3 mb-6">
                          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                            <TrendingUp className="w-5 h-5 text-blue-400" />
                          </div>
                          <div>
                            <span className="text-[10px] font-black text-blue-400/60 uppercase tracking-widest block">KIS 실계산</span>
                            <h3 className="text-sm font-black text-white uppercase tracking-tight">외국인 / 기관 수급</h3>
                          </div>
                          <span className="ml-auto text-[9px] font-black text-blue-400/50 bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/20 uppercase tracking-widest">
                            실데이터
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">외국인 5일 순매수</span>
                            <span className={cn(
                              "text-xl font-black",
                              stock.supplyData.foreignNet > 0 ? "text-red-400" : "text-blue-400"
                            )}>
                              {stock.supplyData.foreignNet > 0 ? '+' : ''}
                              {stock.supplyData.foreignNet.toLocaleString()}주
                            </span>
                            <span className="text-[10px] text-white/30 block mt-1">
                              연속 {stock.supplyData.foreignConsecutive}일 순매수
                            </span>
                          </div>
                          <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">기관 5일 순매수</span>
                            <span className={cn(
                              "text-xl font-black",
                              stock.supplyData.institutionNet > 0 ? "text-red-400" : "text-blue-400"
                            )}>
                              {stock.supplyData.institutionNet > 0 ? '+' : ''}
                              {stock.supplyData.institutionNet.toLocaleString()}주
                            </span>
                            <span className="text-[10px] text-white/30 block mt-1">
                              {stock.supplyData.individualNet < 0 ? '개인 매도' : '개인 매수'} 동반
                            </span>
                          </div>
                        </div>

                        <div className={cn(
                          "p-4 rounded-2xl border",
                          stock.supplyData.isPassiveAndActive
                            ? "bg-red-500/10 border-red-500/20"
                            : "bg-white/5 border-white/10"
                        )}>
                          <div className="flex items-center gap-2">
                            {stock.supplyData.isPassiveAndActive
                              ? <Zap className="w-4 h-4 text-red-400 fill-current" />
                              : <Info className="w-4 h-4 text-white/30" />
                            }
                            <span className={cn(
                              "text-xs font-black uppercase tracking-widest",
                              stock.supplyData.isPassiveAndActive ? "text-red-400" : "text-white/30"
                            )}>
                              {stock.supplyData.isPassiveAndActive
                                ? 'P+A 동반매수 — 가장 강한 수급 신호'
                                : '단일 주체 매수 — 수급 신호 보통'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Short Selling */}
                    <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
                        <TrendingDown className="w-12 h-12 text-red-500" />
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
                          <TrendingDown className="w-5 h-5 text-red-500" />
                        </div>
                        <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Short Selling</span>
                      </div>
                      {stock.shortSelling ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/10">
                            <div>
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">공매도 비율</span>
                              <span className="text-2xl font-black text-white">{stock.shortSelling.ratio}%</span>
                            </div>
                            <div className={cn("flex items-center gap-2 font-black",
                              stock.shortSelling.trend === 'DECREASING' ? "text-green-400" : "text-red-400"
                            )}>
                              {stock.shortSelling.trend === 'DECREASING'
                                ? <ArrowDownRight className="w-5 h-5" />
                                : <ArrowUpRight className="w-5 h-5" />}
                              <span className="text-sm">{stock.shortSelling.trend}</span>
                            </div>
                          </div>
                          <div className="bg-orange-500/10 p-4 rounded-2xl border border-orange-500/20">
                            <p className="text-[11px] text-orange-400/90 font-bold leading-relaxed">
                              {stock.shortSelling.implication}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-white/20">
                          <Info className="w-8 h-8 mb-3 opacity-20" />
                          <p className="text-xs font-black uppercase tracking-widest">데이터 분석 중...</p>
                        </div>
                      )}
                    </div>

                    {/* Tenbagger DNA */}
                    <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
                        <Sparkles className="w-12 h-12 text-blue-400" />
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                          <Sparkles className="w-5 h-5 text-blue-400" />
                        </div>
                        <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Tenbagger DNA</span>
                      </div>
                      {stock.tenbaggerDNA ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/10">
                            <div>
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">매칭 패턴</span>
                              <span className="text-sm font-black text-white">{stock.tenbaggerDNA.matchPattern}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">유사도</span>
                              <span className="text-2xl font-black text-blue-400">{stock.tenbaggerDNA.similarity}%</span>
                            </div>
                          </div>
                          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${stock.tenbaggerDNA.similarity}%` }}
                              className="h-full bg-gradient-to-r from-blue-600 to-blue-400"
                            />
                          </div>
                          <div className="bg-blue-500/10 p-4 rounded-2xl border border-blue-500/20">
                            <p className="text-[11px] text-blue-400/90 font-bold leading-relaxed">
                              {stock.tenbaggerDNA.reason}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-8 text-white/20">
                          <Info className="w-8 h-8 mb-3 opacity-20" />
                          <p className="text-xs font-black uppercase tracking-widest">패턴 분석 중...</p>
                        </div>
                      )}
                    </div>

                    {/* Historical Analogy */}
                    <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
                        <History className="w-12 h-12 text-blue-500" />
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                          <History className="w-5 h-5 text-blue-500" />
                        </div>
                        <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Historical Analogy</span>
                      </div>
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg font-black text-blue-400">{stock.historicalAnalogy?.stockName}</span>
                          <span className="text-xs font-bold text-white/30">({stock.historicalAnalogy?.period})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500" style={{ width: `${stock.historicalAnalogy?.similarity}%` }} />
                          </div>
                          <span className="text-xs font-black text-blue-400">{stock.historicalAnalogy?.similarity}%</span>
                        </div>
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Similarity Match</span>
                      </div>
                      <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
                        {stock.historicalAnalogy?.reason}
                      </p>
                    </div>

                    {/* Anomaly Detection */}
                    <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
                        <Radar className="w-12 h-12 text-purple-500" />
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                          <Radar className="w-5 h-5 text-purple-500" />
                        </div>
                        <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Anomaly Detection</span>
                      </div>
                      <div className="mb-4">
                        <div className={cn(
                          "inline-block px-3 py-1 rounded-full text-[10px] font-black mb-3 border",
                          stock.anomalyDetection?.type === 'FUNDAMENTAL_DIVERGENCE' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
                          stock.anomalyDetection?.type === 'SMART_MONEY_ACCUMULATION' ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                          "bg-white/5 text-white/30 border-white/10"
                        )}>
                          {stock.anomalyDetection?.type?.replace('_', ' ') || 'NONE DETECTED'}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-black text-white tracking-tighter">{stock.anomalyDetection?.score || 0}</span>
                          <span className="text-[10px] font-bold text-white/20 uppercase">Intensity</span>
                        </div>
                      </div>
                      <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
                        {stock.anomalyDetection?.description}
                      </p>
                    </div>

                    {/* Semantic Mapping */}
                    <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/ai-card">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
                        <Hash className="w-12 h-12 text-emerald-500" />
                      </div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                          <Hash className="w-5 h-5 text-emerald-500" />
                        </div>
                        <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Semantic Mapping</span>
                      </div>
                      <div className="mb-4">
                        <span className="text-sm font-black text-emerald-400 block mb-2">{stock.semanticMapping?.theme}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {(stock.semanticMapping?.keywords || []).map((k, i) => (
                            <span key={i} className="text-[9px] font-black px-2 py-0.5 bg-emerald-500/10 text-emerald-400/70 rounded-md border border-emerald-500/20">
                              #{k}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
                        {stock.semanticMapping?.description}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 3-Gate Filter Evaluation */}
                {stock.gateEvaluation && (
                  <div className="mb-10">
                    <div className="flex items-center justify-between mb-6 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
                        <h3 className="text-xl font-black text-white uppercase tracking-tighter">3-Gate Filter Pyramid</h3>
                      </div>
                      <div className={cn(
                        "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border-2",
                        stock.gateEvaluation.isPassed ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"
                      )}>
                        {stock.gateEvaluation.isPassed ? "Total Pass" : "Failed at Gate " + stock.gateEvaluation.currentGate}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {[1, 2, 3].map((gateNum) => {
                        const gate = stock.gateEvaluation?.[`gate${gateNum}` as keyof typeof stock.gateEvaluation] as any;
                        const isCurrent = stock.gateEvaluation?.currentGate === gateNum;
                        const isPassed = gate?.isPassed;

                        return (
                          <div 
                            key={gateNum}
                            className={cn(
                              "p-8 rounded-[2.5rem] border transition-all relative overflow-hidden group/gate",
                              isPassed ? "bg-green-500/[0.03] border-green-500/20" : 
                              isCurrent ? "bg-orange-500/[0.03] border-orange-500/20" :
                              "bg-white/5 border-white/10 opacity-50"
                            )}
                          >
                            <div className="flex items-center justify-between mb-6">
                              <div className={cn(
                                "w-10 h-10 rounded-2xl flex items-center justify-center border",
                                isPassed ? "bg-green-500/20 border-green-500/30 text-green-500" :
                                isCurrent ? "bg-orange-500/20 border-orange-500/30 text-orange-500" :
                                "bg-white/5 border-white/10 text-white/20"
                              )}>
                                <span className="text-lg font-black">{gateNum}</span>
                              </div>
                              {isPassed ? (
                                <CheckCircle2 className="w-5 h-5 text-green-500" />
                              ) : isCurrent ? (
                                <Activity className="w-5 h-5 text-orange-500 animate-pulse" />
                              ) : (
                                <XCircle className="w-5 h-5 text-white/10" />
                              )}
                            </div>
                            <h4 className="text-lg font-black text-white mb-3">
                              {gateNum === 1 ? "Survival Filter" : gateNum === 2 ? "Growth Verification" : "Precision Timing"}
                            </h4>
                            <div className="flex items-baseline gap-2 mb-4">
                              <span className="text-4xl font-black text-white tracking-tighter">{gate?.score || 0}</span>
                              <span className="text-xs font-bold text-white/20 uppercase tracking-widest">Score</span>
                            </div>
                            <p className="text-xs text-white/50 leading-relaxed font-bold">
                              {gate?.reason || "Waiting for evaluation..."}
                            </p>
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Sell Checklist Evaluation */}
                {stock.sellSignals && stock.sellSignals.length > 0 && (
                  <div className="mb-10">
                    <div className="flex items-center justify-between mb-6 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-6 bg-red-500 rounded-full" />
                        <h3 className="text-xl font-black text-white uppercase tracking-tighter">Sell Checklist Evaluation</h3>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black text-red-500 tracking-tighter">{stock.sellScore || 0}</span>
                        <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Sell Score</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {(stock.sellSignals || []).map((signal, i) => (
                        <div key={i} className="flex items-start gap-5 p-6 rounded-[2rem] bg-red-500/[0.03] border border-red-500/10 hover:bg-red-500/[0.06] transition-all group/sell">
                          <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center shrink-0 border border-red-500/20 group-hover/sell:scale-110 transition-transform">
                            <AlertTriangle className="w-6 h-6 text-red-500" />
                          </div>
                          <div>
                            <h5 className="text-sm font-black text-white mb-2 uppercase tracking-tight">{signal.condition}</h5>
                            <p className="text-xs font-bold text-white/40 leading-relaxed">{signal.reason}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sector Analysis Section */}
                {stock.sectorAnalysis && (
                  <div className="mb-8">
                    <div className="flex items-center gap-3 mb-6 px-4">
                      <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
                      <h3 className="text-xl font-black text-white uppercase tracking-tighter">Sector Analysis: {stock.sectorAnalysis.sectorName}</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Trends & Catalysts */}
                      <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/sector-card">
                          <div className="flex items-center gap-3 mb-4">
                            <TrendingUp className="w-5 h-5 text-blue-400" />
                            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Current Trends</span>
                          </div>
                          <ul className="space-y-3">
                            {stock.sectorAnalysis?.currentTrends?.map((trend, i) => (
                              <li key={i} className="flex items-start gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                                <span className="text-sm text-white/80 font-bold leading-tight">{trend}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/sector-card">
                          <div className="flex items-center gap-3 mb-4">
                            <Zap className="w-5 h-5 text-yellow-400" />
                            <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Sector Catalysts</span>
                          </div>
                          <ul className="space-y-3">
                            {stock.sectorAnalysis?.catalysts?.map((catalyst, i) => (
                              <li key={i} className="flex items-start gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1.5 shrink-0" />
                                <span className="text-sm text-white/80 font-bold leading-tight">{catalyst}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="md:col-span-2 mt-2">
                          <div className="bg-white/5 rounded-[2rem] p-8 border border-white/10 relative overflow-hidden">
                            <div className="flex items-center gap-3 mb-6">
                              <Layers className="w-5 h-5 text-purple-400" />
                              <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Related Sectors & Correlation</span>
                            </div>
                            <div className="flex flex-wrap gap-3 mb-6">
                        {(stock.relatedSectors || []).map((sector, i) => (
                                <span key={i} className="px-4 py-2 rounded-2xl bg-purple-500/10 text-purple-400 text-xs font-black border border-purple-500/20">
                                  {sector}
                                </span>
                              ))}
                            </div>
                            <div className="bg-black/20 p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                              <span className="text-[11px] font-black text-white/30 uppercase tracking-widest">Correlation Group</span>
                              <span className="text-sm font-black text-white/80">{stock.correlationGroup}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Leading Stocks */}
                      <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 relative overflow-hidden group/sector-card">
                        <div className="flex items-center gap-3 mb-4">
                          <Crown className="w-5 h-5 text-orange-400" />
                          <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Leading Stocks</span>
                        </div>
                        <div className="space-y-4">
                          {(stock.sectorAnalysis?.leadingStocks || []).map((stock, i) => (
                            <div key={i} className="bg-white/5 p-4 rounded-2xl border border-white/5 hover:bg-white/10 transition-all cursor-pointer group/stock-item">
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-sm font-black text-white group-hover/stock-item:text-orange-400 transition-colors">{stock.name}</span>
                                <span className="text-[10px] font-bold text-white/30">{stock.code}</span>
                              </div>
                              {stock.marketCap && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Market Cap:</span>
                                  <span className="text-[11px] font-black text-white/60">{stock.marketCap}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        
                        {stock.sectorAnalysis?.riskFactors && stock.sectorAnalysis.riskFactors.length > 0 && (
                          <div className="mt-6 pt-6 border-t border-white/5">
                            <span className="text-[10px] font-black text-red-400/40 uppercase tracking-widest block mb-3">Sector Risks</span>
                            <div className="space-y-2">
                              {(stock.sectorAnalysis.riskFactors || []).map((risk, i) => (
                                <div key={i} className="flex items-center gap-2 text-[10px] text-white/50 font-bold">
                                  <AlertCircle className="w-3 h-3 text-red-500/50" />
                                  {risk}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  
                  {/* Left Column: Technicals & Wave */}
                  <div className="lg:col-span-7 space-y-6">
                    {/* Technical Indicators Grid */}
                    <div className="bg-white/5 rounded-[2.5rem] p-6 border border-white/10 relative overflow-hidden group/card">
                      <div className="flex items-center gap-3 mb-6">
                        <Activity className="w-5 h-5 text-blue-400" />
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">Technical Indicators</h3>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-2">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">MA Alignment</span>
                          <div className={cn(
                            "px-3 py-2 rounded-xl text-xs font-black text-center border",
                            stock.technicalSignals?.maAlignment === 'BULLISH' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                            stock.technicalSignals?.maAlignment === 'BEARISH' ? "bg-red-500/10 text-red-400 border-red-500/20" :
                            "bg-white/5 text-white/40 border-white/10"
                          )}>
                            {stock.technicalSignals?.maAlignment}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">RSI (14)</span>
                          <div className="px-3 py-2 rounded-xl text-xs font-black text-center bg-white/5 border border-white/10 text-white/80">
                            {stock.technicalSignals?.rsi}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">MACD Status</span>
                          <div className={cn(
                            "px-3 py-2 rounded-xl text-xs font-black text-center border",
                            stock.technicalSignals?.macdStatus === 'GOLDEN_CROSS' ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                            "bg-white/5 text-white/40 border-white/10"
                          )}>
                            {stock.technicalSignals?.macdStatus?.replace('_', ' ')}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">Ichimoku</span>
                          <div className={cn(
                            "px-3 py-2 rounded-xl text-[10px] font-black text-center border",
                            stock.ichimokuStatus === 'ABOVE_CLOUD' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                            stock.ichimokuStatus === 'BELOW_CLOUD' ? "bg-red-500/10 text-red-400 border-red-500/20" :
                            "bg-white/5 text-white/40 border-white/10"
                          )}>
                            {stock.ichimokuStatus?.replace('_', ' ')}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex justify-between items-center">
                          <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Volume Surge</span>
                          <span className={cn("text-xs font-black", stock.technicalSignals?.volumeSurge ? "text-orange-400" : "text-white/20")}>
                            {stock.technicalSignals?.volumeSurge ? "DETECTED" : "NORMAL"}
                          </span>
                        </div>
                        <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex justify-between items-center">
                          <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Disparity (20)</span>
                          <span className={cn("text-xs font-black", 
                            (stock.technicalSignals?.disparity20 || 100) > 105 ? "text-red-400" : 
                            (stock.technicalSignals?.disparity20 || 100) < 95 ? "text-green-400" : "text-white/60"
                          )}>
                            {stock.technicalSignals?.disparity20}%
                          </span>
                        </div>
                      </div>

                      {/* Elliott Wave & Chart Pattern */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                        {stock.elliottWaveStatus && (
                          <div className="bg-gradient-to-br from-indigo-500/10 to-purple-600/5 rounded-3xl p-5 border border-indigo-500/20">
                            <div className="flex items-center gap-3 mb-3">
                              <Activity className="w-4 h-4 text-indigo-400" />
                              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Elliott Wave Status</span>
                            </div>
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-lg font-black text-indigo-400">{(stock.elliottWaveStatus.wave || '').replace('_', ' ')}</span>
                            </div>
                            <p className="text-[11px] text-white/70 font-bold leading-relaxed">
                              {stock.elliottWaveStatus.description}
                            </p>
                          </div>
                        )}

                        {stock.chartPattern && (
                          <div className="bg-gradient-to-br from-emerald-500/10 to-teal-600/5 rounded-3xl p-5 border border-emerald-500/20">
                            <div className="flex items-center gap-3 mb-3">
                              <Target className="w-4 h-4 text-emerald-400" />
                              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Chart Pattern</span>
                            </div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-black text-white uppercase">{stock.chartPattern.name}</span>
                              <div className={cn("px-2 py-0.5 rounded-md text-[9px] font-black border",
                                (stock.chartPattern.type || '').includes('BULLISH') ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                                (stock.chartPattern.type || '').includes('BEARISH') ? "bg-red-500/20 text-red-400 border-red-500/30" :
                                "bg-white/5 text-white/40 border-white/10"
                              )}>
                                {(stock.chartPattern.type || '').replace('_', ' ')}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500" style={{ width: `${stock.chartPattern.reliability}%` }} />
                              </div>
                              <span className="text-[9px] font-black text-white/40">{stock.chartPattern.reliability}% Reliability</span>
                            </div>
                            <p className="text-[11px] text-white/70 font-bold leading-relaxed">
                              {stock.chartPattern.description}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Technical Details */}
                      <div className="mt-8 space-y-4">
                        {stock.technicalSignals?.macdHistogramDetail && (
                          <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-inner">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className={cn("w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]", 
                                  stock.technicalSignals.macdHistogramDetail.status === 'BULLISH' ? 'bg-green-500 shadow-green-500/50' : 
                                  stock.technicalSignals.macdHistogramDetail.status === 'BEARISH' ? 'bg-red-500 shadow-red-500/50' : 'bg-gray-400'
                                )} />
                                <span className="text-xs font-black text-white/60 uppercase tracking-widest">MACD Histogram</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-black text-white">{stock.technicalSignals.macdHistogram?.toFixed(2) || 'N/A'}</span>
                                <span className={cn("text-[10px] px-2 py-1 rounded-md font-black tracking-widest",
                                  stock.technicalSignals.macdHistogramDetail.status === 'BULLISH' ? 'bg-green-500/20 text-green-400' : 
                                  stock.technicalSignals.macdHistogramDetail.status === 'BEARISH' ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/60'
                                )}>
                                  {stock.technicalSignals.macdHistogramDetail.status}
                                </span>
                              </div>
                            </div>
                            <p className="text-sm text-white/80 leading-relaxed font-bold bg-black/20 p-3 rounded-xl border border-white/5 break-words">
                              {stock.technicalSignals.macdHistogramDetail.implication}
                            </p>
                          </div>
                        )}

                        {stock.technicalSignals?.bbWidthDetail && (
                          <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-inner">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className={cn("w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]", 
                                  stock.technicalSignals.bbWidthDetail.status === 'EXPANSION' ? 'bg-orange-500 shadow-orange-500/50' : 
                                  stock.technicalSignals.bbWidthDetail.status === 'SQUEEZE' ? 'bg-blue-500 shadow-blue-500/50' : 'bg-gray-400'
                                )} />
                                <span className="text-xs font-black text-white/60 uppercase tracking-widest">Bollinger Band Width</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-black text-white">{stock.technicalSignals.bbWidth?.toFixed(3) || 'N/A'}</span>
                                <span className={cn("text-[10px] px-2 py-1 rounded-md font-black tracking-widest",
                                  stock.technicalSignals.bbWidthDetail.status === 'EXPANSION' ? 'bg-orange-500/20 text-orange-400' : 
                                  stock.technicalSignals.bbWidthDetail.status === 'SQUEEZE' ? 'bg-blue-500/20 text-blue-400' : 'bg-white/10 text-white/60'
                                )}>
                                  {stock.technicalSignals.bbWidthDetail.status}
                                </span>
                              </div>
                            </div>
                            <p className="text-sm text-white/80 leading-relaxed font-bold bg-black/20 p-3 rounded-xl border border-white/5 break-words">
                              {stock.technicalSignals.bbWidthDetail.implication}
                            </p>
                          </div>
                        )}

                        {stock.technicalSignals?.stochRsiDetail && (
                          <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-inner">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className={cn("w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]", 
                                  stock.technicalSignals.stochRsiDetail.status === 'OVERBOUGHT' ? 'bg-red-500 shadow-red-500/50' : 
                                  stock.technicalSignals.stochRsiDetail.status === 'OVERSOLD' ? 'bg-green-500 shadow-green-500/50' : 'bg-gray-400'
                                )} />
                                <span className="text-xs font-black text-white/60 uppercase tracking-widest">Stochastic RSI</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-black text-white">{stock.technicalSignals.stochRsi?.toFixed(2) || 'N/A'}</span>
                                <span className={cn("text-[10px] px-2 py-1 rounded-md font-black tracking-widest",
                                  stock.technicalSignals.stochRsiDetail.status === 'OVERBOUGHT' ? 'bg-red-500/20 text-red-400' : 
                                  stock.technicalSignals.stochRsiDetail.status === 'OVERSOLD' ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/60'
                                )}>
                                  {stock.technicalSignals.stochRsiDetail.status}
                                </span>
                              </div>
                            </div>
                            <p className="text-sm text-white/80 leading-relaxed font-bold bg-black/20 p-3 rounded-xl border border-white/5 break-words">
                              {stock.technicalSignals.stochRsiDetail.implication}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Elliott Wave & Strategic Insight */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10">
                        <div className="flex items-center gap-3 mb-6">
                          <Zap className="w-5 h-5 text-yellow-400" />
                          <h3 className="text-lg font-black text-white uppercase tracking-tight">Elliott Wave</h3>
                        </div>
                        {stock.elliottWaveStatus ? (
                          <div className="space-y-4">
                            <div className="inline-block px-4 py-1.5 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-black">
                              {(stock.elliottWaveStatus.wave || '').replace('_', ' ')}
                            </div>
                            <p className="text-sm text-white/70 leading-relaxed font-bold italic break-words">
                              "{stock.elliottWaveStatus.description}"
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-white/30 font-bold">No wave data available</p>
                        )}
                      </div>

                      {/* Chart Pattern Analysis */}
                      <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10">
                        <div className="flex items-center gap-3 mb-6">
                          <TrendingUp className="w-5 h-5 text-blue-400" />
                          <h3 className="text-lg font-black text-white uppercase tracking-tight">Chart Pattern Analysis</h3>
                        </div>
                        {stock.chartPattern ? (
                          <div className="space-y-6">
                            <div className="flex items-center justify-between">
                              <div className={cn(
                                "px-4 py-1.5 rounded-full text-xs font-black border",
                                (stock.chartPattern.type || '').includes('BULLISH') ? "bg-green-500/20 text-green-400 border-green-500/30" :
                                (stock.chartPattern.type || '').includes('BEARISH') ? "bg-red-500/20 text-red-400 border-red-500/30" :
                                "bg-blue-500/20 text-blue-400 border-blue-500/30"
                              )}>
                                {stock.chartPattern.name} ({(stock.chartPattern.type || '').replace('_', ' ')})
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">Reliability</span>
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                    <div 
                                      className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" 
                                      style={{ width: `${stock.chartPattern.reliability}%` }} 
                                    />
                                  </div>
                                  <span className="text-xs font-black text-white">{stock.chartPattern.reliability}%</span>
                                </div>
                              </div>
                            </div>
                            <div className="bg-black/20 p-5 rounded-3xl border border-white/5">
                              <p className="text-sm text-white/80 leading-relaxed font-bold italic">
                                "{stock.chartPattern.description}"
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-white/30 font-bold">No chart pattern identified</p>
                        )}
                      </div>

                      <div className="bg-white/5 rounded-[2.5rem] p-6 border border-white/10">
                        <div className="flex items-center gap-3 mb-4">
                          <Sparkles className="w-5 h-5 text-purple-400" />
                          <h3 className="text-lg font-black text-white uppercase tracking-tight">Strategic Insight</h3>
                        </div>
                        {stock.strategicInsight ? (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Cycle Position</span>
                              <span className={cn("text-xs font-black px-2 py-0.5 rounded-md",
                                stock.strategicInsight.cyclePosition === 'NEW_LEADER' ? 'bg-green-500/20 text-green-400' :
                                stock.strategicInsight.cyclePosition === 'MATURING' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                              )}>
                                {(stock.strategicInsight.cyclePosition || '').replace('_', ' ')}
                              </span>
                            </div>
                            <div className="space-y-3">
                              <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                                <span className="text-[9px] font-black text-white/30 uppercase block mb-1">Earnings Quality</span>
                                <p className="text-xs text-white/70 font-bold leading-relaxed">{stock.strategicInsight.earningsQuality}</p>
                              </div>
                              <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                                <span className="text-[9px] font-black text-white/30 uppercase block mb-1">Policy Context</span>
                                <p className="text-xs text-white/70 font-bold leading-relaxed">{stock.strategicInsight.policyContext}</p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-white/30 font-bold">No strategic insight available</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Fundamentals & Targets */}
                  <div className="lg:col-span-5 space-y-6">
                    {/* Fundamental Insights */}
                    <div className="bg-white/5 rounded-[2.5rem] p-6 border border-white/10">
                      <div className="flex items-center gap-3 mb-6">
                        <BarChart3 className="w-5 h-5 text-orange-400" />
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">Fundamental Insights</h3>
                      </div>
                      
                      <div className="grid grid-cols-1 gap-4 mb-8">
                        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">P/E Ratio (PER)</span>
                              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">주가수익비율: 이익 대비 주가 수준 (낮을수록 저평가)</p>
                            </div>
                            <span className="text-2xl font-black text-white">{stock.valuation?.per}x</span>
                          </div>
                        </div>

                        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">P/B Ratio (PBR)</span>
                              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">주가순자산비율: 자산 가치 대비 주가 (1미만 시 장부가 미달)</p>
                            </div>
                            <span className="text-2xl font-black text-white">{stock.valuation?.pbr}x</span>
                          </div>
                        </div>

                        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">EPS Growth</span>
                              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">주당순이익 성장률: 기업의 수익성 성장 속도</p>
                            </div>
                            <span className="text-2xl font-black text-green-400">+{stock.valuation?.epsGrowth}%</span>
                          </div>
                        </div>

                        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">Debt Ratio</span>
                              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">부채비율: 재무 건전성 및 리스크 지표 (낮을수록 안전)</p>
                            </div>
                            <span className="text-2xl font-black text-white">{stock.valuation?.debtRatio}%</span>
                          </div>
                        </div>

                        {stock.economicMoat && (
                          <div className="bg-blue-500/5 p-5 rounded-3xl border border-blue-500/10 group/moat hover:bg-blue-500/10 transition-all">
                            <div className="flex items-center gap-3 mb-2">
                              <ShieldCheck className="w-4 h-4 text-blue-400" />
                              <span className="text-[10px] font-black text-blue-400/60 uppercase tracking-widest">Economic Moat: {stock.economicMoat.type}</span>
                            </div>
                            <p className="text-xs text-white/70 font-bold leading-relaxed">
                              {stock.economicMoat.description}
                            </p>
                          </div>
                        )}
                      </div>

                      {stock?.roeAnalysis ? (
                        <div className="space-y-4 border-t border-white/5 pt-6">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">ROE Analysis & DuPont</span>
                            <span className="text-xs font-black text-orange-400">{stock.roeType}</span>
                          </div>
                          
                          <div className="grid grid-cols-1 gap-3">
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                              <span className="text-[9px] font-black text-white/30 uppercase block mb-2">Historical Trend</span>
                              <p className="text-xs text-white/70 font-bold leading-relaxed">{stock.roeAnalysis.historicalTrend}</p>
                            </div>
                            
                            <div className="grid grid-cols-3 gap-2">
                              <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                                <span className="text-[8px] font-black text-white/20 uppercase block mb-1">Margin</span>
                                <span className="text-xs font-black text-white">{(stock.roeAnalysis.metrics.netProfitMargin * 100).toFixed(1)}%</span>
                              </div>
                              <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                                <span className="text-[8px] font-black text-white/20 uppercase block mb-1">Turnover</span>
                                <span className="text-xs font-black text-white">{stock.roeAnalysis.metrics.assetTurnover.toFixed(2)}x</span>
                              </div>
                              <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                                <span className="text-[8px] font-black text-white/20 uppercase block mb-1">Leverage</span>
                                <span className="text-xs font-black text-white">{stock.roeAnalysis.metrics.equityMultiplier.toFixed(2)}x</span>
                              </div>
                            </div>

                            <div className="bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10">
                              <span className="text-[9px] font-black text-orange-500/40 uppercase block mb-2">Strategic Drivers</span>
                              <div className="flex flex-wrap gap-2">
                                {(stock.roeAnalysis.drivers || []).map((driver, i) => (
                                  <span key={i} className="text-[10px] px-2 py-1 rounded-md bg-orange-500/10 text-orange-400 font-black border border-orange-500/10">
                                    {driver}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10">
                              <span className="text-[9px] font-black text-orange-500/40 uppercase block mb-2">DuPont Strategy</span>
                              <p className="text-xs text-orange-500/80 font-bold leading-relaxed italic">{stock.roeAnalysis.strategy}</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-white/30">ROE 분석 데이터 없음</p>
                      )}

                      {/* Price Action Cards */}
                      <div className="grid grid-cols-3 gap-3 mt-4">
                        <div className="bg-blue-500/10 rounded-2xl p-4 border border-blue-500/20 text-center">
                          <span className="text-[9px] font-black text-blue-400/60 uppercase tracking-widest block mb-1">Entry</span>
                          <span className="text-lg font-black text-white">
                            ₩{stock.entryPrice?.toLocaleString() || stock.currentPrice?.toLocaleString() || '---'}
                          </span>
                          {stock.entryPrice2 && (
                            <span className="text-[10px] text-blue-400/50 block">~ ₩{stock.entryPrice2.toLocaleString()}</span>
                          )}
                        </div>
                        <div className="bg-orange-500/10 rounded-2xl p-4 border border-orange-500/20 text-center">
                          <span className="text-[9px] font-black text-orange-400/60 uppercase tracking-widest block mb-1">Target</span>
                          <span className="text-lg font-black text-orange-400">
                            ₩{stock.targetPrice?.toLocaleString() || '---'}
                          </span>
                          <span className="text-[10px] text-orange-400/50 block">
                            +{Math.round(((stock.targetPrice || 0) / (stock.currentPrice || 1) - 1) * 100)}%
                          </span>
                        </div>
                        <div className="bg-red-500/10 rounded-2xl p-4 border border-red-500/20 text-center">
                          <span className="text-[9px] font-black text-red-400/60 uppercase tracking-widest block mb-1">Stop</span>
                          <span className="text-lg font-black text-red-400">
                            ₩{stock.stopLoss?.toLocaleString() || '---'}
                          </span>
                          <span className="text-[10px] text-red-400/50 block">
                            {Math.round(((stock.stopLoss || 0) / (stock.currentPrice || 1) - 1) * 100)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>



                  {/* Sentiment Analysis Section */}
                  <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Analyst Sentiment */}
                    <div className="bg-white/5 rounded-[2.5rem] p-6 border border-white/10">
                      <div className="flex items-center gap-3 mb-4">
                        <Users className="w-5 h-5 text-blue-400" />
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">Analyst Sentiment</h3>
                      </div>
                      {stock.analystRatings ? (
                        <div className="space-y-6">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-black text-white/60 uppercase tracking-widest">Consensus</span>
                            <span className={cn("text-sm px-3 py-1 rounded-full font-black tracking-widest",
                              (stock.analystRatings.consensus?.toLowerCase().includes('buy') ?? false) ? 'bg-green-500/20 text-green-400' :
                              (stock.analystRatings.consensus?.toLowerCase().includes('sell') ?? false) ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
                            )}>
                              {stock.analystRatings.consensus}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                              <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Strong Buy</span>
                              <span className="text-xl font-black text-red-500">{stock.analystRatings?.strongBuy}</span>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                              <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Buy</span>
                              <span className="text-xl font-black text-orange-400">{stock.analystRatings?.buy}</span>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                              <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Strong Sell</span>
                              <span className="text-xl font-black text-blue-600">{stock.analystRatings?.strongSell}</span>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                              <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Sell</span>
                              <span className="text-xl font-black text-blue-400">{stock.analystRatings?.sell}</span>
                            </div>
                          </div>

                          <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                            <span className="text-[10px] font-black text-white/40 uppercase block mb-2">Target Price Range</span>
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-black text-white/60">₩{stock.analystRatings?.targetPriceLow?.toLocaleString() || '0'}</span>
                              <div className="flex-1 h-1 bg-white/10 mx-4 rounded-full relative">
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-blue-400 rounded-full shadow-[0_0_10px_rgba(96,165,250,0.5)]" />
                              </div>
                              <span className="text-sm font-black text-white/60">₩{stock.analystRatings?.targetPriceHigh?.toLocaleString() || '0'}</span>
                            </div>
                            <div className="text-center mt-2">
                              <span className="text-xs font-black text-blue-400">Avg: ₩{stock.analystRatings?.targetPriceAvg?.toLocaleString() || '0'}</span>
                            </div>
                          </div>
                          
                          {stock.analystSentiment && (
                            <p className="text-sm text-white/70 leading-relaxed font-bold italic border-l-2 border-blue-500/30 pl-4 break-words">
                              "{stock.analystSentiment}"
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-white/30 font-bold">No analyst data available</p>
                      )}
                    </div>

                    {/* News Sentiment */}
                    <div className="bg-white/5 rounded-[2.5rem] p-6 border border-white/10">
                      <div className="flex items-center gap-3 mb-4">
                        <Newspaper className="w-5 h-5 text-emerald-400" />
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">News Sentiment</h3>
                      </div>
                      {stock.newsSentiment ? (
                        <div className="space-y-6">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-black text-white/60 uppercase tracking-widest">Status</span>
                            <span className={cn("text-sm px-3 py-1 rounded-full font-black tracking-widest flex items-center gap-2",
                              stock.newsSentiment.status === 'POSITIVE' ? 'bg-emerald-500/20 text-emerald-400' :
                              stock.newsSentiment.status === 'NEGATIVE' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
                            )}>
                              {stock.newsSentiment.status === 'POSITIVE' && <TrendingUp className="w-4 h-4" />}
                              {stock.newsSentiment.status === 'NEGATIVE' && <TrendingDown className="w-4 h-4" />}
                              {stock.newsSentiment.status === 'NEUTRAL' && <Minus className="w-4 h-4" />}
                              {stock.newsSentiment.status}
                            </span>
                          </div>

                          <div className="bg-black/20 p-6 rounded-3xl border border-white/5 relative overflow-hidden">
                            <div className="relative z-10 flex flex-col items-center">
                              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-2">Sentiment Score</span>
                              <div className="text-5xl font-black mb-2" style={{
                                color: stock.newsSentiment.score >= 60 ? '#34d399' : stock.newsSentiment.score <= 40 ? '#f87171' : '#9ca3af'
                              }}>
                                {stock.newsSentiment.score}
                              </div>
                              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mt-4">
                                <div 
                                  className={cn("h-full rounded-full transition-all duration-1000",
                                    stock.newsSentiment.score >= 60 ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]' : 
                                    stock.newsSentiment.score <= 40 ? 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.5)]' : 'bg-gray-400'
                                  )}
                                  style={{ width: `${stock.newsSentiment.score}%` }}
                                />
                              </div>
                            </div>
                            {/* Decorative background for score card */}
                            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                          </div>

                          <p className="text-sm text-white/80 leading-relaxed font-bold bg-white/5 p-5 rounded-2xl border border-white/5 break-words">
                            {stock.newsSentiment.summary}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-white/30 font-bold">No news sentiment data available</p>
                      )}
                    </div>
                  </div>

                  {/* Bottom Section: Risk & Checklist */}
                  <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-red-500/5 rounded-[2.5rem] p-6 border border-red-500/10">
                      <div className="flex items-center gap-3 mb-4">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">Risk Factors</h3>
                      </div>
                      <ul className="space-y-4">
                        {(stock.riskFactors || []).map((risk, idx) => (
                          <li key={idx} className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 group/risk hover:bg-red-500/5 transition-all">
                            <div className="w-8 h-8 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0 border border-red-500/20 group-hover/risk:scale-110 transition-transform">
                              <AlertCircle className="w-4 h-4 text-red-400" />
                            </div>
                            <span className="text-sm text-white/70 font-bold leading-relaxed pt-1">
                              {risk}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-green-500/5 rounded-[2.5rem] p-6 border border-green-500/10 flex flex-col">
                      <div className="flex items-center gap-3 mb-4">
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">27-Step Master Checklist</h3>
                      </div>
                      <div className="flex items-center gap-4 mb-6">
                        <div className="text-4xl font-black text-green-400">
                          {Object.values(stock?.checklist || {}).filter(Boolean).length}
                          <span className="text-xl text-green-400/30">/27</span>
                        </div>
                        <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden border border-white/5">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${(Object.values(stock?.checklist || {}).filter(Boolean).length / 27) * 100}%` }}
                            className="h-full bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]"
                          />
                        </div>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar max-h-[320px] space-y-6">
                        {[1, 2, 3].map(gateNum => (
                          <div key={gateNum} className="space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-orange-500/50 uppercase tracking-widest">Gate {gateNum}</span>
                              <div className="h-px flex-1 bg-white/5" />
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                              {MASTER_CHECKLIST_STEPS.filter(s => s.gate === gateNum).map((step) => {
                                const value = stock.checklist ? stock.checklist[step.key as keyof typeof stock.checklist] : 0;
                                return (
                                  <div key={step.key} className="group/item relative flex flex-col gap-1.5 p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all cursor-help">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-bold text-white/70">
                                          {step.title}
                                        </span>
                                        <Info className="w-3 h-3 text-white/20 group-hover/item:text-orange-500 transition-colors" />
                                      </div>
                                      {value ? (
                                        <div className="flex items-center gap-1.5 text-green-400">
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                          <span className="text-[10px] font-black uppercase">Pass</span>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-1.5 text-white/20">
                                          <X className="w-3.5 h-3.5" />
                                          <span className="text-[10px] font-black uppercase">Fail</span>
                                        </div>
                                      )}
                                    </div>
                                    <p className="text-[9px] text-white/40 font-medium leading-relaxed max-h-0 overflow-hidden group-hover/item:max-h-20 transition-all duration-300">
                                      {step.desc}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}

                        {/* Sell Checklist in Deep Analysis */}
                        <div className="space-y-3 pt-4">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-red-500/50 uppercase tracking-widest">Sell Checklist</span>
                            <div className="h-px flex-1 bg-white/5" />
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            {SELL_CHECKLIST_STEPS.map((step, i) => (
                              <div key={i} className="flex flex-col gap-1.5 p-3 rounded-xl bg-red-500/[0.02] border border-red-500/10 hover:bg-red-500/[0.05] transition-all">
                                <div className="flex items-center gap-2">
                                  <step.icon className="w-3 h-3 text-red-400/50" />
                                  <span className="text-[11px] font-bold text-white/70">{step.title}</span>
                                </div>
                                <p className="text-[9px] text-white/40 font-medium leading-relaxed">
                                  {step.desc}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      
                      <p className="text-[10px] text-white/40 font-bold leading-relaxed mt-6 pt-4 border-t border-white/10">
                        마스터 체크리스트는 시장 사이클, 수급, 펀더멘털, 기술적 지표 및 심리적 요인을 종합적으로 검증합니다. 15개 이상 통과 시 '강력 매수' 신호로 간주됩니다.
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
              </>)}
              </AnalysisViewToggle>

              {/* Modal Footer */}
              <div className="p-4 border-t border-white/10 bg-white/5 flex flex-col items-center gap-4">
                <div className="flex items-center justify-center gap-6">
                  <button 
                    onClick={() => onClose()}
                    className="px-8 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white/60 font-black text-sm transition-all border border-white/10 flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Close Analysis
                  </button>
                  <button 
                    onClick={() => {
                      if (!stock) return;
                      const currentWatchlist = watchlist || [];
                      const isWatchlisted = currentWatchlist.some(s => s.code === stock.code);
                      if (isWatchlisted) {
                        setWatchlist(currentWatchlist.filter(s => s.code !== stock.code));
                      } else {
                        setWatchlist([...currentWatchlist, stock]);
                      }
                    }}
                    className={cn(
                      "px-8 py-3 rounded-2xl font-black text-sm transition-all flex items-center gap-2",
                      (watchlist || []).some(s => s.code === stock.code)
                        ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                        : "bg-orange-500 text-white shadow-[0_10px_20px_rgba(249,115,22,0.2)] hover:bg-orange-600"
                    )}
                  >
                    <Star className={cn("w-4 h-4", (watchlist || []).some(s => s.code === stock.code) && "fill-red-400")} />
                    {(watchlist || []).some(s => s.code === stock.code) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                  </button>
                </div>
                
                <div className="flex items-center gap-4 text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3" />
                    <span>Data Source: {stock.dataSource || 'Institutional Feeds'}</span>
                  </div>
                  <div className="w-1 h-1 rounded-full bg-white/10" />
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    <span>Last Updated: {stock.priceUpdatedAt || new Date().toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
      )}
    </AnimatePresence>
  );
}
