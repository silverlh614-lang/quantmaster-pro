/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { toast, Toaster } from 'sonner';
import { 
  TrendingUp, 
  TrendingDown, 
  Crown,
  Search, 
  Filter,
  HelpCircle,
  RefreshCw, 
  Flame, 
  BarChart3, 
  Info,
  ChevronRight,
  ExternalLink,
  Target,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Zap,
  Star,
  LayoutGrid,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Type,
  History,
  Plus,
  Trash2,
  Play,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  Lightbulb,
  X,
  Settings,
  Key,
  Users,
  MessageSquare,
  PieChart,
  Shield,
  Cloud,
  Dna,
  CheckSquare,
  Activity,
  Building2,
  ArrowUpCircle,
  XCircle,
  Edit2,
  Check,
  DollarSign,
  Lock,
  Download,
  Award,
  Mail,
  FileText,
  Clock,
  Globe,
  Brain,
  Shell,
  Hash,
  Sparkles,
  Newspaper,
  Minus,
  Radar,
  Copy,
  Wallet,
  Percent,
  Maximize2,
  ArrowRightLeft,
  Flag,
  ShieldAlert,
  ArrowUpDown,
  Layers,
  Sun,
  Moon,
  Contrast,
  GripVertical,
  Calculator,
  Calendar as CalendarIcon,
  ArrowRight
} from 'lucide-react';
import { domToJpeg } from 'modern-screenshot';
import { jsPDF } from 'jspdf';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import {
  getStockRecommendations,
  StockFilters,
  searchStock,
  syncStockPrice,
  fetchCurrentPrice,
  backtestPortfolio,
  parsePortfolioFile,
  generateReportSummary,
  getMarketOverview,
  syncMarketOverviewIndices,
  getNewsFrequencyScores,
  // 12개 글로벌 인텔 함수는 TanStack Query hooks로 이관됨 (src/hooks/useGlobalIntelQueries.ts)
  StockRecommendation,
  MarketContext,
  MarketOverview,
  BacktestResult,
  Portfolio
} from './services/stockService';
import { MarketDashboard } from './components/MarketDashboard';
import { PortfolioManager } from './components/PortfolioManager';
import { PortfolioPieChart } from './components/PortfolioPieChart';
import { EventCalendar } from './components/EventCalendar';
import { QuantDashboard } from './components/QuantDashboard';
import { MacroIntelligenceDashboard } from './components/MacroIntelligenceDashboard';
import { ManualQuantInput } from './components/ManualQuantInput';
import { ConfidenceBadge } from './components/ConfidenceBadge';
import { evaluateStock, evaluateGate0 } from './services/quantEngine';
import { fetchHistoricalData } from './services/stockService';
import { calculateRSIMomentumAcceleration } from './utils/indicators';
import { MarketRegime, SectorRotation, EuphoriaSignal, EmergencyStopSignal, StockProfile, StockProfileType, MacroEnvironment, EconomicRegimeData, SmartMoneyData, ExportMomentumData, GeopoliticalRiskData, CreditSpreadData, ROEType, ExtendedRegimeData, GlobalCorrelationMatrix, NewsFrequencyScore, SupplyChainIntelligence, SectorOrderIntelligence, FinancialStressIndex, FomcSentimentAnalysis, TradeRecord, ConditionId } from './types/quant';
import { WalkForwardView } from './components/WalkForwardView';
import { HeroChecklist } from './components/HeroChecklist';
import { AnalysisViewToggle, AnalysisViewButtons } from './components/AnalysisViewToggle';
import { useCopiedCode } from './hooks/useCopiedCode';
import { PriceEditCell } from './components/PriceEditCell';
import { QuantScreener } from './components/QuantScreener';
import { SectorSubscription } from './components/SectorSubscription';
import { StockDetailModal } from './components/StockDetailModal';
import { TradeJournal, computeConditionPerformance } from './components/TradeJournal';
import { saveEvolutionWeights } from './services/quantEngine';
import { CandleChart } from './components/CandleChart';
import { MHSHistoryChart } from './components/MHSHistoryChart';
import { IntelligenceRadar } from './components/IntelligenceRadar';
import { MarketPage } from './pages/MarketPage';
import { ManualInputPage } from './pages/ManualInputPage';
import { AutoTradePage } from './pages/AutoTradePage';
import { TradeJournalPage } from './pages/TradeJournalPage';
import { ScreenerPage } from './pages/ScreenerPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import { BacktestPage } from './pages/BacktestPage';
import { DiscoverWatchlistPage } from './pages/DiscoverWatchlistPage';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  AreaChart,
  Area,
  Radar as RechartsRadar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import { MASTER_CHECKLIST_STEPS, SELL_CHECKLIST_STEPS, getMarketPhaseInfo } from './constants/checklist';

const checklistLabels: Record<keyof StockRecommendation['checklist'], { label: string; description: string; gate: 1 | 2 | 3 }> = {
  cycleVerified: { label: "주도주 사이클 부합 (New Leader)", description: "현재 시장의 주도 섹터 및 테마에 부합하며 새로운 상승 사이클의 초입에 있는지 검증", gate: 1 },
  momentumRanking: { label: "섹터 내 모멘텀 랭킹 상위권", description: "동일 섹터 내 종목들 중 주가 상승 강도 및 거래대금 유입이 상위 10% 이내인지 확인", gate: 3 },
  roeType3: { label: "ROE 성장 동력 확인 (Type 3)", description: "자기자본이익률(ROE)이 15% 이상이거나 전년 대비 가파르게 개선되는 성장형 모델인지 분석", gate: 1 },
  supplyInflow: { label: "메이저 수급(외인/기관) 유입", description: "외국인 또는 기관 투자자의 5거래일 연속 순매수 혹은 의미 있는 대량 매집 흔적 포착", gate: 2 },
  riskOnEnvironment: { label: "거시경제 Risk-On 환경 부합", description: "금리, 환율, 지수 변동성(VIX) 등 매크로 지표가 주식 투자에 우호적인 환경인지 판단", gate: 1 },
  ichimokuBreakout: { label: "일목균형표 구름대 상향 돌파", description: "기술적으로 일목균형표의 의운(구름대)을 상향 돌파하여 추세 전환이 완성되었는지 확인", gate: 2 },
  mechanicalStop: { label: "기계적 손절매 기준선 확보", description: "손익비가 우수한 진입 시점이며, 명확한 지지선 기반의 손절 가격 설정이 가능한지 검토", gate: 1 },
  economicMoatVerified: { label: "강력한 경제적 해자(Moat) 보유", description: "독점적 시장 지위, 브랜드 파워, 기술력 등 경쟁사가 쉽게 넘볼 수 없는 진입장벽 존재 여부", gate: 2 },
  notPreviousLeader: { label: "과거 소외주에서 주도주로 전환", description: "직전 사이클의 주도주가 아닌, 장기 소외 구간을 거쳐 새롭게 부각되는 종목인지 확인", gate: 1 },
  technicalGoldenCross: { label: "주요 이평선 골든크로스 발생", description: "5일/20일 또는 20일/60일 이동평균선이 정배열로 전환되는 골든크로스 발생 여부", gate: 2 },
  volumeSurgeVerified: { label: "의미 있는 거래량 급증 동반", description: "평균 거래량 대비 300% 이상의 대량 거래가 동반되며 매물대를 돌파했는지 검증", gate: 2 },
  institutionalBuying: { label: "기관 연속 순매수 포착", description: "연기금, 투신 등 국내 기관 투자자의 지속적인 비중 확대가 나타나는지 추적", gate: 2 },
  consensusTarget: { label: "증권사 목표가 상향 리포트 존재", description: "최근 1개월 내 주요 증권사에서 목표 주가를 상향하거나 긍정적인 분석 리포트 발행 여부", gate: 2 },
  earningsSurprise: { label: "최근 분기 어닝 서프라이즈 달성", description: "시장 예상치(Consensus)를 상회하는 영업이익을 발표하여 실적 모멘텀이 증명되었는지 확인", gate: 2 },
  performanceReality: { label: "실체적 펀더멘털(수주/실적) 기반", description: "단순 테마가 아닌 실제 수주 잔고 증가나 실적 개선 데이터가 뒷받침되는지 검증", gate: 2 },
  policyAlignment: { label: "정부 정책 및 매크로 환경 수혜", description: "정부의 육성 정책, 규제 완화 또는 글로벌 산업 트렌드(AI, 에너지 등)의 직접적 수혜 여부", gate: 2 },
  psychologicalObjectivity: { label: "대중적 광기(FOMO) 미결집 단계", description: "아직 대중의 과도한 관심이나 포모(FOMO)가 형성되지 않은 저평가/매집 단계인지 판단", gate: 3 },
  turtleBreakout: { label: "터틀 트레이딩 주요 저항선 돌파", description: "최근 20일 또는 55일 신고가를 경신하며 강력한 추세 추종 신호가 발생했는지 확인", gate: 3 },
  fibonacciLevel: { label: "피보나치 핵심 지지선 반등", description: "상승 후 조정 시 피보나치 0.382 또는 0.618 지점에서 지지를 받고 반등하는지 분석", gate: 3 },
  elliottWaveVerified: { label: "엘리엇 상승 3파/5파 국면 진입", description: "파동 이론상 가장 강력한 상승 구간인 3파동 또는 마지막 분출 구간인 5파동 진입 여부", gate: 3 },
  ocfQuality: { label: "이익의 질 (OCF) 우수", description: "영업활동현금흐름(OCF)이 당기순이익보다 크거나 양호하여 회계적 이익의 신뢰도가 높은지 확인", gate: 2 },
  marginAcceleration: { label: "마진 가속도 (OPM) 확인", description: "매출 성장보다 영업이익률(OPM) 개선 속도가 빨라지는 수익성 극대화 구간인지 검증", gate: 3 },
  interestCoverage: { label: "재무 방어력 (ICR) 확보", description: "이자보상배율이 충분히 높아 금리 인상기에도 재무적 리스크가 낮은 우량 기업인지 판단", gate: 3 },
  relativeStrength: { label: "상대 강도 (RS) 시장 압도", description: "코스피/코스닥 지수 대비 주가 상승률이 월등히 높아 시장을 이끄는 종목인지 확인", gate: 2 },
  vcpPattern: { label: "변동성 축소 (VCP) 완성", description: "주가 변동 폭이 점차 줄어들며 에너지가 응축된 후 상방 돌파를 앞둔 패턴인지 분석", gate: 3 },
  divergenceCheck: { label: "다이버전스 리스크 부재", description: "주가 상승 시 보조지표(RSI, MACD)가 함께 상승하여 추세의 건전성이 유지되는지 확인", gate: 3 },
  catalystAnalysis: { label: "촉매제 분석 (Catalyst)", description: "확정 일정(30-60일), 핫 섹터 테마 연관성, DART 공시의 질(수주/소각 등) 기반 가산점 분석", gate: 3 }
};

const demoRegime: MarketRegime = {
  type: '상승초기',
  weightMultipliers: { 1: 3.0, 2: 2.5, 3: 2.0 },
  vKospi: 15.5,
  samsungIri: 0.85,
};

const demoSectorRotation: SectorRotation = {
  name: '반도체',
  rank: 1,
  strength: 85,
  isLeading: true,
  sectorLeaderNewHigh: false,
  leadingSectors: ['반도체', 'AI'],
};

const demoEuphoria: EuphoriaSignal = {
  id: 'E1',
  name: '과열 신호',
  active: false,
};

const demoEmergency: EmergencyStopSignal = {
  id: 'S1',
  name: '긴급 중단',
  triggered: false,
};

const demoProfile: StockProfile = {
  type: 'A',
  monitoringCycle: 'DAILY',
  stopLoss: 7,
  executionDelay: 0,
};

// 데모용 데이터 (실제 데이터는 API로 대체 예정)
const demoStockData: Record<number, number> = {
  1: 9, 3: 8, 5: 9, 7: 10, 9: 8, // Gate 1
  2: 7, 4: 8, 6: 9, 8: 7, 10: 8, // Gate 2
  11: 9, 13: 8, 15: 7, 17: 9, 19: 8, // Gate 3
  21: 9, 23: 8, 25: 7, 27: 9, // Others
};

import { MarketTicker } from './components/MarketTicker';
import { TradingChecklist } from './components/TradingChecklist';
import { useShadowTradeStore } from './stores/useShadowTradeStore';
import { buildShadowTrade, resolveShadowTrade } from './services/autoTrading';

// ── Zustand Stores ─────────────────────────────────────────────────────────
import { useSettingsStore, useGlobalIntelStore, useRecommendationStore, useMarketStore, useTradeStore, useAnalysisStore, usePortfolioStore } from './stores';

// ── TanStack Query Hooks ───────────────────────────────────────────────────
import { useAllGlobalIntel } from './hooks';
import { useStockSync } from './hooks/useStockSync';
import { usePortfolioOps } from './hooks/usePortfolioOps';
import { useStockSearch } from './hooks/useStockSearch';
import { useTradeOps } from './hooks/useTradeOps';
import { useReportExport } from './hooks/useReportExport';

export default function App() {
  // ── Zustand Store Subscriptions ──────────────────────────────────────────────
  const globalIntelStore = useGlobalIntelStore();

  // useRecommendationStore
  const {
    recommendations, setRecommendations,
    watchlist, setWatchlist,
    searchResults, setSearchResults,
    screenerRecommendations, setScreenerRecommendations,
    filters, setFilters,
    selectedType, setSelectedType,
    selectedPattern, setSelectedPattern,
    selectedSentiment, setSelectedSentiment,
    selectedChecklist, setSelectedChecklist,
    searchQuery, setSearchQuery,
    minPrice, setMinPrice,
    maxPrice, setMaxPrice,
    sortBy, setSortBy,
    lastUsedMode, setLastUsedMode,
    recommendationHistory, setRecommendationHistory,
    loading, setLoading,
    lastUpdated, setLastUpdated,
    error, setError,
    searchingSpecific, setSearchingSpecific,
  } = useRecommendationStore();

  // useTradeStore
  const {
    tradeRecords, setTradeRecords,
    tradeRecordStock, setTradeRecordStock,
    tradeFormData, setTradeFormData,
  } = useTradeStore();

  // useAnalysisStore
  const {
    deepAnalysisStock, setDeepAnalysisStock,
    selectedDetailStock, setSelectedDetailStock,
    weeklyRsiValues, setWeeklyRsiValues,
    reportSummary, setReportSummary,
    isSummarizing, setIsSummarizing,
    isGeneratingPDF, setIsGeneratingPDF,
    isExportingDeepAnalysis, setIsExportingDeepAnalysis,
    isSendingEmail, setIsSendingEmail,
  } = useAnalysisStore();

  // usePortfolioStore
  const {
    portfolios, setPortfolios,
    currentPortfolioId, setCurrentPortfolioId,
  } = usePortfolioStore();

  // useMarketStore
  const {
    marketOverview, setMarketOverview,
    marketContext, setMarketContext,
    loadingMarket, setLoadingMarket,
    syncStatus, setSyncStatus,
    syncingStock, setSyncingStock,
    nextSyncCountdown, setNextSyncCountdown,
    backtestPortfolioItems, setBacktestPortfolioItems,
    backtestResult, setBacktestResult,
    backtesting, setBacktesting,
    initialEquity, setInitialEquity,
    backtestYears, setBacktestYears,
    parsingFile, setParsingFile,
  } = useMarketStore();

  // useSettingsStore
  const {
    view, setView,
    theme, setTheme,
    fontSize, setFontSize,
    userApiKey, setUserApiKey,
    emailAddress, setEmailAddress,
    autoSyncEnabled, setAutoSyncEnabled,
    subscribedSectors, setSubscribedSectors,
    showSettings, setShowSettings,
    showMasterChecklist, setShowMasterChecklist,
    isFilterExpanded, setIsFilterExpanded,
  } = useSettingsStore();

  // Shadow Trading 스토어
  const { addShadowTrade, updateShadowTrade, shadowTrades, winRate, avgReturn } = useShadowTradeStore();

  // ── Custom Hooks ────────────────────────────────────────────────────────────
  const { handleSyncPrice, handleManualPriceUpdate, handleSyncAll } = useStockSync();
  const { addToBacktest, removeFromBacktest, updateWeight, reorderPortfolioItems, applyAIRecommendedWeights, savePortfolio, selectPortfolio, deletePortfolio, updatePortfolio, runBacktest, handleFileUpload } = usePortfolioOps();
  const { fetchStocks, handleMarketSearch, handleScreener, handleFetchNewsScores, loadingNews } = useStockSearch();
  const { toggleWatchlist, recordTrade, closeTrade, deleteTrade, updateTradeMemo, handleAddSector, handleRemoveSector } = useTradeOps();
  const { generatePDF, handleExportDeepAnalysisPDF, handleGenerateSummary, sendEmail, analysisReportRef } = useReportExport();

  // KIS 모의계좌 잔고 — 자동매매 투자금 기준
  const [kisBalance, setKisBalance] = useState<number>(100_000_000);
  useEffect(() => {
    fetch('/api/kis/balance')
      .then(res => res.json())
      .then(data => {
        const cash = Number(data.output2?.[0]?.dnca_tot_amt ?? data.output?.dnca_tot_amt ?? 0);
        if (cash > 0) setKisBalance(cash);
      })
      .catch(() => {}); // 실패 시 기본값 유지
  }, []);

  // DART 공시 알림 데이터 (DiscoverWatchlistPage에서 사용)
  const [dartAlerts, setDartAlerts] = useState<{ corp_name: string; stock_code: string; report_nm: string; rcept_dt: string; sentiment: string }[]>([]);
  useEffect(() => {
    const fetchDart = () => {
      fetch('/api/auto-trade/dart-alerts').then(r => r.json()).then(setDartAlerts).catch(() => {});
    };
    fetchDart();
    const interval = setInterval(fetchDart, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ── TanStack Query: 12개 글로벌 인텔리전스 자동 로딩 + 30분 캐시 + 자동 재시도 ──
  const globalIntelQueries = useAllGlobalIntel();

  const averageHitRate = useMemo(() => {
    if (recommendationHistory.length === 0) return 0;
    const total = recommendationHistory.reduce((acc, curr) => acc + curr.hitRate, 0);
    return Math.round(total / recommendationHistory.length);
  }, [recommendationHistory]);

  const strongBuyHitRate = useMemo(() => {
    if (recommendationHistory.length === 0) return 68; // More conservative default
    const itemsWithStrongBuy = (recommendationHistory || []).filter(item => item.strongBuyHitRate !== undefined);
    if (itemsWithStrongBuy.length === 0) return 68;
    const total = itemsWithStrongBuy.reduce((acc, curr) => acc + (curr.strongBuyHitRate || 0), 0);
    // Apply a 5% conservative penalty to the average
    return Math.max(0, Math.round((total / itemsWithStrongBuy.length) * 0.95));
  }, [recommendationHistory]);

  // ── 탭별 동적 페이지 타이틀 ────────────────────────────────────────────────
  useEffect(() => {
    const viewLabels: Record<string, string> = {
      DISCOVER: '탐색',
      WATCHLIST: '관심 목록',
      SCREENER: '스크리너',
      SUBSCRIPTION: '섹터 구독',
      BACKTEST: '백테스트',
      MARKET: '시장 대시보드',
      WALK_FORWARD: '워크포워드',
      MANUAL_INPUT: '수동 퀀트',
      TRADE_JOURNAL: '매매일지',
    };
    document.title = `${viewLabels[view] ?? view} · QuantMaster Pro`;
  }, [view]);

  // ── 매크로/어드밴스드 컨텍스트: Zustand store → 로컬 alias (하위 호환) ────────
  // useState 제거됨 — TanStack Query가 자동 로딩 → Zustand store에 동기화
  // 기존 코드에서 사용하는 변수명 유지를 위한 alias
  const macroEnv = globalIntelStore.macroEnv;
  const setMacroEnv = globalIntelStore.setMacroEnv;
  const exportRatio = globalIntelStore.exportRatio;
  const setExportRatio = globalIntelStore.setExportRatio;
  const economicRegimeData = globalIntelStore.economicRegimeData;
  const extendedRegimeData = globalIntelStore.extendedRegimeData;
  const smartMoneyData = globalIntelStore.smartMoneyData;
  const exportMomentumData = globalIntelStore.exportMomentumData;
  const geoRiskData = globalIntelStore.geoRiskData;
  const creditSpreadData = globalIntelStore.creditSpreadData;
  const globalCorrelation = globalIntelStore.globalCorrelation;
  const newsFrequencyScores = globalIntelStore.newsFrequencyScores;
  const setNewsFrequencyScores = globalIntelStore.setNewsFrequencyScores;
  const supplyChainData = globalIntelStore.supplyChainData;
  const sectorOrderData = globalIntelStore.sectorOrderData;
  const financialStressData = globalIntelStore.financialStressData;
  const fomcSentimentData = globalIntelStore.fomcSentimentData;
  const currentRoeType = globalIntelStore.currentRoeType;
  const setCurrentRoeType = globalIntelStore.setCurrentRoeType;

  // ── 실전 성과 관리 시스템 (Zustand store) ──────────────────────────────────────
  const mhsHistory = globalIntelStore.mhsHistory;

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);

  // ── Gap 2a: 주봉 RSI 3주 추이 계산 ──────────────────────────────────────────
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

  // ── 어드밴스드 컨텍스트 + 매크로 환경 데이터 수집 ───────────────────────────
  // TanStack Query (useAllGlobalIntel)로 대체됨:
  // - 12개 글로벌 인텔리전스 데이터 자동 병렬 로딩
  // - 30분 staleTime 캐시 (getCachedAIResponse 대체)
  // - 실패 시 자동 2회 재시도 (withRetry 대체)
  // - 1시간 간격 백그라운드 리프레시
  // - 각 쿼리가 성공 시 Zustand globalIntelStore에 자동 동기화
  // - MHS 히스토리 자동 기록 (useMacroEnvironment 내부)

  // (직접 alias는 위 "매크로/어드밴스드 컨텍스트" 섹션에서 선언됨)


  useEffect(() => {
    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark', 'theme-high-contrast');
    if (theme !== 'dark') {
      body.classList.add(`theme-${theme}`);
    }
  }, [theme]);

  // Use refs to avoid stale closures in intervals
  const prevWatchlistCodesRef = useRef<string[]>([]);
  useEffect(() => {
    const currentCodes = (watchlist || []).map(s => s.code);
    const prevCodes = prevWatchlistCodesRef.current;
    prevWatchlistCodesRef.current = currentCodes;

    // 추가된 종목 → POST
    const added = (watchlist || []).filter(s => !prevCodes.includes(s.code));
    for (const stock of added) {
      fetch('/api/auto-trade/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: stock.code,
          name: stock.name,
          entryPrice: stock.entryPrice ?? stock.currentPrice ?? 0,
          stopLoss: stock.stopLoss ?? 0,
          targetPrice: stock.targetPrice ?? 0,
        }),
      }).catch(() => {});
    }

    // 제거된 종목 → DELETE
    const removed = prevCodes.filter(code => !currentCodes.includes(code));
    for (const code of removed) {
      fetch(`/api/auto-trade/watchlist/${code}`, { method: 'DELETE' }).catch(() => {});
    }
  }, [watchlist]);

  // Shadow Trade resolution — 5분마다 PENDING/ACTIVE 거래의 현재가를 확인하여 결과 갱신
  useEffect(() => {
    const activeTrades = shadowTrades.filter(t => t.status === 'PENDING' || t.status === 'ACTIVE');
    if (activeTrades.length === 0) return;

    const resolveTrades = async () => {
      for (const trade of activeTrades) {
        try {
          const price = await fetchCurrentPrice(trade.stockCode);
          if (!price) continue;
          const updates = resolveShadowTrade(trade, price);
          if (updates && Object.keys(updates).length > 0) {
            updateShadowTrade(trade.id, updates);
          }
        } catch (e) {
          console.error(`[Shadow] ${trade.stockCode} resolve 실패:`, e);
        }
      }
    };

    resolveTrades();
    const interval = setInterval(resolveTrades, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [shadowTrades.filter(t => t.status === 'PENDING' || t.status === 'ACTIVE').length]);

  // Initial app start sync for top indices
  useEffect(() => {
    const initialSync = async () => {
      const stored = localStorage.getItem('k-stock-market-overview');
      if (stored) {
        try {
          const overview = JSON.parse(stored) as MarketOverview;
          console.log("App started: Syncing top indices from storage...");
          const updated = await syncMarketOverviewIndices(overview);
          setMarketOverview(updated);

        } catch (e) {
          console.error("Failed to parse stored market overview", e);
        }
      }
    };
    initialSync();
  }, []); // Only on mount

  const handleFetchMarketOverview = async (force = false) => {
    if (loadingMarket) return;
    
    // If not forced and we have data, we can just sync the indices if it's been a while
    if (!force && marketOverview) {
      const last = new Date(marketOverview.lastUpdated).getTime();
      const now = new Date().getTime();
      const diff = (now - last) / (1000 * 60); // minutes
      
      if (diff < 5) return; // Data is fresh enough (5 minutes)
      
      // If data is between 5 and 30 minutes old, just sync indices (faster than full AI call)
      if (diff < 30) {
        setLoadingMarket(true);
        try {
          const updated = await syncMarketOverviewIndices(marketOverview);
          setMarketOverview(updated);

          return;
        } catch (e) {
          console.error("Failed to sync indices, falling back to full fetch", e);
        } finally {
          setLoadingMarket(false);
        }
      }
    }

    setLoadingMarket(true);
    try {
      const data = await getMarketOverview();
      if (data) {
        setMarketOverview(data);

      }
    } catch (err: any) {
      console.error('Failed to fetch market overview:', err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
      
      if (isRateLimit) {
        toast.error('시장 개요 로드 실패: API 할당량 초과');
      }
    } finally {
      setLoadingMarket(false);
    }
  };

  useEffect(() => {
    // 자동 fetch 제거 — 이미 캐시된 데이터가 있으면 재호출하지 않음
    // 수동 "시장 개요" 버튼 클릭 시에만 갱신 (API 절감: 하루 ~17,400 토큰)
    if (!marketOverview) return;
  }, [view]);

  const handleSaveApiKey = () => {
    setShowSettings(false);
    toast.success('API 키가 저장되었습니다. 이제 AI 기능을 사용할 수 있습니다.');
  };

  useEffect(() => {
    document.documentElement.style.fontSize = `${(fontSize / 16) * 100}%`;
  }, [fontSize]);

  const allPatterns = Array.from(new Set((recommendations || []).flatMap(r => r.patterns || [])));
  
  const searchResultCodes = new Set((searchResults || []).map(s => s.code));

  const filteredRecommendations = [...(recommendations || []), ...(searchResults || [])].filter(stock => {
    const typeMatch = selectedType === 'ALL' || stock.type === selectedType;
    const patternMatch = selectedPattern === 'ALL' || (stock.patterns || []).includes(selectedPattern);

    const sentimentMatch = selectedSentiment === 'ALL' ||
      (selectedSentiment === 'RISK_ON' && (stock.marketSentiment?.iri ?? 0) < 2.0) ||
      (selectedSentiment === 'RISK_OFF' && (stock.marketSentiment?.iri ?? 0) >= 2.0);

    const checklistMatch = selectedChecklist.length === 0 ||
      selectedChecklist.every(item => stock.checklist?.[item as keyof typeof stock.checklist]);

    const minP = minPrice === '' ? 0 : parseInt(minPrice);
    const maxP = maxPrice === '' ? Infinity : parseInt(maxPrice);
    const priceMatch = (stock.currentPrice ?? 0) >= minP && (stock.currentPrice ?? 0) <= maxP;

    // searchResults는 AI가 이미 의미론적으로 검색어에 매칭한 결과이므로 텍스트 필터 생략
    const searchMatch = searchResultCodes.has(stock.code) || searchQuery === '' ||
      (stock.name?.toLowerCase().includes(searchQuery?.toLowerCase() || '') ?? false) ||
      (stock.code?.includes(searchQuery || '') ?? false);

    return typeMatch && patternMatch && sentimentMatch && checklistMatch && searchMatch && priceMatch;
  });



  const displayList = (() => {
    let list: StockRecommendation[] = [];
    if (view === 'DISCOVER') {
      list = filteredRecommendations;
    } else if (view === 'WATCHLIST') {
      list = (watchlist || []).filter(stock => 
        (stock.name?.toLowerCase().includes(searchQuery?.toLowerCase() || '') ?? false) || 
        (stock.code?.includes(searchQuery || '') ?? false)
      );
    } else {
      return [];
    }

    return [...list].sort((a, b) => {
      if (sortBy === 'NAME') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortBy === 'CODE') {
        return (a.code || '').localeCompare(b.code || '');
      }
      if (sortBy === 'PERFORMANCE') {
        const getPerf = (s: StockRecommendation) => {
          if (s.currentPrice > 0 && s.entryPrice && s.entryPrice > 0) {
            return (s.currentPrice / s.entryPrice) - 1;
          }
          if (s.peakPrice > 0) {
            return (s.currentPrice / s.peakPrice) - 1;
          }
          return -Infinity;
        };
        return getPerf(b) - getPerf(a);
      }
      return 0;
    });
  })();

  return (
    <div className="min-h-screen bg-theme-bg text-theme-text font-sans selection:bg-orange-500 selection:text-white antialiased">
      <Toaster position="top-center" expand={false} richColors theme="dark" />
      <div className="max-w-screen-2xl mx-auto relative">
      {/* Master Checklist Modal */}
      <AnimatePresence>
        {showMasterChecklist && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowMasterChecklist(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="glass-3d rounded-[3rem] p-10 max-w-2xl w-full border border-white/10 shadow-2xl overflow-hidden relative"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-orange-500/20 rounded-2xl flex items-center justify-center">
                    <ShieldCheck className="w-6 h-6 text-orange-500" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white tracking-tight">27단계 마스터 체크리스트</h3>
                    <p className="text-xs font-bold text-white/30 uppercase tracking-[0.2em]">Master Selection System</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowMasterChecklist(false)}
                  className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors relative z-[110]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-10 max-h-[60vh] overflow-y-auto pr-4 custom-scrollbar">
                {[1, 2, 3].map(gateNum => (
                  <div key={gateNum} className="space-y-4">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="px-3 py-1 bg-orange-500/20 rounded-full border border-orange-500/30">
                        <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Gate {gateNum}</span>
                      </div>
                      <div className="h-px flex-1 bg-white/10" />
                      <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">
                        {gateNum === 1 ? "기초 체력 및 사이클 검증" : gateNum === 2 ? "수급 및 실체적 모멘텀 확인" : "추세 가속 및 리스크 관리"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {MASTER_CHECKLIST_STEPS.filter(s => s.gate === gateNum).map((step, i) => (
                        <div 
                          key={step.key} 
                          className="flex gap-5 p-5 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.08] transition-all group"
                        >
                          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-orange-500/10 transition-colors shrink-0">
                            <step.icon className="w-5 h-5 text-white/20 group-hover:text-orange-500 transition-colors" />
                          </div>
                          <div>
                            <h4 className="text-sm font-black text-white mb-1">{step.title}</h4>
                            <p className="text-[11px] text-white/40 font-medium leading-relaxed">{step.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Sell Checklist Section */}
                <div className="space-y-4 pt-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="px-3 py-1 bg-red-500/20 rounded-full border border-red-500/30">
                      <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">Sell Checklist</span>
                    </div>
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">매도 원칙 및 리스크 관리</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    {SELL_CHECKLIST_STEPS.map((step, i) => (
                      <div 
                        key={i} 
                        className="flex gap-5 p-5 rounded-2xl border border-red-500/5 bg-red-500/[0.02] hover:bg-red-500/[0.08] transition-all group"
                      >
                        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-red-500/10 transition-colors shrink-0">
                          <step.icon className="w-5 h-5 text-white/20 group-hover:text-red-500 transition-colors" />
                        </div>
                        <div>
                          <h4 className="text-sm font-black text-white mb-1">{step.title}</h4>
                          <p className="text-[11px] text-white/40 font-medium leading-relaxed">{step.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-10 pt-8 border-t border-white/10 text-center">
                <p className="text-xs text-white/30 font-bold leading-relaxed">
                  본 시스템은 과거 70년 한국 증시의 주도주 교체 패턴과<br />
                  실체적 펀더멘털 데이터를 결합한 독자적인 분석 알고리즘입니다.
                </p>
              </div>

              {/* Decorative background */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/5 blur-[100px] -mr-32 -mt-32" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="glass-3d rounded-[3rem] max-w-lg w-full border border-theme-border shadow-2xl max-h-[90vh] relative flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 sm:p-10 pb-0 flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center">
                    <Settings className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-theme-text tracking-tight">설정</h3>
                    <p className="text-xs font-bold text-theme-text-muted uppercase tracking-[0.2em]">Application Settings</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="w-10 h-10 rounded-full bg-theme-card flex items-center justify-center hover:bg-theme-border transition-colors relative z-[110]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 sm:px-10 pb-6 sm:pb-10 custom-scrollbar">
              <div className="space-y-8">
                <div>
                  <label className="block text-xs font-black text-theme-text-muted uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                    <Key className="w-3 h-3" />
                    Gemini API Key
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      value={userApiKey}
                      onChange={(e) => setUserApiKey(e.target.value)}
                      placeholder="AI 기능을 사용하려면 API 키를 입력하세요"
                      className="w-full bg-theme-card border border-theme-border rounded-2xl px-6 py-4 text-sm font-bold text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-blue-500/50 transition-all"
                    />
                  </div>
                  <p className="mt-4 text-[10px] text-theme-text-muted font-bold leading-relaxed">
                    입력하신 API 키는 브라우저의 로컬 스토리지에만 안전하게 저장되며, 서버로 전송되지 않습니다.
                    <br />
                    <span className="text-orange-500/60">※ 현재 할당량 절약을 위해 Gemini 3.1 Flash Lite 모델을 사용 중입니다.</span>
                    <br />
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline inline-flex items-center gap-1 mt-1"
                    >
                      API 키 발급받기 <ExternalLink className="w-2 h-2" />
                    </a>
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Sun className="w-4 h-4 text-orange-500" />
                    <span className="text-xs font-black text-theme-text-muted uppercase tracking-widest">UI 테마 설정</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'light', label: '라이트', icon: Sun },
                      { id: 'dark', label: '다크', icon: Moon },
                      { id: 'high-contrast', label: '고대비', icon: Contrast }
                    ].map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id as any)}
                        className={cn(
                          "flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all",
                          theme === t.id
                            ? "bg-orange-500/20 border-orange-500 text-orange-500"
                            : "bg-theme-card border-theme-border text-theme-text-muted hover:bg-theme-border"
                        )}
                      >
                        <t.icon className="w-5 h-5" />
                        <span className="text-[10px] font-black uppercase tracking-widest">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── 자동매매 설정 체크리스트 ── */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-violet-500" />
                    <span className="text-xs font-black text-theme-text-muted uppercase tracking-widest">자동매매 설정 검증</span>
                  </div>
                  <TradingChecklist />
                </div>

                <div className="flex flex-col gap-4">
                  <button
                    onClick={handleSaveApiKey}
                    className="w-full py-4 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl font-black text-lg transition-all shadow-[0_10px_30px_rgba(59,130,246,0.2)] active:scale-[0.98]"
                  >
                    설정 저장
                  </button>
                  <button
                    onClick={() => {
                      localStorage.removeItem('k-stock-recommendations');
                      localStorage.removeItem('k-stock-market-context');
                      localStorage.removeItem('k-stock-last-updated');
                      localStorage.removeItem('k-stock-search-results');
                      window.location.reload();
                    }}
                    className="w-full py-4 bg-theme-card hover:bg-red-500/20 text-theme-text-muted hover:text-red-400 rounded-2xl font-black text-sm transition-all border border-theme-border hover:border-red-500/50 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    캐시 데이터 초기화 (과거 데이터 삭제)
                  </button>
                </div>
              </div>
              </div>

              {/* Decorative background */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 blur-[100px] -mr-32 -mt-32 pointer-events-none" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-theme-border bg-theme-bg/80 backdrop-blur-2xl sticky top-0 z-50 shadow-[0_2px_30px_rgba(0,0,0,0.3)] no-print">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-[60px] flex items-center justify-between gap-4">

          {/* ── Brand ── */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative">
              <div className="w-9 h-9 bg-gradient-to-br from-orange-400 via-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(249,115,22,0.5)]">
                <Zap className="w-5 h-5 text-white" />
              </div>
              {syncStatus.isSyncing && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-[#050505] animate-pulse" />
              )}
            </div>
            <div className="hidden sm:flex flex-col leading-none">
              <span className="text-[13px] font-black text-white tracking-tight">QuantMaster <span className="text-orange-500">Pro</span></span>
              <span className="text-[9px] font-bold text-white/25 uppercase tracking-[0.18em] mt-0.5">AI · Quant · Engine</span>
            </div>
            <div className="hidden lg:block w-px h-7 bg-white/[0.08] mx-1" />
          </div>

          {/* ── Navigation ── */}
          <nav className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">

            {/* 탐색 & 관심 */}
            <button
              onClick={() => { setView('DISCOVER'); setSearchQuery(''); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0",
                view === 'DISCOVER'
                  ? "bg-orange-500/20 text-orange-400 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.3)]"
                  : "text-white/30 hover:text-white/70 hover:bg-white/[0.05]"
              )}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">탐색</span>
            </button>

            <button
              onClick={() => { setView('WATCHLIST'); setSearchQuery(''); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0",
                view === 'WATCHLIST'
                  ? "bg-orange-500/20 text-orange-400 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.3)]"
                  : "text-white/30 hover:text-white/70 hover:bg-white/[0.05]"
              )}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">관심 목록</span>
              {(watchlist || []).length > 0 && (
                <span className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded-md font-black",
                  view === 'WATCHLIST' ? "bg-orange-500/30 text-orange-300" : "bg-white/10 text-white/40"
                )}>
                  {(watchlist || []).length}
                </span>
              )}
            </button>

            <div className="w-px h-4 bg-white/[0.08] mx-1 shrink-0" />

            {/* 분석 그룹 */}
            <button
              onClick={() => { setView('SCREENER'); setSearchQuery(''); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0",
                view === 'SCREENER'
                  ? "bg-blue-500/20 text-blue-400 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.3)]"
                  : "text-white/30 hover:text-white/70 hover:bg-white/[0.05]"
              )}
            >
              <Filter className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">스크리너</span>
            </button>

            <button
              onClick={() => { setView('SUBSCRIPTION'); setSearchQuery(''); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0",
                view === 'SUBSCRIPTION'
                  ? "bg-amber-500/20 text-amber-400 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.3)]"
                  : "text-white/30 hover:text-white/70 hover:bg-white/[0.05]"
              )}
            >
              <Radar className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">구독</span>
            </button>

            <button
              onClick={() => { setView('MANUAL_INPUT'); setSearchQuery(''); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0",
                view === 'MANUAL_INPUT'
                  ? "bg-indigo-500/20 text-indigo-400 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.3)]"
                  : "text-white/30 hover:text-white/70 hover:bg-white/[0.05]"
              )}
            >
              <Calculator className="w-3.5 h-3.5" />
              <span className="hidden md:inline">수동 퀀트</span>
            </button>

            <div className="w-px h-4 bg-white/[0.08] mx-1 shrink-0" />

            {/* 전략 그룹 */}
            <button
              onClick={() => { setView('BACKTEST'); setSearchQuery(''); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0",
                view === 'BACKTEST'
                  ? "bg-blue-600/20 text-blue-300 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.3)]"
                  : "text-white/30 hover:text-white/70 hover:bg-white/[0.05]"
              )}
            >
              <History className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">백테스트</span>
            </button>

            <button
              onClick={() => { setView('WALK_FORWARD'); setSearchQuery(''); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0",
                view === 'WALK_FORWARD'
                  ? "bg-purple-500/20 text-purple-400 shadow-[inset_0_0_0_1px_rgba(168,85,247,0.3)]"
                  : "text-white/30 hover:text-white/70 hover:bg-white/[0.05]"
              )}
            >
              <Shield className="w-3.5 h-3.5" />
              <span className="hidden md:inline">워크포워드</span>
            </button>

            <button
              onClick={() => { setView('MARKET'); setSearchQuery(''); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0",
                view === 'MARKET'
                  ? "bg-indigo-500/20 text-indigo-400 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.3)]"
                  : "text-white/30 hover:text-white/70 hover:bg-white/[0.05]"
              )}
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden md:inline">시장</span>
            </button>

            <div className="w-px h-4 bg-white/[0.08] mx-1 shrink-0" />

            {/* 저널 & 체크 */}
            <button
              onClick={() => { setView('TRADE_JOURNAL'); setSearchQuery(''); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0",
                view === 'TRADE_JOURNAL'
                  ? "bg-emerald-500/20 text-emerald-400 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.3)]"
                  : "text-white/30 hover:text-white/70 hover:bg-white/[0.05]"
              )}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">매매일지</span>
              {tradeRecords.filter((t: TradeRecord) => t.status === 'OPEN').length > 0 && (
                <span className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded-md font-black",
                  view === 'TRADE_JOURNAL' ? "bg-emerald-500/30 text-emerald-300" : "bg-white/10 text-white/40"
                )}>
                  {tradeRecords.filter((t: TradeRecord) => t.status === 'OPEN').length}
                </span>
              )}
            </button>

            <button
              onClick={() => setShowMasterChecklist(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black text-white/30 hover:text-orange-400 hover:bg-orange-500/[0.08] transition-all whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="hidden md:inline">체크리스트</span>
            </button>

            <button
              onClick={() => { setView('AUTO_TRADE'); setSearchQuery(''); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap shrink-0",
                view === 'AUTO_TRADE'
                  ? "bg-violet-500/20 text-violet-400 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.3)]"
                  : "text-white/30 hover:text-white/70 hover:bg-white/[0.05]"
              )}
            >
              <Zap className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">자동매매</span>
              {shadowTrades.length > 0 && (
                <span className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded-md font-black",
                  view === 'AUTO_TRADE' ? "bg-violet-500/30 text-violet-300" : "bg-white/10 text-white/40"
                )}>
                  {shadowTrades.length}
                </span>
              )}
            </button>
          </nav>

          {/* ── Right: status + settings ── */}
          <div className="flex items-center gap-2 shrink-0">
            {lastUpdated && (
              <div className="hidden lg:flex flex-col items-end leading-none gap-0.5">
                <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.15em]">마지막 업데이트</span>
                <span className="text-[10px] font-black text-white/40 tabular-nums">
                  {new Date(lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-white/30 hover:text-white/70 hover:bg-white/[0.07] transition-all border border-transparent hover:border-white/[0.08]"
              title="설정"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

        </div>
      </header>
      <MarketTicker 
        data={marketOverview} 
        loading={loadingMarket} 
        onRefresh={() => handleFetchMarketOverview(true)} 
      />

      <main id="report-content" className="max-w-6xl mx-auto px-4 py-8 no-print">
        <AnimatePresence mode="wait">
          {view === 'MARKET' ? (
            <MarketPage onFetchMarketOverview={handleFetchMarketOverview} />
          ) : view === 'MANUAL_INPUT' ? (
            <ManualInputPage />
          ) : view === 'AUTO_TRADE' ? (
            <AutoTradePage />
          ) : view === 'TRADE_JOURNAL' ? (
            <TradeJournalPage
              onCloseTrade={closeTrade}
              onDeleteTrade={deleteTrade}
              onUpdateMemo={updateTradeMemo}
            />
          ) : view === 'SCREENER' ? (
            <ScreenerPage onScreen={handleScreener} />
          ) : view === 'SUBSCRIPTION' ? (
            <SubscriptionPage
              onAddSector={handleAddSector}
              onRemoveSector={handleRemoveSector}
            />
          ) : view === 'BACKTEST' ? (
            <BacktestPage
              onRunBacktest={runBacktest}
              onFileUpload={handleFileUpload}
              onRemoveFromBacktest={removeFromBacktest}
              onUpdateWeight={updateWeight}
              onReorderPortfolioItems={reorderPortfolioItems}
              onApplyAIRecommendedWeights={applyAIRecommendedWeights}
              onSelectPortfolio={selectPortfolio}
              onSavePortfolio={savePortfolio}
              onDeletePortfolio={deletePortfolio}
              onUpdatePortfolio={updatePortfolio}
              onCopy={handleCopy}
              copiedCode={copiedCode}
            />
          ) : view === 'WALK_FORWARD' ? (
            <WalkForwardView />
          ) : (
            <DiscoverWatchlistPage
              displayList={displayList}
              filteredRecommendations={filteredRecommendations}
              allPatterns={allPatterns}
              averageHitRate={averageHitRate}
              strongBuyHitRate={strongBuyHitRate}
              loadingNews={loadingNews}
              dartAlerts={dartAlerts}
              kisBalance={kisBalance}
              analysisReportRef={analysisReportRef}
              onFetchStocks={fetchStocks}
              onSyncAll={handleSyncAll}
              onSyncPrice={handleSyncPrice}
              onManualPriceUpdate={handleManualPriceUpdate}
              onToggleWatchlist={toggleWatchlist}
              onAddToBacktest={addToBacktest}
              onMarketSearch={handleMarketSearch}
              onFetchNewsScores={handleFetchNewsScores}
              onGenerateSummary={handleGenerateSummary}
              onGeneratePDF={generatePDF}
              onExportDeepAnalysisPDF={handleExportDeepAnalysisPDF}
              onSendEmail={sendEmail}
              onRecordTrade={recordTrade}
            />
          )}
        </AnimatePresence>

        {/* Disclaimer */}
        <footer className="mt-20 pt-12 pb-20 border-t border-white/5 text-center bg-black/20">
          <div className="flex items-center justify-center gap-3 text-white/30 text-xs mb-6 px-4">
            <Info className="w-4 h-4 shrink-0" />
            <span className="font-medium leading-relaxed">본 정보는 AI 분석 결과이며 투자 권유가 아닙니다. 모든 투자의 책임은 본인에게 있습니다.</span>
          </div>
          <p className="text-white/10 text-[10px] uppercase tracking-[0.3em] font-bold">
            Powered by Google Gemini & Master Framework Engine
          </p>
          <p className="text-[9px] text-white/5 mt-4 font-medium">
            © 2026 K-Stock AI Analysis System. All rights reserved.
          </p>
        </footer>
      </main>

      <StockDetailModal
        stock={selectedDetailStock}
        onClose={() => setSelectedDetailStock(null)}
      />

      {/* ── 매수 기록 모달 ──────────────────────────────────────────── */}
      {tradeRecordStock && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          onClick={() => setTradeRecordStock(null)}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="glass-3d rounded-[2rem] p-8 max-w-md w-full border border-white/10 shadow-2xl"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-black text-white">{tradeRecordStock.name} 매수 기록</h3>
                <p className="text-xs text-white/40 font-mono">{tradeRecordStock.code} · {tradeRecordStock.type}</p>
              </div>
              <button onClick={() => setTradeRecordStock(null)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10">
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-white/50 uppercase tracking-widest">매수가 (원)</label>
                <input type="number" value={tradeFormData.buyPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTradeFormData(p => ({ ...p, buyPrice: e.target.value }))}
                  className="w-full mt-1 p-3 bg-white/5 border border-white/10 text-white text-sm rounded-xl" placeholder={String(tradeRecordStock.currentPrice)} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-white/50 uppercase tracking-widest">수량 (주)</label>
                <input type="number" value={tradeFormData.quantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTradeFormData(p => ({ ...p, quantity: e.target.value }))}
                  className="w-full mt-1 p-3 bg-white/5 border border-white/10 text-white text-sm rounded-xl" placeholder="100" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-white/50 uppercase tracking-widest">포트폴리오 비중 (%)</label>
                <input type="number" value={tradeFormData.positionSize} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTradeFormData(p => ({ ...p, positionSize: e.target.value }))}
                  className="w-full mt-1 p-3 bg-white/5 border border-white/10 text-white text-sm rounded-xl" />
              </div>
              <div className="flex items-center gap-4">
                <label className="text-[10px] font-bold text-white/50 uppercase tracking-widest">매수 방식</label>
                <div className="flex gap-2">
                  <button onClick={() => setTradeFormData(p => ({ ...p, followedSystem: true }))}
                    className={`text-xs px-4 py-2 rounded-xl font-bold border transition-all ${tradeFormData.followedSystem ? 'bg-indigo-500 text-white border-indigo-400' : 'bg-white/5 text-white/40 border-white/10'}`}>
                    SYSTEM
                  </button>
                  <button onClick={() => setTradeFormData(p => ({ ...p, followedSystem: false }))}
                    className={`text-xs px-4 py-2 rounded-xl font-bold border transition-all ${!tradeFormData.followedSystem ? 'bg-amber-500 text-white border-amber-400' : 'bg-white/5 text-white/40 border-white/10'}`}>
                    INTUITION
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                const bp = parseFloat(tradeFormData.buyPrice) || tradeRecordStock.currentPrice;
                const qty = parseInt(tradeFormData.quantity) || 1;
                const ps = parseFloat(tradeFormData.positionSize) || 10;
                recordTrade(
                  tradeRecordStock, bp, qty, ps,
                  tradeFormData.followedSystem,
                  {},  // conditionScores — 수동 입력 시 빈 객체
                  { g1: 0, g2: 0, g3: 0, final: 0 },
                );
                setTradeRecordStock(null);
              }}
              disabled={!tradeFormData.quantity}
              className="w-full mt-6 py-3 bg-emerald-500 text-white font-black rounded-xl text-sm uppercase tracking-widest hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-[0_8px_30px_rgba(16,185,129,0.3)]"
            >
              매수 기록 저장
            </button>
          </motion.div>
        </motion.div>
      )}

      </div>
    </div>
  );
}
