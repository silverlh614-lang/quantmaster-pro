// @responsibility PageGrid 레이아웃 컴포넌트
import React from 'react';
import { cn } from '../ui/cn';

interface PageGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column layout for lg+ */
  columns?: '1' | '2' | '3' | '2-1' | '1-2' | '1-1-1';
  gap?: 'sm' | 'md' | 'lg';
}

const gapClasses = {
  sm: 'gap-4 sm:gap-6',
  md: 'gap-6 sm:gap-8',
  lg: 'gap-8 sm:gap-10',
};

const columnClasses = {
  '1': 'grid-cols-1',
  // 태블릿(md, 768px+) 부터 2열 — 사이드바가 드로어화되며 가용 폭이 넓어진 반영.
  '2': 'grid-cols-1 md:grid-cols-2',
  '3': 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  // 2-1 / 1-2 는 3열 구조이므로 태블릿은 협소 → lg 유지.
  '2-1': 'grid-cols-1 lg:grid-cols-3 [&>*:first-child]:lg:col-span-2',
  '1-2': 'grid-cols-1 lg:grid-cols-3 [&>*:last-child]:lg:col-span-2',
  '1-1-1': 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
};

export function PageGrid({ columns = '1', gap = 'md', className, children, ...props }: PageGridProps) {
  return (
    <div
      className={cn('grid', columnClasses[columns], gapClasses[gap], className)}
      {...props}
    >
      {children}
    </div>
  );
}
