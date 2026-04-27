// @responsibility useSettingsStore Zustand store
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type View = 'DISCOVER' | 'WATCHLIST' | 'BACKTEST' | 'MARKET' | 'WALK_FORWARD' | 'MANUAL_INPUT' | 'SCREENER' | 'SUBSCRIPTION' | 'TRADE_JOURNAL' | 'AUTO_TRADE' | 'PORTFOLIO_EXTRACT' | 'RECOMMENDATION_HISTORY' | 'MACRO_INTEL';
export type ThemeMode = 'dark' | 'light' | 'high-contrast' | 'ocean' | 'forest';
/**
 * 점진적 공개(Progressive disclosure) 모드.
 *  - `simple`: 핵심 KPI + 주요 2개 패널만 표시 (초심자/급하게 확인할 때).
 *  - `pro`: 전체 진단·이벤트 로그·히트맵까지 탭으로 노출 (프로 운영).
 */
export type ViewDensity = 'simple' | 'pro';

/**
 * 자동매매 관제실 탭 ID.
 *   - simple 모드에선 'positions' · 'execution' 만 유효.
 *   - pro 모드에선 모두 유효.
 * 페이지 재진입 후에도 마지막 탭을 유지하기 위해 store 에 영속.
 */
export type AutoTradeTabId = 'positions' | 'execution' | 'signals' | 'diagnostics';

interface SettingsState {
  // Navigation
  view: View;
  setView: (view: View) => void;

  // Theme & Display
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  fontSize: number;
  setFontSize: (size: number) => void;

  // User Credentials
  userApiKey: string;
  setUserApiKey: (key: string) => void;
  emailAddress: string;
  setEmailAddress: (email: string) => void;

  // Sync
  autoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;

  // PR-C (ADR-0030) — 가격 알림 watcher opt-in
  priceAlertsEnabled: boolean;
  setPriceAlertsEnabled: (enabled: boolean) => void;

  // Sector Subscriptions
  subscribedSectors: string[];
  addSector: (sector: string) => void;
  removeSector: (sector: string) => void;
  setSubscribedSectors: (sectors: string[]) => void;

  // UI Modals
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  showMasterChecklist: boolean;
  setShowMasterChecklist: (show: boolean) => void;
  showEmailModal: boolean;
  setShowEmailModal: (show: boolean) => void;

  // UI Panels
  isFilterExpanded: boolean;
  setIsFilterExpanded: (expanded: boolean) => void;

  // Progressive disclosure — 페이지별 간단/프로 모드
  autoTradeViewMode: ViewDensity;
  setAutoTradeViewMode: (mode: ViewDensity) => void;

  // 자동매매 관제실 활성 탭 (영속)
  autoTradeActiveTab: AutoTradeTabId;
  setAutoTradeActiveTab: (tab: AutoTradeTabId) => void;

  // Responsive sidebar drawer (<lg 화면) — 휘발성, persist X
  sidebarDrawerOpen: boolean;
  setSidebarDrawerOpen: (open: boolean) => void;
  toggleSidebarDrawer: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Navigation
      view: 'DISCOVER',
      setView: (view) => set({ view }),

      // Theme & Display
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      fontSize: 16,
      setFontSize: (fontSize) => set({ fontSize }),

      // User Credentials
      userApiKey: '',
      setUserApiKey: (userApiKey) => set({ userApiKey }),
      emailAddress: '',
      setEmailAddress: (emailAddress) => set({ emailAddress }),

      // Sync
      autoSyncEnabled: false,
      setAutoSyncEnabled: (autoSyncEnabled) => set({ autoSyncEnabled }),

      // PR-C (ADR-0030) — 가격 알림 opt-in (기본 false)
      priceAlertsEnabled: false,
      setPriceAlertsEnabled: (priceAlertsEnabled) => set({ priceAlertsEnabled }),

      // Sector Subscriptions — 기본값은 빈 배열. 사용자가 직접 선택/저장한다.
      subscribedSectors: [],
      addSector: (sector) => set((state) => ({
        subscribedSectors: state.subscribedSectors.includes(sector)
          ? state.subscribedSectors
          : [...state.subscribedSectors, sector],
      })),
      removeSector: (sector) => set((state) => ({
        subscribedSectors: state.subscribedSectors.filter((s) => s !== sector),
      })),
      setSubscribedSectors: (subscribedSectors) => set({ subscribedSectors }),

      // UI Modals
      showSettings: false,
      setShowSettings: (showSettings) => set({ showSettings }),
      showMasterChecklist: false,
      setShowMasterChecklist: (showMasterChecklist) => set({ showMasterChecklist }),
      showEmailModal: false,
      setShowEmailModal: (showEmailModal) => set({ showEmailModal }),

      // UI Panels
      isFilterExpanded: true,
      setIsFilterExpanded: (isFilterExpanded) => set({ isFilterExpanded }),

      // Progressive disclosure
      autoTradeViewMode: 'simple',
      setAutoTradeViewMode: (autoTradeViewMode) => set({ autoTradeViewMode }),

      // 자동매매 활성 탭
      autoTradeActiveTab: 'positions',
      setAutoTradeActiveTab: (autoTradeActiveTab) => set({ autoTradeActiveTab }),

      // Responsive sidebar drawer
      sidebarDrawerOpen: false,
      setSidebarDrawerOpen: (sidebarDrawerOpen) => set({ sidebarDrawerOpen }),
      toggleSidebarDrawer: () =>
        set((state) => ({ sidebarDrawerOpen: !state.sidebarDrawerOpen })),
    }),
    {
      name: 'k-stock-settings',
      partialize: (state) => ({
        theme: state.theme,
        fontSize: state.fontSize,
        userApiKey: state.userApiKey,
        emailAddress: state.emailAddress,
        autoSyncEnabled: state.autoSyncEnabled,
        subscribedSectors: state.subscribedSectors,
        autoTradeViewMode: state.autoTradeViewMode,
        autoTradeActiveTab: state.autoTradeActiveTab,
      }),
    }
  )
);
