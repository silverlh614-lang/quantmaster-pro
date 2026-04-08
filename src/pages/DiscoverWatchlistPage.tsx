import React, { useState, useMemo, useRef } from 'react';
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
  Layers, Sun, Moon, Contrast, GripVertical, Calculator
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
import { QuantDashboard } from '../components/QuantDashboard';
import { ConfidenceBadge } from '../components/ConfidenceBadge';
import { PriceEditCell } from '../components/PriceEditCell';
import { CandleChart } from '../components/CandleChart';
import { HeroChecklist } from '../components/HeroChecklist';
import { AnalysisViewToggle, AnalysisViewButtons } from '../components/AnalysisViewToggle';
import { useCopiedCode } from '../hooks/useCopiedCode';
import { evaluateStock, evaluateGate0 } from '../services/quantEngine';
import { buildShadowTrade } from '../services/autoTrading';
import {
  useRecommendationStore, useSettingsStore, useMarketStore,
  useAnalysisStore, useTradeStore, useGlobalIntelStore
} from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import type { StockRecommendation } from '../services/stockService';
import type {
  MarketRegime, SectorRotation, EuphoriaSignal, EmergencyStopSignal,
  StockProfile, StockProfileType, ROEType, Gate0Result, NewsFrequencyScore,
  ConditionId, TradeRecord
} from '../types/quant';

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
  onRecordTrade: (stock: StockRecommendation, buyPrice: number, quantity: number, positionSize: number, followedSystem: boolean, conditionScores: Record<ConditionId, number>, gateScores: { g1: number; g2: number; g3: number; final: number }) => void;
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
    emailAddress
  } = useSettingsStore();
  const { marketOverview, marketContext, syncStatus, syncingStock, nextSyncCountdown } = useMarketStore();
  const {
    deepAnalysisStock, setDeepAnalysisStock, setSelectedDetailStock,
    weeklyRsiValues, reportSummary, setReportSummary,
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

  const MASTER_CHECKLIST_STEPS = [
    { key: 'cycleVerified', title: "주도주 사이클 (Cycle)", desc: "현재 시장의 주도 섹터 및 사이클 부합 여부", icon: RefreshCw, gate: 1 },
    { key: 'roeType3', title: "ROE 유형 3 (ROE Type 3)", desc: "자산회전율과 마진이 동반 상승하는 고품질 성장", icon: BarChart3, gate: 1 },
    { key: 'riskOnEnvironment', title: "시장 환경 (Risk-On)", desc: "삼성 IRI 및 VKOSPI 기반 리스크 온 상태", icon: Zap, gate: 1 },
    { key: 'mechanicalStop', title: "기계적 손절 (-30%)", desc: "리스크 관리를 위한 엄격한 손절 원칙", icon: AlertTriangle, gate: 1 },
    { key: 'notPreviousLeader', title: "신규 주도주 (New Leader)", desc: "과거의 영광이 아닌 새로운 사이클의 주인공", icon: Star, gate: 1 },
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

  return (
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
                  onClick={onFetchStocks}
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
                onClick={onGenerateSummary}
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
                onClick={onFetchStocks}
                disabled={loading}
                className="p-2 bg-theme-card hover:bg-orange-500/20 border border-theme-border rounded-xl transition-all group/refresh active:scale-90"
                title="실시간 시세 새로고침"
              >
                <RefreshCw className={cn("w-4 h-4 text-theme-text-muted group-hover/refresh:text-orange-500", loading && "animate-spin")} />
              </button>

              <button
                onClick={onFetchNewsScores}
                disabled={loadingNews || recommendations.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-theme-card hover:bg-cyan-500/20 border border-theme-border rounded-xl transition-all text-xs font-bold active:scale-90"
                title="뉴스 빈도 역지표 분석"
              >
                <Newspaper className={cn("w-3.5 h-3.5 text-theme-text-muted", loadingNews && "animate-pulse text-cyan-400")} />
                <span className={cn("text-theme-text-muted", loadingNews && "text-cyan-400")}>
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
                        <div className="absolute left-0 top-6 w-80 max-h-[350px] overflow-y-auto p-4 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50 pointer-events-none">
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
                        onKeyDown={(e) => e.key === 'Enter' && onMarketSearch()}
                        className="w-full bg-black/40 border-2 border-white/5 rounded-2xl pl-12 pr-6 py-3.5 text-base font-black text-white placeholder:text-white/20 placeholder:text-sm focus:outline-none focus:border-orange-500/50 focus:ring-4 focus:ring-orange-500/10 focus:bg-black/60 transition-all shadow-inner relative z-0"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={onMarketSearch}
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
                                  {dartAlerts.some(a => a.stock_code.replace(/^A/, '') === stock.code) && (
                                    <div className="px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border bg-amber-500/20 text-amber-400 border-amber-500/30 shadow-lg backdrop-blur-md flex items-center gap-1"
                                      title={dartAlerts.filter(a => a.stock_code.replace(/^A/, '') === stock.code).map(a => a.report_nm).join(', ')}
                                    >
                                      <FileText className="w-3 h-3" />
                                      DART
                                    </div>
                                  )}
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
                              onClick={() => onAddToBacktest(stock)}
                              className="p-2 sm:p-2.5 rounded-xl sm:rounded-2xl transition-all border border-white/10 bg-white/5 text-white/30 hover:text-blue-400 hover:border-blue-500/30 hover:bg-blue-500/5 active:scale-90 shadow-sm"
                              title="Add to Backtest"
                            >
                              <History className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                            </button>
                            <button 
                              onClick={() => onToggleWatchlist(stock)}
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
                          onClick={onMarketSearch}
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
                  onClick={onExportDeepAnalysisPDF}
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
                  stockCode={deepAnalysisStock?.code}
                  stockName={deepAnalysisStock?.name}
                  currentPrice={deepAnalysisStock?.currentPrice}
                  onShadowTrade={(code, name, price) => {
                    const totalAssets = kisBalance;
                    const mockSignal = {
                      positionSize: deepAnalysisStock?.confidenceScore && deepAnalysisStock.confidenceScore >= 80 ? 20 : 10,
                      rrr: 2,
                      lastTrigger: deepAnalysisStock?.type === 'STRONG_BUY',
                      recommendation: deepAnalysisStock?.type === 'STRONG_BUY' ? '풀 포지션' : '절반 포지션',
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
                  onClick={() => onGeneratePDF()}
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

                        setTimeout(() => onSendEmail(), 100);
                      }
                    } else {
                      onSendEmail();
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
    </>
  );
}
