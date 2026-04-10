import React from 'react';
import {
  Search, Filter, RefreshCw, Globe, Newspaper, Settings, Info, X,
  ShieldCheck, ChevronDown, ChevronUp, ArrowUpDown, Bookmark, Lightbulb,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { StockRecommendation } from '../../services/stockService';
import type { StockFilters } from '../../services/stockService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const checklistLabels: Record<string, { label: string; description: string; gate: 1 | 2 | 3 }> = {
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
  catalystAnalysis: { label: "촉매제 분석 (Catalyst)", description: "확정 일정(30-60일), 핫 섹터 테마 연관성, DART 공시의 질(수주/소각 등) 기반 가산점 분석", gate: 3 },
};

export interface WatchlistFilterPanelProps {
  view: string;
  loading: boolean;
  loadingNews: boolean;
  searchingSpecific: boolean;
  recommendations: StockRecommendation[];
  searchResults: StockRecommendation[];
  allPatterns: string[];
  // filter state
  filters: StockFilters;
  setFilters: (filters: StockFilters | ((prev: StockFilters) => StockFilters)) => void;
  selectedType: string;
  setSelectedType: (v: string) => void;
  selectedPattern: string;
  setSelectedPattern: (v: string) => void;
  selectedSentiment: string;
  setSelectedSentiment: (v: string) => void;
  selectedChecklist: string[];
  setSelectedChecklist: (v: string[] | ((prev: string[]) => string[])) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  minPrice: string;
  setMinPrice: (v: string) => void;
  maxPrice: string;
  setMaxPrice: (v: string) => void;
  sortBy: string;
  setSortBy: (v: any) => void;
  isFilterExpanded: boolean;
  setIsFilterExpanded: (v: boolean) => void;
  hasActiveFilters: boolean;
  handleResetScreen: () => void;
  // action callbacks
  onFetchStocks: () => void;
  onFetchNewsScores: () => Promise<void>;
  onSyncAll: () => Promise<void>;
  onMarketSearch: () => Promise<void>;
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (v: boolean) => void;
  nextSyncCountdown: number;
  syncStatus: { isSyncing: boolean; progress: number; total: number; currentStock: string };
}

export function WatchlistFilterPanel({
  view,
  loading,
  loadingNews,
  searchingSpecific,
  recommendations,
  searchResults,
  allPatterns,
  filters,
  setFilters,
  selectedType,
  setSelectedType,
  selectedPattern,
  setSelectedPattern,
  selectedSentiment,
  setSelectedSentiment,
  selectedChecklist,
  setSelectedChecklist,
  searchQuery,
  setSearchQuery,
  minPrice,
  setMinPrice,
  maxPrice,
  setMaxPrice,
  sortBy,
  setSortBy,
  isFilterExpanded,
  setIsFilterExpanded,
  hasActiveFilters,
  handleResetScreen,
  onFetchStocks,
  onFetchNewsScores,
  onSyncAll,
  onMarketSearch,
  autoSyncEnabled,
  setAutoSyncEnabled,
  nextSyncCountdown,
  syncStatus,
}: WatchlistFilterPanelProps) {
  const hasSearchOrFilter = searchQuery || searchResults.length > 0 || selectedType !== 'ALL' || selectedPattern !== 'ALL' || selectedSentiment !== 'ALL' || selectedChecklist.length > 0 || minPrice !== '' || maxPrice !== '';

  return (
    <div className="flex flex-col gap-4">
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

        {/* Search & Filter Input */}
        <div className="flex flex-col gap-4 w-full">
          <div className="flex flex-wrap gap-6 items-end">
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
                          { label: "종합 확신도", desc: "27가지 체크리스트 기반 최고 점수 종목 엄선" },
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
                {hasSearchOrFilter && (
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
                    {hasActiveFilters && (
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
                          onChange={e => setFilters({ ...filters, minRoe: Number(e.target.value) })}
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
                          onChange={e => setFilters({ ...filters, maxPer: Number(e.target.value) })}
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
                          onChange={e => setFilters({ ...filters, maxDebtRatio: Number(e.target.value) })}
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
                          onChange={e => setFilters({ ...filters, minMarketCap: Number(e.target.value) })}
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

      {/* Filter Content */}
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
                      { id: 'RISK_OFF', label: 'Risk-Off' },
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
            ) : null}

            {/* Checklist Filter */}
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
    </div>
  );
}
