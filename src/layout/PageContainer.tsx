// @responsibility PageContainer 레이아웃 컴포넌트
import React from 'react';
import { cn } from '../ui/cn';

interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** max width constraint */
  size?: 'md' | 'lg' | 'xl' | 'full';
}

const sizeClasses = {
  md: 'max-w-5xl',
  lg: 'max-w-6xl',
  xl: 'max-w-7xl',
  full: 'max-w-screen-2xl',
};

export function PageContainer({ size = 'lg', className, children, ...props }: PageContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 sm:py-8',
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
