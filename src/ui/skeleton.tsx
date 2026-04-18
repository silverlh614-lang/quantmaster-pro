/**
 * Skeleton — 로딩 상태를 위한 뼈대(placeholder) 컴포넌트.
 *
 * 설계 원칙:
 *   - Spinner 보다 인지 부하가 낮고 레이아웃 시프트를 방지.
 *   - shimmer 애니메이션은 CSS 변수 기반 (prefers-reduced-motion 시 멈춤).
 *   - 프리셋(SkeletonCard / SkeletonKpiGrid / SkeletonList / SkeletonTable)
 *     은 실제 컴포넌트 구조를 대략적으로 모사하여 "곧 나타날 모양" 을 암시.
 */
import React from 'react';
import { cn } from './cn';

type SkeletonShape = 'rect' | 'circle' | 'text';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shape?: SkeletonShape;
  /** 텍스트 기반 라인 개수 (shape=text 일 때). */
  lines?: number;
  /** 텍스트 마지막 줄을 일부러 짧게. */
  lastShort?: boolean;
}

const shapeClasses: Record<SkeletonShape, string> = {
  rect: 'rounded-xl',
  circle: 'rounded-full',
  text: 'rounded-md h-3',
};

export function Skeleton({
  shape = 'rect',
  lines = 1,
  lastShort = true,
  className,
  ...props
}: SkeletonProps) {
  if (shape === 'text' && lines > 1) {
    return (
      <div className={cn('space-y-2', className)} {...props}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'skeleton-shimmer',
              shapeClasses.text,
              lastShort && i === lines - 1 && 'w-3/5',
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn('skeleton-shimmer', shapeClasses[shape], className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/* ---------- 프리셋 ---------- */

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[0.05] p-5 bg-white/[0.02] space-y-4',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton shape="circle" className="w-9 h-9" />
        <div className="flex-1 space-y-2">
          <Skeleton shape="text" className="w-1/3" />
          <Skeleton shape="text" className="w-1/4 h-2" />
        </div>
      </div>
      <Skeleton shape="text" lines={3} />
    </div>
  );
}

export function SkeletonKpiGrid({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  const colsClass =
    count <= 2
      ? 'grid-cols-2'
      : count === 3
      ? 'grid-cols-2 md:grid-cols-3'
      : count === 4
      ? 'grid-cols-2 md:grid-cols-2 lg:grid-cols-4'
      : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5';

  return (
    <div className={cn('grid gap-3 sm:gap-4', colsClass, className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border-2 border-white/[0.05] bg-white/[0.02] p-4 sm:p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <Skeleton shape="text" className="w-1/2 h-2.5" />
            <Skeleton shape="circle" className="w-2 h-2" />
          </div>
          <Skeleton shape="rect" className="h-8 w-2/3" />
          <Skeleton shape="text" className="w-1/3 h-2.5" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.05] bg-white/[0.02]"
        >
          <Skeleton shape="circle" className="w-8 h-8" />
          <div className="flex-1 space-y-1.5">
            <Skeleton shape="text" className="w-1/3" />
            <Skeleton shape="text" className="w-1/5 h-2" />
          </div>
          <Skeleton shape="rect" className="w-16 h-6" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-white/[0.05] overflow-hidden', className)}>
      {/* header */}
      <div
        className="grid gap-3 px-4 py-3 bg-white/[0.02] border-b border-white/[0.05]"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      >
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} shape="text" className="h-2.5 w-2/3" />
        ))}
      </div>
      {/* rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid gap-3 px-4 py-3 border-b border-white/[0.04] last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} shape="text" className="h-3" />
          ))}
        </div>
      ))}
    </div>
  );
}
