/**
 * AnimatedNumber — 값 변화를 부드럽게 카운트업/다운 애니메이션.
 *
 *  - motion 의 `useSpring` 으로 값 보간, `useMotionValueEvent` 로 DOM 텍스트 갱신.
 *  - 포맷 함수 주입 가능 (KRW, %, 일반 숫자 등).
 *  - prefers-reduced-motion 감지 시 즉시 반영 (애니메이션 스킵).
 */
import React, { useEffect, useRef } from 'react';
import { useMotionValue, useSpring, useMotionValueEvent } from 'motion/react';
import { cn } from './cn';

type Formatter = (value: number) => string;

interface AnimatedNumberProps {
  value: number;
  /** 표시용 포맷터. 기본값: 정수 + 천단위 구분자. */
  format?: Formatter;
  className?: string;
  /** 스프링 강도 (기본 160). */
  stiffness?: number;
  /** 스프링 감쇠 (기본 26). */
  damping?: number;
}

function defaultFormat(n: number): string {
  return Math.round(n).toLocaleString();
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function AnimatedNumber({
  value,
  format = defaultFormat,
  className,
  stiffness = 160,
  damping = 26,
}: AnimatedNumberProps) {
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness, damping, mass: 1 });

  useEffect(() => {
    if (prefersReducedMotion()) {
      mv.set(value);
      if (spanRef.current) spanRef.current.textContent = format(value);
    } else {
      mv.set(value);
    }
  }, [value, mv, format]);

  useMotionValueEvent(spring, 'change', (latest) => {
    if (spanRef.current) {
      spanRef.current.textContent = format(latest);
    }
  });

  return (
    <span ref={spanRef} className={cn('tabular-nums', className)}>
      {format(value)}
    </span>
  );
}
