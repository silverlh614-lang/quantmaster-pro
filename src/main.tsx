import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { QueryProvider } from './components/common/QueryProvider.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { registerPriceAlertServiceWorker } from './utils/serviceWorkerRegistration';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryProvider>
        <App />
      </QueryProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// PR-L: 가격 알림 백그라운드 표시용 Service Worker 등록 (실패해도 fallback Notification API)
void registerPriceAlertServiceWorker();
