// @responsibility common 영역 SectionErrorBoundary 컴포넌트
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isAssetLoadError, reloadPage } from '../../utils/lazyLoadRecovery';

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
    // React.lazy retains rejected imports, so resetting this boundary cannot retry a stale chunk.
    if (isAssetLoadError(this.state.error)) {
      reloadPage();
      return;
    }
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="glass-3d p-6 rounded-[2rem] border border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-sm font-black text-red-400 tracking-tight">
              {this.props.sectionName} 로드 실패
            </span>
          </div>
          <p className="text-xs text-white/40 mb-4">
            {isAssetLoadError(this.state.error)
              ? '화면 파일을 불러오지 못했습니다. 새로고침하여 최신 화면을 불러와 주세요.'
              : '이 화면을 표시하지 못했습니다. 다시 시도하거나 다른 메뉴를 열어 주세요.'}
          </p>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="text-[10px] text-red-300/60 bg-black/30 p-3 rounded-xl mb-4 overflow-auto max-h-24">
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/[0.07] rounded-xl text-xs font-bold text-white/60 hover:bg-white/20 transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            {isAssetLoadError(this.state.error) ? '화면 새로고침' : '다시 시도'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
