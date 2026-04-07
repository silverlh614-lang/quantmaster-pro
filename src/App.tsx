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
import { buildShadowTrade } from './services/autoTrading';

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
  const { addShadowTrade, shadowTrades, winRate, avgReturn } = useShadowTradeStore();

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
    // Fetch on mount if not exists or stale
    const shouldFetch = !marketOverview || (() => {
      const last = new Date(marketOverview.lastUpdated).getTime();
      const now = new Date().getTime();
      const diff = (now - last) / (1000 * 60); // minutes
      return diff >= 5;
    })();

    if (shouldFetch) {
      handleFetchMarketOverview();
    }
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

      // 뉴스 빈도 역지표 자동 조회 (비동기, 메인 플로우 차단 안 함)
      if (diversified.length > 0) {
        getNewsFrequencyScores(diversified.map(s => ({ code: s.code, name: s.name })))
          .then(scores => setNewsFrequencyScores(scores))
          .catch(err => console.error('News frequency scoring failed:', err));
      }

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

      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
      if (isRateLimit) {
        setError('API 할당량이 초과되었습니다. 잠시 후 다시 시도하거나 설정에서 유료 API 키를 등록해 주세요.');
        toast.error('API 할당량 초과: 잠시 후 다시 시도해 주세요.');
      } else {
        setError(message || '종목 검색 중 오류가 발생했습니다.');
        toast.error('검색 실패');
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
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-orange-500 selection:text-white antialiased">
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
              className="glass-3d rounded-[3rem] p-10 max-w-lg w-full border border-white/10 shadow-2xl overflow-hidden relative"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center">
                    <Settings className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white tracking-tight">설정</h3>
                    <p className="text-xs font-bold text-white/30 uppercase tracking-[0.2em]">Application Settings</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors relative z-[110]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-8">
                <div>
                  <label className="block text-xs font-black text-white/30 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                    <Key className="w-3 h-3" />
                    Gemini API Key
                  </label>
                  <div className="relative">
                    <input 
                      type="password"
                      value={userApiKey}
                      onChange={(e) => setUserApiKey(e.target.value)}
                      placeholder="AI 기능을 사용하려면 API 키를 입력하세요"
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm font-bold text-white placeholder:text-white/10 focus:outline-none focus:border-blue-500/50 transition-all"
                    />
                  </div>
                  <p className="mt-4 text-[10px] text-white/20 font-bold leading-relaxed">
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
                    <span className="text-xs font-black text-white/40 uppercase tracking-widest">UI 테마 설정</span>
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
                            : "bg-white/5 border-white/5 text-white/40 hover:bg-white/10"
                        )}
                      >
                        <t.icon className="w-5 h-5" />
                        <span className="text-[10px] font-black uppercase tracking-widest">{t.label}</span>
                      </button>
                    ))}
                  </div>
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
                    className="w-full py-4 bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 rounded-2xl font-black text-sm transition-all border border-white/10 hover:border-red-500/50 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    캐시 데이터 초기화 (과거 데이터 삭제)
                  </button>
                </div>
              </div>

              {/* Decorative background */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 blur-[100px] -mr-32 -mt-32" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-white/[0.06] bg-[#050505]/80 backdrop-blur-2xl sticky top-0 z-50 shadow-[0_2px_30px_rgba(0,0,0,0.7)] no-print">
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
                  onClick={() => handleFetchMarketOverview(true)}
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

              {/* ── 거시 인텔리전스 대시보드 (Gate 0 독립 뷰) ── */}
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

              {/* ── MHS 히스토리 차트 ── */}
              <MHSHistoryChart records={mhsHistory} height={280} />

              {/* ── 글로벌 인텔리전스 통합 레이더 (A~L) ── */}
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
          ) : view === 'MANUAL_INPUT' ? (
            <motion.div
              key="manual-input-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              <ManualQuantInput 
                regime={marketOverview?.regimeShiftDetector?.currentRegime ? {
                  type: marketOverview.regimeShiftDetector.currentRegime as any,
                  weightMultipliers: marketOverview.dynamicWeights || {},
                  vKospi: 15.5,
                  samsungIri: 0.85
                } : {
                  type: '상승초기',
                  weightMultipliers: {},
                  vKospi: 15.5,
                  samsungIri: 0.85
                }}
                sectorRotation={marketOverview?.sectorRotation?.topSectors?.[0] ? {
                  name: (marketOverview.sectorRotation.topSectors[0] as any).sector || '반도체',
                  rank: 1,
                  strength: marketOverview.sectorRotation.topSectors[0].strength,
                  isLeading: true,
                  sectorLeaderNewHigh: true
                } : {
                  name: '반도체',
                  rank: 1,
                  strength: 85,
                  isLeading: true,
                  sectorLeaderNewHigh: true
                }}
              />
            </motion.div>
          ) : view === 'AUTO_TRADE' ? (
            <motion.div
              key="auto-trade-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black text-white uppercase tracking-tighter">자동매매 센터</h2>
                  <p className="text-xs text-white/30 mt-1">KIS 모의계좌 연동 · Shadow Trading · OCO 자동 등록</p>
                </div>
                <div className="flex gap-3 text-center">
                  <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2">
                    <p className="text-[10px] text-white/30 uppercase tracking-widest">Shadow 건수</p>
                    <p className="text-xl font-black text-violet-400">{shadowTrades.length}</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2">
                    <p className="text-[10px] text-white/30 uppercase tracking-widest">적중률</p>
                    <p className="text-xl font-black text-green-400">{winRate()}%</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2">
                    <p className="text-[10px] text-white/30 uppercase tracking-widest">평균수익</p>
                    <p className={cn("text-xl font-black", avgReturn() >= 0 ? "text-green-400" : "text-red-400")}>{avgReturn().toFixed(2)}%</p>
                  </div>
                </div>
              </div>
              <TradingChecklist />
            </motion.div>
          ) : view === 'TRADE_JOURNAL' ? (
            <motion.div
              key="trade-journal-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div className="flex items-center gap-4">
                  <div className="w-3 h-10 bg-emerald-500 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.5)]" />
                  <div>
                    <h2 className="text-2xl font-black text-white tracking-tight uppercase">실전 성과 관리</h2>
                    <p className="text-xs font-bold text-white/30 uppercase tracking-[0.2em]">Trade Journal · Condition Performance · System vs Intuition</p>
                  </div>
                </div>
              </div>
              <TradeJournal
                trades={tradeRecords}
                onCloseTrade={closeTrade}
                onDeleteTrade={deleteTrade}
                onUpdateMemo={updateTradeMemo}
              />
            </motion.div>
          ) : view === 'SCREENER' ? (
            <motion.div
              key="screener-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-3 h-10 bg-blue-600 rounded-full shadow-[0_0_20px_rgba(37,99,235,0.5)]" />
                    <h2 className="text-4xl font-black text-white tracking-tighter uppercase">Quant Screener + AI Pipeline</h2>
                  </div>
                  <p className="text-white/40 font-medium max-w-2xl text-lg">
                    정량적 필터로 후보군을 압축하고, AI가 질적 분석을 통해 최종 주도주를 선정하는 2단계 파이프라인입니다.
                  </p>
                </div>
              </div>
              <QuantScreener 
                onScreen={handleScreener}
                loading={loading}
                recommendations={screenerRecommendations}
                onStockClick={(stock) => setSelectedDetailStock(stock)}
              />
            </motion.div>
          ) : view === 'SUBSCRIPTION' ? (
            <motion.div
              key="subscription-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-3 h-10 bg-amber-500 rounded-full shadow-[0_0_20px_rgba(245,158,11,0.5)]" />
                    <h2 className="text-4xl font-black text-white tracking-tighter uppercase">Sector Subscription System</h2>
                  </div>
                  <p className="text-white/40 font-medium max-w-2xl text-lg">
                    관심 섹터를 구독하고 Gate 1 생존 조건을 통과하는 신규 주도주 후보를 실시간으로 감지하세요.
                  </p>
                </div>
              </div>
              <SectorSubscription 
                subscribedSectors={subscribedSectors}
                onAddSector={handleAddSector}
                onRemoveSector={handleRemoveSector}
                recommendations={recommendations}
                loading={loading}
              />
            </motion.div>
          ) : view === 'BACKTEST' ? (
            <motion.div
              key="backtest-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-3 h-10 bg-blue-500 rounded-full shadow-[0_0_20px_rgba(59,130,246,0.5)]" />
                    <h2 className="text-4xl font-black text-white tracking-tighter uppercase">AI Portfolio Backtest</h2>
                  </div>
                  <p className="text-white/40 font-medium max-w-2xl text-lg">
                    사용자 정의 포트폴리오의 과거 성과를 AI로 시뮬레이션하고, 위험 지표 분석 및 최적화 전략을 제안받으세요.
                  </p>
                </div>
                <button
                  onClick={runBacktest}
                  disabled={backtesting || (backtestPortfolioItems || []).length === 0 || (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0) !== 100}
                  className="flex items-center gap-4 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-10 py-5 rounded-[2.5rem] font-black text-lg transition-all shadow-[0_10px_40px_rgba(59,130,246,0.3)] active:scale-95"
                >
                  {backtesting ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Play className="w-6 h-6" />}
                  <span>{backtesting ? '시뮬레이션 중...' : '백테스팅 시작'}</span>
                </button>
              </div>

              <PortfolioManager 
                portfolios={portfolios}
                currentPortfolioId={currentPortfolioId}
                onSelect={selectPortfolio}
                onSave={savePortfolio}
                onDelete={deletePortfolio}
                onUpdate={updatePortfolio}
              />
              
              {portfolios.find(p => p.id === currentPortfolioId) && (
                <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                  <h3 className="text-xl font-black text-white mb-6 uppercase tracking-widest">포트폴리오 비중</h3>
                  <PortfolioPieChart items={portfolios.find(p => p.id === currentPortfolioId)!.items} />
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                {/* Portfolio Builder */}
                <div className="lg:col-span-1 space-y-8">
                  {/* Backtest Settings */}
                  <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl space-y-8">
                    <div className="flex items-center gap-4">
                      <Settings className="w-6 h-6 text-white/20" />
                      <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">백테스트 설정</span>
                    </div>
                    
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-white/40 uppercase tracking-widest block">초기 자본금 (Initial Equity)</label>
                        <div className="relative">
                          <input 
                            type="number" 
                            value={initialEquity}
                            onChange={(e) => setInitialEquity(parseInt(e.target.value) || 0)}
                            className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 text-lg font-black text-white focus:outline-none focus:border-blue-500/50 transition-all"
                          />
                          <span className="absolute right-6 top-1/2 -translate-y-1/2 text-sm font-black text-white/20">KRW</span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-white/40 uppercase tracking-widest block">테스트 기간 (Period)</label>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: '1년', value: 1 },
                            { label: '3년', value: 3 },
                            { label: '5년', value: 5 },
                          ].map((p) => (
                            <button
                              key={p.value}
                              onClick={() => setBacktestYears(p.value)}
                              className={cn(
                                "py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border",
                                backtestYears === p.value 
                                  ? "bg-blue-500/20 border-blue-500/50 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.2)]" 
                                  : "bg-white/5 border-white/5 text-white/40 hover:bg-white/10"
                              )}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">포트폴리오 구성</span>
                        <div className="flex items-center gap-2">
                          <label className="cursor-pointer flex items-center gap-2 text-[10px] font-black text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-widest">
                            <input type="file" accept=".txt" onChange={handleFileUpload} className="hidden" />
                            {parsingFile ? <RefreshCw className="w-3 h-3 animate-spin" /> : <History className="w-3 h-3" />}
                            <span>파일 업로드 분석</span>
                          </label>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={cn(
                          "text-[11px] font-black px-3 py-1.5 rounded-xl transition-all duration-500",
                          (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0) === 100 
                            ? "bg-green-500/20 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.2)]" 
                            : (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0) > 100
                              ? "bg-red-500/20 text-red-400"
                              : "bg-orange-500/20 text-orange-400"
                        )}>
                          Total: {(backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0)}%
                        </span>
                        <div className="w-32 h-1 bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ 
                              width: `${Math.min(100, (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0))}%`,
                              backgroundColor: (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0) === 100 
                                ? '#22c55e' 
                                : (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0) > 100 
                                  ? '#ef4444' 
                                  : '#f97316'
                            }}
                            className="h-full transition-colors duration-500"
                          />
                        </div>
                      </div>
                    </div>

                    <Reorder.Group 
                      axis="y" 
                      values={backtestPortfolioItems || []} 
                      onReorder={reorderPortfolioItems}
                      className="space-y-5"
                    >
                      {(backtestPortfolioItems || []).length === 0 ? (
                        <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-[2.5rem]">
                          <Plus className="w-12 h-12 text-white/10 mx-auto mb-4" />
                          <p className="text-sm text-white/20 font-black leading-relaxed">추천 종목이나 검색 결과에서<br/>종목을 추가하세요.</p>
                        </div>
                      ) : (
                        (backtestPortfolioItems || []).map((item: any) => {
                          const riskyStock = backtestResult?.riskyStocks?.find((s: any) => s.stock === item.name || s.stock === item.code);
                          const isHighRisk = riskyStock?.riskLevel === 'HIGH';
                          const isMediumRisk = riskyStock?.riskLevel === 'MEDIUM';

                          return (
                            <Reorder.Item 
                              key={item.code} 
                              value={item}
                              className={cn(
                                "bg-white/5 rounded-3xl p-6 border flex items-center justify-between gap-6 group hover:bg-white/[0.08] transition-all cursor-grab active:cursor-grabbing",
                                isHighRisk ? "border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.1)]" : 
                                isMediumRisk ? "border-orange-500/30 shadow-[0_0_15px_rgba(249,115,22,0.05)]" : 
                                "border-white/5"
                              )}
                            >
                              <div className="flex items-center gap-4 flex-1">
                                <div className="p-2 text-white/10 group-hover:text-white/30 transition-colors">
                                  <GripVertical className="w-4 h-4" />
                                </div>
                                <div className="flex-1 relative group/copy">
                                  <div className="flex items-center gap-2 mb-1">
                                    <div 
                                      onClick={() => handleCopy(item.name, item.code)}
                                      className="text-lg font-black text-white cursor-pointer hover:text-orange-500 transition-colors flex items-center gap-2"
                                      title="종목명 복사"
                                    >
                                      {item.name}
                                      <Copy className="w-3.5 h-3.5 opacity-0 group-hover/copy:opacity-50 transition-opacity" />
                                    </div>
                                    {riskyStock && (
                                      <div className={cn(
                                        "px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest flex items-center gap-1",
                                        isHighRisk ? "bg-red-500 text-white animate-pulse" : "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                                      )}>
                                        <ShieldAlert className="w-2.5 h-2.5" />
                                        {riskyStock.riskLevel} RISK
                                      </div>
                                    )}
                                  </div>
                                  <AnimatePresence>
                                    {copiedCode === item.code && (
                                      <motion.span
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                        className="absolute -top-6 left-0 text-[8px] font-black text-green-400 uppercase tracking-widest bg-green-500/20 backdrop-blur-md px-2 py-0.5 rounded-lg border border-green-500/30 z-30"
                                      >
                                        Copied!
                                      </motion.span>
                                    )}
                                  </AnimatePresence>
                                  <div className="text-[11px] font-black text-white/20 uppercase tracking-widest">{item.code}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="relative">
                                  <input
                                    type="number"
                                    value={item.weight}
                                    onChange={(e) => updateWeight(item.code, parseInt(e.target.value) || 0)}
                                    className={cn(
                                      "w-20 bg-black/40 border rounded-2xl px-3 py-2 text-sm font-black text-white text-center focus:outline-none transition-all",
                                      (backtestPortfolioItems || []).reduce((sum, i) => sum + i.weight, 0) > 100 ? "border-red-500/50 focus:border-red-500" : "border-white/10 focus:border-blue-500/50"
                                    )}
                                  />
                                  <span className="absolute -right-4 top-1/2 -translate-y-1/2 text-xs font-black text-white/20">%</span>
                                </div>
                                <button 
                                  onClick={() => removeFromBacktest(item.code)}
                                  className="p-3 text-white/10 hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </div>
                            </Reorder.Item>
                          );
                        })
                      )}
                    </Reorder.Group>
                  </div>
                </div>

                {/* Results Dashboard */}
                <div className="lg:col-span-2 space-y-10">
                  {backtestResult ? (
                    <>
                      {/* High Risk Alert Banner */}
                      {backtestResult.riskyStocks && backtestResult.riskyStocks.some((s: any) => s.riskLevel === 'HIGH') && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="bg-red-500/10 border border-red-500/20 rounded-[2.5rem] p-8 mb-10 flex items-center gap-6 relative overflow-hidden group"
                        >
                          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <ShieldAlert className="w-24 h-24 text-red-500" />
                          </div>
                          <div className="w-16 h-16 rounded-3xl bg-red-500/20 flex items-center justify-center shrink-0 animate-pulse">
                            <ShieldAlert className="w-8 h-8 text-red-500" />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-xl font-black text-white uppercase tracking-tighter mb-1">고위험 종목 감지 (High Risk Detected)</h4>
                            <p className="text-sm text-white/60 font-bold leading-relaxed">
                              포트폴리오 내에 AI가 분석한 고위험 종목이 포함되어 있습니다. 아래 리스크 관리 섹션을 확인하여 비중 조절 또는 정리를 고려하십시오.
                            </p>
                          </div>
                        </motion.div>
                      )}

                      {/* Summary Metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        {[
                          { 
                            label: '누적 수익률', 
                            value: `${backtestResult.cumulativeReturn.toFixed(2)}%`, 
                            icon: TrendingUp, 
                            color: 'text-orange-400',
                            tooltip: {
                              desc: "투자 기간 동안의 총 수익률입니다.",
                              calc: "(기말 자산 / 기초 자산) - 1"
                            }
                          },
                          { 
                            label: '샤프 지수', 
                            value: backtestResult.sharpeRatio.toFixed(2), 
                            icon: ShieldCheck, 
                            color: 'text-blue-400',
                            tooltip: {
                              desc: "위험 대비 수익성을 나타내는 지표입니다. 높을수록 효율적인 투자임을 의미합니다.",
                              calc: "(포트폴리오 수익률 - 무위험 수익률) / 수익률 표준편차"
                            }
                          },
                          { 
                            label: '최대 낙폭', 
                            value: `${backtestResult.maxDrawdown.toFixed(2)}%`, 
                            icon: TrendingDown, 
                            color: 'text-red-400',
                            tooltip: {
                              desc: "투자 기간 중 고점 대비 저점까지의 최대 하락폭입니다.",
                              calc: "포트폴리오 고점 대비 최대 하락 비율 (MDD)"
                            }
                          },
                          { 
                            label: '변동성', 
                            value: `${backtestResult.volatility.toFixed(2)}%`, 
                            icon: Zap, 
                            color: 'text-green-400',
                            tooltip: {
                              desc: "수익률의 표준편차로, 가격의 출렁임 정도를 나타냅니다.",
                              calc: "일간 수익률의 연환산 표준편차"
                            }
                          },
                        ].map((stat: any, i: number) => (
                          <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="glass-3d rounded-[2.5rem] p-8 border border-white/10 shadow-xl text-center group/stat relative"
                          >
                            <div className="absolute top-4 right-4 opacity-0 group-hover/stat:opacity-100 transition-opacity cursor-help">
                              <div className="relative group/info">
                                <Info className="w-4 h-4 text-white/20 hover:text-orange-500 transition-colors" />
                                <div className="absolute right-0 top-6 w-56 p-4 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50 pointer-events-none text-left">
                                  <h4 className="text-[10px] font-black text-orange-500 mb-2 uppercase tracking-widest">{stat.label} 상세 정보</h4>
                                  <div className="space-y-3">
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">설명</span>
                                      <span className="text-[10px] font-bold text-white/80 leading-tight">{stat.tooltip.desc}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">계산식</span>
                                      <span className="text-[9px] font-medium text-white/50 italic leading-tight">{stat.tooltip.calc}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <stat.icon className={cn("w-6 h-6 mx-auto mb-4", stat.color)} />
                            <div className="text-[11px] font-black text-white/20 uppercase tracking-[0.2em] mb-2">{stat.label}</div>
                            <div className={cn("text-2xl font-black tracking-tighter", stat.color)}>{stat.value}</div>
                          </motion.div>
                        ))}
                      </div>

                      {/* Advanced Metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                        {[
                          { 
                            label: 'CAGR (연평균)', 
                            value: `${backtestResult.cagr.toFixed(2)}%`, 
                            icon: CalendarIcon, 
                            color: 'text-purple-400',
                            tooltip: {
                              desc: "기하평균 수익률로, 매년 평균적으로 얼마나 수익을 냈는지 나타냅니다.",
                              calc: "((기말 자산 / 기초 자산) ^ (1 / 투자 기간(년))) - 1"
                            }
                          },
                          { 
                            label: '승률 (Win Rate)', 
                            value: `${backtestResult.winRate.toFixed(1)}%`, 
                            icon: Target, 
                            color: 'text-yellow-400',
                            tooltip: {
                              desc: "전체 매매 중 수익으로 마감한 매매의 비율입니다.",
                              calc: "수익 매매 횟수 / 전체 매매 횟수"
                            }
                          },
                          { 
                            label: 'Profit Factor', 
                            value: backtestResult.profitFactor.toFixed(2), 
                            icon: BarChart3, 
                            color: 'text-cyan-400',
                            tooltip: {
                              desc: "총 이익을 총 손실로 나눈 값으로, 1보다 크면 수익이 손실보다 큼을 의미합니다.",
                              calc: "총 이익 합계 / 총 손실 합계"
                            }
                          },
                          { 
                            label: '총 매매 횟수', 
                            value: backtestResult.trades, 
                            icon: Activity, 
                            color: 'text-pink-400',
                            tooltip: {
                              desc: "백테스트 기간 동안 발생한 총 매매(진입 및 청산) 횟수입니다.",
                              calc: "전체 체결 횟수"
                            }
                          },
                        ].map((stat, i) => (
                          <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 + 0.4 }}
                            className="glass-3d rounded-[2.5rem] p-8 border border-white/10 shadow-xl text-center group/stat relative"
                          >
                            <div className="absolute top-4 right-4 opacity-0 group-hover/stat:opacity-100 transition-opacity cursor-help">
                              <div className="relative group/info">
                                <Info className="w-4 h-4 text-white/20 hover:text-orange-500 transition-colors" />
                                <div className="absolute right-0 top-6 w-56 p-4 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50 pointer-events-none text-left">
                                  <h4 className="text-[10px] font-black text-orange-500 mb-2 uppercase tracking-widest">{stat.label} 상세 정보</h4>
                                  <div className="space-y-3">
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">설명</span>
                                      <span className="text-[10px] font-bold text-white/80 leading-tight">{stat.tooltip.desc}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">계산식</span>
                                      <span className="text-[9px] font-medium text-white/50 italic leading-tight">{stat.tooltip.calc}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <stat.icon className={cn("w-6 h-6 mx-auto mb-4", stat.color)} />
                            <div className="text-[11px] font-black text-white/20 uppercase tracking-[0.2em] mb-2">{stat.label}</div>
                            <div className={cn("text-2xl font-black tracking-tighter", stat.color)}>{stat.value}</div>
                          </motion.div>
                        ))}
                      </div>

                      {/* Advanced Metrics Row 2 */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                        {[
                          { 
                            label: '평균 수익 (Avg Win)', 
                            value: `${backtestResult.avgWin.toFixed(2)}%`, 
                            icon: ArrowUpRight, 
                            color: 'text-green-400',
                            tooltip: {
                              desc: "수익이 발생한 매매들의 평균 수익률입니다.",
                              calc: "총 이익 / 수익 매매 횟수"
                            }
                          },
                          { 
                            label: '평균 손실 (Avg Loss)', 
                            value: `${backtestResult.avgLoss.toFixed(2)}%`, 
                            icon: ArrowDownRight, 
                            color: 'text-red-400',
                            tooltip: {
                              desc: "손실이 발생한 매매들의 평균 손실률입니다.",
                              calc: "총 손실 / 손실 매매 횟수"
                            }
                          },
                          { 
                            label: '최대 연속 손실', 
                            value: `${backtestResult.maxConsecutiveLoss}회`, 
                            icon: XCircle, 
                            color: 'text-orange-400',
                            tooltip: {
                              desc: "가장 길게 이어진 연속 손실 매매 횟수입니다.",
                              calc: "최대 연속 손실 횟수"
                            }
                          },
                        ].map((stat: any, i: number) => (
                          <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 + 0.8 }}
                            className="glass-3d rounded-[2.5rem] p-8 border border-white/10 shadow-xl text-center group/stat relative"
                          >
                            <div className="absolute top-4 right-4 opacity-0 group-hover/stat:opacity-100 transition-opacity cursor-help">
                              <div className="relative group/info">
                                <Info className="w-4 h-4 text-white/20 hover:text-orange-500 transition-colors" />
                                <div className="absolute right-0 top-6 w-56 p-4 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50 pointer-events-none text-left">
                                  <h4 className="text-[10px] font-black text-orange-500 mb-2 uppercase tracking-widest">{stat.label} 상세 정보</h4>
                                  <div className="space-y-3">
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">설명</span>
                                      <span className="text-[10px] font-bold text-white/80 leading-tight">{stat.tooltip.desc}</span>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[9px] font-black text-white/40 uppercase tracking-tighter">계산식</span>
                                      <span className="text-[9px] font-medium text-white/50 italic leading-tight">{stat.tooltip.calc}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <stat.icon className={cn("w-6 h-6 mx-auto mb-4", stat.color)} />
                            <div className="text-[11px] font-black text-white/20 uppercase tracking-[0.2em] mb-2">{stat.label}</div>
                            <div className={cn("text-2xl font-black tracking-tighter", stat.color)}>{stat.value}</div>
                          </motion.div>
                        ))}
                      </div>

                      {/* Performance Chart */}
                      <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                        <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em] block mb-10">수익률 추이 (vs KOSPI)</span>
                        <div className="h-[400px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={backtestResult.performanceData}>
                              <defs>
                                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3}/>
                                  <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                                </linearGradient>
                                <linearGradient id="colorBenchmark" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                              <XAxis 
                                dataKey="date" 
                                stroke="rgba(255,255,255,0.2)" 
                                fontSize={11} 
                                tickLine={false}
                                axisLine={false}
                                tick={{ fontWeight: 900 }}
                              />
                              <YAxis 
                                stroke="rgba(255,255,255,0.2)" 
                                fontSize={11} 
                                tickLine={false}
                                axisLine={false}
                                domain={['auto', 'auto']}
                                tick={{ fontWeight: 900 }}
                              />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px', padding: '16px' }}
                                itemStyle={{ fontSize: '13px', fontWeight: '900', padding: '4px 0' }}
                                labelStyle={{ color: 'rgba(255,255,255,0.4)', fontWeight: '900', marginBottom: '8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em' }}
                              />
                              <Legend verticalAlign="top" align="right" height={48} iconType="circle" wrapperStyle={{ fontWeight: 900, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }} />
                              <Area type="monotone" dataKey="value" name="Portfolio" stroke="#f97316" strokeWidth={4} fillOpacity={1} fill="url(#colorValue)" />
                              <Area type="monotone" dataKey="benchmark" name="KOSPI" stroke="#3b82f6" strokeWidth={2} strokeDasharray="8 8" fillOpacity={1} fill="url(#colorBenchmark)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* Risk Analysis Section */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        {/* Risk Metrics */}
                        <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                          <div className="flex items-center gap-4 mb-8">
                            <ShieldAlert className="w-6 h-6 text-red-400" />
                            <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">리스크 지표 (Risk Metrics)</span>
                          </div>
                          <div className="grid grid-cols-3 gap-4">
                            <div className="p-6 bg-white/5 rounded-3xl border border-white/5">
                              <div className="text-[10px] font-black text-white/30 uppercase mb-2">Beta</div>
                              <div className="text-xl font-black text-white tracking-tighter">{backtestResult.riskMetrics?.beta.toFixed(2) || 'N/A'}</div>
                            </div>
                            <div className="p-6 bg-white/5 rounded-3xl border border-white/5">
                              <div className="text-[10px] font-black text-white/30 uppercase mb-2">Alpha</div>
                              <div className="text-xl font-black text-white tracking-tighter">{backtestResult.riskMetrics?.alpha.toFixed(2) || 'N/A'}%</div>
                            </div>
                            <div className="p-6 bg-white/5 rounded-3xl border border-white/5">
                              <div className="text-[10px] font-black text-white/30 uppercase mb-2">Treynor</div>
                              <div className="text-xl font-black text-white tracking-tighter">{backtestResult.riskMetrics?.treynorRatio.toFixed(2) || 'N/A'}</div>
                            </div>
                          </div>
                        </div>

                        {/* Risky Stocks List */}
                        <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                          <div className="flex items-center gap-4 mb-8">
                            <AlertTriangle className="w-6 h-6 text-yellow-400" />
                            <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">주의 종목 분석</span>
                          </div>
                          <div className="space-y-4">
                            {backtestResult.riskyStocks?.map((stock: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                <div>
                                  <div className="text-xs font-black text-white uppercase">{stock.stock}</div>
                                  <div className="text-[10px] font-bold text-white/40">{stock.reason}</div>
                                </div>
                                <div className={cn(
                                  "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest",
                                  stock.riskLevel === 'HIGH' ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"
                                )}>
                                  {stock.riskLevel}
                                </div>
                              </div>
                            ))}
                            {(!backtestResult.riskyStocks || backtestResult.riskyStocks.length === 0) && (
                              <div className="text-center py-10 text-white/20 font-black uppercase text-xs">특이 리스크 종목 없음</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* AI Analysis & Optimization */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                        <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                          <div className="flex items-center gap-4 mb-8">
                            <Lightbulb className="w-6 h-6 text-orange-400" />
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">AI 전략 분석</span>
                              <div title="AI가 포트폴리오의 과거 성과와 현재 구성을 분석하여 도출한 전략적 인사이트입니다. 수익률, 변동성, 샤프 지수 등을 종합적으로 고려합니다.">
                                <Info 
                                  className="w-3.5 h-3.5 text-white/20 cursor-help hover:text-orange-400 transition-colors" 
                                />
                              </div>
                            </div>
                          </div>
                          <p className="text-base text-white/70 font-bold leading-relaxed whitespace-pre-wrap">
                            {backtestResult.aiAnalysis}
                          </p>
                        </div>

                        <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                          <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-4">
                              <Target className="w-6 h-6 text-blue-400" />
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">포트폴리오 최적화 제안</span>
                                <div title="AI가 현재 시장 상황과 포트폴리오의 리스크/수익 프로파일을 분석하여 제안하는 비중 조절 및 신규 종목 추천입니다.">
                                  <Info 
                                    className="w-3.5 h-3.5 text-white/20 cursor-help hover:text-blue-400 transition-colors" 
                                  />
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={applyAIRecommendedWeights}
                              className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-2xl text-[10px] font-black text-blue-400 uppercase tracking-widest transition-all active:scale-95"
                            >
                              <Sparkles className="w-3 h-3" />
                              AI 추천 비중 적용
                            </button>
                          </div>

                          {/* Discrepancy Tip Card */}
                          <div className="mb-8 p-6 bg-blue-500/5 border border-blue-500/20 rounded-[2rem] relative overflow-hidden group">
                            <div className="flex items-start gap-4 relative z-10">
                              <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center shrink-0">
                                <Lightbulb className="w-5 h-5 text-blue-400" />
                              </div>
                              <div>
                                <h4 className="text-sm font-black text-white mb-2 flex items-center gap-2">
                                  오늘의 추천 종목이 '제거' 대상으로 나오나요?
                                  <span className="text-[10px] font-black bg-blue-500 text-white px-2 py-0.5 rounded-lg uppercase tracking-widest">AI Tip</span>
                                </h4>
                                <div className="space-y-2 text-xs text-white/50 font-medium leading-relaxed">
                                  <p>• <span className="text-blue-400 font-bold">시간 지평의 차이:</span> 오늘의 종목은 단기 모멘텀에 집중하지만, 백테스팅은 1년 이상의 장기 안정성을 평가합니다.</p>
                                  <p>• <span className="text-blue-400 font-bold">포트폴리오 밸런스:</span> 개별 종목이 우수해도 전체 포트폴리오의 변동성을 과도하게 높이면 AI가 비중 축소나 제거를 제안할 수 있습니다.</p>
                                  <p>• <span className="text-blue-400 font-bold">리스크 관리:</span> 급등주는 높은 수익만큼 높은 MDD(최대 낙폭)를 동반하므로, 보수적인 백테스팅 엔진은 이를 위험 요소로 식별합니다.</p>
                                </div>
                              </div>
                            </div>
                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-[40px] -mr-16 -mt-16 group-hover:bg-blue-500/10 transition-all" />
                          </div>

                          <div className="space-y-5">
                            {(backtestResult.optimizationSuggestions || []).map((s: any, i: number) => (
                              <div key={i} className="bg-white/5 rounded-[2rem] p-6 border border-white/5 group hover:bg-white/[0.08] transition-all">
                                <div className="flex items-center justify-between mb-3 relative group/copy">
                                  <div 
                                    onClick={() => handleCopy(s.stock, `opt-${i}`)}
                                    className="text-lg font-black text-white cursor-pointer hover:text-orange-500 transition-colors flex items-center gap-2"
                                    title="종목명 복사"
                                  >
                                    {s.stock}
                                    <Copy className="w-3.5 h-3.5 opacity-0 group-hover/copy:opacity-50 transition-opacity" />
                                    <AnimatePresence>
                                      {copiedCode === `opt-${i}` && (
                                        <motion.span
                                          initial={{ opacity: 0, y: 10 }}
                                          animate={{ opacity: 1, y: 0 }}
                                          exit={{ opacity: 0 }}
                                          className="absolute -top-6 left-0 text-[8px] font-black text-green-400 uppercase tracking-widest bg-green-500/20 backdrop-blur-md px-2 py-0.5 rounded-lg border border-green-500/30 z-30"
                                        >
                                          Copied!
                                        </motion.span>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="flex flex-col items-end">
                                      <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">Weight Change</span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-white/40">{s.currentWeight}%</span>
                                        <ArrowRightLeft className="w-2.5 h-2.5 text-white/20" />
                                        <span className="text-[10px] font-black text-blue-400">{s.recommendedWeight}%</span>
                                      </div>
                                    </div>
                                    <span className={cn(
                                      "text-[10px] font-black px-3 py-1 rounded-xl uppercase tracking-widest",
                                      s.action === 'INCREASE' ? "bg-green-500/20 text-green-400" :
                                      s.action === 'DECREASE' ? "bg-red-500/20 text-red-400" :
                                      s.action === 'REMOVE' ? "bg-red-500/40 text-white" :
                                      "bg-white/10 text-white/40"
                                    )}>
                                      {s.action}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-xs text-white/40 font-bold leading-relaxed">{s.reason}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* New Theme Suggestions */}
                        {backtestResult.newThemeSuggestions && backtestResult.newThemeSuggestions.length > 0 && (
                          <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
                            <div className="flex items-center gap-4 mb-8">
                              <Layers className="w-6 h-6 text-purple-400" />
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">신규 편입 테마 제안</span>
                                <div title="현재 시장 주도 테마와 관련 유망 종목을 분석하여 포트폴리오 다변화를 제안합니다.">
                                  <Info 
                                    className="w-3.5 h-3.5 text-white/20 cursor-help hover:text-purple-400 transition-colors" 
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="space-y-5">
                              {(backtestResult.newThemeSuggestions || []).map((t: any, i: number) => (
                                <div key={i} className="bg-white/5 rounded-[2rem] p-6 border border-white/5 group hover:bg-white/[0.08] transition-all">
                                  <div className="flex items-center justify-between mb-3">
                                    <span className="text-lg font-black text-purple-400">{t.theme}</span>
                                    <div className="flex gap-2">
                                      {(t.stocks || []).map((stock: string, si: number) => (
                                        <span key={si} className="text-[10px] font-black px-2 py-1 bg-purple-500/10 text-purple-300 rounded-lg border border-purple-500/20">
                                          {stock}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <p className="text-xs text-white/40 font-bold leading-relaxed">{t.reason}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Risky Stocks Section */}
                        {backtestResult.riskyStocks && backtestResult.riskyStocks.length > 0 && (
                          <div className={cn(
                            "glass-3d rounded-[3rem] p-10 border shadow-2xl transition-all duration-500",
                            backtestResult.riskyStocks.some(s => s.riskLevel === 'HIGH') 
                              ? "border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.1)]" 
                              : "border-white/10"
                          )}>
                            <div className="flex items-center gap-4 mb-8">
                              <ShieldAlert className={cn(
                                "w-6 h-6",
                                backtestResult.riskyStocks.some((s: any) => s.riskLevel === 'HIGH') ? "text-red-500 animate-pulse" : "text-red-400"
                              )} />
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "text-[11px] font-black uppercase tracking-[0.3em]",
                                  backtestResult.riskyStocks.some((s: any) => s.riskLevel === 'HIGH') ? "text-red-400" : "text-white/20"
                                )}>리스크 관리: 정리 추천</span>
                                <div title="추세 붕괴, 펀더멘털 훼손, 과도한 밸류에이션 등 리스크가 감지된 종목입니다.">
                                  <Info 
                                    className="w-3.5 h-3.5 text-white/20 cursor-help hover:text-red-400 transition-colors" 
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="space-y-5">
                              {(backtestResult.riskyStocks || []).map((rs: any, i: number) => (
                                <div key={i} className={cn(
                                  "rounded-[2rem] p-6 border transition-all",
                                  rs.riskLevel === 'HIGH' 
                                    ? "bg-red-500/10 border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.05)]" 
                                    : "bg-red-500/5 border-red-500/10 group hover:bg-red-500/10"
                                )}>
                                  <div className="flex items-center justify-between mb-3">
                                    <span className={cn(
                                      "text-lg font-black",
                                      rs.riskLevel === 'HIGH' ? "text-red-500" : "text-red-400"
                                    )}>{rs.stock}</span>
                                    <span className={cn(
                                      "text-[10px] font-black px-3 py-1 rounded-xl uppercase tracking-widest flex items-center gap-1",
                                      rs.riskLevel === 'HIGH' ? "bg-red-500 text-white animate-pulse" : "bg-orange-500/20 text-orange-400"
                                    )}>
                                      <ShieldAlert className="w-3 h-3" />
                                      {rs.riskLevel} RISK
                                    </span>
                                  </div>
                                  <p className="text-xs text-white/60 font-bold leading-relaxed">{rs.reason}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center py-32 glass-3d rounded-[3rem] border border-white/10 border-dashed">
                      <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-8">
                        <History className="w-12 h-12 text-white/10" />
                      </div>
                      <h3 className="text-2xl font-black text-white/20 mb-3">백테스팅 결과가 없습니다</h3>
                      <p className="text-base text-white/10 font-bold">포트폴리오를 구성하고 시뮬레이션을 시작하세요.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : view === 'WALK_FORWARD' ? (
            <WalkForwardView />
          ) : (
            <>
              {/* Sync Status Bar */}
              <AnimatePresence>
                {syncStatus.isSyncing && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-8 overflow-hidden"
                  >
                    <div className="bg-white/5 rounded-[2rem] border border-white/10 p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-orange-500/20 rounded-full flex items-center justify-center animate-spin">
                          <RefreshCw className="w-6 h-6 text-orange-500" />
                        </div>
                        <div>
                          <h4 className="text-sm font-black text-white uppercase tracking-widest mb-1">실시간 데이터 동기화 중</h4>
                          <p className="text-xs text-white/40 font-bold">
                            {syncStatus.currentStock} 분석 중... ({syncStatus.progress}/{syncStatus.total})
                          </p>
                        </div>
                      </div>
                      <div className="flex-1 max-w-md w-full">
                        <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-2">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${(syncStatus.progress / syncStatus.total) * 100}%` }}
                            className="h-full bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.5)] transition-all duration-500"
                          />
                        </div>
                        <div className="flex justify-between text-[10px] font-black text-white/20 uppercase tracking-widest">
                          <span>Progress</span>
                          <span>{Math.round((syncStatus.progress / syncStatus.total) * 100)}%</span>
                        </div>
                      </div>
                    </div>
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
                    className="mb-8 p-6 bg-red-500/10 border border-red-500/20 rounded-[2rem] flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-red-400 uppercase tracking-widest mb-1">시스템 오류</h4>
                        <p className="text-sm text-white/60 font-bold">{error}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setError(null)}
                      className="p-2 text-white/20 hover:text-white/40 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Market Sentiment & Hero Section */}
              <section className="mb-16 grid grid-cols-1 lg:grid-cols-3 gap-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="lg:col-span-2 glass-3d rounded-[2.5rem] p-10 sm:p-14 relative overflow-hidden group"
          >
            <div className="relative z-10">
                <p className="text-xl sm:text-2xl font-black text-orange-500/80 uppercase tracking-[0.2em] mb-2">
                  폭등임박
                </p>
                <h2 className="text-5xl sm:text-7xl font-bold mb-6 leading-[1.1] tracking-tight text-glow">
                <span className="text-orange-500 text-glow-orange">QuantMaster Pro</span>
              </h2>
              <p className="text-sm sm:text-base font-bold text-white/30 uppercase tracking-[0.2em] mb-10">
                데이터와 사이클 기반 정밀 분석
              </p>
              <div className="relative group/info mb-10">
                <p className="text-white/50 max-w-xl text-lg sm:text-xl font-medium leading-relaxed">
                  AI 기반 <span className="text-white border-b border-white/20 cursor-help font-bold" onClick={() => setShowMasterChecklist(true)}>27단계 마스터 체크리스트</span>를 통과한 주도주 포착 시스템.
                </p>
                <button 
                  onClick={() => setShowMasterChecklist(true)}
                  className="absolute -right-8 top-0 p-2 text-white/20 hover:text-orange-500 transition-colors"
                >
                  <Info className="w-5 h-5" />
                </button>
              </div>

              <HeroChecklist steps={MASTER_CHECKLIST_STEPS} onShowChecklist={() => setShowMasterChecklist(true)} />

              <div className="flex flex-col sm:flex-row items-center gap-4 mb-12">
                <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 shadow-inner">
                  <button
                    onClick={() => setFilters(prev => ({ ...prev, mode: 'MOMENTUM' }))}
                    className={cn(
                      "px-6 py-3 rounded-xl text-sm font-black transition-all flex items-center gap-2",
                      filters.mode === 'MOMENTUM' 
                        ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" 
                        : "text-white/40 hover:text-white/60"
                    )}
                  >
                    <Zap className={cn("w-4 h-4", filters.mode === 'MOMENTUM' ? "fill-current" : "")} />
                    지금 살 종목
                  </button>
                  <button
                    onClick={() => setFilters(prev => ({ ...prev, mode: 'EARLY_DETECT' }))}
                    className={cn(
                      "px-6 py-3 rounded-xl text-sm font-black transition-all flex items-center gap-2",
                      filters.mode === 'EARLY_DETECT'
                        ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                        : "text-white/40 hover:text-white/60"
                    )}
                  >
                    <Radar className={cn("w-4 h-4", filters.mode === 'EARLY_DETECT' ? "fill-current" : "")} />
                    미리 볼 종목
                  </button>
                  <button
                    onClick={() => setFilters(prev => ({ ...prev, mode: 'QUANT_SCREEN' }))}
                    className={cn(
                      "px-6 py-3 rounded-xl text-sm font-black transition-all flex items-center gap-2",
                      filters.mode === 'QUANT_SCREEN'
                        ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                        : "text-white/40 hover:text-white/60"
                    )}
                  >
                    <Activity className={cn("w-4 h-4", filters.mode === 'QUANT_SCREEN' ? "fill-current" : "")} />
                    숨은 종목 발굴
                  </button>
                </div>
                
                <div className="hidden sm:block h-8 w-px bg-white/10 mx-2" />

                <button
                  onClick={fetchStocks}
                  disabled={loading}
                  className="btn-3d px-12 py-6 bg-gradient-to-br from-orange-400 via-orange-500 to-orange-700 hover:from-orange-300 hover:via-orange-400 hover:to-orange-600 text-white rounded-3xl font-black text-xl flex items-center gap-5 group-hover:scale-[1.05] border-t border-white/40 shadow-[0_20px_50px_rgba(249,115,22,0.4)] transition-all duration-300"
                >
                {loading ? (
                  <RefreshCw className="w-8 h-8 animate-spin" />
                ) : (
                  <Search className="w-8 h-8 group-hover:rotate-12 transition-transform" />
                )}
                <span className="tracking-tighter">주도주 분석 시작</span>
              </button>
              {lastUpdated && (
                <div className="mt-6 flex flex-col gap-2">
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
            className="glass-3d rounded-[2.5rem] p-10 flex flex-col justify-between group"
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
                onClick={handleGenerateSummary}
                disabled={isSummarizing || (!(recommendations || []).length && !(searchResults || []).length && !marketContext)}
                className="w-full btn-3d py-4 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:opacity-50 text-white text-sm font-black rounded-2xl transition-all flex items-center justify-center gap-3 shadow-xl shadow-orange-500/20 group/btn"
              >
                {isSummarizing ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <Sparkles className="w-5 h-5 group-hover/btn:animate-pulse" />
                )}
                AI Report Summary
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
                  <h3 className="text-2xl font-black text-white tracking-tighter uppercase">오늘의 Top 3 주도주</h3>
                  <p className="text-sm text-white/30 font-bold">27단계 마스터 체크리스트를 가장 완벽하게 통과한 종목</p>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white/5 rounded-xl border border-white/10">
                <Activity className="w-4 h-4 text-green-400" />
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">실시간 AI 랭킹 시스템 가동 중</span>
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
                    onClick={() => setDeepAnalysisStock(stock)}
                    className="glass-3d rounded-[3rem] p-8 border border-white/10 relative overflow-hidden group cursor-pointer hover:border-orange-500/50 transition-all"
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
            <div className="glass-3d rounded-[2.5rem] p-8 border border-theme-border shadow-2xl relative overflow-hidden">
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
              <div className="glass-3d rounded-[2.5rem] p-8 border border-orange-500/20 shadow-2xl relative overflow-hidden bg-gradient-to-br from-orange-500/5 to-transparent">
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-8 bg-orange-500 rounded-full" />
                      <h3 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-orange-500" />
                        AI Report Summary
                      </h3>
                    </div>
                    <button 
                      onClick={() => setReportSummary(null)}
                      className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/40 hover:text-white"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="prose prose-invert max-w-none">
                    <div className="text-white/80 text-lg leading-relaxed font-medium space-y-4">
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
        <section>
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
            <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto no-scrollbar pb-1">
              <h3 className="text-xl sm:text-2xl font-black flex items-center gap-3 whitespace-nowrap shrink-0 text-theme-text">
                {view === 'DISCOVER' ? (
                  <>
                    <Search className="w-5 h-5 sm:w-6 sm:h-6 text-orange-500" />
                    종목검색
                  </>
                ) : (
                  <>
                    <Bookmark className="w-5 h-5 text-orange-500" />
                    나의 관심 목록
                  </>
                )}
              </h3>
              <button 
                onClick={fetchStocks}
                disabled={loading}
                className="p-2 bg-theme-card hover:bg-orange-500/20 border border-theme-border rounded-xl transition-all group/refresh active:scale-90"
                title="실시간 시세 새로고침"
              >
                <RefreshCw className={cn("w-4 h-4 text-theme-text-muted group-hover/refresh:text-orange-500", loading && "animate-spin")} />
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
                onClick={handleSyncAll}
                disabled={syncStatus.isSyncing}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all border whitespace-nowrap shrink-0",
                  syncStatus.isSyncing 
                    ? "bg-theme-card border-theme-border text-theme-text-muted cursor-not-allowed"
                    : "bg-orange-500/10 border-orange-500/20 text-orange-500 hover:bg-orange-500/20 hover:border-orange-500/40 shadow-sm active:scale-95"
                )}
                title="현재 화면의 모든 종목 실시간 동기화"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", syncStatus.isSyncing && "animate-spin")} />
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
                      <span className="text-base font-black text-white uppercase tracking-tight">종목 검색 및 실시간 필터</span>
                      <div className="relative group/info">
                        <Info className="w-3.5 h-3.5 text-white/20 hover:text-orange-500 transition-colors cursor-help" />
                        <div className="absolute left-0 top-6 w-80 p-4 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50 pointer-events-none">
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
                                <span className="text-[10px] font-black text-white/80">{item.label}</span>
                                <span className="text-[9px] font-medium text-white/40 leading-tight">{item.desc}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                            <p className="text-[9px] font-bold text-orange-500/60 italic">* 검색어가 없을 경우 AI가 실시간 시장 데이터를 분석하여 가장 유망한 10개 종목을 추천합니다. 시장 상황은 매 순간 변하므로 검색 시마다 결과가 달라질 수 있습니다.</p>
                            <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                              <h5 className="text-[9px] font-black text-blue-400 mb-1 flex items-center gap-1">
                                <Lightbulb className="w-2.5 h-2.5" />
                                백테스팅 결과와 다른 이유?
                              </h5>
                              <p className="text-[8px] text-white/40 font-medium leading-relaxed">
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
                  <div className="flex gap-3">
                    <div className="relative flex-1 group">
                      <div className="absolute left-4 top-0 bottom-0 flex items-center pointer-events-none z-10">
                        <Search className="w-5 h-5 text-white/40 group-focus-within:text-orange-500 transition-colors" />
                      </div>
                      <input
                        type="text"
                        placeholder="종목명 또는 코드를 입력하여 검색..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleMarketSearch()}
                        className="w-full bg-black/40 border-2 border-white/5 rounded-2xl pl-12 pr-6 py-3.5 text-base font-black text-white placeholder:text-white/20 placeholder:text-sm focus:outline-none focus:border-orange-500/50 focus:ring-4 focus:ring-orange-500/10 focus:bg-black/60 transition-all shadow-inner relative z-0"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={handleMarketSearch}
                        disabled={searchingSpecific}
                        className="btn-3d px-6 py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:hover:bg-orange-500 text-white text-base font-black rounded-2xl transition-all flex items-center gap-2 shrink-0 h-full shadow-lg shadow-orange-500/20 whitespace-nowrap"
                      >
                        {searchingSpecific ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Globe className="w-5 h-5" />}
                        시장 검색
                      </button>
                      <div className="flex flex-col gap-0.5 text-center">
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">전체 시장 데이터 조회</span>
                        {!searchQuery && (
                          <span className="text-[8px] font-bold text-orange-500/40 italic animate-pulse">실시간 AI 분석 기반 유동적 추천</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sort Dropdown */}
                <div className="flex flex-col gap-3 min-w-[200px]">
                  <div className="flex items-center gap-2 px-2">
                    <div className="w-1.5 h-4 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                    <span className="text-xs font-black text-white/60 uppercase tracking-[0.1em]">정렬 기준</span>
                  </div>
                  <div className="relative group">
                    <ArrowUpDown className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 group-focus-within:text-orange-500 transition-colors pointer-events-none" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="w-full bg-white/10 border-2 border-white/10 rounded-2xl pl-12 pr-10 py-4 text-base font-black text-white appearance-none focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 focus:bg-white/[0.15] transition-all shadow-2xl cursor-pointer h-[60px]"
                    >
                      <option value="NAME">이름순 (가나다)</option>
                      <option value="CODE">종목코드순</option>
                      <option value="PERFORMANCE">수익률/성과순</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 pointer-events-none" />
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
                          <Settings className={cn("w-4 h-4 text-white/30 group-hover:text-orange-500 transition-colors", isFilterExpanded && "text-orange-500")} />
                          <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] group-hover:text-white/60 transition-colors">필터 및 정밀 검증 설정</span>
                          {isFilterExpanded ? (
                            <ChevronUp className="w-3 h-3 text-white/20" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-white/20" />
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
                          <p className="text-[11px] text-white/40 leading-relaxed">
                            AI 분석 전, 정량적 지표를 통해 1차 스크리닝을 수행합니다. 설정한 조건에 부합하는 종목들 중에서만 AI가 정밀 분석을 진행합니다.
                          </p>
                        </div>
                      )}
                      {isFilterExpanded && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-4 p-5 glass-3d rounded-2xl border border-white/10 bg-white/5">
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-black text-white/40 uppercase tracking-widest ml-1">Min ROE (%)</label>
                            <input 
                              type="number" 
                              placeholder="최소 ROE (%)" 
                              value={filters.minRoe || ''} 
                              onChange={e => setFilters({...filters, minRoe: Number(e.target.value)})} 
                              className="p-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-sm focus:border-orange-500/50 focus:outline-none transition-all" 
                            />
                            <span className="text-[9px] text-white/20 ml-1">자기자본이익률 (수익성)</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-black text-white/40 uppercase tracking-widest ml-1">Max PER</label>
                            <input 
                              type="number" 
                              placeholder="최대 PER" 
                              value={filters.maxPer || ''} 
                              onChange={e => setFilters({...filters, maxPer: Number(e.target.value)})} 
                              className="p-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-sm focus:border-orange-500/50 focus:outline-none transition-all" 
                            />
                            <span className="text-[9px] text-white/20 ml-1">주가수익비율 (저평가)</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-black text-white/40 uppercase tracking-widest ml-1">Max Debt Ratio (%)</label>
                            <input 
                              type="number" 
                              placeholder="최대 부채비율 (%)" 
                              value={filters.maxDebtRatio || ''} 
                              onChange={e => setFilters({...filters, maxDebtRatio: Number(e.target.value)})} 
                              className="p-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-sm focus:border-orange-500/50 focus:outline-none transition-all" 
                            />
                            <span className="text-[9px] text-white/20 ml-1">부채비율 (재무 건전성)</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] font-black text-white/40 uppercase tracking-widest ml-1">Min Market Cap (억)</label>
                            <input 
                              type="number" 
                              placeholder="최소 시총 (억)" 
                              value={filters.minMarketCap || ''} 
                              onChange={e => setFilters({...filters, minMarketCap: Number(e.target.value)})} 
                              className="p-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-sm focus:border-orange-500/50 focus:outline-none transition-all" 
                            />
                            <span className="text-[9px] text-white/20 ml-1">시가총액 (기업 규모)</span>
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
                              <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 shadow-inner">
                                {['ALL', 'STRONG_BUY', 'BUY', 'STRONG_SELL', 'SELL'].map((type) => (
                                  <button
                                    key={type}
                                    onClick={() => setSelectedType(type)}
                                    className={cn(
                                      "px-4 py-2 rounded-xl text-xs font-black transition-all",
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
                              <div className="flex bg-white/5 p-1.5 rounded-2xl border border-white/10 shadow-inner">
                                {[
                                  { id: 'ALL', label: '모든 심리' },
                                  { id: 'RISK_ON', label: 'Risk-On' },
                                  { id: 'RISK_OFF', label: 'Risk-Off' }
                                ].map((s) => (
                                  <button
                                    key={s.id}
                                    onClick={() => setSelectedSentiment(s.id)}
                                    className={cn(
                                      "px-4 py-2 rounded-xl text-xs font-black transition-all",
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
                                    {Object.entries(checklistLabels)
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
            className="mb-8 sm:mb-12 bg-white/5 rounded-[1.5rem] sm:rounded-[2.5rem] p-4 sm:p-6 border border-white/10 shadow-inner"
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
              <div className="bg-white/5 p-6 rounded-[2rem] border border-white/10 shadow-inner flex flex-col justify-center items-center gap-2 relative group/stat-1">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">AI 추천 적중률 (최근 10회)</span>
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
                <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-64 p-4 bg-[#1a1a1a] backdrop-blur-xl border border-white/10 rounded-2xl opacity-0 group-hover/stat-1:opacity-100 transition-all duration-300 z-50 pointer-events-none shadow-2xl scale-95 group-hover/stat-1:scale-100 origin-top">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1 h-3 bg-orange-500 rounded-full" />
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">산출 기준</span>
                  </div>
                  <p className="text-[11px] text-white/60 leading-relaxed font-medium">
                    최근 10번의 추천 세션에서 선정된 종목들이 추천 시점 이후 <span className="text-orange-400">5거래일 이내에 +3% 이상의 수익률</span>을 기록한 비율의 평균입니다. 시스템의 전반적인 단기 예측 성공률을 나타냅니다.
                  </p>
                </div>
              </div>

              <div className="bg-white/5 p-6 rounded-[2rem] border border-white/10 shadow-inner flex flex-col justify-center items-center gap-2 relative group/stat-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Recent 30-day STRONG_BUY hit rate</span>
                  <HelpCircle className="w-3 h-3 text-white/10 cursor-help" />
                </div>
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-black text-indigo-400 tracking-tighter">{strongBuyHitRate}%</span>
                  <div className="mb-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest bg-indigo-500/20 text-indigo-400">
                    High Precision
                  </div>
                </div>

                {/* Tooltip */}
                <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-64 p-4 bg-[#1a1a1a] backdrop-blur-xl border border-white/10 rounded-2xl opacity-0 group-hover/stat-2:opacity-100 transition-all duration-300 z-50 pointer-events-none shadow-2xl scale-95 group-hover/stat-2:scale-100 origin-top">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                    <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">산출 기준</span>
                  </div>
                  <p className="text-[11px] text-white/60 leading-relaxed font-medium">
                    최근 30일간 <span className="text-indigo-400">AI 확신도(Conviction Score)가 85점 이상</span>인 '강력 매수' 종목들의 적중률입니다. 고확신도 종목에 대한 정밀도를 나타내며, 일반 추천보다 엄격한 기준으로 관리됩니다.
                  </p>
                </div>
              </div>
              
              <div className="md:col-span-2 bg-white/5 p-6 rounded-[2rem] border border-white/10 shadow-inner">
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
                  "flex items-center gap-3 px-5 py-3 rounded-2xl border mb-4 backdrop-blur-sm",
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
                  <span className="ml-auto text-[10px] text-white/20 font-bold">
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
                        "glass-3d card-3d rounded-[2.5rem] p-0 transition-all duration-500 relative overflow-hidden flex flex-col h-full group border-white/5 hover:border-white/20 cursor-pointer",
                        stock.peakPrice > 0 && Math.round((stock.currentPrice / stock.peakPrice - 1) * 100) <= -30 
                          ? "border-red-500/40 shadow-[0_0_40px_rgba(239,68,68,0.15)]" 
                          : "shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
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
                          <div className="relative p-4 sm:p-6 bg-white/[0.03] border border-white/10 rounded-2xl sm:rounded-[2rem] overflow-hidden group/name-area shadow-[inset_0_0_20px_rgba(255,255,255,0.02)]">
                            {/* Decorative Background Glow */}
                            <div className="absolute -top-12 -left-12 w-40 h-40 bg-orange-500/5 blur-[80px] rounded-full group-hover/name-area:bg-orange-500/15 transition-all duration-700" />
                            <div className="absolute -bottom-12 -right-12 w-40 h-40 bg-blue-500/5 blur-[80px] rounded-full group-hover/name-area:bg-blue-500/15 transition-all duration-700" />
                            
                            <div className="relative flex flex-col min-w-0">
                              <div className="flex items-center justify-between gap-3 min-w-0 mb-2">
                                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                                  <div className="relative group/copy">
                                    <h4 
                                      onClick={() => handleCopy(stock.name, stock.code)}
                                      className="text-xl sm:text-2xl lg:text-3xl font-black tracking-tighter text-white group-hover:text-orange-500 transition-all duration-300 truncate leading-tight cursor-pointer flex items-center gap-2 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                                      title="종목명 복사"
                                    >
                                      {stock.name}
                                      <Copy className="w-4 h-4 opacity-0 group-hover/copy:opacity-50 transition-opacity" />
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
                                  {stock.gate && (
                                    <div className={cn(
                                      "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border shadow-lg backdrop-blur-md",
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
                                    <span className="text-[10px] sm:text-[11px] font-black text-orange-400 uppercase tracking-[0.1em]">{stock.visualReport.summary}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
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
                              onClick={() => addToBacktest(stock)}
                              className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-white/10 bg-white/5 text-white/30 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5 active:scale-90 shadow-sm"
                              title="Add to Backtest"
                            >
                              <History className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                            </button>
                            <button 
                              onClick={() => toggleWatchlist(stock)}
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
                              onClick={() => {
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
                                onClick={() => {
                                  const totalAssets = 100_000_000; // 기본 1억 (모의계좌 초기자금)
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
                                  onManualUpdate={(newPrice) => handleManualPriceUpdate(stock, newPrice)}
                                  onSync={() => handleSyncPrice(stock)}
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
                    className="col-span-full py-24 text-center border-2 border-dashed border-white/5 rounded-[3rem] bg-white/[0.01]"
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
                          onClick={handleMarketSearch}
                          disabled={searchingSpecific}
                          className="btn-3d px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-black rounded-2xl transition-all flex items-center gap-3 shadow-xl"
                        >
                          {searchingSpecific ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Globe className="w-5 h-5" />}
                          "{searchQuery}" 전체 시장에서 검색
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </section>
      </>
    )}
  </AnimatePresence>

      {/* Deep Analysis Modal */}
      <AnimatePresence>
        {deepAnalysisStock && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] flex items-center justify-center p-4 md:p-6 bg-black/90 backdrop-blur-md"
            onClick={() => setDeepAnalysisStock(null)}
          >
            <motion.div
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
                  onClick={handleExportDeepAnalysisPDF}
                  disabled={isExportingDeepAnalysis}
                  className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center hover:bg-blue-500 transition-all group active:scale-90 border border-white/10 backdrop-blur-md shadow-2xl"
                  title="PDF 리포트 저장"
                >
                  {isExportingDeepAnalysis ? (
                    <RefreshCw className="w-6 h-6 text-white/50 animate-spin" />
                  ) : (
                    <Download className="w-6 h-6 text-white/50 group-hover:text-white transition-colors" />
                  )}
                </button>
                <button 
                  onClick={() => setDeepAnalysisStock(null)}
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
                        {
                          'cycleVerified': 1, 'roeType3': 3, 'riskOnEnvironment': 5, 'mechanicalStop': 7, 'notPreviousLeader': 9,
                          'supplyInflow': 4, 'ichimokuBreakout': 6, 'economicMoatVerified': 8, 'technicalGoldenCross': 10,
                          'volumeSurgeVerified': 11, 'institutionalBuying': 12, 'consensusTarget': 13, 'earningsSurprise': 14,
                          'performanceReality': 15, 'policyAlignment': 16, 'ocfQuality': 17, 'relativeStrength': 18,
                          'momentumRanking': 2, 'psychologicalObjectivity': 19, 'turtleBreakout': 20, 'fibonacciLevel': 21,
                          'elliottWaveVerified': 22, 'marginAcceleration': 23, 'interestCoverage': 24, 'vcpPattern': 25,
                          'divergenceCheck': 26, 'catalystAnalysis': 27
                        }[step.key], 
                        deepAnalysisStock?.checklist?.[step.key as keyof typeof deepAnalysisStock.checklist] ? 10 : 0
                      ])
                    ) as Record<number, number>,
                    { 
                      type: (['BULL', 'RISK_ON'].includes(deepAnalysisStock.aiConvictionScore?.marketPhase || '') ? '상승초기' : 
                             ['BEAR', 'RISK_OFF'].includes(deepAnalysisStock.aiConvictionScore?.marketPhase || '') ? '하락' : 
                             deepAnalysisStock.aiConvictionScore?.marketPhase === 'SIDEWAYS' ? '횡보' : '변동성'),
                      weightMultipliers: marketOverview?.dynamicWeights || {}, 
                      vKospi: deepAnalysisStock.marketSentiment?.vkospi || 15, 
                      samsungIri: deepAnalysisStock.marketSentiment?.iri || 3.5
                    },
                    deepAnalysisStock.marketCapCategory === 'LARGE' ? 'A' : 'B',
                    { 
                      name: deepAnalysisStock.relatedSectors?.[0] || 'Unknown',
                      rank: 1,
                      strength: deepAnalysisStock.confidenceScore || 0,
                      isLeading: deepAnalysisStock.isSectorTopPick || false, 
                      sectorLeaderNewHigh: deepAnalysisStock.sectorLeaderNewHigh || false 
                    },
                    0, // euphoriaSignals
                    false, // emergencyStop
                    deepAnalysisStock.currentPrice > 0 && deepAnalysisStock.stopLoss > 0 && deepAnalysisStock.targetPrice > deepAnalysisStock.currentPrice
                      ? (deepAnalysisStock.targetPrice - deepAnalysisStock.currentPrice) / (deepAnalysisStock.currentPrice - deepAnalysisStock.stopLoss)
                      : 2.1,
                    (deepAnalysisStock.sellSignals || []).map((_, i) => i),
                    deepAnalysisStock.multiTimeframe,
                    deepAnalysisStock.enemyChecklist,
                    deepAnalysisStock.seasonality,
                    deepAnalysisStock.attribution,
                    deepAnalysisStock.isPullbackVolumeLow || false,
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
                      newsPhase: (newsFrequencyScores.find((n: any) => n.code === deepAnalysisStock.code)?.phase) as any ?? undefined,
                      // 촉매 설명 텍스트 → 촉매 등급 A/B/C
                      catalystDescription: deepAnalysisStock.reason,
                      // Gap 2a: 주봉 RSI 3주 추이
                      weeklyRsiValues: weeklyRsiValues.length > 0 ? weeklyRsiValues : undefined,
                      // Gap 2b: 기관 일별 순매수 수량 시계열 (supplyData에서 추출)
                      institutionalAmounts: deepAnalysisStock.supplyData?.institutionalDailyAmounts ?? undefined,
                    },
                    {
                      kospi60dVolatility: extendedRegimeData?.uncertaintyMetrics?.kospi60dVolatility,
                      leadingSectorCount: extendedRegimeData?.uncertaintyMetrics?.leadingSectorCount,
                      foreignFlowDirection: extendedRegimeData?.uncertaintyMetrics?.foreignFlowDirection,
                      kospiSp500Correlation: globalCorrelation?.kospiSp500,
                      financialStress: financialStressData ?? undefined,
                    },
                    deepAnalysisStock.relatedSectors?.[0],
                  )}
                  economicRegime={extendedRegimeData ?? economicRegimeData ?? undefined}
                  currentRoeType={currentRoeType}
                  marketOverview={marketOverview}
                />
                ) : (
                  <>
                    {/* Modal Header Area */}
                    <div className="mb-10 flex flex-col lg:flex-row lg:items-end justify-between gap-8">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 sm:gap-4 flex-wrap min-w-0">
                      <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tighter text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.1)] break-words max-w-full leading-tight">
                        {deepAnalysisStock.name}
                      </h2>
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <span className="text-xs sm:text-sm font-black text-white/60 bg-white/10 px-4 py-2 rounded-2xl border border-white/20 tracking-[0.2em] uppercase shadow-2xl backdrop-blur-xl">
                          {deepAnalysisStock.code}
                        </span>
                        {deepAnalysisStock.isSectorTopPick && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-xl shadow-lg">
                            <Award className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-black uppercase tracking-widest">Sector Top Pick</span>
                          </div>
                        )}
                        {deepAnalysisStock.aiConvictionScore?.marketPhase && (
                          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                            <div className={cn(
                              "px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border backdrop-blur-md shadow-lg flex items-center gap-2 whitespace-nowrap shrink-0",
                              deepAnalysisStock.aiConvictionScore.marketPhase === 'RISK_ON' || deepAnalysisStock.aiConvictionScore.marketPhase === 'BULL' ? "bg-green-500/20 text-green-400 border-green-500/30" :
                              deepAnalysisStock.aiConvictionScore.marketPhase === 'RISK_OFF' || deepAnalysisStock.aiConvictionScore.marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400 border-red-500/30" : 
                              deepAnalysisStock.aiConvictionScore.marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400 border-blue-500/30" :
                              deepAnalysisStock.aiConvictionScore.marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
                              "bg-white/10 text-white/40 border-white/10"
                            )} title={getMarketPhaseInfo(deepAnalysisStock.aiConvictionScore.marketPhase).description}>
                              {getMarketPhaseInfo(deepAnalysisStock.aiConvictionScore.marketPhase).label}
                              <Info className="w-3 h-3 opacity-50" />
                            </div>
                            <a 
                              href={(() => {
                                const cleanCode = String(deepAnalysisStock.code).replace(/[^0-9]/g, '');
                                return cleanCode.length === 6
                                  ? `https://finance.naver.com/item/main.naver?code=${cleanCode}`
                                  : `https://search.naver.com/search.naver?query=${encodeURIComponent(deepAnalysisStock.name)}+주가`;
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
                          <span className="text-2xl sm:text-3xl font-black text-white tracking-tighter">₩{deepAnalysisStock.currentPrice?.toLocaleString() || '0'}</span>
                          <span className="text-[10px] font-bold text-white/20 uppercase">KRW</span>
                        </div>
                        {(deepAnalysisStock.priceUpdatedAt || deepAnalysisStock.dataSource) && (
                          <div className="text-[8px] font-black text-white/30 uppercase tracking-tighter mt-1">
                            {deepAnalysisStock.priceUpdatedAt} {deepAnalysisStock.dataSource && `via ${deepAnalysisStock.dataSource}`}
                          </div>
                        )}
                        {deepAnalysisStock.financialUpdatedAt && (
                          <div className="text-[8px] font-black text-blue-400/40 uppercase tracking-tighter mt-0.5 flex items-center gap-1">
                            <ShieldCheck className="w-2 h-2" />
                            DART: {deepAnalysisStock.financialUpdatedAt}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="hidden sm:block w-px h-10 sm:h-12 bg-white/10" />
                    <div className="flex flex-col min-w-fit">
                      <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 sm:mb-2">Value / Momentum</span>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="flex flex-col items-center">
                          <span className="text-lg sm:text-xl font-black text-blue-400">{deepAnalysisStock.scores?.value || 0}</span>
                          <span className="text-[7px] sm:text-[8px] font-black text-white/20 uppercase tracking-widest">VALUE</span>
                        </div>
                        <div className="w-px h-5 sm:h-6 bg-white/10" />
                        <div className="flex flex-col items-center">
                          <span className="text-lg sm:text-xl font-black text-orange-400">{deepAnalysisStock.scores?.momentum || 0}</span>
                          <span className="text-[7px] sm:text-[8px] font-black text-white/20 uppercase tracking-widest">MOMENTUM</span>
                        </div>
                      </div>
                    </div>
                    <div className="hidden sm:block w-px h-10 sm:h-12 bg-white/10" />
                    <div className="flex flex-col min-w-fit">
                      <span className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mb-1 sm:mb-2">AI Conviction</span>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl sm:text-3xl font-black text-orange-500 tracking-tighter">{deepAnalysisStock.aiConvictionScore?.totalScore || 0}</span>
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
                    {deepAnalysisStock.reason}
                  </p>
                </div>

                {/* Candle Chart with Technical Overlays */}
                <div className="mb-10">
                  <CandleChart
                    stockCode={deepAnalysisStock.code}
                    stockName={deepAnalysisStock.name}
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
                        <span className="text-xs font-black text-orange-500">{Object.values(deepAnalysisStock?.checklist || {}).filter(Boolean).length} / 27 Passed</span>
                      </div>
                    </div>
                    
                    <div className="w-full h-[400px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="80%" data={getRadarData(deepAnalysisStock)}>
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
                            name={deepAnalysisStock.name}
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
                            const isPassed = deepAnalysisStock.checklist[key as keyof StockRecommendation['checklist']];
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
                      <span className="text-3xl font-black text-blue-400">#{deepAnalysisStock.momentumRank}</span>
                      <span className="text-[9px] font-bold text-white/40 mt-1">Top {Math.round((deepAnalysisStock.momentumRank / 2500) * 100)}% of Market</span>
                    </div>
                    
                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Supply Quality</span>
                      <div className="flex gap-2">
                        <div className={cn("px-3 py-1 rounded-full text-[10px] font-black border", 
                          deepAnalysisStock.supplyQuality?.active ? "bg-orange-500/20 text-orange-400 border-orange-500/30" : "bg-white/5 text-white/20 border-white/10")}>
                          ACTIVE
                        </div>
                        <div className={cn("px-3 py-1 rounded-full text-[10px] font-black border", 
                          deepAnalysisStock.supplyQuality?.passive ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-white/5 text-white/20 border-white/10")}>
                          PASSIVE
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Sector Status</span>
                      <div className="flex flex-col items-center">
                        <span className={cn("text-sm font-black mb-1", deepAnalysisStock.isLeadingSector ? "text-orange-400" : "text-white/40")}>
                          {deepAnalysisStock.isLeadingSector ? "LEADING SECTOR" : "SECONDARY SECTOR"}
                        </span>
                        <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">
                          {deepAnalysisStock.isPreviousLeader ? "PREVIOUS LEADER" : "NEW LEADER CANDIDATE"}
                        </span>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Peak Distance</span>
                      <div className="flex flex-col items-center">
                        <span className="text-xl font-black text-white">₩{deepAnalysisStock.peakPrice?.toLocaleString()}</span>
                        <span className="text-[10px] font-black text-red-400 mt-1">
                          -{Math.round((1 - (deepAnalysisStock.currentPrice / (deepAnalysisStock.peakPrice || 1))) * 100)}% from Peak
                        </span>
                      </div>
                    </div>

                    <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col items-center justify-center text-center">
                      <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-2">Market Cap</span>
                      <span className="text-lg font-black text-white uppercase tracking-tight">{deepAnalysisStock.marketCapCategory} CAP</span>
                      <span className="text-[9px] font-bold text-white/40 mt-1">₩{(deepAnalysisStock.marketCap / 100000000).toFixed(1)}B</span>
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
                        <span className="text-4xl font-black text-white tracking-tighter">{deepAnalysisStock.aiConvictionScore?.totalScore || 0}</span>
                        <span className="text-sm font-bold text-white/20">/ 100</span>
                      </div>
                      <div className="bg-orange-500/10 p-3 rounded-xl border border-orange-500/20 mb-4">
                        <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest block mb-1">Market Context Weighting</span>
                        <p className="text-[11px] text-orange-400/80 font-bold leading-tight">
                          {deepAnalysisStock.aiConvictionScore?.description}
                        </p>
                      </div>
                      <div className="space-y-2 mb-4">
                        {(deepAnalysisStock.aiConvictionScore?.factors || []).map((f, i) => (
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
                            deepAnalysisStock.aiConvictionScore?.marketPhase === 'RISK_ON' || deepAnalysisStock.aiConvictionScore?.marketPhase === 'BULL' ? "bg-green-500/20 text-green-400" :
                            deepAnalysisStock.aiConvictionScore?.marketPhase === 'RISK_OFF' || deepAnalysisStock.aiConvictionScore?.marketPhase === 'BEAR' ? "bg-red-500/20 text-red-400" : 
                            deepAnalysisStock.aiConvictionScore?.marketPhase === 'SIDEWAYS' ? "bg-blue-500/20 text-blue-400" :
                            deepAnalysisStock.aiConvictionScore?.marketPhase === 'TRANSITION' ? "bg-purple-500/20 text-purple-400" :
                            "bg-white/10 text-white/40"
                          )}>
                            {getMarketPhaseInfo(deepAnalysisStock.aiConvictionScore?.marketPhase).label}
                          </div>
                          <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Phase Analysis</span>
                        </div>
                        
                        <div className="bg-white/5 rounded-xl p-3 border border-white/5 mb-3">
                          <div className="flex items-center gap-2 mb-1">
                            <Lightbulb className="w-3 h-3 text-yellow-500" />
                            <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Recommendation</span>
                          </div>
                          <p className="text-[11px] text-white/80 font-bold leading-relaxed">
                            {getMarketPhaseInfo(deepAnalysisStock.aiConvictionScore?.marketPhase).recommendation}
                          </p>
                        </div>

                        <p className="text-[11px] text-white/40 leading-relaxed font-medium italic break-words">
                          {deepAnalysisStock.aiConvictionScore?.description}
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
                        <span className="text-4xl font-black text-white tracking-tighter">{deepAnalysisStock.catalystDetail?.score || 0}</span>
                        <span className="text-sm font-bold text-white/20">/ 20 bonus</span>
                        {deepAnalysisStock.catalystSummary && (
                          <span className="ml-auto px-3 py-1 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-[10px] font-black text-yellow-500 uppercase tracking-widest">
                            {deepAnalysisStock.catalystSummary}
                          </span>
                        )}
                      </div>
                      <div className="space-y-4">
                        <div>
                          <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-2">Key Catalyst</span>
                          <p className="text-xs text-white/70 font-bold leading-relaxed">
                            {deepAnalysisStock.catalystDetail?.description || '발굴된 촉매제가 없습니다.'}
                          </p>
                        </div>
                        {deepAnalysisStock.catalystDetail?.upcomingEvents && deepAnalysisStock.catalystDetail.upcomingEvents.length > 0 && (
                          <div>
                            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-2">Upcoming Events</span>
                            <div className="space-y-1.5">
                              {(deepAnalysisStock.catalystDetail?.upcomingEvents || []).map((event, i) => (
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
                          { label: 'Financial', grade: deepAnalysisStock.visualReport?.financial, color: 'text-blue-400' },
                          { label: 'Technical', grade: deepAnalysisStock.visualReport?.technical, color: 'text-orange-400' },
                          { label: 'Supply', grade: deepAnalysisStock.visualReport?.supply, color: 'text-green-400' }
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
                          "{deepAnalysisStock.visualReport?.summary}"
                        </p>
                      </div>
                    </div>

                    {/* KIS 실시간 수급 카드 */}
                    {deepAnalysisStock.supplyData && (
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
                              deepAnalysisStock.supplyData.foreignNet > 0 ? "text-red-400" : "text-blue-400"
                            )}>
                              {deepAnalysisStock.supplyData.foreignNet > 0 ? '+' : ''}
                              {deepAnalysisStock.supplyData.foreignNet.toLocaleString()}주
                            </span>
                            <span className="text-[10px] text-white/30 block mt-1">
                              연속 {deepAnalysisStock.supplyData.foreignConsecutive}일 순매수
                            </span>
                          </div>
                          <div className="bg-white/5 rounded-2xl p-4 border border-white/10">
                            <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">기관 5일 순매수</span>
                            <span className={cn(
                              "text-xl font-black",
                              deepAnalysisStock.supplyData.institutionNet > 0 ? "text-red-400" : "text-blue-400"
                            )}>
                              {deepAnalysisStock.supplyData.institutionNet > 0 ? '+' : ''}
                              {deepAnalysisStock.supplyData.institutionNet.toLocaleString()}주
                            </span>
                            <span className="text-[10px] text-white/30 block mt-1">
                              {deepAnalysisStock.supplyData.individualNet < 0 ? '개인 매도' : '개인 매수'} 동반
                            </span>
                          </div>
                        </div>

                        <div className={cn(
                          "p-4 rounded-2xl border",
                          deepAnalysisStock.supplyData.isPassiveAndActive
                            ? "bg-red-500/10 border-red-500/20"
                            : "bg-white/5 border-white/10"
                        )}>
                          <div className="flex items-center gap-2">
                            {deepAnalysisStock.supplyData.isPassiveAndActive
                              ? <Zap className="w-4 h-4 text-red-400 fill-current" />
                              : <Info className="w-4 h-4 text-white/30" />
                            }
                            <span className={cn(
                              "text-xs font-black uppercase tracking-widest",
                              deepAnalysisStock.supplyData.isPassiveAndActive ? "text-red-400" : "text-white/30"
                            )}>
                              {deepAnalysisStock.supplyData.isPassiveAndActive
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
                      {deepAnalysisStock.shortSelling ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/10">
                            <div>
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">공매도 비율</span>
                              <span className="text-2xl font-black text-white">{deepAnalysisStock.shortSelling.ratio}%</span>
                            </div>
                            <div className={cn("flex items-center gap-2 font-black",
                              deepAnalysisStock.shortSelling.trend === 'DECREASING' ? "text-green-400" : "text-red-400"
                            )}>
                              {deepAnalysisStock.shortSelling.trend === 'DECREASING'
                                ? <ArrowDownRight className="w-5 h-5" />
                                : <ArrowUpRight className="w-5 h-5" />}
                              <span className="text-sm">{deepAnalysisStock.shortSelling.trend}</span>
                            </div>
                          </div>
                          <div className="bg-orange-500/10 p-4 rounded-2xl border border-orange-500/20">
                            <p className="text-[11px] text-orange-400/90 font-bold leading-relaxed">
                              {deepAnalysisStock.shortSelling.implication}
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
                      {deepAnalysisStock.tenbaggerDNA ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/10">
                            <div>
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">매칭 패턴</span>
                              <span className="text-sm font-black text-white">{deepAnalysisStock.tenbaggerDNA.matchPattern}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] font-black text-white/30 uppercase tracking-widest block mb-1">유사도</span>
                              <span className="text-2xl font-black text-blue-400">{deepAnalysisStock.tenbaggerDNA.similarity}%</span>
                            </div>
                          </div>
                          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${deepAnalysisStock.tenbaggerDNA.similarity}%` }}
                              className="h-full bg-gradient-to-r from-blue-600 to-blue-400"
                            />
                          </div>
                          <div className="bg-blue-500/10 p-4 rounded-2xl border border-blue-500/20">
                            <p className="text-[11px] text-blue-400/90 font-bold leading-relaxed">
                              {deepAnalysisStock.tenbaggerDNA.reason}
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
                          <span className="text-lg font-black text-blue-400">{deepAnalysisStock.historicalAnalogy?.stockName}</span>
                          <span className="text-xs font-bold text-white/30">({deepAnalysisStock.historicalAnalogy?.period})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500" style={{ width: `${deepAnalysisStock.historicalAnalogy?.similarity}%` }} />
                          </div>
                          <span className="text-xs font-black text-blue-400">{deepAnalysisStock.historicalAnalogy?.similarity}%</span>
                        </div>
                        <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">Similarity Match</span>
                      </div>
                      <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
                        {deepAnalysisStock.historicalAnalogy?.reason}
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
                          deepAnalysisStock.anomalyDetection?.type === 'FUNDAMENTAL_DIVERGENCE' ? "bg-purple-500/20 text-purple-400 border-purple-500/30" :
                          deepAnalysisStock.anomalyDetection?.type === 'SMART_MONEY_ACCUMULATION' ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                          "bg-white/5 text-white/30 border-white/10"
                        )}>
                          {deepAnalysisStock.anomalyDetection?.type?.replace('_', ' ') || 'NONE DETECTED'}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-black text-white tracking-tighter">{deepAnalysisStock.anomalyDetection?.score || 0}</span>
                          <span className="text-[10px] font-bold text-white/20 uppercase">Intensity</span>
                        </div>
                      </div>
                      <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
                        {deepAnalysisStock.anomalyDetection?.description}
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
                        <span className="text-sm font-black text-emerald-400 block mb-2">{deepAnalysisStock.semanticMapping?.theme}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {(deepAnalysisStock.semanticMapping?.keywords || []).map((k, i) => (
                            <span key={i} className="text-[9px] font-black px-2 py-0.5 bg-emerald-500/10 text-emerald-400/70 rounded-md border border-emerald-500/20">
                              #{k}
                            </span>
                          ))}
                        </div>
                      </div>
                      <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
                        {deepAnalysisStock.semanticMapping?.description}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 3-Gate Filter Evaluation */}
                {deepAnalysisStock.gateEvaluation && (
                  <div className="mb-10">
                    <div className="flex items-center justify-between mb-6 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
                        <h3 className="text-xl font-black text-white uppercase tracking-tighter">3-Gate Filter Pyramid</h3>
                      </div>
                      <div className={cn(
                        "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border-2",
                        deepAnalysisStock.gateEvaluation.isPassed ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"
                      )}>
                        {deepAnalysisStock.gateEvaluation.isPassed ? "Total Pass" : "Failed at Gate " + deepAnalysisStock.gateEvaluation.currentGate}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {[1, 2, 3].map((gateNum) => {
                        const gate = deepAnalysisStock.gateEvaluation?.[`gate${gateNum}` as keyof typeof deepAnalysisStock.gateEvaluation] as any;
                        const isCurrent = deepAnalysisStock.gateEvaluation?.currentGate === gateNum;
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
                {deepAnalysisStock.sellSignals && deepAnalysisStock.sellSignals.length > 0 && (
                  <div className="mb-10">
                    <div className="flex items-center justify-between mb-6 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-6 bg-red-500 rounded-full" />
                        <h3 className="text-xl font-black text-white uppercase tracking-tighter">Sell Checklist Evaluation</h3>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black text-red-500 tracking-tighter">{deepAnalysisStock.sellScore || 0}</span>
                        <span className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Sell Score</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {(deepAnalysisStock.sellSignals || []).map((signal, i) => (
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
                {deepAnalysisStock.sectorAnalysis && (
                  <div className="mb-8">
                    <div className="flex items-center gap-3 mb-6 px-4">
                      <div className="w-1.5 h-6 bg-blue-500 rounded-full" />
                      <h3 className="text-xl font-black text-white uppercase tracking-tighter">Sector Analysis: {deepAnalysisStock.sectorAnalysis.sectorName}</h3>
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
                            {deepAnalysisStock.sectorAnalysis?.currentTrends?.map((trend, i) => (
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
                            {deepAnalysisStock.sectorAnalysis?.catalysts?.map((catalyst, i) => (
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
                        {(deepAnalysisStock.relatedSectors || []).map((sector, i) => (
                                <span key={i} className="px-4 py-2 rounded-2xl bg-purple-500/10 text-purple-400 text-xs font-black border border-purple-500/20">
                                  {sector}
                                </span>
                              ))}
                            </div>
                            <div className="bg-black/20 p-5 rounded-3xl border border-white/5 flex items-center justify-between">
                              <span className="text-[11px] font-black text-white/30 uppercase tracking-widest">Correlation Group</span>
                              <span className="text-sm font-black text-white/80">{deepAnalysisStock.correlationGroup}</span>
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
                          {(deepAnalysisStock.sectorAnalysis?.leadingStocks || []).map((stock, i) => (
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
                        
                        {deepAnalysisStock.sectorAnalysis?.riskFactors && deepAnalysisStock.sectorAnalysis.riskFactors.length > 0 && (
                          <div className="mt-6 pt-6 border-t border-white/5">
                            <span className="text-[10px] font-black text-red-400/40 uppercase tracking-widest block mb-3">Sector Risks</span>
                            <div className="space-y-2">
                              {(deepAnalysisStock.sectorAnalysis.riskFactors || []).map((risk, i) => (
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
                            deepAnalysisStock.technicalSignals?.maAlignment === 'BULLISH' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                            deepAnalysisStock.technicalSignals?.maAlignment === 'BEARISH' ? "bg-red-500/10 text-red-400 border-red-500/20" :
                            "bg-white/5 text-white/40 border-white/10"
                          )}>
                            {deepAnalysisStock.technicalSignals?.maAlignment}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">RSI (14)</span>
                          <div className="px-3 py-2 rounded-xl text-xs font-black text-center bg-white/5 border border-white/10 text-white/80">
                            {deepAnalysisStock.technicalSignals?.rsi}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">MACD Status</span>
                          <div className={cn(
                            "px-3 py-2 rounded-xl text-xs font-black text-center border",
                            deepAnalysisStock.technicalSignals?.macdStatus === 'GOLDEN_CROSS' ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                            "bg-white/5 text-white/40 border-white/10"
                          )}>
                            {deepAnalysisStock.technicalSignals?.macdStatus?.replace('_', ' ')}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest block">Ichimoku</span>
                          <div className={cn(
                            "px-3 py-2 rounded-xl text-[10px] font-black text-center border",
                            deepAnalysisStock.ichimokuStatus === 'ABOVE_CLOUD' ? "bg-green-500/10 text-green-400 border-green-500/20" :
                            deepAnalysisStock.ichimokuStatus === 'BELOW_CLOUD' ? "bg-red-500/10 text-red-400 border-red-500/20" :
                            "bg-white/5 text-white/40 border-white/10"
                          )}>
                            {deepAnalysisStock.ichimokuStatus?.replace('_', ' ')}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex justify-between items-center">
                          <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Volume Surge</span>
                          <span className={cn("text-xs font-black", deepAnalysisStock.technicalSignals?.volumeSurge ? "text-orange-400" : "text-white/20")}>
                            {deepAnalysisStock.technicalSignals?.volumeSurge ? "DETECTED" : "NORMAL"}
                          </span>
                        </div>
                        <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex justify-between items-center">
                          <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Disparity (20)</span>
                          <span className={cn("text-xs font-black", 
                            (deepAnalysisStock.technicalSignals?.disparity20 || 100) > 105 ? "text-red-400" : 
                            (deepAnalysisStock.technicalSignals?.disparity20 || 100) < 95 ? "text-green-400" : "text-white/60"
                          )}>
                            {deepAnalysisStock.technicalSignals?.disparity20}%
                          </span>
                        </div>
                      </div>

                      {/* Elliott Wave & Chart Pattern */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                        {deepAnalysisStock.elliottWaveStatus && (
                          <div className="bg-gradient-to-br from-indigo-500/10 to-purple-600/5 rounded-3xl p-5 border border-indigo-500/20">
                            <div className="flex items-center gap-3 mb-3">
                              <Activity className="w-4 h-4 text-indigo-400" />
                              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Elliott Wave Status</span>
                            </div>
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-lg font-black text-indigo-400">{(deepAnalysisStock.elliottWaveStatus.wave || '').replace('_', ' ')}</span>
                            </div>
                            <p className="text-[11px] text-white/70 font-bold leading-relaxed">
                              {deepAnalysisStock.elliottWaveStatus.description}
                            </p>
                          </div>
                        )}

                        {deepAnalysisStock.chartPattern && (
                          <div className="bg-gradient-to-br from-emerald-500/10 to-teal-600/5 rounded-3xl p-5 border border-emerald-500/20">
                            <div className="flex items-center gap-3 mb-3">
                              <Target className="w-4 h-4 text-emerald-400" />
                              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Chart Pattern</span>
                            </div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-black text-white uppercase">{deepAnalysisStock.chartPattern.name}</span>
                              <div className={cn("px-2 py-0.5 rounded-md text-[9px] font-black border",
                                (deepAnalysisStock.chartPattern.type || '').includes('BULLISH') ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                                (deepAnalysisStock.chartPattern.type || '').includes('BEARISH') ? "bg-red-500/20 text-red-400 border-red-500/30" :
                                "bg-white/5 text-white/40 border-white/10"
                              )}>
                                {(deepAnalysisStock.chartPattern.type || '').replace('_', ' ')}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500" style={{ width: `${deepAnalysisStock.chartPattern.reliability}%` }} />
                              </div>
                              <span className="text-[9px] font-black text-white/40">{deepAnalysisStock.chartPattern.reliability}% Reliability</span>
                            </div>
                            <p className="text-[11px] text-white/70 font-bold leading-relaxed">
                              {deepAnalysisStock.chartPattern.description}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Technical Details */}
                      <div className="mt-8 space-y-4">
                        {deepAnalysisStock.technicalSignals?.macdHistogramDetail && (
                          <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-inner">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className={cn("w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]", 
                                  deepAnalysisStock.technicalSignals.macdHistogramDetail.status === 'BULLISH' ? 'bg-green-500 shadow-green-500/50' : 
                                  deepAnalysisStock.technicalSignals.macdHistogramDetail.status === 'BEARISH' ? 'bg-red-500 shadow-red-500/50' : 'bg-gray-400'
                                )} />
                                <span className="text-xs font-black text-white/60 uppercase tracking-widest">MACD Histogram</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-black text-white">{deepAnalysisStock.technicalSignals.macdHistogram?.toFixed(2) || 'N/A'}</span>
                                <span className={cn("text-[10px] px-2 py-1 rounded-md font-black tracking-widest",
                                  deepAnalysisStock.technicalSignals.macdHistogramDetail.status === 'BULLISH' ? 'bg-green-500/20 text-green-400' : 
                                  deepAnalysisStock.technicalSignals.macdHistogramDetail.status === 'BEARISH' ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/60'
                                )}>
                                  {deepAnalysisStock.technicalSignals.macdHistogramDetail.status}
                                </span>
                              </div>
                            </div>
                            <p className="text-sm text-white/80 leading-relaxed font-bold bg-black/20 p-3 rounded-xl border border-white/5 break-words">
                              {deepAnalysisStock.technicalSignals.macdHistogramDetail.implication}
                            </p>
                          </div>
                        )}

                        {deepAnalysisStock.technicalSignals?.bbWidthDetail && (
                          <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-inner">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className={cn("w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]", 
                                  deepAnalysisStock.technicalSignals.bbWidthDetail.status === 'EXPANSION' ? 'bg-orange-500 shadow-orange-500/50' : 
                                  deepAnalysisStock.technicalSignals.bbWidthDetail.status === 'SQUEEZE' ? 'bg-blue-500 shadow-blue-500/50' : 'bg-gray-400'
                                )} />
                                <span className="text-xs font-black text-white/60 uppercase tracking-widest">Bollinger Band Width</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-black text-white">{deepAnalysisStock.technicalSignals.bbWidth?.toFixed(3) || 'N/A'}</span>
                                <span className={cn("text-[10px] px-2 py-1 rounded-md font-black tracking-widest",
                                  deepAnalysisStock.technicalSignals.bbWidthDetail.status === 'EXPANSION' ? 'bg-orange-500/20 text-orange-400' : 
                                  deepAnalysisStock.technicalSignals.bbWidthDetail.status === 'SQUEEZE' ? 'bg-blue-500/20 text-blue-400' : 'bg-white/10 text-white/60'
                                )}>
                                  {deepAnalysisStock.technicalSignals.bbWidthDetail.status}
                                </span>
                              </div>
                            </div>
                            <p className="text-sm text-white/80 leading-relaxed font-bold bg-black/20 p-3 rounded-xl border border-white/5 break-words">
                              {deepAnalysisStock.technicalSignals.bbWidthDetail.implication}
                            </p>
                          </div>
                        )}

                        {deepAnalysisStock.technicalSignals?.stochRsiDetail && (
                          <div className="bg-white/5 p-5 rounded-3xl border border-white/10 shadow-inner">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className={cn("w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]", 
                                  deepAnalysisStock.technicalSignals.stochRsiDetail.status === 'OVERBOUGHT' ? 'bg-red-500 shadow-red-500/50' : 
                                  deepAnalysisStock.technicalSignals.stochRsiDetail.status === 'OVERSOLD' ? 'bg-green-500 shadow-green-500/50' : 'bg-gray-400'
                                )} />
                                <span className="text-xs font-black text-white/60 uppercase tracking-widest">Stochastic RSI</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-black text-white">{deepAnalysisStock.technicalSignals.stochRsi?.toFixed(2) || 'N/A'}</span>
                                <span className={cn("text-[10px] px-2 py-1 rounded-md font-black tracking-widest",
                                  deepAnalysisStock.technicalSignals.stochRsiDetail.status === 'OVERBOUGHT' ? 'bg-red-500/20 text-red-400' : 
                                  deepAnalysisStock.technicalSignals.stochRsiDetail.status === 'OVERSOLD' ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/60'
                                )}>
                                  {deepAnalysisStock.technicalSignals.stochRsiDetail.status}
                                </span>
                              </div>
                            </div>
                            <p className="text-sm text-white/80 leading-relaxed font-bold bg-black/20 p-3 rounded-xl border border-white/5 break-words">
                              {deepAnalysisStock.technicalSignals.stochRsiDetail.implication}
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
                        {deepAnalysisStock.elliottWaveStatus ? (
                          <div className="space-y-4">
                            <div className="inline-block px-4 py-1.5 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-black">
                              {(deepAnalysisStock.elliottWaveStatus.wave || '').replace('_', ' ')}
                            </div>
                            <p className="text-sm text-white/70 leading-relaxed font-bold italic break-words">
                              "{deepAnalysisStock.elliottWaveStatus.description}"
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
                        {deepAnalysisStock.chartPattern ? (
                          <div className="space-y-6">
                            <div className="flex items-center justify-between">
                              <div className={cn(
                                "px-4 py-1.5 rounded-full text-xs font-black border",
                                (deepAnalysisStock.chartPattern.type || '').includes('BULLISH') ? "bg-green-500/20 text-green-400 border-green-500/30" :
                                (deepAnalysisStock.chartPattern.type || '').includes('BEARISH') ? "bg-red-500/20 text-red-400 border-red-500/30" :
                                "bg-blue-500/20 text-blue-400 border-blue-500/30"
                              )}>
                                {deepAnalysisStock.chartPattern.name} ({(deepAnalysisStock.chartPattern.type || '').replace('_', ' ')})
                              </div>
                              <div className="flex flex-col items-end">
                                <span className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-1">Reliability</span>
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                                    <div 
                                      className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" 
                                      style={{ width: `${deepAnalysisStock.chartPattern.reliability}%` }} 
                                    />
                                  </div>
                                  <span className="text-xs font-black text-white">{deepAnalysisStock.chartPattern.reliability}%</span>
                                </div>
                              </div>
                            </div>
                            <div className="bg-black/20 p-5 rounded-3xl border border-white/5">
                              <p className="text-sm text-white/80 leading-relaxed font-bold italic">
                                "{deepAnalysisStock.chartPattern.description}"
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
                        {deepAnalysisStock.strategicInsight ? (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">Cycle Position</span>
                              <span className={cn("text-xs font-black px-2 py-0.5 rounded-md",
                                deepAnalysisStock.strategicInsight.cyclePosition === 'NEW_LEADER' ? 'bg-green-500/20 text-green-400' :
                                deepAnalysisStock.strategicInsight.cyclePosition === 'MATURING' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                              )}>
                                {(deepAnalysisStock.strategicInsight.cyclePosition || '').replace('_', ' ')}
                              </span>
                            </div>
                            <div className="space-y-3">
                              <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                                <span className="text-[9px] font-black text-white/30 uppercase block mb-1">Earnings Quality</span>
                                <p className="text-xs text-white/70 font-bold leading-relaxed">{deepAnalysisStock.strategicInsight.earningsQuality}</p>
                              </div>
                              <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                                <span className="text-[9px] font-black text-white/30 uppercase block mb-1">Policy Context</span>
                                <p className="text-xs text-white/70 font-bold leading-relaxed">{deepAnalysisStock.strategicInsight.policyContext}</p>
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
                            <span className="text-2xl font-black text-white">{deepAnalysisStock.valuation?.per}x</span>
                          </div>
                        </div>

                        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">P/B Ratio (PBR)</span>
                              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">주가순자산비율: 자산 가치 대비 주가 (1미만 시 장부가 미달)</p>
                            </div>
                            <span className="text-2xl font-black text-white">{deepAnalysisStock.valuation?.pbr}x</span>
                          </div>
                        </div>

                        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">EPS Growth</span>
                              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">주당순이익 성장률: 기업의 수익성 성장 속도</p>
                            </div>
                            <span className="text-2xl font-black text-green-400">+{deepAnalysisStock.valuation?.epsGrowth}%</span>
                          </div>
                        </div>

                        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 group/fund hover:bg-white/10 transition-all">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] block mb-1">Debt Ratio</span>
                              <p className="text-[10px] text-white/40 font-bold leading-tight max-w-[200px]">부채비율: 재무 건전성 및 리스크 지표 (낮을수록 안전)</p>
                            </div>
                            <span className="text-2xl font-black text-white">{deepAnalysisStock.valuation?.debtRatio}%</span>
                          </div>
                        </div>

                        {deepAnalysisStock.economicMoat && (
                          <div className="bg-blue-500/5 p-5 rounded-3xl border border-blue-500/10 group/moat hover:bg-blue-500/10 transition-all">
                            <div className="flex items-center gap-3 mb-2">
                              <ShieldCheck className="w-4 h-4 text-blue-400" />
                              <span className="text-[10px] font-black text-blue-400/60 uppercase tracking-widest">Economic Moat: {deepAnalysisStock.economicMoat.type}</span>
                            </div>
                            <p className="text-xs text-white/70 font-bold leading-relaxed">
                              {deepAnalysisStock.economicMoat.description}
                            </p>
                          </div>
                        )}
                      </div>

                      {deepAnalysisStock?.roeAnalysis ? (
                        <div className="space-y-4 border-t border-white/5 pt-6">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">ROE Analysis & DuPont</span>
                            <span className="text-xs font-black text-orange-400">{deepAnalysisStock.roeType}</span>
                          </div>
                          
                          <div className="grid grid-cols-1 gap-3">
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                              <span className="text-[9px] font-black text-white/30 uppercase block mb-2">Historical Trend</span>
                              <p className="text-xs text-white/70 font-bold leading-relaxed">{deepAnalysisStock.roeAnalysis.historicalTrend}</p>
                            </div>
                            
                            <div className="grid grid-cols-3 gap-2">
                              <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                                <span className="text-[8px] font-black text-white/20 uppercase block mb-1">Margin</span>
                                <span className="text-xs font-black text-white">{(deepAnalysisStock.roeAnalysis.metrics.netProfitMargin * 100).toFixed(1)}%</span>
                              </div>
                              <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                                <span className="text-[8px] font-black text-white/20 uppercase block mb-1">Turnover</span>
                                <span className="text-xs font-black text-white">{deepAnalysisStock.roeAnalysis.metrics.assetTurnover.toFixed(2)}x</span>
                              </div>
                              <div className="bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                                <span className="text-[8px] font-black text-white/20 uppercase block mb-1">Leverage</span>
                                <span className="text-xs font-black text-white">{deepAnalysisStock.roeAnalysis.metrics.equityMultiplier.toFixed(2)}x</span>
                              </div>
                            </div>

                            <div className="bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10">
                              <span className="text-[9px] font-black text-orange-500/40 uppercase block mb-2">Strategic Drivers</span>
                              <div className="flex flex-wrap gap-2">
                                {(deepAnalysisStock.roeAnalysis.drivers || []).map((driver, i) => (
                                  <span key={i} className="text-[10px] px-2 py-1 rounded-md bg-orange-500/10 text-orange-400 font-black border border-orange-500/10">
                                    {driver}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="bg-orange-500/5 p-4 rounded-2xl border border-orange-500/10">
                              <span className="text-[9px] font-black text-orange-500/40 uppercase block mb-2">DuPont Strategy</span>
                              <p className="text-xs text-orange-500/80 font-bold leading-relaxed italic">{deepAnalysisStock.roeAnalysis.strategy}</p>
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
                            ₩{deepAnalysisStock.entryPrice?.toLocaleString() || deepAnalysisStock.currentPrice?.toLocaleString() || '---'}
                          </span>
                          {deepAnalysisStock.entryPrice2 && (
                            <span className="text-[10px] text-blue-400/50 block">~ ₩{deepAnalysisStock.entryPrice2.toLocaleString()}</span>
                          )}
                        </div>
                        <div className="bg-orange-500/10 rounded-2xl p-4 border border-orange-500/20 text-center">
                          <span className="text-[9px] font-black text-orange-400/60 uppercase tracking-widest block mb-1">Target</span>
                          <span className="text-lg font-black text-orange-400">
                            ₩{deepAnalysisStock.targetPrice?.toLocaleString() || '---'}
                          </span>
                          <span className="text-[10px] text-orange-400/50 block">
                            +{Math.round(((deepAnalysisStock.targetPrice || 0) / (deepAnalysisStock.currentPrice || 1) - 1) * 100)}%
                          </span>
                        </div>
                        <div className="bg-red-500/10 rounded-2xl p-4 border border-red-500/20 text-center">
                          <span className="text-[9px] font-black text-red-400/60 uppercase tracking-widest block mb-1">Stop</span>
                          <span className="text-lg font-black text-red-400">
                            ₩{deepAnalysisStock.stopLoss?.toLocaleString() || '---'}
                          </span>
                          <span className="text-[10px] text-red-400/50 block">
                            {Math.round(((deepAnalysisStock.stopLoss || 0) / (deepAnalysisStock.currentPrice || 1) - 1) * 100)}%
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
                      {deepAnalysisStock.analystRatings ? (
                        <div className="space-y-6">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-black text-white/60 uppercase tracking-widest">Consensus</span>
                            <span className={cn("text-sm px-3 py-1 rounded-full font-black tracking-widest",
                              (deepAnalysisStock.analystRatings.consensus?.toLowerCase().includes('buy') ?? false) ? 'bg-green-500/20 text-green-400' :
                              (deepAnalysisStock.analystRatings.consensus?.toLowerCase().includes('sell') ?? false) ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
                            )}>
                              {deepAnalysisStock.analystRatings.consensus}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                              <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Strong Buy</span>
                              <span className="text-xl font-black text-red-500">{deepAnalysisStock.analystRatings?.strongBuy}</span>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                              <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Buy</span>
                              <span className="text-xl font-black text-orange-400">{deepAnalysisStock.analystRatings?.buy}</span>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                              <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Strong Sell</span>
                              <span className="text-xl font-black text-blue-600">{deepAnalysisStock.analystRatings?.strongSell}</span>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center">
                              <span className="text-[10px] font-black text-white/40 uppercase block mb-1">Sell</span>
                              <span className="text-xl font-black text-blue-400">{deepAnalysisStock.analystRatings?.sell}</span>
                            </div>
                          </div>

                          <div className="bg-black/20 p-4 rounded-2xl border border-white/5">
                            <span className="text-[10px] font-black text-white/40 uppercase block mb-2">Target Price Range</span>
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-black text-white/60">₩{deepAnalysisStock.analystRatings?.targetPriceLow?.toLocaleString() || '0'}</span>
                              <div className="flex-1 h-1 bg-white/10 mx-4 rounded-full relative">
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-blue-400 rounded-full shadow-[0_0_10px_rgba(96,165,250,0.5)]" />
                              </div>
                              <span className="text-sm font-black text-white/60">₩{deepAnalysisStock.analystRatings?.targetPriceHigh?.toLocaleString() || '0'}</span>
                            </div>
                            <div className="text-center mt-2">
                              <span className="text-xs font-black text-blue-400">Avg: ₩{deepAnalysisStock.analystRatings?.targetPriceAvg?.toLocaleString() || '0'}</span>
                            </div>
                          </div>
                          
                          {deepAnalysisStock.analystSentiment && (
                            <p className="text-sm text-white/70 leading-relaxed font-bold italic border-l-2 border-blue-500/30 pl-4 break-words">
                              "{deepAnalysisStock.analystSentiment}"
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
                      {deepAnalysisStock.newsSentiment ? (
                        <div className="space-y-6">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-black text-white/60 uppercase tracking-widest">Status</span>
                            <span className={cn("text-sm px-3 py-1 rounded-full font-black tracking-widest flex items-center gap-2",
                              deepAnalysisStock.newsSentiment.status === 'POSITIVE' ? 'bg-emerald-500/20 text-emerald-400' :
                              deepAnalysisStock.newsSentiment.status === 'NEGATIVE' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
                            )}>
                              {deepAnalysisStock.newsSentiment.status === 'POSITIVE' && <TrendingUp className="w-4 h-4" />}
                              {deepAnalysisStock.newsSentiment.status === 'NEGATIVE' && <TrendingDown className="w-4 h-4" />}
                              {deepAnalysisStock.newsSentiment.status === 'NEUTRAL' && <Minus className="w-4 h-4" />}
                              {deepAnalysisStock.newsSentiment.status}
                            </span>
                          </div>

                          <div className="bg-black/20 p-6 rounded-3xl border border-white/5 relative overflow-hidden">
                            <div className="relative z-10 flex flex-col items-center">
                              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-2">Sentiment Score</span>
                              <div className="text-5xl font-black mb-2" style={{
                                color: deepAnalysisStock.newsSentiment.score >= 60 ? '#34d399' : deepAnalysisStock.newsSentiment.score <= 40 ? '#f87171' : '#9ca3af'
                              }}>
                                {deepAnalysisStock.newsSentiment.score}
                              </div>
                              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mt-4">
                                <div 
                                  className={cn("h-full rounded-full transition-all duration-1000",
                                    deepAnalysisStock.newsSentiment.score >= 60 ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]' : 
                                    deepAnalysisStock.newsSentiment.score <= 40 ? 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.5)]' : 'bg-gray-400'
                                  )}
                                  style={{ width: `${deepAnalysisStock.newsSentiment.score}%` }}
                                />
                              </div>
                            </div>
                            {/* Decorative background for score card */}
                            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                          </div>

                          <p className="text-sm text-white/80 leading-relaxed font-bold bg-white/5 p-5 rounded-2xl border border-white/5 break-words">
                            {deepAnalysisStock.newsSentiment.summary}
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
                        {(deepAnalysisStock.riskFactors || []).map((risk, idx) => (
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
                          {Object.values(deepAnalysisStock?.checklist || {}).filter(Boolean).length}
                          <span className="text-xl text-green-400/30">/27</span>
                        </div>
                        <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden border border-white/5">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${(Object.values(deepAnalysisStock?.checklist || {}).filter(Boolean).length / 27) * 100}%` }}
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
                                const value = deepAnalysisStock.checklist ? deepAnalysisStock.checklist[step.key as keyof typeof deepAnalysisStock.checklist] : 0;
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
                    onClick={() => setDeepAnalysisStock(null)}
                    className="px-8 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white/60 font-black text-sm transition-all border border-white/10 flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Close Analysis
                  </button>
                  <button 
                    onClick={() => {
                      if (!deepAnalysisStock) return;
                      const currentWatchlist = watchlist || [];
                      const isWatchlisted = currentWatchlist.some(s => s.code === deepAnalysisStock.code);
                      if (isWatchlisted) {
                        setWatchlist(currentWatchlist.filter(s => s.code !== deepAnalysisStock.code));
                      } else {
                        setWatchlist([...currentWatchlist, deepAnalysisStock]);
                      }
                    }}
                    className={cn(
                      "px-8 py-3 rounded-2xl font-black text-sm transition-all flex items-center gap-2",
                      (watchlist || []).some(s => s.code === deepAnalysisStock.code)
                        ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                        : "bg-orange-500 text-white shadow-[0_10px_20px_rgba(249,115,22,0.2)] hover:bg-orange-600"
                    )}
                  >
                    <Star className={cn("w-4 h-4", (watchlist || []).some(s => s.code === deepAnalysisStock.code) && "fill-red-400")} />
                    {(watchlist || []).some(s => s.code === deepAnalysisStock.code) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                  </button>
                </div>
                
                <div className="flex items-center gap-4 text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3" />
                    <span>Data Source: {deepAnalysisStock.dataSource || 'Institutional Feeds'}</span>
                  </div>
                  <div className="w-1 h-1 rounded-full bg-white/10" />
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3" />
                    <span>Last Updated: {deepAnalysisStock.priceUpdatedAt || new Date().toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

        {/* Export Report Section */}
        <div className="mt-16 mb-8 px-4">
          <div className="max-w-4xl mx-auto glass-3d rounded-[2.5rem] border border-white/10 p-8 md:p-12 shadow-2xl relative overflow-hidden">
            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-3 mb-4">
                  <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.5)]" />
                  <span className="text-xs font-black text-white/40 uppercase tracking-[0.3em]">Export Options</span>
                </div>
                <h2 className="text-3xl font-black text-white mb-4 tracking-tight uppercase">분석 리포트 내보내기</h2>
                <p className="text-sm text-white/40 font-bold leading-relaxed max-w-md">
                  QuantMaster Pro 분석 결과를 PDF 파일로 저장하거나 이메일로 즉시 전송하여 보관할 수 있습니다.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
                <button 
                  onClick={() => generatePDF()}
                  disabled={isGeneratingPDF || loading}
                  className="w-full sm:w-auto flex items-center justify-center gap-4 px-8 py-5 bg-white/5 hover:bg-blue-500/20 rounded-[1.5rem] transition-all disabled:opacity-50 active:scale-95 group/btn border border-white/5 hover:border-blue-500/30"
                  title="PDF 리포트 다운로드"
                >
                  <Download className={cn("w-6 h-6 text-white/40 group-hover/btn:text-blue-400 transition-colors", isGeneratingPDF && "animate-pulse text-blue-400")} />
                  <div className="text-left">
                    <span className="block text-[10px] font-black text-white/20 uppercase tracking-widest">Download</span>
                    <span className="text-sm font-black text-white group-hover/btn:text-blue-400 transition-colors uppercase tracking-widest">PDF Report</span>
                  </div>
                </button>

                <button 
                  onClick={() => {
                    if (!emailAddress && !localStorage.getItem('k-stock-email')) {
                      const email = prompt('리포트를 전송할 이메일 주소를 입력해주세요:', 'silverlh614@gmail.com');
                      if (email) {
                        setEmailAddress(email);

                        setTimeout(() => sendEmail(), 100);
                      }
                    } else {
                      sendEmail();
                    }
                  }}
                  disabled={isSendingEmail || loading}
                  className="w-full sm:w-auto flex items-center justify-center gap-4 px-8 py-5 bg-white/5 hover:bg-green-500/20 rounded-[1.5rem] transition-all disabled:opacity-50 active:scale-95 group/btn border border-white/5 hover:border-green-500/30"
                  title="이메일로 전송"
                >
                  <Mail className={cn("w-6 h-6 text-white/40 group-hover/btn:text-green-400 transition-colors", isSendingEmail && "animate-pulse text-green-400")} />
                  <div className="text-left">
                    <span className="block text-[10px] font-black text-white/20 uppercase tracking-widest">Send to</span>
                    <span className="text-sm font-black text-white group-hover/btn:text-green-400 transition-colors uppercase tracking-widest">Email</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Decorative background elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/5 blur-[100px] -mr-32 -mt-32" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-500/5 blur-[100px] -ml-32 -mb-32" />
          </div>
        </div>

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
