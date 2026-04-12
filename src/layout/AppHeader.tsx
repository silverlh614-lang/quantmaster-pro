/**
 * AppHeader — Now a minimal mobile-only top bar (desktop uses Sidebar).
 * Shows logo + last update time on mobile. Navigation handled by BottomNav.
 */
import React from 'react';
import { Zap, Settings } from 'lucide-react';
import { useSettingsStore, useRecommendationStore, useMarketStore } from '../stores';

export function AppHeader() {
  const { setView, setShowSettings } = useSettingsStore();
  const { setSearchQuery, lastUpdated } = useRecommendationStore();
  const { syncStatus } = useMarketStore();

  // This header is only rendered on mobile via BottomNav (Sidebar handles desktop).
  // Kept as a minimal export for backward compatibility but no longer rendered in App.tsx.
  return null;
}
