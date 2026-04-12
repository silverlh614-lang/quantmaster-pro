import React from 'react';
import { cn } from './cn';
import { Spinner, type SpinnerSize, type SpinnerVariant } from './spinner';

interface LoadingStateProps {
  message?: string;
  className?: string;
  spinnerVariant?: SpinnerVariant;
  spinnerSize?: SpinnerSize;
}

export function LoadingState({
  message = '데이터를 불러오는 중입니다...',
  className,
  spinnerVariant = 'ring',
  spinnerSize = 'lg',
}: LoadingStateProps) {
  return (
    <div className={cn('py-20 sm:py-32 flex flex-col items-center justify-center space-y-4 sm:space-y-6', className)}>
      <Spinner variant={spinnerVariant} size={spinnerSize} className="text-blue-400" />
      <p className="text-sm sm:text-base text-theme-text-secondary font-bold animate-pulse text-center px-4">{message}</p>
    </div>
  );
}
