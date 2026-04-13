import { useMemo, useEffect } from 'react';
import {
  useRecommendationStore, useSettingsStore, useMarketStore,
  useAnalysisStore, useTradeStore, useGlobalIntelStore,
} from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import { useCopiedCode } from './useCopiedCode';
import { evaluateGate0 } from '../services/quant/macroEngine';
import { fetchHistoricalData } from '../services/stockService';
import { debugWarn } from '../utils/debug';
import type { StockRecommendation } from '../services/stockService';
import { calculateRSIMomentumAcceleration } from '../utils/indicators';

export function useWatchlistData() {
  const {
    recommendations, watchlist, searchResults,
    loading, lastUpdated, error, setError, searchingSpecific,
    lastUsedMode, recommendationHistory,
  } = useRecommendationStore();

  const {
    view, setView, autoSyncEnabled, setAutoSyncEnabled,
    showMasterChecklist, setShowMasterChecklist,
    emailAddress, setEmailAddress,
  } = useSettingsStore();

  const { marketOverview, marketContext, syncStatus, syncingStock, nextSyncCountdown } = useMarketStore();

  const {
    deepAnalysisStock, setDeepAnalysisStock, setSelectedDetailStock,
    weeklyRsiValues, setWeeklyRsiValues, reportSummary, setReportSummary,
    isSummarizing, isGeneratingPDF, isExportingDeepAnalysis, isSendingEmail,
  } = useAnalysisStore();

  const {
    tradeRecordStock, setTradeRecordStock, tradeFormData, setTradeFormData,
  } = useTradeStore();

  const globalIntelStore = useGlobalIntelStore();
  const macroEnv = globalIntelStore.macroEnv;
  const newsFrequencyScores = globalIntelStore.newsFrequencyScores;
  const currentRoeType = globalIntelStore.currentRoeType;
  const exportRatio = globalIntelStore.exportRatio;

  const { addShadowTrade } = useShadowTradeStore();
  const { copiedCode, handleCopy } = useCopiedCode();

  // ── 주봉 RSI 3주 추이 계산 ──────────────────────────────────────────────
  useEffect(() => {
    if (!deepAnalysisStock) { setWeeklyRsiValues([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchHistoricalData(deepAnalysisStock.code, '6mo', '1wk');
        if (cancelled || !data?.indicators?.quote?.[0]) return;
        const closes = (data.indicators.quote[0].close as (number | null)[]).filter((v): v is number => v !== null);
        if (closes.length < 17) return;
        const { values } = calculateRSIMomentumAcceleration(closes, 3);
        if (!cancelled) setWeeklyRsiValues(values);
      } catch (err) { debugWarn(`[RSI 계산] ${deepAnalysisStock.code} 실패`, err); }
    })();
    return () => { cancelled = true; };
  }, [deepAnalysisStock?.code]);

  const gate0Result = useMemo(() => macroEnv ? evaluateGate0(macroEnv) : undefined, [macroEnv]);

  const roeTypeDetails: Record<string, any> = {
    '유형 1': { title: '유형 1 (ROE 개선)', desc: 'ROE가 전년 대비 개선되는 기업. 턴어라운드 초기 단계.', metrics: '순이익률 개선, 비용 절감, 자산 효율화', trend: '하락 추세 멈춤 → 횡보 → 상승 반전의 초기 국면', strategy: '추세 전환 확인 후 분할 매수, 손절가 엄격 준수', detailedStrategy: '1차 매수는 비중의 30%로 시작, 20일 이평선 안착 시 추가 매수. 실적 턴어라운드 확인 필수.', color: 'text-blue-400' },
    '유형 2': { title: '유형 2 (ROE 고성장)', desc: 'ROE가 15% 이상 유지되는 고성장 기업. 안정적 수익성.', metrics: '높은 시장 점유율, 독점적 지위, 꾸준한 현금 흐름', trend: '장기 우상향 추세, 일시적 조정 후 재상승 반복', strategy: '눌림목 매수, 장기 보유, 실적 발표 주기 확인', detailedStrategy: '주요 지지선(60일/120일 이평선) 터치 시 비중 확대. 배당 성향 및 자사주 매입 여부 체크.', color: 'text-green-400' },
    '유형 3': { title: '유형 3 (최우선 매수)', desc: '매출과 이익이 함께 증가하며 ROE가 개선되는 최우선 매수 대상.', metrics: '매출 성장률 > 이익 성장률, 자산 회전율 급증', trend: '가파른 상승 각도, 거래량 동반한 전고점 돌파', strategy: '공격적 비중 확대, 전고점 돌파 시 추가 매수', detailedStrategy: '추세 추종(Trend Following) 전략 적용. 익절가를 높여가며(Trailing Stop) 수익 극대화.', color: 'text-orange-400' },
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
      { name: '전략/심리', keys: ['mechanicalStop', 'psychologicalObjectivity', 'catalystAnalysis'] },
    ];
    return categories.map(cat => {
      const passed = cat.keys.filter(key => stock.checklist ? stock.checklist[key as keyof StockRecommendation['checklist']] : 0).length;
      const total = cat.keys.length;
      return { subject: cat.name, A: Math.round((passed / total) * 100), fullMark: 100 };
    });
  };

  return {
    recommendations,
    watchlist,
    searchResults,
    loading,
    lastUpdated,
    error,
    setError,
    searchingSpecific,
    lastUsedMode,
    recommendationHistory,
    view,
    setView,
    autoSyncEnabled,
    setAutoSyncEnabled,
    showMasterChecklist,
    setShowMasterChecklist,
    emailAddress,
    setEmailAddress,
    marketOverview,
    marketContext,
    syncStatus,
    syncingStock,
    nextSyncCountdown,
    deepAnalysisStock,
    setDeepAnalysisStock,
    setSelectedDetailStock,
    weeklyRsiValues,
    reportSummary,
    setReportSummary,
    isSummarizing,
    isGeneratingPDF,
    isExportingDeepAnalysis,
    isSendingEmail,
    tradeRecordStock,
    setTradeRecordStock,
    tradeFormData,
    setTradeFormData,
    macroEnv,
    newsFrequencyScores,
    currentRoeType,
    exportRatio,
    addShadowTrade,
    copiedCode,
    handleCopy,
    gate0Result,
    roeTypeDetails,
    getRoeDetail,
    getRadarData,
  };
}
