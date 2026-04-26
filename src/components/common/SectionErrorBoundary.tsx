// @responsibility common 영역 SectionErrorBoundary 컴포넌트
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  sectionName: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class SectionErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[SectionError] ${this.props.sectionName}:`, error.message);
    console.error(`[SectionError] ${this.props.sectionName} stack:`, errorInfo.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="glass-3d p-6 rounded-[2rem] border border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-sm font-black text-red-400 uppercase tracking-widest">
              {this.props.sectionName} 로드 실패
            </span>
          </div>
          <p className="text-xs text-white/40 mb-4">
            이 섹션에서 오류가 발생했습니다. 다른 섹션은 정상 작동합니다.
          </p>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="text-[10px] text-red-300/60 bg-black/30 p-3 rounded-xl mb-4 overflow-auto max-h-24">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-white/60 hover:bg-white/20 transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            다시 시도
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
