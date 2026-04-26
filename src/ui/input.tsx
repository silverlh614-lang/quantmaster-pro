// @responsibility input UI 프리미티브 컴포넌트
import React, { useId } from 'react';
import { cn } from './cn';
import { FieldError } from './field-error';

type InputSize = 'sm' | 'md' | 'lg';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  icon?: React.ReactNode;
  /** 검증 에러 메시지 — 지정 시 빨강 테두리·FieldError 렌더. */
  error?: string | null;
  /** Button/Badge/Card 와 일치하는 size 매트릭스. */
  inputSize?: InputSize;
}

const sizeClasses: Record<InputSize, string> = {
  sm: 'px-3 py-2 text-xs rounded-lg min-h-[32px]',
  md: 'px-4 py-2.5 text-sm rounded-xl min-h-[40px]',
  lg: 'px-5 py-3 text-base rounded-2xl min-h-[48px]',
};

export function Input({
  label,
  hint,
  icon,
  error,
  inputSize = 'md',
  className,
  id,
  ...props
}: InputProps) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const hasError = Boolean(error);

  return (
    <div>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-[10px] font-black text-theme-text-muted uppercase tracking-[0.15em] mb-2"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          aria-invalid={hasError || undefined}
          aria-describedby={cn(hasError && errorId, hint && hintId) || undefined}
          className={cn(
            'w-full bg-white/[0.03] border font-medium text-theme-text',
            'placeholder:text-theme-text-muted',
            'focus:outline-none focus:ring-1 transition-all',
            sizeClasses[inputSize],
            hasError
              ? 'border-red-500/50 focus:border-red-500/70 focus:ring-red-500/25 bg-red-500/[0.04]'
              : 'border-white/[0.06] focus:border-blue-500/30 focus:ring-blue-500/15 focus:bg-white/[0.04]',
            icon && 'pl-10',
            className,
          )}
          {...props}
        />
      </div>
      {hint && !hasError && (
        <p
          id={hintId}
          className="mt-1.5 text-[10px] text-theme-text-muted font-medium leading-relaxed"
        >
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
