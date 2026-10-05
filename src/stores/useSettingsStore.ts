// @responsibility useSettingsStore Zustand store
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type View =
  | 'DASHBOARD'
  | 'PAPER_OBSERVATIONS'
  | 'PAPER_STRATEGY'
  | 'PAPER_RESEARCH'
  | 'OPERATIONS'
  | 'MANUAL'
  | 'DISCOVER'
  | 'WATCHLIST'
  | 'BACKTEST'
  | 'MARKET'
  | 'WALK_FORWARD'
  | 'MANUAL_INPUT'
  | 'SCREENER'
  | 'SUBSCRIPTION'
  | 'TRADE_JOURNAL'
  | 'AUTO_TRADE'
  | 'PORTFOLIO_EXTRACT'
  | 'RECOMMENDATION_HISTORY'
  | 'MACRO_INTEL'
  | 'SHADOW_LEARNING'
  | 'PUBLIC_REPORT'
  | 'BLOG_EXPORT'
  | 'TELEGRAM_SUMMARY'
  | 'PAID_PREVIEW'
  | 'DIAGNOSTICS'
  | 'LEARNING_SANITY'
  | 'PROVIDER_HEALTH'
  | 'EXECUTION_TRACE'
  | 'RAW_SNAPSHOT';
export type ThemeMode = 'dark' | 'light' | 'high-contrast' | 'ocean' | 'forest';

/** Display density and last tab are retained for the active execution manager. */
export type ViewDensity = 'simple' | 'pro';
export type AutoTradeTabId = 'positions' | 'execution' | 'signals' | 'diagnostics';

interface SettingsState {
  view: View;
  setView: (view: View) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  autoTradeViewMode: ViewDensity;
  setAutoTradeViewMode: (mode: ViewDensity) => void;
  autoTradeActiveTab: AutoTradeTabId;
  setAutoTradeActiveTab: (tab: AutoTradeTabId) => void;
  sidebarDrawerOpen: boolean;
  setSidebarDrawerOpen: (open: boolean) => void;
  toggleSidebarDrawer: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      view: 'DASHBOARD',
      setView: (view) => set({ view }),
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      fontSize: 16,
      setFontSize: (fontSize) => set({ fontSize }),
      autoTradeViewMode: 'simple',
      setAutoTradeViewMode: (autoTradeViewMode) => set({ autoTradeViewMode }),
      autoTradeActiveTab: 'positions',
      setAutoTradeActiveTab: (autoTradeActiveTab) => set({ autoTradeActiveTab }),
      sidebarDrawerOpen: false,
      setSidebarDrawerOpen: (sidebarDrawerOpen) => set({ sidebarDrawerOpen }),
      toggleSidebarDrawer: () => set((state) => ({ sidebarDrawerOpen: !state.sidebarDrawerOpen })),
    }),
    {
      name: 'k-stock-settings',
      partialize: (state) => ({
        theme: state.theme,
        fontSize: state.fontSize,
        autoTradeViewMode: state.autoTradeViewMode,
        autoTradeActiveTab: state.autoTradeActiveTab,
      }),
    },
  ),
);
