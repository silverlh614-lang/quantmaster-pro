import React from 'react';
import { cn } from './cn';
import { Button } from './button';

type EmptyStateVariant = 'default' | 'inviting' | 'error' | 'minimal';

interface EmptyStateCta {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'accent';
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** 이전 API 호환 — 외부에서 커스텀 액션 노드를 직접 넣고 싶을 때. */
  action?: React.ReactNode;
  /** 내장 CTA 버튼 (권장) — primary 액션만 넘기면 스타일·크기 자동. */
  cta?: EmptyStateCta;
  variant?: EmptyStateVariant;
  className?: string;
}

const variantClasses: Record<EmptyStateVariant, string> = {
  default: 'border-dashed border-white/[0.06] bg-white/[0.01]',
  inviting:
    'border-blue-500/20 bg-gradient-to-br from-blue-500/[0.04] to-indigo-500/[0.02] shadow-[0_0_40px_rgba(59,130,246,0.06)]',
  error: 'border-red-500/20 bg-red-500/[0.03]',
  minimal: 'border-transparent bg-transparent',
};

const iconWrapClasses: Record<EmptyStateVariant, string> = {
  default:
    'bg-gradient-to-br from-blue-500/[0.08] to-indigo-500/[0.04] border border-blue-500/10 text-blue-400/60',
  inviting:
    'bg-gradient-to-br from-blue-500/[0.2] to-indigo-500/[0.1] border border-blue-500/30 text-blue-300',
  error:
    'bg-gradient-to-br from-red-500/[0.12] to-red-500/[0.04] border border-red-500/20 text-red-300',
  minimal: 'bg-white/[0.04] text-theme-text-muted',
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  cta,
  variant = 'default',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'py-16 sm:py-24 text-center rounded-2xl sm:rounded-3xl border',
        variantClasses[variant],
        className,
      )}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      {icon && (
        <div
          className={cn(
            'w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 sm:mb-6 rounded-2xl flex items-center justify-center',
            iconWrapClasses[variant],
          )}
        >
          {icon}
        </div>
      )}
      <p className="text-sm sm:text-base font-bold text-theme-text-secondary mb-2">{title}</p>
      {description && (
        <p className="text-xs sm:text-sm text-theme-text-muted max-w-md mx-auto leading-relaxed px-4">
          {description}
        </p>
      )}
      {cta && (
        <div className="mt-6 flex justify-center">
          <Button
            variant={cta.variant ?? 'primary'}
            size="md"
            icon={cta.icon}
            onClick={cta.onClick}
          >
            {cta.label}
          </Button>
        </div>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
