import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, Crown, Search, Filter, HelpCircle, RefreshCw,
  Flame, BarChart3, Info, ChevronRight, ExternalLink, Target, CheckCircle2,
  AlertTriangle, AlertCircle, Zap, Star, LayoutGrid, Bookmark, ChevronDown,
  ChevronUp, Type, History, Plus, Trash2, Play, ArrowUpRight, ArrowDownRight,
  ShieldCheck, Lightbulb, X, Settings, Key, Users, MessageSquare, PieChart,
  Shield, Cloud, Dna, CheckSquare, Activity, Building2, ArrowUpCircle,
  XCircle, Edit2, Check, DollarSign, Lock, Download, Award, Mail, FileText,
  Clock, Globe, Brain, Shell, Hash, Sparkles, Newspaper, Minus, Radar, Copy,
  Wallet, Percent, Maximize2, ArrowRightLeft, Flag, ShieldAlert, ArrowUpDown,
  Layers, Sun, Moon, Contrast, GripVertical, Calculator, ArrowRight,
  Calendar as CalendarIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Radar as RechartsRadar, RadarChart,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { PageHeader } from '../ui/page-header';
import { Card } from '../ui/card';
import { Section } from '../ui/section';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { KpiStrip } from '../ui/kpi-strip';
import { Stack } from '../layout/Stack';
import { QuantDashboard } from '../components/QuantDashboard';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { PriceEditCell } from '../components/PriceEditCell';
import { CandleChart } from '../components/CandleChart';
import { HeroChecklist } from '../components/HeroChecklist';
import { AnalysisViewToggle, AnalysisViewButtons } from '../components/AnalysisViewToggle';
import { DeepAnalysisModal } from '../components/DeepAnalysisModal';

import { useCopiedCode } from '../hooks/useCopiedCode';
import { evaluateStock, evaluateGate0 } from '../services/quantEngine';
import { buildShadowTrade } from '../services/autoTrading';
import { MASTER_CHECKLIST_STEPS, CHECKLIST_LABELS, getMarketPhaseInfo } from '../constants/checklist';
import {
  useRecommendationStore, useSettingsStore, useMarketStore,
  useAnalysisStore, useTradeStore, useGlobalIntelStore
} from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import { fetchHistoricalData } from '../services/stockService';
import type { StockRecommendation } from '../services/stockService';
import { calculateRSIMomentumAcceleration } from '../utils/indicators';
import type {
  StockProfileType, ROEType, Gate0Result, NewsFrequencyScore,
  ConditionId, TradeRecord
} from '../types/quant';
import { debugWarn } from '../utils/debug';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DiscoverWatchlistPageProps {
  displayList: StockRecommendation[];
  filteredRecommendations: StockRecommendation[];
  allPatterns: string[];
  averageHitRate: number;
  strongBuyHitRate: number;
  loadingNews: boolean;
  dartAlerts: { corp_name: string; stock_code: string; report_nm: string; rcept_dt: string; sentiment: string }[];
  kisBalance: number;
  analysisReportRef: React.RefObject<HTMLDivElement | null>;
  onFetchStocks: () => Promise<void>;
  onSyncAll: () => Promise<void>;
  onSyncPrice: (stock: StockRecommendation) => Promise<StockRecommendation | null>;
  onManualPriceUpdate: (stock: StockRecommendation, newPrice: number) => void;
  onToggleWatchlist: (stock: StockRecommendation) => void;
  onAddToBacktest: (stock: StockRecommendation) => void;
  onMarketSearch: () => Promise<void>;
  onFetchNewsScores: () => Promise<void>;
  onGenerateSummary: () => Promise<void>;
  onGeneratePDF: (shouldDownload?: boolean) => Promise<string | null>;
  onExportDeepAnalysisPDF: () => Promise<void>;
  onSendEmail: () => Promise<void>;
  onRecordTrade: (stock: StockRecommendation, buyPrice: number, quantity: number, positionSize: number, followedSystem: boolean, conditionScores: Record<ConditionId, number>, gateScores: { g1: number; g2: number; g3: number; final: number }, preMortems?: import('../types/quant').PreMortemItem[]) => void;
}

export function DiscoverWatchlistPage({
  displayList, filteredRecommendations, allPatterns, averageHitRate,
  strongBuyHitRate, loadingNews, dartAlerts, kisBalance,
  analysisReportRef,
  onFetchStocks, onSyncAll, onSyncPrice, onManualPriceUpdate,
  onToggleWatchlist, onAddToBacktest, onMarketSearch, onFetchNewsScores,
  onGenerateSummary, onGeneratePDF, onExportDeepAnalysisPDF, onSendEmail,
  onRecordTrade
}: DiscoverWatchlistPageProps) {
  // Zustand stores
  const {
    recommendations, watchlist, searchResults, filters, setFilters,
    selectedType, setSelectedType, selectedPattern, setSelectedPattern,
    selectedSentiment, setSelectedSentiment, selectedChecklist, setSelectedChecklist,
    searchQuery, setSearchQuery, minPrice, setMinPrice, maxPrice, setMaxPrice,
    sortBy, setSortBy, lastUsedMode, recommendationHistory, loading,
    lastUpdated, error, setError, searchingSpecific
  } = useRecommendationStore();
  const {
    view, setView, autoSyncEnabled, setAutoSyncEnabled,
    showMasterChecklist, setShowMasterChecklist, isFilterExpanded, setIsFilterExpanded,
    emailAddress, setEmailAddress
  } = useSettingsStore();
  const { marketOverview, marketContext, syncStatus, syncingStock, nextSyncCountdown } = useMarketStore();
  const {
    deepAnalysisStock, setDeepAnalysisStock, setSelectedDetailStock,
    weeklyRsiValues, setWeeklyRsiValues, reportSummary, setReportSummary,
    isSummarizing, isGeneratingPDF, isExportingDeepAnalysis, isSendingEmail
  } = useAnalysisStore();
  const {
    tradeRecordStock, setTradeRecordStock, tradeFormData, setTradeFormData
  } = useTradeStore();
  const globalIntelStore = useGlobalIntelStore();
  const macroEnv = globalIntelStore.macroEnv;
  const newsFrequencyScores = globalIntelStore.newsFrequencyScores;
  const currentRoeType = globalIntelStore.currentRoeType;
  const exportRatio = globalIntelStore.exportRatio;
  const { addShadowTrade } = useShadowTradeStore();
  const { copiedCode, handleCopy } = useCopiedCode();

  // ── 주봉 RSI 3주 추이 계산 (deepAnalysisStock 변경 시) ──────────────────────
  useEffect(() => {
    if (!deepAnalysisStock) { setWeeklyRsiValues([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchHistoricalData(deepAnalysisStock.code, '6mo', '1wk');
        if (cancelled || !data?.indicators?.quote?.[0]) return;
        const closes = (data.indicators.quote[0].close as (number | null)[]).filter((v): v is number => v !== null);
        if (closes.length < 17) return; // RSI 14 + 3주
        const { values } = calculateRSIMomentumAcceleration(closes, 3);
        if (!cancelled) setWeeklyRsiValues(values);
      } catch { /* 실패 시 기본값 유지 */ }
    })();
    return () => { cancelled = true; };
  }, [deepAnalysisStock?.code]);

  const gate0Result = useMemo(() => macroEnv ? evaluateGate0(macroEnv) : undefined, [macroEnv]);

  const isWatched = (code: string) => watchlist.some(s => s.code === code);

  const scrollToStock = (code: string) => {
    const element = document.getElementById(`stock-${code}`);
    if (element) {
      const headerOffset = 100;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
      window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    }
  };

  const roeTypeDetails: Record<string, any> = {
    '유형 1': { title: '유형 1 (ROE 개선)', desc: 'ROE가 전년 대비 개선되는 기업. 턴어라운드 초기 단계.', metrics: '순이익률 개선, 비용 절감, 자산 효율화', trend: '하락 추세 멈춤 → 횡보 → 상승 반전의 초기 국면', strategy: '추세 전환 확인 후 분할 매수, 손절가 엄격 준수', detailedStrategy: '1차 매수는 비중의 30%로 시작, 20일 이평선 안착 시 추가 매수. 실적 턴어라운드 확인 필수.', color: 'text-blue-400' },
    '유형 2': { title: '유형 2 (ROE 고성장)', desc: 'ROE가 15% 이상 유지되는 고성장 기업. 안정적 수익성.', metrics: '높은 시장 점유율, 독점적 지위, 꾸준한 현금 흐름', trend: '장기 우상향 추세, 일시적 조정 후 재상승 반복', strategy: '눌림목 매수, 장기 보유, 실적 발표 주기 확인', detailedStrategy: '주요 지지선(60일/120일 이평선) 터치 시 비중 확대. 배당 성향 및 자사주 매입 여부 체크.', color: 'text-green-400' },
    '유형 3': { title: '유형 3 (최우선 매수)', desc: '매출과 이익이 함께 증가하며 ROE가 개선되는 최우선 매수 대상.', metrics: '매출 성장률 > 이익 성장률, 자산 회전율 급증', trend: '가파른 상승 각도, 거래량 동반한 전고점 돌파', strategy: '공격적 비중 확대, 전고점 돌파 시 추가 매수', detailedStrategy: '추세 추종(Trend Following) 전략 적용. 익절가를 높여가며(Trailing Stop) 수익 극대화.', color: 'text-orange-400' }
  };

  const getRoeDetail = (roeType: string) => {
    if (roeType.includes('유형 3')) return roeTypeDetails['유형 3'];
    if (roeType.includes('유형 2')) return roeTypeDetails['유형 2'];
    if (roeType.includes('유형 1')) return roeTypeDetails['유형 1'];
    return null;
  };

  const getRadarData = (stock: StockRecommendation) => {
    const categories = [
      { name: '기본적 분석', keys: ['roeType3', 'earningsSurprise', 'performanceReality', 'ocfQuality', 'marginAcceleration', 'interestCoverage', 'economicMoatVerified'] },
      { name: '기술적 분석', keys: ['momentumRanking', 'ichimokuBreakout', 'technicalGoldenCross', 'volumeSurgeVerified', 'turtleBreakout', 'fibonacciLevel', 'elliottWaveVerified', 'vcpPattern', 'divergenceCheck'] },
      { name: '수급 분석', keys: ['supplyInflow', 'institutionalBuying', 'consensusTarget'] },
      { name: '시장 주도력', keys: ['cycleVerified', 'riskOnEnvironment', 'notPreviousLeader', 'policyAlignment'] },
      { name: '전략/심리', keys: ['mechanicalStop', 'psychologicalObjectivity', 'catalystAnalysis'] }
    ];
    return categories.map(cat => {
      const passed = cat.keys.filter(key => stock.checklist ? stock.checklist[key as keyof StockRecommendation['checklist']] : 0).length;
      const total = cat.keys.length;
      return { subject: cat.name, A: Math.round((passed / total) * 100), fullMark: 100 };
    });
  };

  const handleResetScreen = () => {
    useRecommendationStore.getState().setSearchResults([]);
    setSearchQuery('');
    setSelectedType('ALL');
    setSelectedPattern('ALL');
    setSelectedSentiment('ALL');
    setSelectedChecklist([]);
    setMinPrice('');
    setMaxPrice('');
    setFilters({ minRoe: 15, maxPer: 20, maxDebtRatio: 100, minMarketCap: 1000, mode: 'MOMENTUM' });
    setError(null);
  };

  return (
    <Stack gap="lg">
              {/* Sync Status Bar */}
              <AnimatePresence>
                {syncStatus.isSyncing && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <Card variant="ghost" padding="md" className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-orange-500/15 rounded-xl sm:rounded-2xl flex items-center justify-center">
                          <RefreshCw className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500 animate-spin" />
                        </div>
                        <div>
                          <h4 className="text-xs sm:text-sm font-black text-theme-text uppercase tracking-widest mb-0.5">실시간 동기화 중</h4>
                          <p className="text-[10px] sm:text-xs text-theme-text-muted font-bold">
                            {syncStatus.currentStock} 분석 중... ({syncStatus.progress}/{syncStatus.total})
                          </p>
                        </div>
                      </div>
                      <div className="flex-1 max-w-xs sm:max-w-md w-full">
                        <div className="h-1.5 sm:h-2 bg-white/5 rounded-full overflow-hidden mb-1.5">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(syncStatus.progress / syncStatus.total) * 100}%` }}
                            className="h-full bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.5)] transition-all duration-500"
                          />
                        </div>
                        <div className="flex justify-between text-micro">
                          <span>Progress</span>
                          <span>{Math.round((syncStatus.progress / syncStatus.total) * 100)}%</span>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error Alert */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                  >
                    <Card variant="danger" padding="md" className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 bg-red-500/15 rounded-xl flex items-center justify-center shrink-0">
                          <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs sm:text-sm font-black text-red-400 uppercase tracking-widest mb-0.5">시스템 오류</h4>
                          <p className="text-xs sm:text-sm text-theme-text-secondary font-bold truncate">{error}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setError(null)}
                        className="p-2 text-theme-text-muted hover:text-theme-text-secondary transition-colors shrink-0"
                      >
                        <X className="w-4 h-4 sm:w-5 sm:h-5" />
                      </button>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Market Sentiment & Hero Section */}
              <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="lg:col-span-2 glass-3d rounded-2xl sm:rounded-3xl p-6 sm:p-10 lg:p-14 relative overflow-hidden group"
          >
            <div className="relative z-10">
                <h2 className="text-3xl sm:text-5xl lg:text-7xl font-bold mb-4 sm:mb-6 leading-[1.1] tracking-tight text-glow">
                <span className="text-orange-500 text-glow-orange">QuantMaster Pro</span>
              </h2>
              <p className="text-xs sm:text-sm lg:text-base font-bold text-theme-text-muted uppercase tracking-[0.15em] sm:tracking-[0.2em] mb-6 sm:mb-10">
                데이터와 사이클 기반 정밀 분석
              </p>
              <div className="relative group/info mb-10">
                <p className="text-theme-text-muted max-w-xl text-lg sm:text-xl font-medium leading-relaxed">
                  AI 기반 <span className="text-theme-text border-b border-theme-border cursor-help font-bold" onClick={() => setShowMasterChecklist(true)}>27단계 마스터 체크리스트</span>를 통과한 주도주 포착 시스템.
                </p>
                <button
                  onClick={() => setShowMasterChecklist(true)}
                  className="absolute -right-8 top-0 p-2 text-theme-text-muted hover:text-orange-500 transition-colors"
                >
                  <Info className="w-5 h-5" />
                </button>
              </div>

              <HeroChecklist steps={MASTER_CHECKLIST_STEPS} onShowChecklist={() => setShowMasterChecklist(true)} />

              <div className="flex flex-col gap-5 mb-12">
                {/* Filter Buttons Row */}
                <div className="flex flex-col gap-2 w-full">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
                    <button
                      onClick={() => setFilters(prev => ({ ...prev, mode: 'MOMENTUM' }))}
                      className={cn(
                        "flex flex-col items-start gap-1 px-4 sm:px-5 py-3 sm:py-4 rounded-xl transition-all border",
                        filters.mode === 'MOMENTUM'
                          ? "bg-orange-500/15 border-orange-500/30 shadow-lg shadow-orange-500/10"
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Zap className={cn("w-4 h-4", filters.mode === 'MOMENTUM' ? "text-orange-500 fill-current" : "text-white/40")} />
                        <span className={cn("text-xs sm:text-sm font-black", filters.mode === 'MOMENTUM' ? "text-orange-500" : "text-white/60")}>지금 살 종목</span>
                      </div>
                      <span className={cn("text-[10px] font-medium leading-tight", filters.mode === 'MOMENTUM' ? "text-orange-500/60" : "text-white/25")}>
                        강한 모멘텀과 수급이 집중되는 단기 매수 적기 종목
                      </span>
                    </button>
                    <button
                      onClick={() => setFilters(prev => ({ ...prev, mode: 'EARLY_DETECT' }))}
                      className={cn(
                        "flex flex-col items-start gap-1 px-4 sm:px-5 py-3 sm:py-4 rounded-xl transition-all border",
                        filters.mode === 'EARLY_DETECT'
                          ? "bg-blue-500/15 border-blue-500/30 shadow-lg shadow-blue-500/10"
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Radar className={cn("w-4 h-4", filters.mode === 'EARLY_DETECT' ? "text-blue-500 fill-current" : "text-white/40")} />
                        <span className={cn("text-xs sm:text-sm font-black", filters.mode === 'EARLY_DETECT' ? "text-blue-500" : "text-white/60")}>미리 살 종목</span>
                      </div>
                      <span className={cn("text-[10px] font-medium leading-tight", filters.mode === 'EARLY_DETECT' ? "text-blue-500/60" : "text-white/25")}>
                        급등 전 선행 신호가 포착된 에너지 응축 종목
                      </span>
                    </button>
                    <button
                      onClick={() => setFilters(prev => ({ ...prev, mode: 'QUANT_SCREEN' }))}
                      className={cn(
                        "flex flex-col items-start gap-1 px-4 sm:px-5 py-3 sm:py-4 rounded-xl transition-all border",
                        filters.mode === 'QUANT_SCREEN'
                          ? "bg-emerald-500/15 border-emerald-500/30 shadow-lg shadow-emerald-500/10"
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Activity className={cn("w-4 h-4", filters.mode === 'QUANT_SCREEN' ? "text-emerald-500 fill-current" : "text-white/40")} />
                        <span className={cn("text-xs sm:text-sm font-black", filters.mode === 'QUANT_SCREEN' ? "text-emerald-500" : "text-white/60")}>숨은 종목 발굴</span>
                      </div>
                      <span className={cn("text-[10px] font-medium leading-tight", filters.mode === 'QUANT_SCREEN' ? "text-emerald-500/60" : "text-white/25")}>
                        ROE, PER, 부채비율 등 정량 지표 기반 저평가 종목 스크리닝
                      </span>
                    </button>
                  </div>
                </div>

                {/* Analysis Start Button */}
                <button
                  onClick={onFetchStocks}
                  disabled={loading}
                  className={cn(
                    "btn-3d px-8 sm:px-12 py-4 sm:py-5 rounded-2xl font-black text-base sm:text-xl flex items-center gap-3 sm:gap-4 transition-all duration-300 w-full sm:w-auto justify-center border-t",
                    loading
                      ? "bg-gradient-to-br from-cyan-400 via-blue-500 to-blue-700 border-cyan-300/40 shadow-[0_12px_40px_rgba(59,130,246,0.5)] text-white animate-pulse"
                      : "bg-gradient-to-br from-orange-400 via-orange-500 to-orange-700 hover:from-orange-300 hover:via-orange-400 hover:to-orange-600 border-white/40 shadow-[0_12px_40px_rgba(249,115,22,0.4)] text-white"
                  )}
                >
                  {loading ? (
                    <RefreshCw className="w-6 h-6 sm:w-7 sm:h-7 animate-spin" />
                  ) : (
                    <Search className="w-6 h-6 sm:w-7 sm:h-7" />
                  )}
                  <span className="tracking-tighter">{loading ? '분석 진행중...' : '주도주 분석 시작'}</span>
                </button>

                {/* Last Updated Info */}
                {lastUpdated && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-bold text-white/20 uppercase tracking-[0.2em] flex items-center gap-2">
                      <Clock className="w-3 h-3" />
                      Last Updated: {lastUpdated} (KST)
                    </p>
                    {marketContext?.dataSource && (
                      <p className="text-[10px] font-bold text-green-500/40 uppercase tracking-[0.1em] flex items-center gap-2">
                        <Globe className="w-2.5 h-2.5" />
                        Source: {marketContext.dataSource}
                      </p>
                    )}
                    {(() => {
                      const last = new Date(lastUpdated).getTime();
                      const now = new Date().getTime();
                      const diff = (now - last) / (1000 * 60);
                      if (diff > 30) {
                        return (
                          <p className="text-[10px] font-black text-orange-500/60 uppercase tracking-widest flex items-center gap-2 animate-pulse">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            Data may be stale. Please refresh for real-time analysis.
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}
              </div>
            </div>
            
            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-orange-500/10 blur-[120px] -mr-32 -mt-32 animate-pulse" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/5 blur-[100px] -ml-32 -mb-32" />
          </motion.div>

          {/* Market Sentiment Card */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="glass-3d rounded-2xl sm:rounded-3xl p-10 flex flex-col justify-between group"
          >
            <div>
              <h3 className="text-xs font-black text-white/30 uppercase tracking-[0.2em] mb-10 flex items-center gap-3">
                <BarChart3 className="w-5 h-5" />
                Market Sentiment
              </h3>
              
              <div className="space-y-8">
                {!marketContext && (
                  <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                      <BarChart3 className="w-7 h-7 text-white/20" />
                    </div>
                    <p className="text-sm font-bold text-white/25 uppercase tracking-widest">데이터 없음</p>
                    <p className="text-xs text-white/15 max-w-[200px] leading-relaxed">시장 분석을 실행하면<br/>센티멘트 지표가 표시됩니다</p>
                  </div>
                )}
                {marketContext && (
                  <>
                    {marketContext.fearAndGreed && (
                      <div className="group/item">
                        <div className="flex justify-between items-end mb-3">
                          <span className="text-sm font-bold text-white/50 uppercase tracking-wide">Fear & Greed</span>
                          <span className={cn(
                            "text-3xl font-bold tracking-tight",
                            (marketContext.fearAndGreed.value || 0) < 70 ? "text-green-500" : "text-red-500"
                          )}>
                            {marketContext.fearAndGreed.value || 0}<span className="text-sm ml-1 opacity-50 font-medium">{marketContext.fearAndGreed.status || 'Neutral'}</span>
                          </span>
                        </div>
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden shadow-inner">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${marketContext.fearAndGreed.value || 0}%` }}
                            className={cn(
                              "h-full transition-all duration-1000",
                              (marketContext.fearAndGreed.value || 0) < 70 ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]" : "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                            )}
                          />
                        </div>
                      </div>
                    )}

                    <div className="group/item">
                      <div className="flex justify-between items-end mb-3">
                        <span className="text-sm font-bold text-white/50 uppercase tracking-wide">삼성 IRI</span>
                        <span className={cn(
                          "text-3xl font-bold tracking-tight",
                          (marketContext.iri || 0) < 2.0 ? "text-green-500" : "text-red-500"
                        )}>
                          {(marketContext.iri || 0).toFixed(1)}<span className="text-sm ml-1 opacity-50 font-medium">pt</span>
                        </span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden shadow-inner">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min((marketContext.iri || 0) * 25, 100)}%` }}
                          className={cn(
                            "h-full transition-all duration-1000",
                            (marketContext.iri || 0) < 2.0 ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]" : "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                          )}
                        />
                      </div>
                    </div>

                    <div className="group/item">
                      <div className="flex justify-between items-end mb-3">
                        <span className="text-sm font-bold text-white/50 uppercase tracking-wide">VKOSPI</span>
                        <span className={cn(
                          "text-3xl font-bold tracking-tight",
                          (marketContext.vkospi || 0) < 20 ? "text-green-500" : "text-red-500"
                        )}>
                          {(marketContext.vkospi || 0).toFixed(1)}<span className="text-sm ml-1 opacity-50 font-medium">%</span>
                        </span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden shadow-inner">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min((marketContext.vkospi || 0) * 2.5, 100)}%` }}
                          className={cn(
                            "h-full transition-all duration-1000",
                            (marketContext.vkospi || 0) < 20 ? "bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]" : "bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                          )}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">환율 (USD/KRW)</span>
                        <div className="text-xl font-black text-white tracking-tighter">
                          {marketContext.exchangeRate?.value ? marketContext.exchangeRate.value.toLocaleString() : <span className="text-sm text-white/20">—</span>}
                          {marketContext.exchangeRate?.value && typeof marketContext.exchangeRate.change === 'number' && (
                            <span className={cn("text-[10px] ml-2", marketContext.exchangeRate.change > 0 ? "text-red-400" : "text-green-400")}>
                              {marketContext.exchangeRate.change > 0 ? '▲' : '▼'} {Math.abs(marketContext.exchangeRate.change)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">국채 10년물</span>
                        <div className="text-xl font-black text-white tracking-tighter">
                          {marketContext.bondYield?.value ? `${marketContext.bondYield.value}%` : <span className="text-sm text-white/20">—</span>}
                          {marketContext.bondYield?.value && typeof marketContext.bondYield.change === 'number' && (
                            <span className={cn("text-[10px] ml-2", marketContext.bondYield.change > 0 ? "text-red-400" : "text-green-400")}>
                              {marketContext.bondYield.change > 0 ? '▲' : '▼'} {Math.abs(marketContext.bondYield.change)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {marketContext.globalMacro && (
                      <div className="grid grid-cols-2 gap-6">
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">미 국채 10년물</span>
                          <div className="text-xl font-black text-white tracking-tighter">
                            {marketContext.globalMacro.us10yYield}%
                          </div>
                        </div>
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block mb-1">달러 인덱스</span>
                          <div className="text-xl font-black text-white tracking-tighter">
                            {marketContext.globalMacro.dollarIndex}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="mt-8 space-y-4">
              <div className={cn(
                "p-5 rounded-2xl border-2 flex items-center justify-center gap-4 shadow-lg transition-all group-hover:scale-[1.05]",
                marketContext?.marketPhase === 'RISK_ON' || marketContext?.marketPhase === 'BULL' ? "bg-green-500/10 border-green-500/20 text-green-400 shadow-green-500/10" :
                marketContext?.marketPhase === 'RISK_OFF' || marketContext?.marketPhase === 'BEAR' ? "bg-red-500/10 border-red-500/20 text-red-400 shadow-red-500/10" :
                marketContext?.marketPhase === 'SIDEWAYS' ? "bg-blue-500/10 border-blue-500/20 text-blue-400 shadow-blue-500/10" :
                marketContext?.marketPhase === 'TRANSITION' ? "bg-purple-500/10 border-purple-500/20 text-purple-400 shadow-purple-500/10" :
                marketContext?.marketPhase === 'NEUTRAL' ? "bg-gray-500/10 border-gray-500/20 text-gray-400 shadow-gray-500/10" :
                "bg-white/5 border-white/10 text-white/60"
              )}>
                <div className={cn(
                  "w-3 h-3 rounded-full animate-pulse",
                  marketContext?.marketPhase === 'RISK_ON' || marketContext?.marketPhase === 'BULL' ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]" :
                  marketContext?.marketPhase === 'RISK_OFF' || marketContext?.marketPhase === 'BEAR' ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]" :
                  marketContext?.marketPhase === 'SIDEWAYS' ? "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)]" :
                  marketContext?.marketPhase === 'TRANSITION' ? "bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.8)]" :
                  marketContext?.marketPhase === 'NEUTRAL' ? "bg-gray-500 shadow-[0_0_10px_rgba(156,163,175,0.8)]" :
                  "bg-white/20"
                )} />
                <span className="text-sm font-black uppercase tracking-[0.1em]">
                  System: {getMarketPhaseInfo(marketContext?.marketPhase || (marketContext?.iri && marketContext.iri < 2.0 ? 'RISK_ON' : 'RISK_OFF') || 'NEUTRAL').label}
                </span>
              </div>

              <button
                onClick={onGenerateSummary}
                disabled={isSummarizing || (!(recommendations || []).length && !(searchResults || []).length && !marketContext)}
                className={cn(
                  "w-full btn-3d py-4 disabled:opacity-50 text-white text-sm font-black rounded-2xl transition-all duration-300 flex items-center justify-center gap-3 group/btn",
                  isSummarizing
                    ? "bg-gradient-to-r from-cyan-500 to-blue-600 shadow-xl shadow-blue-500/30 animate-pulse"
                    : "bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-xl shadow-orange-500/20"
                )}
              >
                {isSummarizing ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <Sparkles className="w-5 h-5 group-hover/btn:animate-pulse" />
                )}
                {isSummarizing ? '리포트 작성중...' : 'AI 시장분석'}
              </button>
            </div>
          </motion.div>
        </section>

        {/* Today's Top 3 Section */}
        {(recommendations || []).filter(s => (s.aiConvictionScore?.totalScore || 0) > 0 && Number.isFinite(Number(s.currentPrice)) && Number(s.currentPrice) > 0).length > 0 && (
          <section className="mb-16">
            <div className="flex items-center justify-between mb-8 px-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-orange-500/20 rounded-2xl flex items-center justify-center">
                  <Crown className="w-6 h-6 text-orange-500" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-theme-text tracking-tighter uppercase">오늘의 Top 3 주도주</h3>
                  <p className="text-sm text-theme-text-muted font-bold">27단계 마스터 체크리스트를 가장 완벽하게 통과한 종목</p>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-theme-surface rounded-xl border border-theme-border">
                <Activity className="w-4 h-4 text-green-400" />
                <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest">실시간 AI 랭킹 시스템 가동 중</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[...(recommendations || [])]
                .filter(s => (s.aiConvictionScore?.totalScore || 0) > 0 && Number.isFinite(Number(s.currentPrice)) && Number(s.currentPrice) > 0)
                .sort((a, b) => (b.aiConvictionScore?.totalScore || 0) - (a.aiConvictionScore?.totalScore || 0))
                .slice(0, 3)
                .map((stock, idx) => (
                  <motion.div
                    key={stock.code}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    onClick={() => {
                      console.log("🔥 Top3 카드 클릭됨:", stock.name, stock.code);
                      setDeepAnalysisStock(stock);
                    }}
                    className="glass-3d rounded-2xl sm:rounded-3xl p-8 border border-white/10 relative overflow-hidden group cursor-pointer hover:border-orange-500/50 transition-all"
                  >
                    <div className="absolute top-0 right-0 p-6">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl border shadow-2xl",
                        idx === 0 ? "bg-orange-500 border-orange-400 text-white" :
                        idx === 1 ? "bg-slate-400 border-slate-300 text-white" :
                        "bg-amber-700 border-amber-600 text-white"
                      )}>
                        {idx + 1}
                      </div>
                    </div>

                    <div className="mb-8">
                      <div className={cn(
                        "text-[10px] font-black uppercase tracking-[0.3em] mb-2",
                        (stock.type || '').includes('BUY') ? "text-red-500" : "text-blue-500"
                      )}>
                        {(stock.type || '').replace('_', ' ')}
                      </div>
                      <h4 className="text-2xl sm:text-3xl font-black text-theme-text tracking-tighter mb-1 truncate" title={stock.name}>{stock.name}</h4>
                      <div className="text-xs sm:text-sm font-black text-theme-text-muted uppercase tracking-widest truncate">{stock.code}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                      <div className="bg-theme-card rounded-2xl p-4 border border-theme-border">
                        <div className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest mb-1">AI Score</div>
                        <div className="text-2xl font-black text-orange-500">{stock.aiConvictionScore?.totalScore || 0}</div>
                      </div>
                      <div className="bg-theme-card rounded-2xl p-4 border border-theme-border">
                        <div className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest mb-1">Checklist</div>
                        <div className="text-2xl font-black text-theme-text">{Object.values(stock.checklist || {}).filter(Boolean).length}/27</div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-green-400" />
                          <span className="text-lg font-black text-theme-text">₩{stock.currentPrice?.toLocaleString() || '0'}</span>
                          <ConfidenceBadge type={stock.dataSourceType || 'AI'} />
                        </div>
                        {(stock.priceUpdatedAt || stock.dataSource) && (
                          <div className="text-[8px] font-black text-theme-text-muted uppercase tracking-tighter mt-1">
                            {stock.priceUpdatedAt} {stock.dataSource && `via ${stock.dataSource}`}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-green-400 font-black text-sm">
                        <ArrowUpRight className="w-4 h-4" />
                        {(() => {
                          const upside = Math.round(((Number(stock.targetPrice) || 0) / (Number(stock.currentPrice) || 1) - 1) * 100);
                          return Number.isFinite(upside) && upside > 0 ? `+${upside}%` : 'N/A';
                        })()}
                      </div>
                    </div>

                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-orange-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  </motion.div>
                ))}
            </div>
          </section>
        )}

        {/* Market Context Section */}
        {marketContext && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <div className="glass-3d rounded-2xl sm:rounded-3xl p-8 border border-theme-border shadow-2xl relative overflow-hidden">
              <div className="flex flex-col lg:flex-row gap-8 items-center relative z-10">
                <div className="flex-1 space-y-6 w-full">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <div className="w-2 h-8 bg-orange-500 rounded-full" />
                    <h3 className="text-xl font-black text-theme-text uppercase tracking-tighter">실시간 시장 분석 (Market Context)</h3>
                    {marketContext.upcomingEvents && marketContext.upcomingEvents.some(e => e.impact === 'HIGH' && e.dDay <= 5) && (
                      <motion.div 
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full bg-red-500/10 border border-red-500/20 rounded-3xl p-6 flex flex-col md:flex-row items-center gap-6 relative overflow-hidden group mt-4"
                      >
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                          <AlertTriangle className="w-24 h-24 text-red-500" />
                        </div>
                        <div className="w-16 h-16 rounded-2xl bg-red-500/20 flex items-center justify-center shrink-0">
                          <CalendarIcon className="w-8 h-8 text-red-500" />
                        </div>
                        <div className="flex-1 text-center md:text-left relative z-10">
                          <div className="flex items-center justify-center md:justify-start gap-2 mb-1">
                            <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">Critical Market Event Detected</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                          </div>
                          <h3 className="text-xl font-black text-white mb-2">
                            {marketContext.upcomingEvents.find(e => e.impact === 'HIGH' && e.dDay <= 5)?.title} (D-{marketContext.upcomingEvents.find(e => e.impact === 'HIGH' && e.dDay <= 5)?.dDay})
                          </h3>
                          <p className="text-sm text-gray-400 font-medium max-w-xl">
                            {marketContext.upcomingEvents.find(e => e.impact === 'HIGH' && e.dDay <= 5)?.strategyAdjustment}
                          </p>
                        </div>
                        <button 
                          onClick={() => setView('MARKET')}
                          className="px-6 py-3 bg-red-500 text-white text-sm font-black rounded-2xl hover:bg-red-600 transition-all flex items-center gap-2 shrink-0 relative z-10"
                        >
                          상세 분석 보기
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </motion.div>
                    )}
                    {marketContext.marketPhase && (
                      <div className={cn(
                        "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border-2 flex items-center gap-2 whitespace-nowrap shrink-0",
                        marketContext.marketPhase === 'RISK_ON' || marketContext.marketPhase === 'BULL' ? "bg-green-500/20 text-green-400 border-green-500/30" :
                        marketContext.marketPhase === 'RISK_OFF' || marketContext.marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400 border-red-500/30" : 
                        marketContext.marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                        marketContext.marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
                        marketContext.marketPhase === 'NEUTRAL' ? "bg-gray-500/20 text-gray-400 border-gray-500/30" :
                        "bg-white/10 text-white/60 border-white/20"
                      )} title={getMarketPhaseInfo(marketContext.marketPhase).description}>
                        {getMarketPhaseInfo(marketContext.marketPhase).label}
                        <Info className="w-3 h-3 opacity-50" />
                      </div>
                    )}
                  </div>
                  <p className="text-theme-text-secondary text-lg leading-relaxed font-black">
                    {marketContext.overallSentiment}
                  </p>
                  
                  <div className="bg-theme-card p-4 rounded-2xl border border-theme-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Info className="w-4 h-4 text-orange-500" />
                      <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest">Market Phase란?</span>
                    </div>
                    <p className="text-[11px] text-theme-text-secondary leading-relaxed font-medium">
                      현재 시장이 처한 <strong>'단계'</strong>를 의미합니다. {getMarketPhaseInfo(marketContext.marketPhase).description} 
                      AI는 이 단계를 분석하여 각 종목에 대한 투자 비중과 전략을 동적으로 조절합니다.
                    </p>
                  </div>

                  {marketContext.activeStrategy && (
                    <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/20 px-6 py-4 rounded-3xl group/strategy hover:bg-orange-500/20 transition-all">
                      <div className="w-10 h-10 rounded-2xl bg-orange-500/20 flex items-center justify-center group-hover/strategy:scale-110 transition-transform">
                        <Zap className="w-5 h-5 text-orange-500" />
                      </div>
                      <div>
                        <span className="text-[10px] font-black text-orange-500/60 uppercase tracking-[0.2em] block mb-1">AI 동적 가중치 전략 (Dynamic Weighting)</span>
                        <p className="text-sm font-black text-white/80 leading-tight">
                          {marketContext.activeStrategy}
                        </p>
                      </div>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">KOSPI</span>
                          <span className="text-2xl font-black text-white tracking-tighter">{marketContext.kospi.index?.toLocaleString() || '0'}</span>
                        </div>
                        <div className={cn(
                          "px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5",
                          marketContext.kospi.change >= 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                        )}>
                          {marketContext.kospi.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {marketContext.kospi.changePercent}%
                        </div>
                      </div>
                      <p className="text-xs text-white/50 leading-relaxed font-bold">
                        {marketContext.kospi.analysis}
                      </p>
                    </div>

                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">KOSDAQ</span>
                          <span className="text-2xl font-black text-white tracking-tighter">{marketContext.kosdaq.index?.toLocaleString() || '0'}</span>
                        </div>
                        <div className={cn(
                          "px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5",
                          marketContext.kosdaq.change >= 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                        )}>
                          {marketContext.kosdaq.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {marketContext.kosdaq.changePercent}%
                        </div>
                      </div>
                      <p className="text-xs text-white/50 leading-relaxed font-bold">
                        {marketContext.kosdaq.analysis}
                      </p>
                    </div>
                  </div>

                  {/* New Quant Features in Market Context */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {marketContext.sectorRotation && (
                      <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                        <div className="flex items-center gap-2 mb-4">
                          <Layers className="w-4 h-4 text-blue-400" />
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Sector Rotation</span>
                        </div>
                        <div className="space-y-3">
                          {(marketContext.sectorRotation?.topSectors || []).slice(0, 3).map((sector, i) => (
                            <div key={i} className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white/60">{sector.name}</span>
                              <span className="text-[10px] font-black text-blue-400 uppercase tracking-tighter">Rank {sector.rank}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {marketContext.euphoriaSignals && (
                      <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                        <div className="flex items-center gap-2 mb-4">
                          <Flame className="w-4 h-4 text-orange-500" />
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Euphoria Detector</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-3xl font-black text-white">{marketContext.euphoriaSignals.score}</div>
                          <div className="flex-1">
                            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div 
                                className={cn(
                                  "h-full transition-all duration-1000",
                                  marketContext.euphoriaSignals.score > 70 ? "bg-red-500" : "bg-orange-500"
                                )}
                                style={{ width: `${marketContext.euphoriaSignals.score}%` }}
                              />
                            </div>
                            <p className="text-[10px] font-bold text-white/30 mt-2 uppercase tracking-widest">
                              {marketContext.euphoriaSignals.status}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {marketContext.regimeShiftDetector && (
                      <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                        <div className="flex items-center gap-2 mb-4">
                          <Zap className="w-4 h-4 text-purple-400" />
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Regime Shift</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-2xl flex items-center justify-center",
                            marketContext.regimeShiftDetector.isShiftDetected ? "bg-red-500/20 text-red-500" : "bg-green-500/20 text-green-500"
                          )}>
                            <Activity className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-xs font-black text-white uppercase tracking-tight">
                              {marketContext.regimeShiftDetector.currentRegime}
                            </p>
                            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">
                              {marketContext.regimeShiftDetector.isShiftDetected ? "Shift Detected" : "Stable Regime"}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {marketContext.globalEtfMonitoring && (
                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 shadow-inner group hover:bg-white/[0.08] transition-all">
                      <div className="flex items-center gap-2 mb-4">
                        <Globe className="w-4 h-4 text-indigo-400" />
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">Global ETF Monitoring</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {(marketContext.globalEtfMonitoring || []).map((etf, i) => (
                          <div key={i} className="flex flex-col gap-1">
                            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest truncate">{etf.name || etf.symbol}</span>
                            {etf.symbol && <span className="text-[9px] text-white/20">{etf.symbol}</span>}
                            <div className="flex items-center gap-2">
                              {etf.price ? (
                                <span className="text-sm font-black text-white">₩{etf.price.toLocaleString()}</span>
                              ) : null}
                              <span className={cn("text-[10px] font-bold", (etf.change || 0) >= 0 ? "text-green-400" : "text-red-400")}>
                                {(etf.change || 0) >= 0 ? '+' : ''}{etf.change || 0}%
                              </span>
                            </div>
                            {etf.flow && (
                              <span className={cn("text-[9px] font-black uppercase tracking-widest", etf.flow === 'INFLOW' ? "text-green-400/60" : "text-red-400/60")}>
                                {etf.flow === 'INFLOW' ? '▲ 유입' : '▼ 유출'}
                              </span>
                            )}
                            {etf.implication && (
                              <span className="text-[9px] text-white/20 leading-tight">{etf.implication}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {marketContext.globalIndices && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-inner">
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">NASDAQ</span>
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-black text-white">{marketContext.globalIndices.nasdaq.index?.toLocaleString() || '0'}</span>
                          <span className={cn("text-[10px] font-black", marketContext.globalIndices.nasdaq.changePercent >= 0 ? "text-green-400" : "text-red-400")}>
                            {marketContext.globalIndices.nasdaq.changePercent >= 0 ? '+' : ''}{marketContext.globalIndices.nasdaq.changePercent}%
                          </span>
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-inner">
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">S&P 500</span>
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-black text-white">{marketContext.globalIndices.snp500.index?.toLocaleString() || '0'}</span>
                          <span className={cn("text-[10px] font-black", marketContext.globalIndices.snp500.changePercent >= 0 ? "text-green-400" : "text-red-400")}>
                            {marketContext.globalIndices.snp500.changePercent >= 0 ? '+' : ''}{marketContext.globalIndices.snp500.changePercent}%
                          </span>
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-inner">
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">DOW</span>
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-black text-white">{marketContext.globalIndices.dow.index?.toLocaleString() || '0'}</span>
                          <span className={cn("text-[10px] font-black", marketContext.globalIndices.dow.changePercent >= 0 ? "text-green-400" : "text-red-400")}>
                            {marketContext.globalIndices.dow.changePercent >= 0 ? '+' : ''}{marketContext.globalIndices.dow.changePercent}%
                          </span>
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-inner">
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest block mb-1">SOX (Semicon)</span>
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-black text-white">{marketContext.globalIndices.sox.index?.toLocaleString() || '0'}</span>
                          <span className={cn("text-[10px] font-black", marketContext.globalIndices.sox.changePercent >= 0 ? "text-green-400" : "text-red-400")}>
                            {marketContext.globalIndices.sox.changePercent >= 0 ? '+' : ''}{marketContext.globalIndices.sox.changePercent}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Decorative background */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/5 blur-[80px] -mr-20 -mt-20" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/5 blur-[60px] -ml-16 -mb-16" />
            </div>
          </motion.section>
        )}

        {/* AI Report Summary Section */}
        <AnimatePresence>
          {reportSummary && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-12 overflow-hidden"
            >
              <div className="glass-3d rounded-2xl sm:rounded-3xl p-8 border border-orange-500/20 shadow-2xl relative overflow-hidden bg-gradient-to-br from-orange-500/5 to-transparent">
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-8 bg-orange-500 rounded-full" />
                      <h3 className="text-xl font-black text-theme-text uppercase tracking-tighter flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-orange-500" />
                        AI 시장분석
                      </h3>
                    </div>
                    <button
                      onClick={() => setReportSummary(null)}
                      className="p-2 hover:bg-theme-surface rounded-full transition-colors text-theme-text-muted hover:text-theme-text"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="prose prose-invert max-w-none">
                    <div className="text-theme-text-secondary text-lg leading-relaxed font-medium space-y-4">
                      <ReactMarkdown>{reportSummary}</ReactMarkdown>
                    </div>
                  </div>
                </div>
                
                {/* Decorative background */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 blur-[80px] -mr-20 -mt-20 animate-pulse" />
              </div>
            </motion.section>
          )}
        </AnimatePresence>
        <Section>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto no-scrollbar pb-1">
              <h3 className="text-lg sm:text-xl lg:text-2xl font-black flex items-center gap-2 sm:gap-3 whitespace-nowrap shrink-0 text-theme-text">
                {view === 'DISCOVER' ? (
                  <>
                    <div className="w-1.5 h-7 sm:h-8 bg-orange-500 rounded-full shadow-[0_0_10px_rgba(249,115,22,0.4)]" />
                    <Search className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
                    종목검색
                  </>
                ) : (
                  <>
                    <div className="w-1.5 h-7 sm:h-8 bg-orange-500 rounded-full shadow-[0_0_10px_rgba(249,115,22,0.4)]" />
                    <Bookmark className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500" />
                    나의 관심 목록
                  </>
                )}
              </h3>
              <button
                onClick={onFetchStocks}
                disabled={loading}
                className={cn(
                  "p-2 border rounded-xl transition-all duration-300 group/refresh active:scale-90",
                  loading
                    ? "bg-blue-500/20 border-blue-500/30 shadow-[0_0_12px_rgba(59,130,246,0.2)]"
                    : "bg-theme-card hover:bg-orange-500/20 border-theme-border"
                )}
                title="실시간 시세 새로고침"
              >
                <RefreshCw className={cn("w-4 h-4 transition-colors duration-300", loading ? "animate-spin text-blue-400" : "text-theme-text-muted group-hover/refresh:text-orange-500")} />
              </button>

              <button
                onClick={onFetchNewsScores}
                disabled={loadingNews || recommendations.length === 0}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 border rounded-xl transition-all duration-300 text-xs font-bold active:scale-90",
                  loadingNews
                    ? "bg-cyan-500/20 border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.2)]"
                    : "bg-theme-card hover:bg-cyan-500/20 border-theme-border"
                )}
                title="뉴스 빈도 역지표 분석"
              >
                <Newspaper className={cn("w-3.5 h-3.5 transition-colors duration-300", loadingNews ? "animate-pulse text-cyan-400" : "text-theme-text-muted")} />
                <span className={cn("transition-colors duration-300", loadingNews ? "text-cyan-400" : "text-theme-text-muted")}>
                  {loadingNews ? '분석중...' : '뉴스 분석'}
                </span>
              </button>

              <button
                onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border whitespace-nowrap shrink-0",
                  autoSyncEnabled 
                    ? "bg-green-500/20 text-green-400 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.1)]" 
                    : "bg-theme-card text-theme-text-muted border-theme-border hover:bg-white/10"
                )}
                title="개별 종목 실시간 가격 동기화"
              >
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  autoSyncEnabled ? "bg-green-400 animate-pulse" : "bg-theme-text-muted"
                )} />
                {autoSyncEnabled ? `실시간 동기화 (${nextSyncCountdown}s)` : "실시간 동기화 꺼짐"}
              </button>

              <button
                onClick={onSyncAll}
                disabled={syncStatus.isSyncing}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all duration-300 border whitespace-nowrap shrink-0",
                  syncStatus.isSyncing
                    ? "bg-blue-500/20 border-blue-500/30 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.2)] cursor-not-allowed"
                    : "bg-orange-500/10 border-orange-500/20 text-orange-500 hover:bg-orange-500/20 hover:border-orange-500/40 shadow-sm active:scale-95"
                )}
                title="현재 화면의 모든 종목 실시간 동기화"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", syncStatus.isSyncing && "animate-spin text-blue-400")} />
                <span>{syncStatus.isSyncing ? "동기화 중..." : "전체 동기화"}</span>
              </button>
            </div>

            {/* Common Search & Filter Area */}
            <div className="flex flex-col gap-4 w-full">
              <div className="flex flex-wrap gap-6 items-end">
                {/* Search & Filter Input */}
                <div className="flex flex-col gap-3 flex-1 min-w-[320px]">
                  <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-4 bg-orange-500 rounded-full shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                      <span className="text-sm sm:text-base font-black text-theme-text uppercase tracking-tight">종목 검색 및 실시간 필터</span>
                      <div className="relative group/info">
                        <Info className="w-3.5 h-3.5 text-theme-text-muted hover:text-orange-500 transition-colors cursor-help" />
                        <div className="absolute left-0 top-6 w-80 max-h-[350px] overflow-y-auto p-4 bg-theme-bg backdrop-blur-xl border border-theme-border rounded-2xl shadow-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50 pointer-events-none">
                          <h4 className="text-xs font-black text-orange-500 mb-2 uppercase tracking-widest">빈칸 검색 추천 기준 (Top 10)</h4>
                          <ul className="space-y-2">
                            {[
                              { label: "시장 주도주", desc: "현재 시장의 주도 섹터 및 사이클 부합 여부" },
                              { label: "모멘텀 순위", desc: "업종 내 상대적 강도 및 모멘텀 상위권" },
                              { label: "ROE Type 3", desc: "자산회전율과 마진이 동반 상승하는 성장성" },
                              { label: "수급의 질", desc: "기관/외인의 질적인 수급 유입 및 매집 흔적" },
                              { label: "기술적 돌파", desc: "이동평균선 정배열 및 주요 지지/저항 돌파" },
                              { label: "종합 확신도", desc: "27가지 체크리스트 기반 최고 점수 종목 엄선" }
                            ].map((item, i) => (
                              <li key={i} className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-black text-theme-text-secondary">{item.label}</span>
                                <span className="text-[9px] font-medium text-theme-text-muted leading-tight">{item.desc}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-3 pt-3 border-t border-theme-border space-y-2">
                            <p className="text-[9px] font-bold text-orange-500/60 italic">* 검색어가 없을 경우 AI가 실시간 시장 데이터를 분석하여 가장 유망한 10개 종목을 추천합니다. 시장 상황은 매 순간 변하므로 검색 시마다 결과가 달라질 수 있습니다.</p>
                            <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                              <h5 className="text-[9px] font-black text-blue-400 mb-1 flex items-center gap-1">
                                <Lightbulb className="w-2.5 h-2.5" />
                                백테스팅 결과와 다른 이유?
                              </h5>
                              <p className="text-[8px] text-theme-text-muted font-medium leading-relaxed">
                                추천 종목은 단기 모멘텀에 집중하며, 백테스팅은 장기 안정성과 포트폴리오 조화를 평가합니다. 따라서 추천 종목이 백테스팅에서 리스크로 분류될 수 있습니다.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    {(searchQuery || searchResults.length > 0 || selectedType !== 'ALL' || selectedPattern !== 'ALL' || selectedSentiment !== 'ALL' || selectedChecklist.length > 0 || minPrice !== '' || maxPrice !== '') && (
                      <button 
                        onClick={handleResetScreen}
                        className="text-xs font-black text-orange-500 hover:text-orange-400 uppercase tracking-widest transition-colors flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" />
                        초기화
                      </button>
                    )}
                  </div>
                  <div className="flex gap-3 items-stretch">
                    <div className="relative flex-1 group">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-10">
                        <Search className="w-4 h-4 text-theme-text-muted group-focus-within:text-orange-500 transition-colors" />
                      </div>
                      <input
                        type="text"
                        placeholder="종목명 또는 코드를 입력하여 검색..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && onMarketSearch()}
                        className="w-full h-full bg-theme-input border-2 border-theme-border rounded-2xl pl-11 pr-6 py-3 text-base font-black text-theme-text placeholder:text-theme-text-muted placeholder:text-sm focus:outline-none focus:border-orange-500/50 focus:ring-4 focus:ring-orange-500/10 transition-all shadow-inner relative z-0"
                      />
                    </div>
                    <button
                      onClick={onMarketSearch}
                      disabled={searchingSpecific}
                      className={cn(
                        "px-6 text-white text-sm font-black rounded-2xl transition-all flex items-center gap-2 shrink-0 whitespace-nowrap",
                        searchingSpecific
                          ? "bg-gradient-to-br from-cyan-400 via-blue-500 to-blue-700 shadow-lg shadow-blue-500/30 animate-pulse cursor-not-allowed"
                          : "btn-3d bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-500/20"
                      )}
                    >
                      {searchingSpecific ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                      {searchingSpecific ? '검색 중...' : '시장 검색'}
                    </button>
                  </div>
                </div>

                {/* Sort Dropdown */}
                <div className="flex flex-col gap-3 min-w-[200px]">
                  <div className="flex items-center gap-2 px-2">
                    <div className="w-1.5 h-4 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                    <span className="text-xs font-black text-theme-text-muted uppercase tracking-[0.1em]">정렬 기준</span>
                  </div>
                  <div className="relative group">
                    <ArrowUpDown className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-text-muted group-focus-within:text-orange-500 transition-colors pointer-events-none" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="w-full bg-theme-surface border-2 border-theme-border rounded-2xl pl-12 pr-10 py-4 text-base font-black text-theme-text appearance-none focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all shadow-2xl cursor-pointer h-[60px]"
                    >
                      <option value="NAME">이름순 (가나다)</option>
                      <option value="CODE">종목코드순</option>
                      <option value="PERFORMANCE">수익률/성과순</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-theme-text-muted pointer-events-none" />
                  </div>
                </div>

                <div className="flex flex-col gap-6">
                  {view === 'DISCOVER' && (
                    <>
                      <div className="flex items-center justify-between px-1">
                        <button
                          onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                          className="flex items-center gap-2 hover:opacity-70 transition-opacity group"
                        >
                          <Settings className={cn("w-4 h-4 text-theme-text-muted group-hover:text-orange-500 transition-colors", isFilterExpanded && "text-orange-500")} />
                          <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-[0.2em] group-hover:text-theme-text-secondary transition-colors">필터 및 정밀 검증 설정</span>
                          {isFilterExpanded ? (
                            <ChevronUp className="w-3 h-3 text-theme-text-muted" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-theme-text-muted" />
                          )}
                        </button>
                        {(selectedType !== 'ALL' || selectedPattern !== 'ALL' || selectedSentiment !== 'ALL' || selectedChecklist.length > 0 || minPrice !== '' || maxPrice !== '') && (
                          <button 
                            onClick={handleResetScreen}
                            className="text-[10px] font-black text-orange-500 hover:text-orange-400 uppercase tracking-widest flex items-center gap-1 transition-colors"
                          >
                            <X className="w-3 h-3" />
                            모든 필터 및 검색 초기화
                          </button>
                        )}
                      </div>
                      {isFilterExpanded && (
                        <div className="px-1 mb-2">
                          <p className="text-[11px] text-theme-text-muted leading-relaxed">
                            AI 분석 전, 정량적 지표를 통해 1차 스크리닝을 수행합니다. 설정한 조건에 부합하는 종목들 중에서만 AI가 정밀 분석을 진행합니다.
                          </p>
                        </div>
                      )}
                      {isFilterExpanded && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-4 p-5 glass-3d rounded-2xl border border-theme-border bg-theme-surface">
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest ml-1">Min ROE (%)</label>
                            <input
                              type="number"
                              placeholder="최소 ROE (%)"
                              value={filters.minRoe || ''}
                              onChange={e => setFilters({...filters, minRoe: Number(e.target.value)})}
                              className="p-2.5 rounded-xl bg-theme-input border border-theme-border text-theme-text text-sm focus:border-orange-500/50 focus:outline-none transition-all"
                            />
                            <span className="text-[9px] text-theme-text-muted ml-1">자기자본이익률 (수익성)</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest ml-1">Max PER</label>
                            <input
                              type="number"
                              placeholder="최대 PER"
                              value={filters.maxPer || ''}
                              onChange={e => setFilters({...filters, maxPer: Number(e.target.value)})}
                              className="p-2.5 rounded-xl bg-theme-input border border-theme-border text-theme-text text-sm focus:border-orange-500/50 focus:outline-none transition-all"
                            />
                            <span className="text-[9px] text-theme-text-muted ml-1">주가수익비율 (저평가)</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest ml-1">Max Debt Ratio (%)</label>
                            <input
                              type="number"
                              placeholder="최대 부채비율 (%)"
                              value={filters.maxDebtRatio || ''}
                              onChange={e => setFilters({...filters, maxDebtRatio: Number(e.target.value)})}
                              className="p-2.5 rounded-xl bg-theme-input border border-theme-border text-theme-text text-sm focus:border-orange-500/50 focus:outline-none transition-all"
                            />
                            <span className="text-[9px] text-theme-text-muted ml-1">부채비율 (재무 건전성)</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-black text-theme-text-muted uppercase tracking-widest ml-1">Min Market Cap (억)</label>
                            <input
                              type="number"
                              placeholder="최소 시총 (억)"
                              value={filters.minMarketCap || ''}
                              onChange={e => setFilters({...filters, minMarketCap: Number(e.target.value)})}
                              className="p-2.5 rounded-xl bg-theme-input border border-theme-border text-theme-text text-sm focus:border-orange-500/50 focus:outline-none transition-all"
                            />
                            <span className="text-[9px] text-theme-text-muted ml-1">시가총액 (기업 규모)</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
                  <AnimatePresence>
                    {isFilterExpanded || view !== 'DISCOVER' ? (
                      <motion.div
                        key="filter-content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        className="flex flex-col gap-6 overflow-hidden"
                      >
                        {view === 'DISCOVER' ? (
                          <div className="flex flex-wrap gap-3 items-center">
                            {/* Type Filter */}
                            <div className="flex flex-col gap-2">
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-1">추천 유형</span>
                              <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 shadow-inner overflow-x-auto no-scrollbar">
                                {['ALL', 'STRONG_BUY', 'BUY', 'STRONG_SELL', 'SELL'].map((type) => (
                                  <button
                                    key={type}
                                    onClick={() => setSelectedType(type)}
                                    className={cn(
                                      "px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-xs font-black transition-all whitespace-nowrap shrink-0",
                                      selectedType === type
                                        ? "bg-orange-500 text-white shadow-[0_4px_10px_rgba(249,115,22,0.3)]"
                                        : "text-white/30 hover:text-white/60"
                                    )}
                                  >
                                    {type}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Sentiment Filter */}
                            <div className="flex flex-col gap-2">
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-1">시장 심리</span>
                              <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 shadow-inner overflow-x-auto no-scrollbar">
                                {[
                                  { id: 'ALL', label: '모든 심리' },
                                  { id: 'RISK_ON', label: 'Risk-On' },
                                  { id: 'RISK_OFF', label: 'Risk-Off' }
                                ].map((s) => (
                                  <button
                                    key={s.id}
                                    onClick={() => setSelectedSentiment(s.id)}
                                    className={cn(
                                      "px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-xs font-black transition-all whitespace-nowrap shrink-0",
                                      selectedSentiment === s.id
                                        ? "bg-blue-500 text-white shadow-[0_4px_10px_rgba(59,130,246,0.3)]"
                                        : "text-white/30 hover:text-white/60"
                                    )}
                                  >
                                    {s.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Pattern Filter */}
                            <div className="flex flex-col gap-2">
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-1">기술적 패턴</span>
                              <select 
                                value={selectedPattern}
                                onChange={(e) => setSelectedPattern(e.target.value)}
                                className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm font-black text-white/60 focus:outline-none focus:border-orange-500/50 transition-all shadow-inner cursor-pointer h-[52px]"
                              >
                                <option value="ALL">모든 패턴</option>
                                {allPatterns.map(pattern => (
                                  <option key={pattern} value={pattern}>{pattern}</option>
                                ))}
                              </select>
                            </div>

                            {/* Price Range Filter */}
                            <div className="flex flex-col gap-2">
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] px-1">가격 범위 (원)</span>
                              <div className="flex items-center gap-2 bg-white/5 p-1.5 rounded-2xl border border-white/10 shadow-inner">
                                <input 
                                  type="number"
                                  placeholder="최소"
                                  value={minPrice}
                                  onChange={(e) => setMinPrice(e.target.value)}
                                  className="w-20 bg-transparent border-none text-xs font-black text-white placeholder:text-white/20 focus:outline-none px-2"
                                />
                                <span className="text-white/20 text-xs">~</span>
                                <input 
                                  type="number"
                                  placeholder="최대"
                                  value={maxPrice}
                                  onChange={(e) => setMaxPrice(e.target.value)}
                                  className="w-20 bg-transparent border-none text-xs font-black text-white placeholder:text-white/20 focus:outline-none px-2"
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          null
                        )}

                          <div className="flex flex-col gap-3 bg-white/[0.02] p-5 rounded-3xl border border-white/5 shadow-inner">
                            <div className="flex items-center gap-2 mb-1">
                              <ShieldCheck className="w-4 h-4 text-orange-500/50" />
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">27단계 마스터 체크리스트 정밀 필터</span>
                            </div>
                            <div className="space-y-4 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                              {[1, 2, 3].map(gateNum => (
                                <div key={gateNum} className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-black text-orange-500/50 uppercase tracking-widest">Gate {gateNum}</span>
                                    <div className="h-px flex-1 bg-white/5" />
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {Object.entries(CHECKLIST_LABELS)
                                      .filter(([_, info]) => info.gate === gateNum)
                                      .map(([key, info]) => (
                                        <button
                                          key={key}
                                          onClick={() => {
                                            setSelectedChecklist(prev => {
                                              const current = prev || [];
                                              return current.includes(key) 
                                                ? current.filter(k => k !== key)
                                                : [...current, key];
                                            });
                                          }}
                                          className={cn(
                                            "px-3 py-2 rounded-xl text-[10px] font-black transition-all border whitespace-nowrap flex items-center gap-2",
                                            selectedChecklist.includes(key)
                                              ? "bg-orange-500/20 border-orange-500/50 text-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.15)]"
                                              : "bg-white/5 border-white/10 text-white/30 hover:text-white/60 hover:border-white/20"
                                          )}
                                          title={info.description}
                                        >
                                          <div className={cn(
                                            "w-1.5 h-1.5 rounded-full",
                                            selectedChecklist.includes(key) ? "bg-orange-500 animate-pulse" : "bg-white/10"
                                          )} />
                                          {info.label.split(' (')[0]}
                                        </button>
                                      ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <p className="text-[9px] text-white/10 font-bold uppercase tracking-widest mt-1">
                              * 선택한 모든 조건을 동시에 충족하는 종목만 표시됩니다.
                            </p>
                          </div>
                        
                      </motion.div>
                    ) : (
                      <motion.div
                        key="filter-collapsed"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="bg-white/[0.02] p-4 rounded-2xl border border-white/5 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">활성 필터:</span>
                            <div className="flex gap-1.5">
                              {selectedType !== 'ALL' && <span className="px-2 py-0.5 bg-orange-500/10 text-orange-500 text-[8px] font-black rounded-md border border-orange-500/20">{selectedType}</span>}
                              {selectedSentiment !== 'ALL' && <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 text-[8px] font-black rounded-md border border-blue-500/20">{selectedSentiment}</span>}
                              {selectedPattern !== 'ALL' && <span className="px-2 py-0.5 bg-white/10 text-white/40 text-[8px] font-black rounded-md border border-white/10">{selectedPattern}</span>}
                              {(minPrice !== '' || maxPrice !== '') && <span className="px-2 py-0.5 bg-green-500/10 text-green-500 text-[8px] font-black rounded-md border border-green-500/20">{minPrice || '0'} ~ {maxPrice || '무제한'}</span>}
                              {selectedChecklist.length > 0 && <span className="px-2 py-0.5 bg-orange-500/20 text-orange-500 text-[8px] font-black rounded-md border border-orange-500/30">체크리스트 {selectedChecklist.length}개</span>}
                              {selectedType === 'ALL' && selectedSentiment === 'ALL' && selectedPattern === 'ALL' && selectedChecklist.length === 0 && minPrice === '' && maxPrice === '' && (
                                <span className="text-[10px] font-black text-white/10 italic">적용된 필터 없음</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <button 
                          onClick={() => setIsFilterExpanded(true)}
                          className="text-[10px] font-black text-white/30 hover:text-white/60 transition-colors uppercase tracking-widest"
                        >
                          필터 펼치기
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>


          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 sm:mb-12 bg-white/5 rounded-[1.5rem] sm:rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-white/10 shadow-inner"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1.5 h-6 bg-orange-500 rounded-full shadow-[0_0_10px_rgba(249,115,22,0.5)]" />
              <span className="text-[10px] sm:text-xs font-black text-white/40 uppercase tracking-[0.2em]">종목 검색 퀵 네비게이션</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {displayList.map((stock) => (
                <button
                  key={`nav-${stock.code}`}
                  onClick={() => scrollToStock(stock.code)}
                  className="group flex items-center gap-2 sm:gap-3 bg-white/5 hover:bg-orange-500/10 border border-white/10 hover:border-orange-500/30 px-3 py-1.5 sm:px-4 sm:py-2.5 rounded-xl sm:rounded-2xl transition-all active:scale-95"
                >
                  <span className="text-[10px] sm:text-xs font-black text-white group-hover:text-orange-500 transition-colors truncate max-w-[80px] sm:max-w-none">{stock.name}</span>
                  <span className="text-[8px] sm:text-[10px] font-black text-white/20 group-hover:text-orange-500/40 transition-colors">{stock.code}</span>
                  <ChevronRight className="w-3 h-3 text-white/10 group-hover:text-orange-500 transition-colors shrink-0" />
                </button>
              ))}
            </div>
          </motion.div>

          {view === 'DISCOVER' && (
            <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white/5 p-6 rounded-xl sm:rounded-2xl border border-white/10 shadow-inner flex flex-col justify-center items-center gap-2 relative group/stat-1">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.1em] sm:tracking-[0.2em] text-center">AI 추천 적중률 (최근 10회)</span>
                  <HelpCircle className="w-3 h-3 text-white/10 cursor-help" />
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-black text-orange-500 tracking-tighter">{averageHitRate}%</span>
                  <div className={cn(
                    "mb-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest",
                    averageHitRate >= 85 ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"
                  )}>
                    {averageHitRate >= 85 ? "Excellent" : "Stable"}
                  </div>
                </div>
                
                {/* Tooltip */}
                <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-64 max-h-[250px] overflow-y-auto p-4 bg-theme-card backdrop-blur-xl border border-theme-border rounded-2xl opacity-0 group-hover/stat-1:opacity-100 transition-all duration-300 z-50 pointer-events-none shadow-2xl scale-95 group-hover/stat-1:scale-100 origin-top">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1 h-3 bg-orange-500 rounded-full" />
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">산출 기준</span>
                  </div>
                  <p className="text-[11px] text-white/60 leading-relaxed font-medium">
                    최근 10번의 추천 세션에서 선정된 종목들이 추천 시점 이후 <span className="text-orange-400">5거래일 이내에 +3% 이상의 수익률</span>을 기록한 비율의 평균입니다. 시스템의 전반적인 단기 예측 성공률을 나타냅니다.
                  </p>
                </div>
              </div>

              <div className="bg-white/5 p-6 rounded-xl sm:rounded-2xl border border-white/10 shadow-inner flex flex-col justify-center items-center gap-2 relative group/stat-2">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.1em] sm:tracking-[0.2em] text-center">Recent 30-day STRONG_BUY hit rate</span>
                  <HelpCircle className="w-3 h-3 text-white/10 cursor-help" />
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-black text-indigo-400 tracking-tighter">{strongBuyHitRate}%</span>
                  <div className="mb-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest bg-indigo-500/20 text-indigo-400">
                    High Precision
                  </div>
                </div>

                {/* Tooltip */}
                <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-64 max-h-[250px] overflow-y-auto p-4 bg-theme-card backdrop-blur-xl border border-theme-border rounded-2xl opacity-0 group-hover/stat-2:opacity-100 transition-all duration-300 z-50 pointer-events-none shadow-2xl scale-95 group-hover/stat-2:scale-100 origin-top">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">산출 기준</span>
                  </div>
                  <p className="text-[11px] text-white/60 leading-relaxed font-medium">
                    최근 30일간 <span className="text-indigo-400">AI 확신도(Conviction Score)가 85점 이상</span>인 '강력 매수' 종목들의 적중률입니다. 고확신도 종목에 대한 정밀도를 나타내며, 일반 추천보다 엄격한 기준으로 관리됩니다.
                  </p>
                </div>
              </div>
              
              <div className="md:col-span-2 bg-white/5 p-6 rounded-xl sm:rounded-2xl border border-white/10 shadow-inner">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-white/30" />
                    <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">최근 추천 히스토리</span>
                  </div>
                  <span className="text-[9px] font-black text-white/10 uppercase tracking-widest">최근 10개 세션 저장됨</span>
                </div>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                  {recommendationHistory.length > 0 ? (
                    recommendationHistory.map((item, idx) => (
                      <div key={idx} className="flex-shrink-0 bg-white/5 p-3 rounded-2xl border border-white/5 min-w-[140px]">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[9px] font-black text-white/20">{item.date}</span>
                          <span className="text-[10px] font-black text-orange-500">{item.hitRate}%</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {item.stocks.slice(0, 2).map((s, i) => (
                            <span key={i} className="text-[9px] font-bold text-white/40 bg-white/5 px-1.5 py-0.5 rounded-md truncate max-w-[60px]">{s}</span>
                          ))}
                          {item.stocks.length > 2 && <span className="text-[9px] font-bold text-white/20">+{item.stocks.length - 2}</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="w-full py-4 flex items-center justify-center border border-dashed border-white/5 rounded-2xl">
                      <span className="text-[10px] font-black text-white/10 uppercase tracking-widest italic">히스토리 데이터 없음</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {loading && view === 'DISCOVER' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-64 bg-white/5 rounded-3xl animate-pulse border border-white/10" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {displayList.length > 0 && view === 'DISCOVER' && (
                <div className={cn(
                  "flex flex-wrap items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3 rounded-2xl border mb-4 backdrop-blur-sm",
                  lastUsedMode === 'MOMENTUM'
                    ? "bg-orange-500/10 border-orange-500/20"
                    : "bg-blue-500/10 border-blue-500/20"
                )}>
                  {lastUsedMode === 'MOMENTUM' ? (
                    <Zap className="w-4 h-4 text-orange-400 fill-current flex-shrink-0" />
                  ) : (
                    <Radar className="w-4 h-4 text-blue-400 flex-shrink-0" />
                  )}
                  <span className={cn(
                    "text-xs font-black uppercase tracking-widest",
                    lastUsedMode === 'MOMENTUM' ? "text-orange-400" : "text-blue-400"
                  )}>
                    {lastUsedMode === 'MOMENTUM' ? '지금 살 종목' : '미리 볼 종목'} 결과
                  </span>
                  <span className="text-xs text-white/30 font-bold">
                    — {displayList.length}개 종목
                  </span>
                  <span className="sm:ml-auto text-[10px] text-white/20 font-bold">
                    {lastUsedMode === 'MOMENTUM'
                      ? '현재 강한 모멘텀 · 수급 집중 종목'
                      : '급등 전 선행 신호 · 에너지 응축 종목'}
                  </span>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                <AnimatePresence mode="popLayout">
                {displayList.length > 0 ? (
                  displayList.map((stock, idx) => (
                    <motion.div
                      key={stock.code}
                      id={`stock-${stock.code}`}
                      data-stock-code={stock.code}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: idx * 0.05 }}
                      onClick={() => setSelectedDetailStock(stock)}
                      className={cn(
                        "glass-3d card-3d rounded-2xl sm:rounded-3xl p-0 transition-all duration-500 relative overflow-hidden flex flex-col h-full group border-theme-border hover:border-white/20 cursor-pointer",
                        stock.peakPrice > 0 && Math.round((stock.currentPrice / stock.peakPrice - 1) * 100) <= -30
                          ? "!border-red-500/40 shadow-[0_0_40px_rgba(239,68,68,0.15)]"
                          : "shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
                      )}
                    >
                      {/* 관심종목 추가 시점 대비 등락 배지 */}
                      {view === 'WATCHLIST' && stock.watchedPrice && stock.watchedPrice > 0 && (() => {
                        const diff = stock.currentPrice - stock.watchedPrice;
                        const pct  = ((diff / stock.watchedPrice) * 100);
                        const isUp = diff >= 0;
                        return (
                          <div className={cn(
                            "flex items-center justify-between px-5 py-3 text-[11px] font-black uppercase tracking-widest",
                            isUp
                              ? "bg-red-500/20 text-red-400"
                              : "bg-blue-500/20 text-blue-400"
                          )}>
                            <div className="flex items-center gap-2">
                              {isUp
                                ? <TrendingUp className="w-3.5 h-3.5" />
                                : <TrendingDown className="w-3.5 h-3.5" />
                              }
                              <span>추가 대비</span>
                              <span className="text-base font-black">
                                {isUp ? '+' : ''}{pct.toFixed(2)}%
                              </span>
                            </div>
                            <div className="flex flex-col items-end text-[9px] opacity-60">
                              <span>추가가 ₩{stock.watchedPrice.toLocaleString()}</span>
                              <span>{stock.watchedAt}</span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Risk Alert Badge */}
                      {stock.peakPrice > 0 && Math.round((stock.currentPrice / stock.peakPrice - 1) * 100) <= -30 && (
                        <div className="bg-red-500/90 backdrop-blur-md text-[10px] font-black text-white py-2 px-4 flex items-center justify-center gap-2 z-20 animate-pulse uppercase tracking-[0.2em]">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Risk Alert: -30% Rule Exceeded
                        </div>
                      )}

                      {/* Mode Badge */}
                      {lastUsedMode === 'EARLY_DETECT' && (
                        <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-blue-500/20 border border-blue-500/30 px-2 py-1 rounded-lg backdrop-blur-sm">
                          <Radar className="w-2.5 h-2.5 text-blue-400" />
                          <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">선행</span>
                        </div>
                      )}
                      {lastUsedMode === 'MOMENTUM' && (
                        <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-orange-500/20 border border-orange-500/30 px-2 py-1 rounded-lg backdrop-blur-sm">
                          <Zap className="w-2.5 h-2.5 text-orange-400 fill-current" />
                          <span className="text-[9px] font-black text-orange-400 uppercase tracking-widest">모멘텀</span>
                        </div>
                      )}
                      {lastUsedMode === 'QUANT_SCREEN' && (
                        <div className="absolute top-3 left-3 z-10 flex items-center gap-1 bg-emerald-500/20 border border-emerald-500/30 px-2 py-1 rounded-lg backdrop-blur-sm">
                          <Activity className="w-2.5 h-2.5 text-emerald-400" />
                          <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">정량발굴</span>
                        </div>
                      )}

                      {/* News Frequency Contrarian Badge */}
                      {(() => {
                        const nfs = newsFrequencyScores.find(n => n.code === stock.code);
                        if (!nfs) return null;
                        const phaseColors: Record<string, string> = {
                          SILENT: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400',
                          EARLY: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400',
                          GROWING: 'bg-amber-500/20 border-amber-500/30 text-amber-400',
                          CROWDED: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
                          OVERHYPED: 'bg-red-500/20 border-red-500/30 text-red-400',
                        };
                        const phaseLabels: Record<string, string> = {
                          SILENT: '미인지', EARLY: '초기', GROWING: '관심↑', CROWDED: '과밀', OVERHYPED: '과열',
                        };
                        return (
                          <div className={`absolute top-3 right-3 z-10 flex items-center gap-1 border px-2 py-1 rounded-lg backdrop-blur-sm ${phaseColors[nfs.phase] || ''}`}>
                            <Newspaper className="w-2.5 h-2.5" />
                            <span className="text-[9px] font-black uppercase tracking-widest">
                              뉴스 {phaseLabels[nfs.phase] || nfs.phase} ({nfs.score})
                            </span>
                          </div>
                        );
                      })()}

                      {/* Card Header */}
                      <div className="p-5 sm:p-8 pb-4 sm:pb-6 bg-gradient-to-b from-white/[0.03] to-transparent">
                        {/* Name and Code Row */}
                        <div className="flex flex-col mb-4 sm:mb-6 gap-3 min-w-0">
                          <div className="relative p-4 sm:p-6 bg-white/[0.03] border border-white/10 rounded-2xl sm:rounded-xl sm:rounded-2xl overflow-hidden group/name-area shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]">
                            {/* Decorative Background Glow */}
                            <div className="absolute -top-12 -left-12 w-40 h-40 bg-orange-500/5 blur-[80px] rounded-full group-hover/name-area:bg-orange-500/15 transition-all duration-700" />
                            <div className="absolute -bottom-12 -right-12 w-40 h-40 bg-blue-500/5 blur-[80px] rounded-full group-hover/name-area:bg-blue-500/15 transition-all duration-700" />
                            
                            <div className="relative flex flex-col min-w-0">
                              <div className="flex items-start justify-between gap-2 sm:gap-3 min-w-0 mb-2">
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
                                  <div className="relative group/copy min-w-0">
                                    <h4
                                      onClick={(e) => { e.stopPropagation(); handleCopy(stock.name, stock.code); }}
                                      className="text-lg sm:text-2xl lg:text-3xl font-black tracking-tighter text-white group-hover:text-orange-500 transition-all duration-300 leading-tight cursor-pointer flex items-center gap-2 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] break-keep"
                                      title="종목명 복사"
                                    >
                                      {stock.name}
                                      <Copy className="w-4 h-4 opacity-0 group-hover/copy:opacity-50 transition-opacity shrink-0" />
                                    </h4>
                                    <AnimatePresence>
                                      {copiedCode === stock.code && (
                                        <motion.span
                                          initial={{ opacity: 0, y: 10 }}
                                          animate={{ opacity: 1, y: 0 }}
                                          exit={{ opacity: 0 }}
                                          className="absolute -top-10 left-0 text-[10px] font-black text-green-400 uppercase tracking-widest bg-green-500/20 backdrop-blur-md px-2 py-1 rounded-lg border border-green-500/30 z-30"
                                        >
                                          Copied!
                                        </motion.span>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                  <span className="text-[10px] sm:text-[12px] font-black text-white/60 bg-white/10 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl border border-white/20 tracking-[0.15em] uppercase shrink-0 shadow-lg backdrop-blur-sm">
                                    {stock.code}
                                  </span>
                                  {dartAlerts.some(a => a.stock_code.replace(/^A/, '') === stock.code) && (
                                    <div className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border bg-amber-500/20 text-amber-400 border-amber-500/30 shadow-lg backdrop-blur-md flex items-center gap-1 shrink-0"
                                      title={dartAlerts.filter(a => a.stock_code.replace(/^A/, '') === stock.code).map(a => a.report_nm).join(', ')}
                                    >
                                      <FileText className="w-3 h-3" />
                                      DART
                                    </div>
                                  )}
                                  {stock.gate && (
                                    <div className={cn(
                                      "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border shadow-lg backdrop-blur-md shrink-0",
                                      stock.gate === 1 ? "bg-red-500/20 text-red-400 border-red-500/30" :
                                      stock.gate === 2 ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                                      "bg-green-500/20 text-green-400 border-green-500/30"
                                    )}>
                                      Gate {stock.gate}
                                    </div>
                                  )}
                                </div>

                                {stock.aiConvictionScore && (
                                  <div className="flex flex-col items-end shrink-0">
                                    <span className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-0.5">Score</span>
                                    <span className={cn(
                                      "text-lg sm:text-xl font-black tracking-tighter",
                                      stock.aiConvictionScore.totalScore >= 80 ? "text-orange-500" :
                                      stock.aiConvictionScore.totalScore >= 60 ? "text-blue-400" : "text-white/60"
                                    )}>
                                      {stock.aiConvictionScore.totalScore}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {stock.chartPattern && (
                              <div className="flex items-center gap-2 mt-1">
                                <div className="flex items-center gap-2 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20 backdrop-blur-md">
                                  <TrendingUp className={cn("w-3.5 h-3.5", 
                                    (stock.chartPattern.type || '').includes('BULLISH') ? "text-green-400" : "text-red-400"
                                  )} />
                                  <span className="text-[10px] sm:text-[11px] font-black text-blue-400 uppercase tracking-[0.1em]">
                                    Pattern: {stock.chartPattern.name}
                                  </span>
                                </div>
                              </div>
                            )}
                            {stock.visualReport?.summary && (
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="flex items-center gap-2 bg-orange-500/10 px-3 py-1 rounded-full border border-orange-500/20 backdrop-blur-md">
                                    <Sparkles className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
                                    <span className="text-[10px] sm:text-[11px] font-black text-orange-400 uppercase tracking-[0.1em] break-keep">{stock.visualReport.summary}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              console.log("🔥 Deep Analysis 클릭됨:", stock.name, stock.code);
                              setDeepAnalysisStock(stock);
                            }}
                            className="w-full flex items-center justify-center gap-2.5 px-4 py-3 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 hover:border-orange-500/50 rounded-xl sm:rounded-2xl text-[10px] sm:text-[11px] font-black text-orange-500 transition-all uppercase tracking-[0.2em] active:scale-[0.98] shadow-[0_0_20px_rgba(249,115,22,0.05)] hover:shadow-[0_0_25px_rgba(249,115,22,0.15)] group/deep"
                          >
                            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 group-hover/deep:scale-110 transition-transform" />
                            Deep Analysis
                          </button>
                        </div>

                        {/* Signal and Action Row */}
                        <div className="flex justify-between items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
                          <div className="flex flex-wrap gap-2 sm:gap-3 items-center min-w-0">
                            {/* Signal Badge */}
                            <div className={cn(
                              "px-3 py-1 sm:px-4 sm:py-1.5 rounded-lg sm:rounded-xl text-[9px] sm:text-[11px] font-black uppercase tracking-[0.1em] sm:tracking-[0.2em] border shadow-xl flex items-center gap-1.5 sm:gap-2 transition-all transform group-hover:scale-105 shrink-0 whitespace-nowrap",
                              stock.type === 'STRONG_BUY' && "bg-red-600 text-white border-red-400/50 shadow-red-600/40 ring-2 ring-red-500/20",
                              stock.type === 'BUY' && "bg-red-500 text-white border-red-400/50 shadow-red-500/20",
                              stock.type === 'STRONG_SELL' && "bg-blue-600 text-white border-blue-400/50 shadow-blue-600/40 ring-2 ring-blue-500/20",
                              stock.type === 'SELL' && "bg-blue-500 text-white border-blue-400/50 shadow-blue-500/20"
                            )}>
                              <span className="opacity-50 text-[7px] sm:text-[8px] font-bold">SIGNAL</span>
                              {(stock.type || '').replace('_', ' ')}
                            </div>

                            {/* Other Badges */}
                            {stock.isLeadingSector && (
                              <span className="bg-orange-500 text-white text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest shadow-[0_4px_15px_rgba(249,115,22,0.4)] flex items-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap">
                                <Star className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-current" />
                                Leading
                              </span>
                            )}
                            {stock.isSectorTopPick && (
                              <span className="bg-blue-500 text-white text-[9px] sm:text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest shadow-[0_4px_15px_rgba(59,130,246,0.4)] flex items-center gap-1 sm:gap-1.5 shrink-0 whitespace-nowrap">
                                <Award className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-current" />
                                Top Pick
                              </span>
                            )}
                            <span className="text-[9px] sm:text-[10px] font-black text-white/50 bg-white/10 px-2.5 py-1 rounded-full border border-white/10 uppercase tracking-widest backdrop-blur-md truncate max-w-[100px] sm:max-w-none">
                              {stock.relatedSectors?.[0] || 'Market'}
                            </span>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); onAddToBacktest(stock); }}
                              className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-white/10 bg-white/5 text-white/30 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5 active:scale-90 shadow-sm"
                              title="Add to Backtest"
                            >
                              <History className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleWatchlist(stock); }}
                              className={cn(
                                "p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border active:scale-90 shadow-sm",
                                isWatched(stock.code)
                                  ? "bg-orange-500 text-white border-orange-400 shadow-[0_8px_20px_rgba(249,115,22,0.4)]"
                                  : "bg-white/5 border-white/10 text-white/30 hover:text-white/70 hover:bg-white/10"
                              )}
                            >
                              <Bookmark className={cn("w-4 h-4 sm:w-4.5 sm:h-4.5", isWatched(stock.code) && "fill-current")} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setTradeRecordStock(stock);
                                setTradeFormData({ buyPrice: String(stock.currentPrice || ''), quantity: '', positionSize: '10', followedSystem: true });
                              }}
                              className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-white/10 bg-white/5 text-white/30 hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-emerald-500/5 active:scale-90 shadow-sm"
                              title="매수 기록"
                            >
                              <Plus className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                            </button>
                            {(stock.type === 'STRONG_BUY' || stock.type === 'BUY') && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const totalAssets = kisBalance;
                                  const mockSignal = {
                                    positionSize: stock.type === 'STRONG_BUY' ? 20 : 10,
                                    rrr: 2,
                                    lastTrigger: stock.type === 'STRONG_BUY',
                                    recommendation: stock.type === 'STRONG_BUY' ? '풀 포지션' : '절반 포지션',
                                    profile: { stopLoss: -8 },
                                  } as any;
                                  const trade = buildShadowTrade(mockSignal, stock.code, stock.name, stock.currentPrice || stock.entryPrice || 0, totalAssets);
                                  addShadowTrade(trade);
                                  setView('AUTO_TRADE');
                                }}
                                className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 active:scale-90 shadow-sm"
                                title="Shadow Trading 등록"
                              >
                                <Zap className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* External Links & Market Heat */}
                        <div className="flex items-center justify-between mb-6 sm:mb-8 py-3 sm:py-4 border-y border-white/5 bg-white/[0.02] rounded-xl sm:rounded-2xl px-3 sm:px-4">
                          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                              <Flame className="w-4 h-4 sm:w-5 sm:h-5 text-orange-500 shrink-0" />
                              <div className="flex gap-0.5 sm:gap-1 overflow-hidden">
                                {[...Array(10)].map((_, i) => (
                                  <div 
                                    key={i} 
                                    className={cn(
                                      "w-1 sm:w-1.5 h-3 sm:h-4 rounded-full transition-all duration-500 shrink-0",
                                      i < stock.hotness ? "bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.6)]" : "bg-white/10"
                                    )} 
                                  />
                                ))}
                              </div>
                              <span className="text-[9px] sm:text-[11px] font-black text-white/40 ml-1 sm:ml-2 tracking-widest uppercase truncate">Heat</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                            <a
                              href={(() => {
                                const cleanCode = String(stock.code).replace(/[^0-9]/g, '');
                                return cleanCode.length === 6
                                  ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
                                  : `https://search.naver.com/search.naver?query=${encodeURIComponent(stock.name + ' 주가 차트')}`;
                              })()}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 sm:gap-2.5 px-3 py-1.5 sm:px-4 sm:py-2 bg-white/5 hover:bg-orange-500 hover:text-white border border-white/10 rounded-lg sm:rounded-xl transition-all group/link shadow-sm active:scale-95"
                            >
                              <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest">Chart</span>
                              <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform" />
                            </a>
                          </div>
                        </div>

                        {/* Automated Tranche Plan Section */}
                        {stock.tranchePlan && (
                          <div className="mb-6 sm:mb-8 bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10 shadow-inner">
                            <div className="flex items-center gap-2 mb-3">
                              <Target className="w-4 h-4 text-orange-500" />
                              <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Automated Tranche Plan</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {[
                                { id: '1', data: stock.tranchePlan.tranche1 },
                                { id: '2', data: stock.tranchePlan.tranche2 },
                                { id: '3', data: stock.tranchePlan.tranche3 }
                              ].map((t) => (
                                <div key={t.id} className="flex flex-col gap-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">T{t.id}</span>
                                    <span className="text-[9px] font-black text-orange-500/70">{t.data?.size || 0}%</span>
                                  </div>
                                  <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                                    <div className="text-[9px] font-black text-white/60 truncate" title={t.data?.trigger || ''}>
                                      {t.data?.trigger ? t.data.trigger.split(' (')[0] : '-'}
                                    </div>
                                    <div className="text-[7px] font-bold text-white/20 uppercase tracking-tighter truncate">
                                      {t.data?.trigger?.includes('(') ? t.data.trigger.split('(')[1].replace(')', '') : 'Trigger'}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Technical Health Section */}
                        <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mb-6 sm:mb-8">
                          <div className={cn(
                            "rounded-xl sm:rounded-2xl p-1.5 sm:p-2 border flex flex-col items-center justify-center gap-0.5 sm:gap-1 group/stat transition-all shadow-sm min-w-0 h-14 sm:h-16",
                            stock.confidenceScore && stock.confidenceScore >= 90 ? "bg-green-500/10 border-green-500/20" : "bg-white/5 border-white/5"
                          )}>
                            <span className="text-[6px] sm:text-[7px] font-black text-white/20 uppercase tracking-widest truncate w-full text-center">Conf.</span>
                            <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
                              <Zap className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0", stock.confidenceScore && stock.confidenceScore >= 90 ? "text-green-400 fill-current" : "text-white/20")} />
                              <span className={cn("text-[9px] sm:text-[10px] font-black tracking-tighter truncate", stock.confidenceScore && stock.confidenceScore >= 90 ? "text-green-400" : "text-white/70")}>
                                {stock.confidenceScore}%
                              </span>
                            </div>
                          </div>
                          <div className={cn(
                            "rounded-xl sm:rounded-2xl p-1.5 sm:p-2 border flex flex-col items-center justify-center gap-0.5 sm:gap-1 group/stat transition-all shadow-sm min-w-0 h-14 sm:h-16",
                            stock.momentumRank && stock.momentumRank <= 5 ? "bg-red-500/10 border-red-500/20" : "bg-white/5 border-white/5"
                          )}>
                            <span className="text-[6px] sm:text-[7px] font-black text-white/20 uppercase tracking-widest truncate w-full text-center">Mom.</span>
                            <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
                              <TrendingUp className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0", stock.momentumRank && stock.momentumRank <= 5 ? "text-red-400" : "text-white/20")} />
                              <span className={cn("text-[9px] sm:text-[10px] font-black tracking-tighter truncate", stock.momentumRank && stock.momentumRank <= 5 ? "text-red-400" : "text-white/70")}>
                                {stock.momentumRank}%
                              </span>
                            </div>
                          </div>
                          <div className={cn(
                            "rounded-xl sm:rounded-2xl p-1.5 sm:p-2 border flex flex-col items-center justify-center gap-0.5 sm:gap-1 group/stat transition-all shadow-sm min-w-0 h-14 sm:h-16",
                            stock.ichimokuStatus === 'ABOVE_CLOUD' ? "bg-blue-500/10 border-blue-500/20" : "bg-white/5 border-white/5"
                          )}>
                            <span className="text-[6px] sm:text-[7px] font-black text-white/20 uppercase tracking-widest truncate w-full text-center">Ichi.</span>
                            <div className="flex items-center justify-center gap-0.5 sm:gap-1 min-w-0 w-full">
                              <Cloud className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0", stock.ichimokuStatus === 'ABOVE_CLOUD' ? "text-blue-400" : "text-white/20")} />
                              <span className={cn("text-[7px] sm:text-[8px] font-black text-center tracking-tight leading-tight truncate", stock.ichimokuStatus === 'ABOVE_CLOUD' ? "text-blue-400" : "text-white/70")}>
                                {stock.ichimokuStatus?.split('_')[0] || 'N/A'}
                              </span>
                            </div>
                          </div>
                          <div className={cn(
                            "rounded-xl sm:rounded-2xl p-1.5 sm:p-2 border flex flex-col items-center justify-center gap-0.5 sm:gap-1 group/stat transition-all shadow-sm min-w-0 h-14 sm:h-16",
                            stock.isLeadingSector ? "bg-orange-500/10 border-orange-500/20" : "bg-white/5 border-white/5"
                          )}>
                            <span className="text-[6px] sm:text-[7px] font-black text-white/20 uppercase tracking-widest truncate w-full text-center">Sector</span>
                            <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
                              <Crown className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0", stock.isLeadingSector ? "text-orange-400" : "text-white/20")} />
                              <span className={cn("text-[9px] sm:text-[10px] font-black tracking-tighter truncate", stock.isLeadingSector ? "text-orange-400" : "text-white/70")}>
                                {stock.isLeadingSector ? 'LEAD' : 'MAIN'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Price Strategy Section */}
                      </div>
                      <div className="bg-white/[0.03] border-y border-white/10 p-5 sm:p-8 py-5 sm:py-7 relative">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 sm:mb-5 gap-3">
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-4 bg-orange-500 rounded-full" />
                            <span className="text-[10px] sm:text-[11px] font-black text-white/30 uppercase tracking-[0.2em] sm:tracking-[0.25em]">Price Strategy</span>
                          </div>
                            <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 sm:gap-1">
                              <div className="flex items-center gap-2 sm:gap-2.5 bg-orange-500/10 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg sm:rounded-xl border border-orange-500/20 shadow-[0_0_15px_rgba(249,115,22,0.1)] transition-all group-hover:bg-orange-500/20">
                                <div className="flex items-center gap-1.5 mr-1">
                                  <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-orange-500 animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.8)]" />
                                  <span className="text-[7px] sm:text-[8px] font-black text-orange-500 uppercase tracking-widest">LIVE</span>
                                </div>
                                <PriceEditCell
                                  stockCode={stock.code}
                                  currentPrice={stock.currentPrice}
                                  syncingStock={syncingStock}
                                  onManualUpdate={(newPrice) => onManualPriceUpdate(stock, newPrice)}
                                  onSync={() => onSyncPrice(stock)}
                                />
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                {stock.priceUpdatedAt && (
                                  <span className="text-[7px] sm:text-[8px] font-black text-white/20 uppercase tracking-widest flex items-center gap-1">
                                    <Clock className="w-2 h-2" />
                                    {stock.priceUpdatedAt}
                                  </span>
                                )}
                                {stock.financialUpdatedAt && (
                                  <span className="text-[7px] sm:text-[8px] font-black text-blue-400/40 uppercase tracking-widest flex items-center gap-1">
                                    <ShieldCheck className="w-2 h-2" />
                                    DART: {stock.financialUpdatedAt}
                                  </span>
                                )}
                                {stock.dataSourceType === 'REALTIME' ? (
                                  <span className="text-[7px] font-black text-green-500/50 uppercase tracking-[0.1em] flex items-center gap-1">
                                    <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                                    Verified Real-time
                                  </span>
                                ) : (
                                  <span className="text-[7px] font-black text-orange-500/50 uppercase tracking-[0.1em] flex items-center gap-1">
                                    <div className="w-1 h-1 bg-orange-500 rounded-full" />
                                    AI Estimated
                                  </span>
                                )}
                              </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:gap-4">
                          <div className="bg-blue-500/5 rounded-2xl sm:rounded-3xl p-3 sm:p-5 border border-blue-500/10 flex flex-col items-center justify-center gap-1.5 sm:gap-2 group/price hover:bg-blue-500/10 transition-all shadow-sm min-w-0">
                            <span className="text-[7px] sm:text-[9px] font-black text-blue-400/50 uppercase tracking-widest truncate w-full text-center">Entry</span>
                            <div className="flex flex-col items-center min-w-0">
                              <div className="flex items-baseline gap-0.5 sm:gap-1 min-w-0">
                                <span className="text-[8px] sm:text-[10px] font-black text-blue-400/30 uppercase shrink-0">1st</span>
                                <span className="text-xs sm:text-base font-black text-white tracking-tighter truncate">
                                  {stock.entryPrice && stock.entryPrice > 0 
                                    ? `₩${stock.entryPrice?.toLocaleString() || '0'}` 
                                    : stock.currentPrice > 0 
                                      ? `₩${stock.currentPrice?.toLocaleString() || '0'}*` 
                                      : '-'}
                                </span>
                              </div>
                              {stock.entryPrice2 && stock.entryPrice2 > 0 && (
                                <div className="flex items-baseline gap-1 opacity-60">
                                  <span className="text-[7px] sm:text-[9px] font-black text-blue-400/30 uppercase shrink-0">2nd</span>
                                  <span className="text-[10px] sm:text-sm font-black text-white/60 tracking-tighter truncate">₩{stock.entryPrice2?.toLocaleString() || '0'}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="bg-green-500/5 rounded-2xl sm:rounded-3xl p-3 sm:p-5 border border-green-500/10 flex flex-col items-center justify-center gap-1.5 sm:gap-2 group/price hover:bg-green-500/10 transition-all shadow-sm min-w-0">
                            <span className="text-[7px] sm:text-[9px] font-black text-green-400/50 uppercase tracking-widest truncate w-full text-center">Target</span>
                            <div className="flex flex-col items-center min-w-0">
                              <div className="flex items-baseline gap-0.5 sm:gap-1 min-w-0">
                                <span className="text-[8px] sm:text-[10px] font-black text-green-400/30 uppercase shrink-0">1st</span>
                                <span className="text-xs sm:text-base font-black text-green-400 tracking-tighter truncate">₩{stock.targetPrice?.toLocaleString() || '-'}</span>
                              </div>
                              {stock.targetPrice2 && stock.targetPrice2 > 0 && (
                                <div className="flex items-baseline gap-1 opacity-60">
                                  <span className="text-[7px] sm:text-[9px] font-black text-green-400/30 uppercase shrink-0">2nd</span>
                                  <span className="text-[10px] sm:text-sm font-black text-green-400/60 tracking-tighter truncate">₩{stock.targetPrice2?.toLocaleString() || '0'}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="bg-red-500/5 rounded-2xl sm:rounded-3xl p-3 sm:p-5 border border-red-500/10 flex flex-col items-center justify-center gap-1 sm:gap-1.5 group/price hover:bg-red-500/10 transition-all shadow-sm min-w-0">
                            <span className="text-[7px] sm:text-[9px] font-black text-red-400/50 uppercase tracking-widest truncate w-full text-center">Stop</span>
                            <span className="text-xs sm:text-base font-black text-red-400 tracking-tighter truncate">₩{stock.stopLoss?.toLocaleString() || '-'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Footer Section */}
                      <div className="p-5 sm:p-8 pt-5 sm:pt-7 flex-1 flex flex-col justify-between">
                        <div className="space-y-6 sm:space-y-8">
                          {/* Economic Moat */}
                          <div className="flex items-start gap-4 sm:gap-5 group/moat">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 shadow-sm group-hover/moat:bg-blue-500/20 transition-all">
                              <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-[9px] sm:text-[10px] font-black text-white/20 uppercase tracking-[0.15em] sm:tracking-[0.2em] block mb-1.5 sm:mb-2">Economic Moat</span>
                              <div className="space-y-1.5 sm:space-y-2">
                                <span className={cn(
                                  "text-[9px] sm:text-[10px] font-black px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-lg sm:rounded-xl shadow-sm inline-block",
                                  stock.economicMoat?.type !== 'NONE' ? "bg-blue-500 text-white" : "bg-white/10 text-white/40"
                                )}>
                                  {stock.economicMoat?.type || 'NONE'}
                                </span>
                                <p className="text-[11px] sm:text-[12px] text-white/50 font-bold italic leading-relaxed break-words">
                                  {stock.economicMoat?.description}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Catalyst Analysis */}
                          <div className="flex items-start gap-4 sm:gap-5 group/catalyst">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0 shadow-sm group-hover/catalyst:bg-yellow-500/20 transition-all">
                              <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-[9px] sm:text-[10px] font-black text-white/20 uppercase tracking-[0.15em] sm:tracking-[0.2em] block mb-1.5 sm:mb-2">Catalyst Analysis</span>
                              <div className="space-y-1.5 sm:space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    "text-[9px] sm:text-[10px] font-black px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-lg sm:rounded-xl shadow-sm inline-block",
                                    stock.checklist?.catalystAnalysis ? "bg-yellow-500 text-black" : "bg-white/10 text-white/40"
                                  )}>
                                    {stock.checklist?.catalystAnalysis ? 'PASSED' : 'PENDING'}
                                  </span>
                                  {stock.catalystSummary && (
                                    <span className="text-[10px] sm:text-[11px] font-black text-yellow-400/80 truncate">
                                      {stock.catalystSummary}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] sm:text-[12px] text-white/50 font-bold italic leading-relaxed break-words">
                                  {stock.catalystDetail?.description || '발굴된 촉매제가 없습니다.'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Valuation */}
                          <div className="flex items-start gap-4 sm:gap-5 group/val">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 shadow-sm group-hover/val:bg-orange-500/20 transition-all">
                              <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-[9px] sm:text-[10px] font-black text-white/20 uppercase tracking-[0.15em] sm:tracking-[0.2em] block mb-1.5 sm:mb-2">Valuation Matrix</span>
                              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                                <div className="bg-white/5 p-2 sm:p-2.5 rounded-lg sm:rounded-xl border border-white/5 shadow-inner min-w-0">
                                  <span className="text-[7px] sm:text-[9px] font-black text-white/10 uppercase block mb-0.5 sm:mb-1 tracking-tighter truncate">P/E</span>
                                  <span className="text-xs sm:text-sm font-black text-white/80 truncate block">{stock.valuation?.per || 'N/A'}x</span>
                                </div>
                                <div className="bg-white/5 p-2 sm:p-2.5 rounded-lg sm:rounded-xl border border-white/5 shadow-inner min-w-0">
                                  <span className="text-[7px] sm:text-[9px] font-black text-white/10 uppercase block mb-0.5 sm:mb-1 tracking-tighter truncate">P/B</span>
                                  <span className="text-xs sm:text-sm font-black text-white/80 truncate block">{stock.valuation?.pbr || 'N/A'}x</span>
                                </div>
                                <div className="bg-white/5 p-2 sm:p-2.5 rounded-lg sm:rounded-xl border border-white/5 shadow-inner min-w-0">
                                  <span className="text-[7px] sm:text-[9px] font-black text-white/10 uppercase block mb-0.5 sm:mb-1 tracking-tighter truncate">EPS</span>
                                  <span className="text-xs sm:text-sm font-black text-green-400 truncate block">+{stock.valuation?.epsGrowth || '0'}%</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Latest News Section */}
                          {stock.latestNews && stock.latestNews.length > 0 && (
                            <div className="flex items-start gap-4 sm:gap-5 group/news">
                              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 shadow-sm group-hover/news:bg-orange-500/20 transition-all">
                                <Newspaper className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="text-[9px] sm:text-[10px] font-black text-white/20 uppercase tracking-[0.15em] sm:tracking-[0.2em] block mb-1.5 sm:mb-2">Latest News</span>
                                <div className="space-y-2">
                                  {(stock.latestNews || []).slice(0, 5).map((news, i) => (
                                    <a
                                      key={i}
                                      href={`https://www.google.com/search?q=${encodeURIComponent((news.headline || '') + ' ' + (stock.name || ''))}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="flex flex-col gap-1 p-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl transition-all group/news-item cursor-pointer"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-[11px] sm:text-[12px] font-bold text-white/80 group-hover/news-item:text-orange-400 transition-colors line-clamp-2 leading-tight">
                                          {news.headline}
                                        </span>
                                        <ExternalLink className="w-3 h-3 text-white/20 shrink-0" />
                                      </div>
                                      <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">{news.date}</span>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <motion.div 
                    key="empty-state"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="col-span-full py-24 text-center border-2 border-dashed border-white/5 rounded-2xl sm:rounded-3xl bg-white/[0.01]"
                  >
                    <div className="relative inline-block mb-6">
                      <div className="absolute inset-0 bg-orange-500/10 blur-2xl rounded-full animate-pulse" />
                      <Search className="w-16 h-16 text-white/10 relative z-10" />
                    </div>
                    <p className="text-white/40 font-black text-lg mb-6 uppercase tracking-widest">
                      {view === 'WATCHLIST' ? '관심 목록이 비어 있습니다.' : (recommendations || []).length === 0 ? '검색된 종목이 없습니다.' : '조건에 맞는 종목이 없습니다.'}
                    </p>
                    {searchQuery && (
                      <div className="flex flex-col items-center gap-4">
                        <p className="text-white/20 text-sm max-w-md mx-auto leading-relaxed">
                          현재 필터링된 리스트에는 해당 종목이 없습니다.<br />
                          전체 시장 데이터를 조회하시겠습니까?
                        </p>
                        <button
                          onClick={onMarketSearch}
                          disabled={searchingSpecific}
                          className={cn(
                            "px-8 py-4 text-white font-black rounded-2xl transition-all flex items-center gap-3 shadow-xl",
                            searchingSpecific
                              ? "bg-gradient-to-br from-cyan-400 via-blue-500 to-blue-700 shadow-blue-500/30 animate-pulse cursor-not-allowed"
                              : "btn-3d bg-orange-500 hover:bg-orange-600"
                          )}
                        >
                          {searchingSpecific ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Globe className="w-5 h-5" />}
                          {searchingSpecific ? '검색 중...' : `"${searchQuery}" 전체 시장에서 검색`}
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </Section>
      <DeepAnalysisModal
        stock={deepAnalysisStock}
        onClose={() => setDeepAnalysisStock(null)}
        analysisReportRef={analysisReportRef}
        weeklyRsiValues={weeklyRsiValues}
        onExportPDF={onExportDeepAnalysisPDF}
        isExporting={isExportingDeepAnalysis}
      />

        {/* Export Report Section */}
        <div className="mt-12 mb-8 px-4">
          <div className="max-w-2xl mx-auto glass-3d rounded-2xl border border-theme-border p-6 sm:p-8 shadow-xl relative overflow-hidden">
            <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="text-center sm:text-left flex-1 min-w-0">
                <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                  <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-[0.2em]">Export</span>
                </div>
                <h2 className="text-lg sm:text-xl font-black text-theme-text mb-2 tracking-tight uppercase break-keep">분석 리포트 내보내기</h2>
                <p className="text-xs text-theme-text-muted font-bold leading-relaxed">
                  PDF 저장 또는 이메일 전송
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => onGeneratePDF()}
                  disabled={isGeneratingPDF || loading}
                  className={cn(
                    "flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-300 disabled:opacity-50 active:scale-95 group/btn border",
                    isGeneratingPDF
                      ? "bg-blue-500/20 border-blue-500/30"
                      : "bg-white/5 hover:bg-blue-500/20 border-theme-border hover:border-blue-500/30"
                  )}
                  title="PDF 리포트 다운로드"
                >
                  <Download className={cn("w-5 h-5 transition-colors", isGeneratingPDF ? "animate-pulse text-blue-400" : "text-theme-text-muted group-hover/btn:text-blue-400")} />
                  <span className={cn("text-sm font-black transition-colors", isGeneratingPDF ? "text-blue-400" : "text-theme-text group-hover/btn:text-blue-400")}>{isGeneratingPDF ? '생성중...' : 'PDF'}</span>
                </button>

                <button
                  onClick={() => {
                    if (!emailAddress && !localStorage.getItem('k-stock-email')) {
                      const email = prompt('리포트를 전송할 이메일 주소를 입력해주세요:', 'silverlh614@gmail.com');
                      if (email) {
                        setEmailAddress(email);
                        setTimeout(() => onSendEmail(), 100);
                      }
                    } else {
                      onSendEmail();
                    }
                  }}
                  disabled={isSendingEmail || loading}
                  className={cn(
                    "flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-300 disabled:opacity-50 active:scale-95 group/btn border",
                    isSendingEmail
                      ? "bg-green-500/20 border-green-500/30"
                      : "bg-white/5 hover:bg-green-500/20 border-theme-border hover:border-green-500/30"
                  )}
                  title="이메일로 전송"
                >
                  <Mail className={cn("w-5 h-5 transition-colors", isSendingEmail ? "animate-pulse text-green-400" : "text-theme-text-muted group-hover/btn:text-green-400")} />
                  <span className={cn("text-sm font-black transition-colors", isSendingEmail ? "text-green-400" : "text-theme-text group-hover/btn:text-green-400")}>{isSendingEmail ? '전송중...' : 'Email'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
    </Stack>
  );
}
