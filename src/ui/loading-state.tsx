import React from 'react';
import { cn } from './cn';

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export function LoadingState({ message = '데이터를 불러오는 중입니다...', className }: LoadingStateProps) {
  return (
    <div className={cn('py-20 sm:py-32 flex flex-col items-center justify-center space-y-4 sm:space-y-6', className)}>
      <div className="w-12 h-12 sm:w-14 sm:h-14 border-[3px] border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
      <p className="text-sm sm:text-base text-theme-text-secondary font-bold animate-pulse text-center px-4">{message}</p>
    </div>
  );
}
