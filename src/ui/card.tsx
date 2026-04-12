/**
 * Idea 10: Dark Glassmorphism Card with 3-layer depth system
 * Cards have inset highlight line at top for depth perception.
 */
import React from 'react';
import { cn } from './cn';

type CardVariant = 'default' | 'accent' | 'danger' | 'ghost' | 'gradient';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: 'sm' | 'md' | 'lg';
  hover?: boolean;
}

const variantClasses: Record<CardVariant, string> = {
  default: 'glass-3d',
  accent: 'glass-3d border-orange-500/20 shadow-[0_0_30px_rgba(249,115,22,0.08)]',
  danger: 'glass-3d border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.08)]',
  ghost: 'border border-theme-border',
  gradient: 'glass-gradient',
};

const paddingClasses = {
  sm: 'p-4 sm:p-5',
  md: 'p-5 sm:p-6 lg:p-8',
  lg: 'p-6 sm:p-8 lg:p-10',
};

export function Card({ variant = 'default', padding = 'md', hover = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl sm:rounded-3xl',
        variantClasses[variant],
        paddingClasses[padding],
        hover && 'card-3d cursor-pointer',
        variant === 'ghost' && 'bg-[var(--bg-surface)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ className, children, ...props }: CardHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between mb-4 sm:mb-6', className)} {...props}>
      {children}
    </div>
  );
}

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: 'h2' | 'h3' | 'h4';
}

export function CardTitle({ as: Tag = 'h3', className, children, ...props }: CardTitleProps) {
  return (
    <Tag className={cn('text-base sm:text-lg font-black text-theme-text tracking-tight leading-snug', className)} {...props}>
      {children}
    </Tag>
  );
}
