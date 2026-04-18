/**
 * FieldError — 폼 필드 인라인 검증 메시지.
 * 아이콘 + 빨강 계열 텍스트로 시각적 즉각성을 주되, 공간을 과점하지 않는 높이.
 */
import React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from './cn';

interface FieldErrorProps {
  message?: string | null;
  className?: string;
  /** id — input 의 aria-describedby 와 연결하기 위한 식별자. */
  id?: string;
}

export function FieldError({ message, className, id }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className={cn(
        'mt-1.5 flex items-start gap-1.5 text-[11px] font-semibold text-red-400 leading-snug',
        className,
      )}
    >
      <AlertCircle className="w-3.5 h-3.5 mt-[1px] shrink-0" />
      <span>{message}</span>
    </p>
  );
}
