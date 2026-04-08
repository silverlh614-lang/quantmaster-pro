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

const getMarketPhaseInfo = (phase?: string) => {
  const p = phase?.toUpperCase() || 'NEUTRAL';
  switch (p) {
    case 'RISK_ON':
    case 'BULL':
      return { 
        label: '강세장 (Bull)', 
        description: '시장이 상승 추세에 있으며 투자 심리가 긍정적입니다.',
        recommendation: '적극 매수 및 수익 극대화 전략',
        color: 'text-green-400'
      };
    case 'RISK_OFF':
    case 'BEAR':
      return { 
        label: '약세장 (Bear)', 
        description: '시장이 하락 추세에 있으며 투자 심리가 위축되어 있습니다.',
        recommendation: '현금 비중 확대 및 보수적 관망',
        color: 'text-red-400'
      };
    case 'SIDEWAYS':
      return { 
        label: '횡보장 (Sideways)', 
        description: '시장이 뚜렷한 방향성 없이 박스권에서 움직이고 있습니다.',
        recommendation: '박스권 매매 및 개별 종목 장세 대응',
        color: 'text-blue-400'
      };
    case 'TRANSITION':
      return { 
        label: '전환기 (Transition)', 
        description: '시장의 추세가 변하고 있는 중요한 시점입니다.',
        recommendation: '주도주 교체 확인 및 분할 매수 준비',
        color: 'text-purple-400'
      };
    case 'NEUTRAL':
    default:
      return { 
        label: '중립 (Neutral)', 
        description: '시장 상황을 분석 중이며 관망세가 짙습니다.',
        recommendation: '시장 방향성 확인 후 진입 결정',
        color: 'text-gray-400'
      };
  }
};

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
  const analysisReportRef = useRef<HTMLDivElement>(null);

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

  const checkPriceAlerts = (stocks: StockRecommendation[]) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    
    stocks.forEach(stock => {
      // 손절가 도달
      if (stock.currentPrice <= stock.stopLoss) {
        new Notification(`⚠️ 손절 알림: ${stock.name}`, {
          body: `현재가 ${stock.currentPrice.toLocaleString()}원이 손절가 ${stock.stopLoss.toLocaleString()}원에 도달했습니다.`,
          icon: '/favicon.ico'
        });
      }
      // 1차 목표가 도달
      if (stock.currentPrice >= stock.targetPrice) {
        new Notification(`🎯 목표 달성: ${stock.name}`, {
          body: `1차 목표가 ${stock.targetPrice.toLocaleString()}원 도달! 절반 익절을 고려하십시오.`
        });
      }
    });
  };

  useEffect(() => {
    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark', 'theme-high-contrast');
    if (theme !== 'dark') {
      body.classList.add(`theme-${theme}`);
    }
  }, [theme]);

  // Use refs to avoid stale closures in intervals
  const watchlistRef = useRef(watchlist);
  const autoSyncEnabledRef = useRef(autoSyncEnabled);
  const syncingStockRef = useRef<string | null>(null);

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  // 서버 자동매매 워치리스트 동기화 — 클라이언트 watchlist 변경 시 서버에 반영
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

  useEffect(() => {
    autoSyncEnabledRef.current = autoSyncEnabled;
  }, [autoSyncEnabled]);

  const handleSyncPrice = async (stock: StockRecommendation): Promise<StockRecommendation | null> => {
    if (syncingStockRef.current) return null;
    
    syncingStockRef.current = stock.code;
    setSyncingStock(stock.code);
    
    try {
      toast.info(`${stock.name}의 실시간 가격, 뉴스 및 전략을 동기화 중입니다...`, {
        description: "최신 시장 데이터를 반영하여 목표가와 손절가를 재산출합니다.",
        duration: 3000
      });
      const updatedStock = await syncStockPrice(stock);
      
      toast.success(`${stock.name} 동기화 완료`, {
        description: "최신 가격과 뉴스, 기술적 분석이 업데이트되었습니다.",
        duration: 2000
      });
      
      // Update recommendations using functional update
      setRecommendations(prev => {
        const updated = (prev || []).map(s => s.code === stock.code ? updatedStock : s);

        return updated;
      });

      // Update watchlist using functional update
      setWatchlist(prev => {
        const updated = (prev || []).map(s => s.code === stock.code ? updatedStock : s);

        return updated;
      });

      // Update deep analysis if open
      setDeepAnalysisStock(prev => {
        if (prev?.code === stock.code) return updatedStock;
        return prev;
      });
      
      return updatedStock;
    } catch (err: any) {
      console.error('Sync failed:', err);
      if (!autoSyncEnabledRef.current) {
        toast.error(`${stock.name} 동기화 실패`, {
          description: err.message || '알 수 없는 오류가 발생했습니다.',
        });
      }
      return null;
    } finally {
      syncingStockRef.current = null;
      setSyncingStock(null);
    }
  };

  const handleManualPriceUpdate = (stock: StockRecommendation, newPrice: number) => {
    if (isNaN(newPrice) || newPrice <= 0) {
      toast.error("유효한 가격을 입력해주세요.");
      return;
    }

    const updatedStock = {
      ...stock,
      currentPrice: newPrice,
      priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} (수동)`
    };

    setRecommendations(prev => {
      const next = (prev || []).map(s => s.code === stock.code ? updatedStock : s);

      return next;
    });

    setWatchlist(prev => {
      const next = (prev || []).map(s => s.code === stock.code ? updatedStock : s);

      return next;
    });

    setDeepAnalysisStock(prev => {
      if (prev?.code === stock.code) return updatedStock;
      return prev;
    });

    toast.success(`${stock.name} 가격이 수동 업데이트되었습니다.`, {
      description: `새 가격: ₩${newPrice?.toLocaleString() || '0'}`
    });
  };

  // Expose syncBySelector to window for external control/automation
  useEffect(() => {
    (window as any).syncStocksBySelector = async (selector: string) => {
      const elements = document.querySelectorAll(selector);
      const codes = Array.from(elements)
        .map(el => el.getAttribute('data-stock-code'))
        .filter(Boolean) as string[];
      
      if (codes.length === 0) {
        toast.warning("선택된 종목이 없습니다.", {
          description: `Selector '${selector}'에 매칭되는 종목을 찾을 수 없습니다.`
        });
        return;
      }

      toast.info(`${codes.length}개 종목 동기화 시작...`);
      
      for (const code of codes) {
        const stock = (recommendations || []).find(r => r.code === code) || (watchlist || []).find(w => w.code === code);
        if (stock) {
          await handleSyncPrice(stock);
          // Small delay between each stock sync to be gentle with API
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    };
  }, [recommendations, watchlist]);

  // Auto-sync logic with improved cycle management
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let countdownInterval: ReturnType<typeof setInterval>;

    const runSyncCycle = async () => {
      if (!autoSyncEnabledRef.current || syncStatus.isSyncing) {
        timeoutId = setTimeout(runSyncCycle, 10000);
        return;
      }

      const currentWatchlist = [...watchlistRef.current];
      if (currentWatchlist.length === 0) {
        setNextSyncCountdown(60);
        timeoutId = setTimeout(runSyncCycle, 60000);
        return;
      }

      setSyncStatus({ isSyncing: true, total: currentWatchlist.length, progress: 0 });

      for (let i = 0; i < currentWatchlist.length; i++) {
        if (!autoSyncEnabledRef.current) break;
        
        const stock = currentWatchlist[i];
        setSyncStatus({ currentStock: stock.name, progress: i + 1 });

        try {
          const updatedStock = await handleSyncPrice(stock);
          if (updatedStock) checkPriceAlerts([updatedStock]);
          // Wait between stocks to respect rate limits (Gemini 3.1 Flash is ~15 RPM)
          // 5 seconds delay + execution time (~3-5s) = ~10s per stock = 6 stocks per minute
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (err) {
          console.error(`Auto-sync failed for ${stock.name}:`, err);
        }
      }

      // ── OPEN 매매 현재가 자동 갱신 ──
      setTradeRecords((prev: TradeRecord[]) => {
        const updatedRecs = prev.map((t: TradeRecord) => {
          if (t.status !== 'OPEN') return t;
          // watchlist에서 동기화된 최신 가격 반영
          const synced = watchlistRef.current.find((s: StockRecommendation) => s.code === t.stockCode);
          const newPrice = synced?.currentPrice ?? t.currentPrice;
          if (!newPrice || newPrice === t.currentPrice) return t;
          return {
            ...t,
            currentPrice: newPrice,
            unrealizedPct: parseFloat(((newPrice - t.buyPrice) / t.buyPrice * 100).toFixed(2)),
            lastSyncAt: new Date().toISOString(),
          };
        });
        return updatedRecs;
      });

      setSyncStatus({ isSyncing: false, currentStock: null, lastSyncTime: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) });

      setNextSyncCountdown(300); // Wait 5 minutes between full cycles
      timeoutId = setTimeout(runSyncCycle, 300000);
    };

    if (autoSyncEnabled) {
      setNextSyncCountdown(60);
      countdownInterval = setInterval(() => {
        setNextSyncCountdown(Math.max(0, useMarketStore.getState().nextSyncCountdown - 1));
      }, 1000);
      
      timeoutId = setTimeout(runSyncCycle, 1000);
    }

    return () => {
      clearTimeout(timeoutId);
      clearInterval(countdownInterval);
    };
  }, [autoSyncEnabled]);

  const handleSyncAll = async () => {
    if (syncStatus.isSyncing) return;
    
    const stocksToSync = view === 'WATCHLIST' ? watchlist : recommendations;
    if (stocksToSync.length === 0) {
      toast.info("동기화할 종목이 없습니다.");
      return;
    }

    setSyncStatus({ isSyncing: true, total: stocksToSync.length, progress: 0 });

    toast.info(`${stocksToSync.length}개 종목의 실시간 데이터 동기화를 시작합니다.`);

    for (let i = 0; i < stocksToSync.length; i++) {
      const stock = stocksToSync[i];
      setSyncStatus({ currentStock: stock.name, progress: i + 1 });

      try {
        await handleSyncPrice(stock);
        // Delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (err) {
        console.error(`Sync failed for ${stock.name}:`, err);
      }
    }

    setSyncStatus({ isSyncing: false, currentStock: null, lastSyncTime: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) });
    
    toast.success("모든 종목의 동기화가 완료되었습니다.");
  };

  // Real-time price sync effect
  useEffect(() => {
    if (recommendations.length === 0) return;

    const syncPrices = async () => {
      console.log("Syncing prices...");
      const updatedRecommendations = await Promise.all(
        recommendations.map(async (stock) => {
          try {
            const currentPrice = await fetchCurrentPrice(stock.code);
            if (currentPrice && currentPrice !== stock.currentPrice) {
              return { ...stock, currentPrice, priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (Auto)` };
            }
          } catch (e) {
            console.error(`Failed to sync price for ${stock.code}`, e);
          }
          return stock;
        })
      );
      
      // Only update if there are changes
      const hasChanges = updatedRecommendations.some((s, i) => s.currentPrice !== recommendations[i].currentPrice);
      if (hasChanges) {
        setRecommendations(updatedRecommendations);

      }
    };

    // Initial sync
    syncPrices();

    // Set up interval (every 5 minutes)
    const interval = setInterval(syncPrices, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [recommendations.length]); // Only re-run if the list changes

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

  const generatePDF = async (shouldDownload = true): Promise<string | null> => {
    setIsGeneratingPDF(true);
    console.log('PDF 생성 시작 (modern-screenshot 사용)...');
    const originalStyles = new Map<HTMLElement, any>();
    const originalScrollY = window.scrollY;
    try {
      const element = document.getElementById('report-content');
      if (!element) {
        console.error('report-content element not found');
        toast.error('리포트 내용을 찾을 수 없습니다.');
        return null;
      }

      // Ensure we are at the top to capture everything correctly
      window.scrollTo(0, 0);

      // Give a small delay for any animations or lazy-loaded content to settle
      await new Promise(resolve => setTimeout(resolve, 800));

      // Temporarily expand all scrollable containers to capture full content
      const scrollableElements = element.querySelectorAll('.overflow-y-auto, .overflow-auto');
      
      scrollableElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        originalStyles.set(htmlEl, {
          maxHeight: htmlEl.style.maxHeight,
          overflow: htmlEl.style.overflow,
          overflowY: htmlEl.style.overflowY,
          height: htmlEl.style.height
        });
        htmlEl.style.maxHeight = 'none';
        htmlEl.style.overflow = 'visible';
        htmlEl.style.overflowY = 'visible';
        htmlEl.style.height = 'auto';
      });

      const fullHeight = element.scrollHeight;
      const fullWidth = element.scrollWidth;
      
      console.log(`리포트 크기: ${fullWidth}x${fullHeight}`);

      // Cap scale if height is too large to avoid browser canvas limits (approx 32k)
      // Most browsers have a limit around 32,767px for canvas dimensions
      let captureScale = 1.5;
      if (fullHeight * captureScale > 30000) {
        captureScale = Math.max(1, 30000 / fullHeight);
        console.log(`높이가 너무 커서 스케일을 ${captureScale.toFixed(2)}로 조정합니다.`);
      }

      console.log('domToJpeg 호출 중...');
      // modern-screenshot supports modern CSS like oklch/oklab
      // We force height auto and overflow visible to ensure full capture
      const imgData = await domToJpeg(element, {
        scale: captureScale,
        quality: 0.8,
        backgroundColor: '#050505',
        width: fullWidth,
        height: fullHeight,
        style: {
          borderRadius: '0',
          backdropFilter: 'none',
          height: 'auto',
          overflow: 'visible',
          maxHeight: 'none',
          margin: '0',
          padding: '20px', // Add some padding for the PDF
        }
      });

      console.log('이미지 생성 완료, PDF 변환 중...');
      
      // Create a temporary image to get dimensions
      const img = new Image();
      img.src = imgData;
      await new Promise((resolve) => (img.onload = resolve));

      const pdf = new jsPDF({
        orientation: img.width > img.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [img.width, img.height],
        compress: true
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, img.width, img.height, undefined, 'FAST');
      
      const filename = `stock-analysis-${new Date().toISOString().split('T')[0]}.pdf`;
      if (shouldDownload) {
        console.log('PDF 다운로드 시작...');
        pdf.save(filename);
      }

      console.log('PDF 생성 완료');
      return pdf.output('datauristring');
    } catch (err: any) {
      console.error('PDF 생성 실패:', err);
      toast.error(`PDF 생성 중 오류가 발생했습니다: ${err.message || '알 수 없는 오류'}`);
      return null;
    } finally {
      // Restore scroll position
      window.scrollTo(0, originalScrollY);

      // Restore all original styles
      originalStyles.forEach((style, el) => {
        el.style.maxHeight = style.maxHeight;
        el.style.overflow = style.overflow;
        if (style.overflowY !== undefined) el.style.overflowY = style.overflowY;
        el.style.height = style.height;
      });
      setIsGeneratingPDF(false);
    }
  };

  const handleExportDeepAnalysisPDF = async () => {
    if (!analysisReportRef.current || !deepAnalysisStock) return;
    
    setIsExportingDeepAnalysis(true);
    const toastId = toast.loading(`${deepAnalysisStock.name} PDF 리포트를 생성 중입니다...`);
    
    const originalStyles = new Map<HTMLElement, any>();
    try {
      const element = analysisReportRef.current;
      
      // Temporarily expand all scrollable containers to capture full content
      const scrollableElements = element.querySelectorAll('.overflow-y-auto, .overflow-auto');
      
      // Save and modify root element
      originalStyles.set(element, {
        maxHeight: element.style.maxHeight,
        overflow: element.style.overflow,
        height: element.style.height
      });
      element.style.maxHeight = 'none';
      element.style.overflow = 'visible';
      element.style.height = 'auto';

      // Save and modify all nested scrollable elements
      scrollableElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        originalStyles.set(htmlEl, {
          maxHeight: htmlEl.style.maxHeight,
          overflow: htmlEl.style.overflow,
          overflowY: htmlEl.style.overflowY,
          height: htmlEl.style.height
        });
        htmlEl.style.maxHeight = 'none';
        htmlEl.style.overflow = 'visible';
        htmlEl.style.overflowY = 'visible';
        htmlEl.style.height = 'auto';
      });
      
      const fullHeight = element.scrollHeight;
      const fullWidth = element.scrollWidth;
      
      let captureScale = 1.2; // Reduced scale to save memory/size
      if (fullHeight * captureScale > 25000) {
        captureScale = Math.max(0.8, 25000 / fullHeight);
      }

      // Add a small delay to allow browser to re-render expanded elements
      await new Promise(resolve => setTimeout(resolve, 300));

      const imgData = await domToJpeg(element, {
        scale: captureScale,
        quality: 0.7, // Reduced quality for smaller file size
        backgroundColor: '#050505',
        width: fullWidth,
        height: fullHeight,
        filter: (node) => {
          if (node instanceof HTMLElement && node.classList.contains('no-print')) {
            return false;
          }
          return true;
        }
      });
      
      const img = new Image();
      img.src = imgData;
      await new Promise((resolve) => (img.onload = resolve));

      const pdf = new jsPDF({
        orientation: img.width > img.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [img.width, img.height],
        compress: true
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, img.width, img.height, undefined, 'FAST');
      pdf.save(`${deepAnalysisStock.name}_AI_Analysis_Report.pdf`);
      
      toast.success('PDF 리포트가 성공적으로 저장되었습니다.', { id: toastId });
    } catch (error: any) {
      console.error('PDF Export Error:', error);
      toast.error(`PDF 생성 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`, { id: toastId });
    } finally {
      // Restore all original styles
      originalStyles.forEach((style, el) => {
        el.style.maxHeight = style.maxHeight;
        el.style.overflow = style.overflow;
        if (style.overflowY !== undefined) el.style.overflowY = style.overflowY;
        el.style.height = style.height;
      });
      setIsExportingDeepAnalysis(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (isSummarizing) return;
    
    setIsSummarizing(true);
    try {
      console.log('AI 요약 생성 중...');
      // 추천 종목과 검색 결과를 합쳐서 요약 대상으로 전달
      const allStocks = [...(recommendations || []), ...(searchResults || [])];
      const summary = await generateReportSummary(allStocks, marketContext);
      setReportSummary(summary);
    } catch (err: any) {
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
      
      if (isRateLimit) {
        console.warn('AI 요약 생성 할당량 초과');
        toast.error('API 할당량 초과: 잠시 후 다시 시도해 주세요.');
      } else {
        console.error('요약 생성 실패:', err);
        toast.error(`요약 생성 중 오류가 발생했습니다: ${message}`);
      }
    } finally {
      setIsSummarizing(false);
    }
  };

  const sendEmail = async () => {
    if (!emailAddress) {
      toast.warning('이메일 주소를 입력해주세요.');
      return;
    }

    setIsSendingEmail(true);
    try {
      let summary = reportSummary;
      if (!summary) {
        setIsSummarizing(true);
        console.log('AI 요약 생성 중...');
        summary = await generateReportSummary(recommendations, marketContext);
        setReportSummary(summary);
        setIsSummarizing(false);
      }
      
      console.log('PDF 생성 중...');
      const pdfBase64 = await generatePDF(false);
      if (!pdfBase64) return;

      console.log('이메일 전송 중...');
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: emailAddress,
          subject: `[QuantMaster Pro] 주식 분석 리포트 - ${new Date().toLocaleDateString()}`,
          text: `안녕하세요. 'QuantMaster Pro' 분석 리포트입니다.\n\n[AI 요약 리포트]\n${summary}\n\n상세 내용은 첨부된 PDF 파일을 확인해주세요.`,
          pdfBase64,
          filename: `stock-analysis-${new Date().toISOString().split('T')[0]}.pdf`
        }),
      });

      const result = await response.json();
      if (result.success) {
        toast.success('이메일이 성공적으로 전송되었습니다.');
      } else {
        throw new Error(result.error || '전송 실패');
      }
    } catch (err: any) {
      console.error('이메일 전송 실패:', err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
      
      if (isRateLimit) {
        toast.error('API 할당량 초과: 잠시 후 다시 시도해 주세요.');
      } else {
        toast.error(`이메일 전송 중 오류가 발생했습니다: ${message}`);
      }
    } finally {
      setIsSendingEmail(false);
      setIsSummarizing(false);
    }
  };

  useEffect(() => {
    document.documentElement.style.fontSize = `${(fontSize / 16) * 100}%`;
  }, [fontSize]);


  const roeTypeDetails = {
    '유형 1': {
      title: '유형 1 (ROE 개선)',
      desc: 'ROE가 전년 대비 개선되는 기업. 턴어라운드 초기 단계.',
      metrics: '순이익률 개선, 비용 절감, 자산 효율화',
      trend: '하락 추세 멈춤 → 횡보 → 상승 반전의 초기 국면',
      strategy: '추세 전환 확인 후 분할 매수, 손절가 엄격 준수',
      detailedStrategy: '1차 매수는 비중의 30%로 시작, 20일 이평선 안착 시 추가 매수. 실적 턴어라운드 확인 필수.',
      color: 'text-blue-400'
    },
    '유형 2': {
      title: '유형 2 (ROE 고성장)',
      desc: 'ROE가 15% 이상 유지되는 고성장 기업. 안정적 수익성.',
      metrics: '높은 시장 점유율, 독점적 지위, 꾸준한 현금 흐름',
      trend: '장기 우상향 추세, 일시적 조정 후 재상승 반복',
      strategy: '눌림목 매수, 장기 보유, 실적 발표 주기 확인',
      detailedStrategy: '주요 지지선(60일/120일 이평선) 터치 시 비중 확대. 배당 성향 및 자사주 매입 여부 체크.',
      color: 'text-green-400'
    },
    '유형 3': {
      title: '유형 3 (최우선 매수)',
      desc: '매출과 이익이 함께 증가하며 ROE가 개선되는 최우선 매수 대상.',
      metrics: '매출 성장률 > 이익 성장률, 자산 회전율 급증',
      trend: '가파른 상승 각도, 거래량 동반한 전고점 돌파',
      strategy: '공격적 비중 확대, 전고점 돌파 시 추가 매수',
      detailedStrategy: '추세 추종(Trend Following) 전략 적용. 익절가를 높여가며(Trailing Stop) 수익 극대화.',
      color: 'text-orange-400'
    }
  };

  const getRoeDetail = (roeType: string) => {
    if (roeType.includes('유형 3')) return roeTypeDetails['유형 3'];
    if (roeType.includes('유형 2')) return roeTypeDetails['유형 2'];
    if (roeType.includes('유형 1')) return roeTypeDetails['유형 1'];
    return null;
  };

  const checklistDescriptions: Record<string, string> = {
    cycleVerified: '현재 시장의 주도 섹터 및 사이클에 부합하는지 확인합니다.',
    momentumRanking: '상대 강도 지수 및 가격 상승 탄력성이 상위권인지 확인합니다.',
    roeType3: '매출/이익 동반 성장 및 ROE 개선이 뚜렷한 최우선 매수 대상입니다.',
    supplyInflow: '외국인/기관의 패시브 자금과 액티브 자금이 동시 유입되는지 확인합니다.',
    riskOnEnvironment: '거시 경제 및 시장 전반의 리스크가 통제 가능한 수준인지 확인합니다.',
    ichimokuBreakout: '일목균형표 구름대를 돌파하고 상단에 안착했는지 확인합니다.',
    mechanicalStop: '후행스팬이 주가를 상향 돌파하여 추세 전환을 확증했는지 확인합니다.',
    economicMoatVerified: '브랜드, 네트워크 효과 등 독점적 경쟁 우위를 보유했는지 확인합니다.',
    notPreviousLeader: '직전 장세의 주도주가 아닌, 새로운 사이클의 주도주인지 확인합니다.',
    technicalGoldenCross: '5일/20일 이동평균선의 단기 골든크로스 발생을 확인합니다.',
    volumeSurgeVerified: '지지선 또는 돌파 시점에서 평소 대비 2배 이상의 거래량 발생을 확인합니다.',
    institutionalBuying: '최근 5거래일 이내 기관 또는 외국인의 유의미한 순매수세가 유입되었는지 확인합니다.',
    consensusTarget: '증권사 평균 목표가 대비 현재가가 충분한 상승 여력(Upside)을 보유했는지 확인합니다.',
    earningsSurprise: '최근 분기 실적이 시장 예상치를 상회하거나, 향후 가이던스가 상향되었는지 확인합니다.',
    performanceReality: '막연한 기대감이 아닌, 수주 잔고나 실질 이익 등 실체적 데이터가 담보되었는지 확인합니다.',
    policyAlignment: '정부의 산업 육성 정책이나 글로벌 매크로 환경(피벗 등)에 부합하는지 확인합니다.',
    psychologicalObjectivity: '보유 효과나 후회 회피 등 심리적 편향을 배제하고 객관적 데이터로 판단했는지 확인합니다.',
    turtleBreakout: '20일/55일 신고가 돌파(Donchian Channel) 및 ATR 기반의 변동성 추세 추종 전략에 부합하는지 확인합니다.',
    fibonacciLevel: '주요 피보나치 되돌림(38.2%, 50%, 61.8%) 지지선 및 확장 목표가 레벨에 도달했는지 확인합니다.',
    elliottWaveVerified: '엘리엇 파동 이론에 따른 현재 파동의 위치(상승 3파 등)와 추세 지속성을 확인합니다.'
  };
  const { copiedCode, handleCopy } = useCopiedCode();

  const handleResetScreen = () => {
    setSearchResults([]);
    setSearchQuery('');
    setSelectedType('ALL');
    setSelectedPattern('ALL');
    setSelectedSentiment('ALL');
    setSelectedChecklist([]);
    setMinPrice('');
    setMaxPrice('');
    setFilters({ 
      minRoe: 15, 
      maxPer: 20, 
      maxDebtRatio: 100, 
      minMarketCap: 1000,
      mode: 'MOMENTUM'
    });
    setError(null);
    toast.info('화면이 초기화되었습니다.');
  };

  // Gate 0 결과: macroEnv가 채워지면 자동 계산
  const gate0Result = useMemo(() => macroEnv ? evaluateGate0(macroEnv) : undefined, [macroEnv]);

  const deepAnalysisGateSignals = useMemo(() => {
    if (!deepAnalysisStock) return [];
    if (deepAnalysisStock.type === 'STRONG_BUY' || deepAnalysisStock.type === 'BUY') {
      return [{
        time: new Date().toISOString().split('T')[0],
        type: deepAnalysisStock.type === 'STRONG_BUY' ? 'STRONG_BUY' as const : 'BUY' as const,
        label: deepAnalysisStock.type,
      }];
    }
    return [];
  }, [deepAnalysisStock?.code, deepAnalysisStock?.type]);

  const triageSummary = useMemo(() => {
    const summary = { gate1: 0, gate2: 0, gate3: 0, total: (recommendations || []).length };
    (recommendations || []).forEach(rec => {
      if (rec.gate === 1) summary.gate1++;
      else if (rec.gate === 2) summary.gate2++;
      else if (rec.gate === 3) summary.gate3++;
    });
    return summary;
  }, [recommendations]);



  const scrollToStock = (code: string) => {
    const element = document.getElementById(`stock-${code}`);
    if (element) {
      const headerOffset = 100;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };


  // ── 매매 기록 → EVOLUTION_WEIGHTS 자동 업데이트 ─────────────────────────────
  useEffect(() => {
    const closed = tradeRecords.filter(t => t.status === 'CLOSED');
    if (closed.length >= 10) {
      const condPerf = computeConditionPerformance(closed);
      const weights: Record<number, number> = {};
      condPerf.forEach((c: { conditionId: number; totalTrades: number; evolutionWeight: number }) => {
        if (c.totalTrades >= 10 && c.evolutionWeight !== 1.0) {
          weights[c.conditionId] = c.evolutionWeight;
        }
      });
      if (Object.keys(weights).length > 0) {
        saveEvolutionWeights(weights);
      }
    }
  }, [tradeRecords]);

  const recordTrade = (
    stock: StockRecommendation,
    buyPrice: number,
    quantity: number,
    positionSize: number,
    followedSystem: boolean,
    conditionScores: Record<ConditionId, number>,
    gateScores: { g1: number; g2: number; g3: number; final: number },
  ) => {
    const newTrade: TradeRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      stockCode: stock.code,
      stockName: stock.name,
      sector: stock.relatedSectors?.[0] ?? 'Unknown',
      buyDate: new Date().toISOString(),
      buyPrice,
      quantity,
      positionSize,
      systemSignal: stock.type === 'STRONG_BUY' ? 'STRONG_BUY' : stock.type === 'BUY' ? 'BUY' : stock.type === 'SELL' || stock.type === 'STRONG_SELL' ? 'SELL' : 'NEUTRAL',
      recommendation: gateScores.final >= 200 ? '풀 포지션' : gateScores.final >= 150 ? '절반 포지션' : '관망',
      gate1Score: gateScores.g1,
      gate2Score: gateScores.g2,
      gate3Score: gateScores.g3,
      finalScore: gateScores.final,
      conditionScores,
      followedSystem,
      status: 'OPEN',
      currentPrice: stock.currentPrice,
      unrealizedPct: 0,
    };
    setTradeRecords(prev => [...prev, newTrade]);
  };

  const closeTrade = (tradeId: string, sellPrice: number, sellReason: TradeRecord['sellReason']) => {
    setTradeRecords((prev: TradeRecord[]) => prev.map((t: TradeRecord) => {
      if (t.id !== tradeId) return t;
      const returnPct = ((sellPrice - t.buyPrice) / t.buyPrice) * 100;
      const holdingDays = Math.round((Date.now() - new Date(t.buyDate).getTime()) / (1000 * 60 * 60 * 24));
      return {
        ...t,
        sellDate: new Date().toISOString(),
        sellPrice,
        sellReason,
        returnPct: parseFloat(returnPct.toFixed(2)),
        holdingDays,
        status: 'CLOSED' as const,
      };
    }));
  };

  const deleteTrade = (tradeId: string) => {
    setTradeRecords((prev: TradeRecord[]) => prev.filter((t: TradeRecord) => t.id !== tradeId));
  };

  const updateTradeMemo = (tradeId: string, memo: string) => {
    setTradeRecords((prev: TradeRecord[]) => prev.map((t: TradeRecord) => t.id === tradeId ? { ...t, memo } : t));
  };

  const toggleWatchlist = (stock: StockRecommendation) => {
    setWatchlist(prev => {
      const current = prev || [];
      const exists = current.find(s => s.code === stock.code);
      if (exists) {
        return current.filter(s => s.code !== stock.code);
      }
      return [...current, {
        ...stock,
        watchedPrice: stock.currentPrice,  // 추가 시점 현재가 저장
        watchedAt: new Date().toLocaleDateString('ko-KR'),
      }];
    });
  };

  const addToBacktest = (stock: StockRecommendation) => {
    if ((backtestPortfolioItems || []).some(item => item.code === stock.code)) return;
    const currentTotalWeight = (backtestPortfolioItems || []).reduce((sum, item) => sum + item.weight, 0);
    const remainingWeight = Math.max(0, 100 - currentTotalWeight);
    setBacktestPortfolioItems([...(backtestPortfolioItems || []), { name: stock.name, code: stock.code, weight: Math.min(20, remainingWeight) }]);
    setView('BACKTEST');
  };

  const removeFromBacktest = (code: string) => {
    setBacktestPortfolioItems((backtestPortfolioItems || []).filter(item => item.code !== code));
  };

  const updateWeight = (code: string, weight: number) => {
    setBacktestPortfolioItems((backtestPortfolioItems || []).map((item: any) => item.code === code ? { ...item, weight } : item));
  };

  const applyAIRecommendedWeights = () => {
    if (!backtestResult?.optimizationSuggestions) return;
    
    let newItems = [...(backtestPortfolioItems || [])];
    let removedCount = 0;
    let updatedCount = 0;
    
    backtestResult.optimizationSuggestions.forEach((suggestion: any) => {
      const index = newItems.findIndex(item => 
        item.name === suggestion.stock || 
        suggestion.stock.includes(item.name) || 
        item.name.includes(suggestion.stock)
      );
      
      if (index !== -1) {
        if (suggestion.action === 'REMOVE') {
          newItems.splice(index, 1);
          removedCount++;
        } else {
          newItems[index] = { ...newItems[index], weight: suggestion.recommendedWeight };
          updatedCount++;
        }
      }
    });
    
    setBacktestPortfolioItems(newItems);
    toast.success(`AI 최적화가 적용되었습니다: ${updatedCount}개 비중 조절, ${removedCount}개 종목 제외`);
  };

  const reorderPortfolioItems = (newItems: { name: string, code: string, weight: number }[]) => {
    setBacktestPortfolioItems(newItems);
  };


  const savePortfolio = (name: string, description?: string) => {
    const newPortfolio: Portfolio = {
      id: crypto.randomUUID(),
      name,
      description,
      items: [...backtestPortfolioItems],
      createdAt: new Date().toISOString(),
      lastBacktestResult: backtestResult
    };
    setPortfolios(prev => [...(prev || []), newPortfolio]);
    setCurrentPortfolioId(newPortfolio.id);
    toast.success('Portfolio saved successfully');
  };

  const selectPortfolio = (id: string) => {
    const portfolio = (portfolios || []).find(p => p.id === id);
    if (portfolio) {
      setBacktestPortfolioItems(portfolio.items);
      setBacktestResult(portfolio.lastBacktestResult || null);
      setCurrentPortfolioId(id);
      toast.info(`Loaded portfolio: ${portfolio.name}`);
    }
  };

  const deletePortfolio = (id: string) => {
    setPortfolios(prev => (prev || []).filter(p => p.id !== id));
    if (currentPortfolioId === id) {
      setCurrentPortfolioId(null);
    }
    toast.error('Portfolio deleted');
  };

  const updatePortfolio = (id: string, name: string, description?: string) => {
    setPortfolios(prev => (prev || []).map(p => 
      p.id === id ? { ...p, name, description } : p
    ));
    toast.success('Portfolio updated');
  };


  const runBacktest = async () => {
    const totalWeight = (backtestPortfolioItems || []).reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight !== 100) {
      toast.warning('포트폴리오 비중의 합이 100%여야 합니다.');
      return;
    }
    setBacktesting(true);
    setError(null);
    try {
      const result = await backtestPortfolio(backtestPortfolioItems, initialEquity, backtestYears);
      setBacktestResult(result);
      
      // Update current portfolio if selected
      if (currentPortfolioId) {
        setPortfolios(prev => (prev || []).map(p => 
          p.id === currentPortfolioId ? { ...p, lastBacktestResult: result } : p
        ));
      }
      
      toast.success('백테스팅 시뮬레이션 완료');
    } catch (err: any) {
      console.error(err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');

      if (isRateLimit) {
        setError('API 할당량이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
        toast.error('API 할당량 초과: 잠시 후 다시 시도해 주세요.');
      } else {
        setError(message || '백테스팅 수행 중 오류가 발생했습니다.');
        toast.error('백테스팅 실패');
      }
    } finally {
      setBacktesting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsingFile(true);
    setError(null);
    try {
      const text = await file.text();
      const items = await parsePortfolioFile(text);
      if (items.length > 0) {
        setBacktestPortfolioItems(items);
      } else {
        toast.error('포트폴리오 정보를 추출하지 못했습니다.');
      }
    } catch (err: any) {
      console.error(err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');

      if (isRateLimit) {
        setError('API 할당량이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
        toast.error('API 할당량 초과: 잠시 후 다시 시도해 주세요.');
      } else {
        setError(message || '파일을 읽는 중 오류가 발생했습니다.');
        toast.error('파일 읽기 실패');
      }
    } finally {
      setParsingFile(false);
      e.target.value = '';
    }
  };


  // Proactive Sector Monitoring (Idea 5) - REMOVED AS REQUESTED

  const handleScreener = async (newFilters: StockFilters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getStockRecommendations(newFilters);
      if (result) {
        setScreenerRecommendations(result.recommendations);
        toast.success(`${result.recommendations.length}개 종목이 스크리닝되었습니다.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '스크리닝 중 오류가 발생했습니다.');
      toast.error('스크리닝 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSector = (sector: string) => {
    if (!subscribedSectors.includes(sector)) {
      setSubscribedSectors([...subscribedSectors, sector]);
      toast.success(`${sector} 섹터가 구독되었습니다.`);
    }
  };

  const handleRemoveSector = (sector: string) => {
    setSubscribedSectors(subscribedSectors.filter(s => s !== sector));
    toast.success(`${sector} 섹터 구독이 해제되었습니다.`);
  };

  const isWatched = (code: string) => watchlist.some(s => s.code === code);

  const MASTER_CHECKLIST_STEPS = [
    // Gate 1: 기초 체력 및 사이클 검증
    { key: 'cycleVerified', title: "주도주 사이클 (Cycle)", desc: "현재 시장의 주도 섹터 및 사이클 부합 여부", icon: RefreshCw, gate: 1 },
    { key: 'roeType3', title: "ROE 유형 3 (ROE Type 3)", desc: "자산회전율과 마진이 동반 상승하는 고품질 성장", icon: BarChart3, gate: 1 },
    { key: 'riskOnEnvironment', title: "시장 환경 (Risk-On)", desc: "삼성 IRI 및 VKOSPI 기반 리스크 온 상태", icon: Zap, gate: 1 },
    { key: 'mechanicalStop', title: "기계적 손절 (-30%)", desc: "리스크 관리를 위한 엄격한 손절 원칙", icon: AlertTriangle, gate: 1 },
    { key: 'notPreviousLeader', title: "신규 주도주 (New Leader)", desc: "과거의 영광이 아닌 새로운 사이클의 주인공", icon: Star, gate: 1 },

    // Gate 2: 수급 및 실체적 모멘텀 확인
    { key: 'supplyInflow', title: "수급 질 개선 (Supply)", desc: "기관 및 외국인의 질적인 수급 유입", icon: Flame, gate: 2 },
    { key: 'ichimokuBreakout', title: "일목균형표 (Ichimoku)", desc: "구름대 돌파 및 후행스팬 역전 확인", icon: LayoutGrid, gate: 2 },
    { key: 'economicMoatVerified', title: "경제적 해자 (Moat)", desc: "브랜드, 네트워크 등 독점적 경쟁력 보유", icon: ShieldCheck, gate: 2 },
    { key: 'technicalGoldenCross', title: "기술적 정배열 (Technical)", desc: "주요 이동평균선의 정배열 및 골든크로스", icon: CheckCircle2, gate: 2 },
    { key: 'volumeSurgeVerified', title: "거래량 실체 (Volume)", desc: "의미 있는 거래량 동반과 매집 흔적", icon: Target, gate: 2 },
    { key: 'institutionalBuying', title: "기관/외인 수급 (Institutional)", desc: "최근 5거래일 이내 유의미한 순매수세 유입", icon: Users, gate: 2 },
    { key: 'consensusTarget', title: "목표가 여력 (Upside)", desc: "증권사 평균 목표가 대비 충분한 상승 여력", icon: ArrowUpCircle, gate: 2 },
    { key: 'earningsSurprise', title: "실적 서프라이즈 (Earnings)", desc: "최근 실적 예상치 상회 및 가이던스 상향", icon: DollarSign, gate: 2 },
    { key: 'performanceReality', title: "실체적 펀더멘털 (Reality)", desc: "수주 잔고 및 실질 이익 등 실체적 데이터 담보", icon: Activity, gate: 2 },
    { key: 'policyAlignment', title: "정책/매크로 부합 (Policy)", desc: "정부 육성 정책 및 글로벌 매크로 환경 부합", icon: Building2, gate: 2 },
    { key: 'ocfQuality', title: "이익의 질 (OCF)", desc: "영업활동현금흐름 > 당기순이익으로 실질적 현금 유입 확인", icon: Wallet, gate: 2 },
    { key: 'relativeStrength', title: "상대 강도 (RS)", desc: "시장 지수 대비 강력한 아웃퍼폼 및 하락장 방어력", icon: Zap, gate: 2 },

    // Gate 3: 추세 가속 및 리스크 관리
    { key: 'momentumRanking', title: "모멘텀 순위 (Momentum)", desc: "업종 내 모멘텀 순위 상위권 진입", icon: TrendingUp, gate: 3 },
    { key: 'psychologicalObjectivity', title: "심리적 객관성 (Psychology)", desc: "보유 효과 등 심리적 편향 배제 및 객관적 판단", icon: Target, gate: 3 },
    { key: 'turtleBreakout', title: "터틀 돌파 (Turtle)", desc: "20일/55일 신고가 돌파 및 ATR 기반 리스크 관리", icon: Shield, gate: 3 },
    { key: 'fibonacciLevel', title: "피보나치 레벨 (Fibonacci)", desc: "주요 되돌림 및 확장 레벨 지지/저항 확인", icon: BarChart3, gate: 3 },
    { key: 'elliottWaveVerified', title: "엘리엇 파동 (Elliott)", desc: "현재 파동 국면(상승 3파 등) 및 추세 지속성 확인", icon: Activity, gate: 3 },
    { key: 'marginAcceleration', title: "마진 가속도 (OPM)", desc: "최근 2~3분기 연속 영업이익률(YoY) 상승 및 레버리지 발생", icon: Percent, gate: 3 },
    { key: 'interestCoverage', title: "재무 방어력 (ICR)", desc: "이자보상배율 3배 초과로 고금리 환경 생존 능력 확보", icon: ShieldCheck, gate: 3 },
    { key: 'vcpPattern', title: "변동성 축소 (VCP)", desc: "주가 수축 및 거래량 마름(Dry-up) 현상으로 에너지 응축", icon: Maximize2, gate: 3 },
    { key: 'divergenceCheck', title: "다이버전스 (Divergence)", desc: "보조지표 역전 현상 부재 확인으로 가짜 돌파 리스크 배제", icon: ArrowRightLeft, gate: 3 },
    { key: 'catalystAnalysis', title: "촉매제 분석 (Catalyst)", desc: "확정 일정(30-60일), 핫 섹터 테마 연관성, DART 공시의 질(수주/소각 등) 기반 가산점 분석", icon: Sparkles, gate: 3 }
  ];

  const SELL_CHECKLIST_STEPS = [
    { title: "주도주 지위 상실 (RS 하락)", desc: "시장 지수 대비 상대 강도가 급격히 약화되며 주도주 대열 이탈", icon: TrendingDown },
    { title: "실적 가속도 둔화 (OPM 하락)", desc: "영업이익률 개선세가 꺾이거나 성장이 정체되는 신호 포착", icon: Percent },
    { title: "주요 이평선 이탈 (20일/60일)", desc: "심리적/추세적 지지선인 20일 또는 60일 이동평균선 대량거래 이탈", icon: AlertTriangle },
    { title: "대중적 광기 (FOMO) 극달", desc: "모든 매체가 해당 종목을 찬양하며 비이성적 과열 구간 진입", icon: Flame },
    { title: "기계적 손절가 터치", desc: "사전에 설정한 리스크 한도(예: -30%)에 도달하여 기계적 매도", icon: ShieldAlert }
  ];

  const fetchStocks = async () => {
    setLoading(true);
    setSearchResults([]);
    setError(null);
    try {
      const data = await getStockRecommendations(filters);
      
      if (!data || !data.recommendations) {
        throw new Error("AI 추천 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      }

      // Save to history
      const avgConfidence = data.recommendations.length > 0 
        ? Math.round(data.recommendations.reduce((sum, s) => sum + s.confidenceScore, 0) / data.recommendations.length)
        : 75;
        
      const newHistoryItem = {
        date: new Date().toLocaleDateString(),
        stocks: data.recommendations.map(s => s.name),
        hitRate: avgConfidence, // Use average confidence as a proxy for expected hit rate
        strongBuyHitRate: Math.min(99, avgConfidence + 5)
      };
      const updatedHistory = [newHistoryItem, ...recommendationHistory].slice(0, 10);
      setRecommendationHistory(updatedHistory);
      localStorage.setItem('quant-master-history', JSON.stringify(updatedHistory));

      // 섹터 분산 로직 (Portfolio Diversification)
      // 동일 섹터 내에서는 가장 점수가 높은 종목 하나만 선정하여 안정성 극대화
      const diversified = (data.recommendations || []).reduce((acc: StockRecommendation[], current) => {
        const primarySector = current.relatedSectors?.[0] || '기타';
        const existingInSector = acc.find(s => (s.relatedSectors?.[0] || '기타') === primarySector);
        
        if (!existingInSector) {
          acc.push({ ...current, isSectorTopPick: true });
        } else if (current.confidenceScore > existingInSector.confidenceScore) {
          // 더 높은 확신도의 종목이 있다면 교체
          const index = acc.indexOf(existingInSector);
          acc[index] = { ...current, isSectorTopPick: true };
        }
        return acc;
      }, []);

      setLastUsedMode(filters.mode || 'MOMENTUM');
      setRecommendations(diversified);
      setMarketContext(data.marketContext);
      setLastUpdated(new Date().toLocaleTimeString());

      // 뉴스 빈도 역지표 — 자동 연쇄 호출 제거 (API 절감)
      // 사용자가 별도 "뉴스 분석" 버튼 클릭 시에만 수동 호출

      if (diversified.length === 0) {
        toast.info('추천 종목이 없습니다.');
      } else {
        toast.success('검색이 완료되었습니다.');
      }
    } catch (err: any) {
      console.error(err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;

      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
      if (isRateLimit) {
        setError('API 할당량이 초과되었습니다. 무료 티어의 경우 분당 호출 제한이 있을 수 있습니다. 잠시 후 다시 시도하거나 설정에서 유료 API 키를 등록해 주세요.');
        toast.error('API 할당량 초과: 잠시 후 다시 시도해 주세요.');
      } else {
        setError(message || '데이터를 가져오는 중 오류가 발생했습니다.');
        toast.error('데이터 로드 실패');
      }
    } finally {
      setLoading(false);
    }
  };

  const [loadingNews, setLoadingNews] = useState(false);
  const handleFetchNewsScores = async () => {
    if (recommendations.length === 0) return;
    setLoadingNews(true);
    try {
      const scores = await getNewsFrequencyScores(recommendations.map(s => ({ code: s.code, name: s.name })));
      setNewsFrequencyScores(scores);
      toast.success('뉴스 빈도 분석 완료');
    } catch (err) {
      console.error('News frequency scoring failed:', err);
      toast.error('뉴스 분석 실패');
    } finally {
      setLoadingNews(false);
    }
  };

  const handleMarketSearch = async () => {
    setSearchingSpecific(true);
    setError(null);
    try {
      const results = await searchStock(searchQuery, {
        type: selectedType,
        pattern: selectedPattern,
        sentiment: selectedSentiment,
        checklist: selectedChecklist,
        minPrice,
        maxPrice
      });
      
      if (results && results.length > 0) {
        // Add to search results if not already in recommendations
        setSearchResults(prev => {
          if (!searchQuery.trim()) {
            // If empty search, replace with top 10 recommendations
            return results.slice(0, 10);
          }
          // Replace existing results for the same code
          const filteredPrev = (prev || []).filter(s => !results.some(r => r.code === s.code));
          const newResults = (results || []).filter(result => 
            ![...(recommendations || [])].some(s => s.code === result.code)
          );
          return [...newResults, ...filteredPrev];
        });
        toast.success(searchQuery.trim() ? '검색이 완료되었습니다.' : '시장 분석을 통해 유망 종목을 찾았습니다.');
      } else {
        toast.error(searchQuery.trim() ? '종목을 찾을 수 없거나 분석에 실패했습니다.' : '현재 시장에서 조건에 맞는 유망 종목을 찾지 못했습니다.');
      }
    } catch (err: any) {
      console.error(err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;

      const msgLower = (message || '').toLowerCase();
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota') || message.includes('할당량');
      const isInvalidArg = message.includes('400') || status === 400 || code === 400 || status === 'INVALID_ARGUMENT' || msgLower.includes('invalid');
      const isNetworkError = msgLower.includes('failed to fetch') || msgLower.includes('networkerror') || msgLower.includes('timeout');
      const isApiKeyError = msgLower.includes('api key') || msgLower.includes('api_key') || msgLower.includes('unauthorized') || status === 401 || code === 401;

      if (isRateLimit) {
        setError('API 할당량이 초과되었습니다. 잠시 후 다시 시도하거나 설정에서 유료 API 키를 등록해 주세요.');
        toast.error('API 할당량 초과: 잠시 후 다시 시도해 주세요.');
      } else if (isApiKeyError) {
        setError('API 키가 유효하지 않습니다. 설정에서 올바른 Gemini API 키를 입력해 주세요.');
        toast.error('API 키 오류');
      } else if (isInvalidArg) {
        setError('API 요청 설정 오류입니다. 잠시 후 다시 시도해 주세요.');
        toast.error('API 설정 오류');
      } else if (isNetworkError) {
        setError('네트워크 연결에 실패했습니다. 인터넷 연결을 확인해 주세요.');
        toast.error('네트워크 오류');
      } else {
        setError(message || '종목 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
        toast.error('검색 실패: 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setSearchingSpecific(false);
    }
  };


  useEffect(() => {
    // Check if data is stale (older than 30 minutes)
    if (lastUpdated) {
      const last = new Date(lastUpdated).getTime();
      const now = new Date().getTime();
      const diff = (now - last) / (1000 * 60); // minutes
      if (diff > 30) {
        // Data is stale, but don't auto-fetch to avoid quota issues
        // Just show a subtle warning or let the user know
        console.log("Data is stale, consider refreshing.");
      }
    }
  }, [lastUpdated]);

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
      return {
        subject: cat.name,
        A: Math.round((passed / total) * 100),
        fullMark: 100
      };
    });
  };

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
