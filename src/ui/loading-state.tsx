// @responsibility loading-state UI 프리미티브 컴포넌트
import React from 'react';
import { cn } from './cn';
import { Spinner, type SpinnerSize, type SpinnerVariant } from './spinner';
import {
  SkeletonKpiGrid,
  SkeletonCard,
  SkeletonList,
  SkeletonTable,
} from './skeleton';

type SkeletonPreset = 'kpi' | 'card' | 'list' | 'table' | 'dashboard';

interface LoadingStateProps {
  message?: string;
  className?: string;
  spinnerVariant?: SpinnerVariant;
  spinnerSize?: SpinnerSize;
  /**
   * 스켈레톤 프리셋으로 렌더 — 레이아웃 시프트를 방지하고 싶을 때 사용.
   * 지정 시 Spinner/메시지는 생략되고 해당 프리셋이 렌더된다.
   */
  skeleton?: SkeletonPreset;
  /** 스켈레톤 옵션: 프리셋별 개수(KPI 열/리스트 행/테이블 행 수) 조정용. */
  skeletonCount?: number;
}

export function LoadingState({
  message = '데이터를 불러오는 중입니다...',
  className,
  spinnerVariant = 'ring',
  spinnerSize = 'lg',
  skeleton,
  skeletonCount,
}: LoadingStateProps) {
  if (skeleton) {
    return (
      <div
        className={cn('space-y-4 sm:space-y-6', className)}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="sr-only">{message}</span>
        {renderSkeleton(skeleton, skeletonCount)}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'py-20 sm:py-32 flex flex-col items-center justify-center space-y-4 sm:space-y-6',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Spinner variant={spinnerVariant} size={spinnerSize} className="text-blue-400" />
      <p className="text-sm sm:text-base text-theme-text-secondary font-bold animate-pulse text-center px-4">
        {message}
      </p>
    </div>
  );
}

function renderSkeleton(preset: SkeletonPreset, count?: number) {
  switch (preset) {
    case 'kpi':
      return <SkeletonKpiGrid count={count ?? 4} />;
    case 'card':
      return <SkeletonCard />;
    case 'list':
      return <SkeletonList count={count ?? 5} />;
    case 'table':
      return <SkeletonTable rows={count ?? 5} />;
    case 'dashboard':
      return (
        <>
          <SkeletonKpiGrid count={4} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <SkeletonTable rows={5} />
        </>
      );
  }
}
