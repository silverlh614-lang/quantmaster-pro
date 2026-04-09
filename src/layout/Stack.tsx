import React from 'react';
import { cn } from '../ui/cn';

interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const gapClasses = {
  xs: 'space-y-2',
  sm: 'space-y-3 sm:space-y-4',
  md: 'space-y-4 sm:space-y-6',
  lg: 'space-y-6 sm:space-y-8',
  xl: 'space-y-8 sm:space-y-12',
};

export function Stack({ gap = 'md', className, children, ...props }: StackProps) {
  return (
    <div className={cn(gapClasses[gap], className)} {...props}>
      {children}
    </div>
  );
}
