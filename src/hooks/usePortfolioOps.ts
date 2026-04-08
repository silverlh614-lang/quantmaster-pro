import React from 'react';
import { toast } from 'sonner';
import { backtestPortfolio, parsePortfolioFile } from '../services/stockService';
import { useMarketStore, usePortfolioStore, useRecommendationStore, useSettingsStore } from '../stores';
import type { StockRecommendation, Portfolio } from '../services/stockService';

export function usePortfolioOps() {
  const {
    backtestPortfolioItems, setBacktestPortfolioItems,
    backtestResult, setBacktestResult,
    backtesting, setBacktesting,
    initialEquity, backtestYears,
    parsingFile, setParsingFile,
  } = useMarketStore();
  const { portfolios, setPortfolios, currentPortfolioId, setCurrentPortfolioId } = usePortfolioStore();
  const { setError } = useRecommendationStore();
  const { setView } = useSettingsStore();

  const addToBacktest = (stock: StockRecommendation) => {
    if ((backtestPortfolioItems || []).some(item => item.code === stock.code)) return;
    const currentTotalWeight = (backtestPortfolioItems || []).reduce((sum: number, item: any) => sum + item.weight, 0);
    const remainingWeight = Math.max(0, 100 - currentTotalWeight);
    setBacktestPortfolioItems([...(backtestPortfolioItems || []), { name: stock.name, code: stock.code, weight: Math.min(20, remainingWeight) }]);
    setView('BACKTEST');
  };

  const removeFromBacktest = (code: string) => {
    setBacktestPortfolioItems((backtestPortfolioItems || []).filter((item: any) => item.code !== code));
  };

  const updateWeight = (code: string, weight: number) => {
    setBacktestPortfolioItems((backtestPortfolioItems || []).map((item: any) => item.code === code ? { ...item, weight } : item));
  };

  const reorderPortfolioItems = (newItems: { name: string; code: string; weight: number }[]) => {
    setBacktestPortfolioItems(newItems);
  };

  const applyAIRecommendedWeights = () => {
    if (!backtestResult?.optimizationSuggestions) return;
    let newItems = [...(backtestPortfolioItems || [])];
    let removedCount = 0, updatedCount = 0;
    backtestResult.optimizationSuggestions.forEach((suggestion: any) => {
      const index = newItems.findIndex(item => item.name === suggestion.stock || suggestion.stock.includes(item.name) || item.name.includes(suggestion.stock));
      if (index !== -1) {
        if (suggestion.action === 'REMOVE') { newItems.splice(index, 1); removedCount++; }
        else { newItems[index] = { ...newItems[index], weight: suggestion.recommendedWeight }; updatedCount++; }
      }
    });
    setBacktestPortfolioItems(newItems);
    toast.success(`AI 최적화가 적용되었습니다: ${updatedCount}개 비중 조절, ${removedCount}개 종목 제외`);
  };

  const savePortfolio = (name: string, description?: string) => {
    const newPortfolio: Portfolio = { id: crypto.randomUUID(), name, description, items: [...backtestPortfolioItems], createdAt: new Date().toISOString(), lastBacktestResult: backtestResult };
    setPortfolios((prev: Portfolio[]) => [...(prev || []), newPortfolio]);
    setCurrentPortfolioId(newPortfolio.id);
    toast.success('Portfolio saved successfully');
  };

  const selectPortfolio = (id: string) => {
    const portfolio = (portfolios || []).find(p => p.id === id);
    if (portfolio) { setBacktestPortfolioItems(portfolio.items); setBacktestResult(portfolio.lastBacktestResult || null); setCurrentPortfolioId(id); toast.info(`Loaded portfolio: ${portfolio.name}`); }
  };

  const deletePortfolio = (id: string) => {
    setPortfolios((prev: Portfolio[]) => (prev || []).filter(p => p.id !== id));
    if (currentPortfolioId === id) setCurrentPortfolioId(null);
    toast.error('Portfolio deleted');
  };

  const updatePortfolio = (id: string, name: string, description?: string) => {
    setPortfolios((prev: Portfolio[]) => (prev || []).map(p => p.id === id ? { ...p, name, description } : p));
    toast.success('Portfolio updated');
  };

  const runBacktest = async () => {
    const totalWeight = (backtestPortfolioItems || []).reduce((sum: number, item: any) => sum + item.weight, 0);
    if (totalWeight !== 100) { toast.warning('포트폴리오 비중의 합이 100%여야 합니다.'); return; }
    setBacktesting(true); setError(null);
    try {
      const result = await backtestPortfolio(backtestPortfolioItems, initialEquity, backtestYears);
      setBacktestResult(result);
      if (currentPortfolioId) setPortfolios((prev: Portfolio[]) => (prev || []).map(p => p.id === currentPortfolioId ? { ...p, lastBacktestResult: result } : p));
      toast.success('백테스팅 시뮬레이션 완료');
    } catch (err: any) {
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const isRateLimit = message.includes('429') || errObj?.status === 429;
      if (isRateLimit) { setError('API 할당량이 초과되었습니다.'); toast.error('API 할당량 초과'); }
      else { setError(message || '백테스팅 수행 중 오류가 발생했습니다.'); toast.error('백테스팅 실패'); }
    } finally { setBacktesting(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setParsingFile(true); setError(null);
    try {
      const text = await file.text();
      const items = await parsePortfolioFile(text);
      if (items.length > 0) setBacktestPortfolioItems(items);
      else toast.error('포트폴리오 정보를 추출하지 못했습니다.');
    } catch (err: any) {
      const message = err?.error?.message || err?.message || "";
      setError(message || '파일을 읽는 중 오류가 발생했습니다.');
      toast.error('파일 읽기 실패');
    } finally { setParsingFile(false); e.target.value = ''; }
  };

  return {
    addToBacktest, removeFromBacktest, updateWeight, reorderPortfolioItems,
    applyAIRecommendedWeights, savePortfolio, selectPortfolio, deletePortfolio,
    updatePortfolio, runBacktest, handleFileUpload,
  };
}
