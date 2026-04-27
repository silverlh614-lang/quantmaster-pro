// @responsibility button UI 프리미티브 컴포넌트
/**
 * Button — 프로젝트 전역 공용 버튼.
 *
 * 설계 목표 (Step 4 · 디자인 일관성):
 *   - size 는 sm/md/lg 3단계로 통일 (Input/Badge 와 매트릭스 맞춤)
 *   - variant 이름을 의도 중심으로 정돈:
 *       primary   (단일 중요 액션)
 *       secondary (부수 액션)
 *       ghost     (텍스트 버튼)
 *       danger    (파괴적 액션)
 *       accent    (차별화된 CTA — 블루 그라디언트)
 *       neo*      (Neo-Brutalism 강조용 — 한정 사용)
 *   - loading 시 자동 Spinner 교체, aria-busy 부여.
 */
import React from 'react';
import { cn } from './cn';
import { Spinner, type SpinnerSize, type SpinnerVariant } from './spinner';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'neo' | 'neo-secondary';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  /** 아이콘을 오른쪽에 배치 (텍스트 뒤). */
  iconPosition?: 'start' | 'end';
  loading?: boolean;
  loadingText?: string;
  /** 로딩 스피너 스타일 커스텀 (드물게 필요). */
  spinnerVariant?: SpinnerVariant;
  spinnerSize?: SpinnerSize;
  /** 풀-폭 버튼 — 모바일 폼 하단 CTA 등. */
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-orange-500 hover:bg-orange-600 text-white shadow-[0_8px_30px_rgba(249,115,22,0.25)] active:scale-[0.97]',
  secondary:
    'bg-white/[0.04] hover:bg-white/[0.08] text-theme-text-secondary border border-white/[0.06] hover:border-white/[0.12]',
  ghost: 'text-theme-text-muted hover:text-theme-text hover:bg-white/[0.04]',
  danger:
    'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40',
  accent:
    'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white shadow-[0_8px_30px_rgba(59,130,246,0.25)] active:scale-[0.97]',
  neo: 'neo-btn bg-orange-500 hover:bg-orange-600 text-white',
  'neo-secondary': 'neo-btn bg-white/[0.04] hover:bg-white/[0.08] text-theme-text-secondary',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg min-h-[32px]',
  md: 'px-4 py-2.5 text-sm gap-2 rounded-xl min-h-[40px]',
  lg: 'px-6 py-3.5 text-base gap-3 rounded-2xl min-h-[48px]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'start',
  loading,
  loadingText,
  spinnerVariant = 'ring',
  spinnerSize = 'md',
  fullWidth,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const iconNode = loading ? (
    <Spinner variant={spinnerVariant} size={spinnerSize} />
  ) : icon ? (
    <span className="shrink-0">{icon}</span>
  ) : null;

  const label = loading && loadingText ? loadingText : children;

  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-bold transition-all whitespace-nowrap',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-app)]',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        (disabled || loading) && 'opacity-50 cursor-not-allowed pointer-events-none',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {iconPosition === 'start' && iconNode}
      {label}
      {iconPosition === 'end' && iconNode}
    </button>
  );
}
