// @responsibility card UI 프리미티브 컴포넌트
/**
 * Card — 프로젝트 전역 공용 카드 컨테이너.
 *
 * 설계 목표 (Step 4 · 디자인 일관성):
 *   1) 주 언어(primary language) = Glass + subtle depth (variant="default")
 *   2) Neo-Brutalism 은 Gate/Scoreboard 같이 강한 인상을 요구하는 곳 한정 (variant="neo")
 *   3) 시맨틱 컬러는 `tone` 으로 분리 (기존 neo-pass/neo-fail/neo-warn/... 을 대체)
 *
 * 호환성:
 *   - 기존 variant 값(accent, danger, gradient, neo-*) 은 그대로 동작.
 *   - 새 코드는 `variant="default" tone="success"` 처럼 "형태 × 시맨틱" 을 분리해 표기.
 */
import React from 'react';
import { cn } from './cn';

type CardVariant =
  | 'default'
  | 'accent'
  | 'danger'
  | 'ghost'
  | 'gradient'
  | 'neo'
  | 'neo-accent'
  | 'neo-pass'
  | 'neo-fail'
  | 'neo-warn'
  | 'neo-info'
  | 'neo-ai';

type CardTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'violet';
type CardPadding = 'sm' | 'md' | 'lg' | 'none';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  hover?: boolean;
  /** 시맨틱 컬러 오버레이 — 테두리/배경 틴트만 덧붙이고 구조는 유지. */
  tone?: CardTone;
}

const variantClasses: Record<CardVariant, string> = {
  default: 'glass-3d',
  accent: 'glass-3d border-orange-500/20 shadow-[0_0_30px_rgba(249,115,22,0.08)]',
  danger: 'glass-3d border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.08)]',
  ghost: 'border border-theme-border',
  gradient: 'glass-gradient',
  neo: 'neo-card',
  'neo-accent': 'neo-card border-orange-500/40',
  'neo-pass': 'neo-card neo-bg-pass',
  'neo-fail': 'neo-card neo-bg-fail',
  'neo-warn': 'neo-card neo-bg-warn',
  'neo-info': 'neo-card neo-bg-info',
  'neo-ai': 'neo-card neo-bg-ai',
};

const toneClasses: Record<CardTone, string> = {
  neutral: '',
  success: 'ring-1 ring-emerald-500/20 bg-emerald-500/[0.03]',
  warning: 'ring-1 ring-amber-500/20 bg-amber-500/[0.03]',
  danger: 'ring-1 ring-red-500/20 bg-red-500/[0.03]',
  info: 'ring-1 ring-blue-500/20 bg-blue-500/[0.03]',
  accent: 'ring-1 ring-orange-500/20 bg-orange-500/[0.03]',
  violet: 'ring-1 ring-violet-500/20 bg-violet-500/[0.03]',
};

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4 sm:p-5',
  md: 'p-5 sm:p-6 lg:p-8',
  lg: 'p-6 sm:p-8 lg:p-10',
};

export function Card({
  variant = 'default',
  padding = 'md',
  hover = false,
  tone,
  className,
  children,
  ...props
}: CardProps) {
  const isNeo = variant.startsWith('neo');
  return (
    <div
      className={cn(
        isNeo ? 'rounded-xl sm:rounded-2xl' : 'rounded-2xl sm:rounded-3xl',
        variantClasses[variant],
        paddingClasses[padding],
        hover && (isNeo ? 'cursor-pointer' : 'card-3d cursor-pointer'),
        variant === 'ghost' && 'bg-[var(--bg-surface)]',
        tone && toneClasses[tone],
        className,
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
    <Tag
      className={cn(
        'text-base sm:text-lg font-black text-theme-text tracking-tight leading-snug',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
