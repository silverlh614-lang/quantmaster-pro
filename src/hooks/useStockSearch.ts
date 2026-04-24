import { useState } from 'react';
import { toast } from 'sonner';
import { getStockRecommendations, searchStock, clearSearchCache, getNewsFrequencyScores, StockFilters } from '../services/stockService';
import { useRecommendationStore, useMarketStore, useGlobalIntelStore } from '../stores';
import type { StockRecommendation } from '../services/stockService';

export function useStockSearch() {
  const {
    recommendations, setRecommendations,
    searchResults, setSearchResults,
    screenerRecommendations, setScreenerRecommendations,
    filters, searchQuery,
    selectedType, selectedPattern, selectedSentiment, selectedChecklist,
    minPrice, maxPrice,
    loading, setLoading,
    setLastUsedMode, setLastUpdated, setError,
    recommendationHistory, setRecommendationHistory,
    searchingSpecific, setSearchingSpecific,
  } = useRecommendationStore();
  const { setMarketContext } = useMarketStore();
  const { setNewsFrequencyScores } = useGlobalIntelStore();

  const [loadingNews, setLoadingNews] = useState(false);

  const fetchStocks = async () => {
    setLoading(true); setSearchResults([]); setRecommendations([]); setError(null);
    try {
      const data = await getStockRecommendations(filters);
      if (!data || !data.recommendations) throw new Error("AI 추천 데이터를 불러오지 못했습니다.");
      const avgConfidence = data.recommendations.length > 0 ? Math.round(data.recommendations.reduce((sum: number, s: StockRecommendation) => sum + s.confidenceScore, 0) / data.recommendations.length) : 75;
      const newHistoryItem = { date: new Date().toLocaleDateString(), stocks: data.recommendations.map((s: StockRecommendation) => s.name), hitRate: avgConfidence, strongBuyHitRate: Math.min(99, avgConfidence + 5) };
      const updatedHistory = [newHistoryItem, ...recommendationHistory].slice(0, 10);
      setRecommendationHistory(updatedHistory);
      localStorage.setItem('quant-master-history', JSON.stringify(updatedHistory));
      const diversified = (data.recommendations || []).reduce((acc: StockRecommendation[], current: StockRecommendation) => {
        const primarySector = current.relatedSectors?.[0] || '기타';
        const existingInSector = acc.find(s => (s.relatedSectors?.[0] || '기타') === primarySector);
        if (!existingInSector) acc.push({ ...current, isSectorTopPick: true });
        else if (current.confidenceScore > existingInSector.confidenceScore) { const index = acc.indexOf(existingInSector); acc[index] = { ...current, isSectorTopPick: true }; }
        return acc;
      }, []);
      const lastMode = filters.mode === 'BEAR_SCREEN' || filters.mode === 'SMALL_MID_CAP' ? 'QUANT_SCREEN' : (filters.mode || 'MOMENTUM');
      setLastUsedMode(lastMode);
      setRecommendations(diversified);
      setMarketContext(data.marketContext);
      setLastUpdated(new Date().toISOString());
      const warnings = Array.isArray((data as { warnings?: string[] }).warnings)
        ? ((data as { warnings?: string[] }).warnings ?? [])
        : [];
      for (const w of warnings) toast.warning(w, { duration: 8000 });
      if (diversified.length === 0) {
        toast.info(warnings.length > 0 ? '추천 결과 없음 — 위 안내를 확인하세요.' : '추천 종목이 없습니다.');
      } else {
        toast.success('검색이 완료되었습니다.');
      }
    } catch (err: any) {
      const message = err?.error?.message || err?.message || "";
      const isRateLimit = message.includes('429') || err?.status === 429;
      if (isRateLimit) { setError('API 할당량이 초과되었습니다.'); toast.error('API 할당량 초과'); }
      else { setError(message || '데이터를 가져오는 중 오류가 발생했습니다.'); toast.error('데이터 로드 실패'); }
    } finally { setLoading(false); }
  };

  const handleMarketSearch = async () => {
    setSearchingSpecific(true); setSearchResults([]); setError(null);
    clearSearchCache();
    try {
      const results = await searchStock(searchQuery, { type: selectedType, pattern: selectedPattern, sentiment: selectedSentiment, checklist: selectedChecklist, minPrice, maxPrice });
      if (results && results.length > 0) {
        setSearchResults((prev: StockRecommendation[]) => {
          if (!searchQuery.trim()) return results.slice(0, 10);
          const filteredPrev = (prev || []).filter(s => !results.some(r => r.code === s.code));
          const newResults = (results || []).filter(result => ![...(recommendations || [])].some(s => s.code === result.code));
          return [...newResults, ...filteredPrev];
        });
        toast.success(searchQuery.trim() ? '검색이 완료되었습니다.' : '시장 분석을 통해 유망 종목을 찾았습니다.');
      } else { toast.error(searchQuery.trim() ? '종목을 찾을 수 없습니다.' : '유망 종목을 찾지 못했습니다.'); }
    } catch (err: any) {
      const message = err?.error?.message || err?.message || "";
      const isRateLimit = message.includes('429') || err?.status === 429;
      if (isRateLimit) { setError('API 할당량이 초과되었습니다.'); toast.error('API 할당량 초과'); }
      else { setError(message || '종목 검색 중 오류가 발생했습니다.'); toast.error('검색 실패'); }
    } finally { setSearchingSpecific(false); }
  };

  const handleScreener = async (newFilters: StockFilters) => {
    setLoading(true); setError(null);
    try {
      const result = await getStockRecommendations(newFilters);
      if (result) { setScreenerRecommendations(result.recommendations); toast.success(`${result.recommendations.length}개 종목이 스크리닝되었습니다.`); }
    } catch (err) { setError(err instanceof Error ? err.message : '스크리닝 중 오류가 발생했습니다.'); toast.error('스크리닝 실패'); }
    finally { setLoading(false); }
  };

  const handleFetchNewsScores = async () => {
    if (recommendations.length === 0) return;
    setLoadingNews(true);
    try {
      const scores = await getNewsFrequencyScores(recommendations.map(s => ({ code: s.code, name: s.name })));
      setNewsFrequencyScores(scores);
      toast.success('뉴스 빈도 분석 완료');
    } catch { toast.error('뉴스 분석 실패'); }
    finally { setLoadingNews(false); }
  };

  return { fetchStocks, handleMarketSearch, handleScreener, handleFetchNewsScores, loadingNews };
}
