// @responsibility common 영역 ErrorBoundary 컴포넌트
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { toast } from 'sonner';

interface Props {
  children: ReactNode;
  /** Optional fallback UI. When omitted, a default error screen is shown. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

const isDev = typeof process !== 'undefined'
  ? process.env.NODE_ENV === 'development'
  : (import.meta as any).env?.DEV ?? false;

export class ErrorBoundary extends Component<Props, State> {
  declare props: Props;
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
    toast.error('애플리케이션 오류가 발생했습니다.', {
      description: '페이지를 새로고침하거나 잠시 후 다시 시도해주세요.'
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-6 text-center">
          <h2 className="text-2xl font-black mb-4">문제가 발생했습니다.</h2>
          <p className="text-white/60 mb-6">애플리케이션을 복구할 수 없습니다. 새로고침을 시도해주세요.</p>

          {this.state.error && (
            <details className="mb-6 w-full max-w-2xl text-left">
              <summary className="cursor-pointer text-red-400 text-sm font-bold mb-2">
                에러 상세
              </summary>
              <pre className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-red-300 overflow-auto max-h-60 whitespace-pre-wrap">
                {this.state.error.toString()}
                {isDev && this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}

          <div className="flex gap-4">
            <button
              onClick={this.handleRetry}
              className="px-6 py-3 bg-white/10 border border-white/20 rounded-xl font-bold hover:bg-white/20 transition-all"
            >
              다시 시도
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-blue-500 rounded-xl font-bold hover:bg-blue-600 transition-all"
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
