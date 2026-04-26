// @responsibility useWatchlistFilters React hook
import { useRecommendationStore } from '../stores';
import { useSettingsStore } from '../stores';

export function useWatchlistFilters() {
  const {
    filters, setFilters,
    selectedType, setSelectedType,
    selectedPattern, setSelectedPattern,
    selectedSentiment, setSelectedSentiment,
    selectedChecklist, setSelectedChecklist,
    searchQuery, setSearchQuery,
    minPrice, setMinPrice,
    maxPrice, setMaxPrice,
    sortBy, setSortBy,
    searchResults,
    setError,
  } = useRecommendationStore();

  const { isFilterExpanded, setIsFilterExpanded } = useSettingsStore();

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

  const hasActiveFilters =
    selectedType !== 'ALL' ||
    selectedPattern !== 'ALL' ||
    selectedSentiment !== 'ALL' ||
    selectedChecklist.length > 0 ||
    minPrice !== '' ||
    maxPrice !== '';

  return {
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
    searchResults,
    isFilterExpanded,
    setIsFilterExpanded,
    handleResetScreen,
    hasActiveFilters,
  };
}
