import { useRecommendationStore } from '../stores';

export function useWatchlistActions() {
  const { watchlist } = useRecommendationStore();

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

  return { isWatched, scrollToStock };
}
