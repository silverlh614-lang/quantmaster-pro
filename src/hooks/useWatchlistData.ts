import { useMemo, useEffect } from 'react';
import {
  useRecommendationStore, useSettingsStore, useMarketStore,
  useAnalysisStore, useTradeStore, useGlobalIntelStore,
} from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import { useCopiedCode } from './useCopiedCode';
import { evaluateGate0 } from '../services/quantEngine';
import { fetchHistoricalData } from '../services/stockService';
import { calculateRSIMomentumAcceleration } from '../utils/indicators';
import { getRadarData } from '../utils/radarData';
import { ROE_TYPE_DETAILS, getRoeDetail } from '../constants/roeTypes';

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
      } catch { /* 실패 시 기본값 유지 */ }
    })();
    return () => { cancelled = true; };
  }, [deepAnalysisStock?.code]);

  const gate0Result = useMemo(() => macroEnv ? evaluateGate0(macroEnv) : undefined, [macroEnv]);

  const roeTypeDetails = ROE_TYPE_DETAILS;

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
