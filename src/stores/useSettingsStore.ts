import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type View = 'DISCOVER' | 'WATCHLIST' | 'BACKTEST' | 'MARKET' | 'WALK_FORWARD' | 'MANUAL_INPUT' | 'SCREENER' | 'SUBSCRIPTION' | 'TRADE_JOURNAL' | 'AUTO_TRADE';

interface SettingsState {
  // Navigation
  view: View;
  setView: (view: View) => void;

  // Theme & Display
  theme: 'dark' | 'light' | 'high-contrast';
  setTheme: (theme: 'dark' | 'light' | 'high-contrast') => void;
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

      // Sector Subscriptions
      subscribedSectors: ['조선', '방산', '원자력'],
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
      }),
    }
  )
);
