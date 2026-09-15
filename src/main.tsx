// @responsibility main 모듈
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { QueryProvider } from './components/common/QueryProvider.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary.tsx';
import { installLazyLoadRecovery } from './utils/lazyLoadRecovery.ts';

installLazyLoadRecovery(import.meta.url);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryProvider>
        <App />
      </QueryProvider>
    </ErrorBoundary>
  </StrictMode>,
);
