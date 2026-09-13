// @responsibility Assemble the research workspace shell.
import React from 'react';
import { Toaster } from 'sonner';
import { PageRouter } from './pages/PageRouter';
import { KeyboardShortcutsModal } from './components/common/KeyboardShortcutsModal';
import { Sidebar } from './layout/Sidebar';
import { SidebarDrawer } from './layout/SidebarDrawer';
import { MobileTopBar } from './layout/MobileTopBar';
import { BottomNav } from './layout/BottomNav';
import { PageContainer } from './layout/PageContainer';
import { AppFooter } from './layout/AppFooter';
import { SkipLink } from './layout/SkipLink';
import { useAppEffects } from './hooks/useAppEffects';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import './styles/paperWorkspace.css';

export default function App() {
  useAppEffects();
  const { shortcutsOpen, closeShortcuts } = useGlobalShortcuts();
  return <div className="paper-workspace min-h-screen bg-theme-bg text-theme-text font-sans antialiased">
    <SkipLink /><Toaster position="top-center" richColors theme="dark" />
    <KeyboardShortcutsModal open={shortcutsOpen} onClose={closeShortcuts} />
    <Sidebar /><SidebarDrawer /><BottomNav />
    <div className="app-main"><MobileTopBar />
      <main id="main-content" tabIndex={-1}><PageContainer size="full">
        <PageRouter /><AppFooter />
      </PageContainer></main>
    </div>
  </div>;
}
