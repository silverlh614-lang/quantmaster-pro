import React, { Component, ErrorInfo, ReactNode } from 'react';
import { toast } from 'sonner';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  declare props: Props;
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    toast.error("애플리케이션 오류가 발생했습니다.", {
      description: "페이지를 새로고침하거나 잠시 후 다시 시도해주세요."
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-6 text-center">
          <h2 className="text-2xl font-black mb-4">문제가 발생했습니다.</h2>
          <p className="text-white/60 mb-6">애플리케이션을 복구할 수 없습니다. 새로고침을 시도해주세요.</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-blue-500 rounded-xl font-bold hover:bg-blue-600 transition-all"
          >
            새로고침
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
