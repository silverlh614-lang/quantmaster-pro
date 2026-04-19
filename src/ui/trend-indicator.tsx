/**
 * TrendIndicator — 증감을 색상뿐 아니라 "아이콘·패턴" 으로 함께 표기.
 *
 * 접근성 원칙 (Step 5·6):
 *   - 색상만으로 구분되는 UI 지양 → ↑/↓ 아이콘을 병기하여 색맹·저조도 환경 대응.
 *   - 음수 부호는 숫자 앞에 붙이고 ↓ 아이콘과 색상으로 중복 표기.
 *   - aria-label 로 스크린리더에 "상승/하락" 의도 전달.
 */
import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { cn } from './cn';

type TrendDirection = 'up' | 'down' | 'neutral';

interface TrendIndicatorProps {
  value: number;
  /** 포맷터 — 기본은 소수 2자리 % 표기. */
  format?: (n: number) => string;
  /** 크기. */
  size?: 'sm' | 'md' | 'lg';
  /** 외부에서 방향을 명시하고 싶을 때 (예: 절대 변화량 대신 상대 비교). */
  direction?: TrendDirection;
  className?: string;
  /** 아이콘 표시 여부 (기본 true). */
  showIcon?: boolean;
  /** 한국 증권 관례(상승=빨강/하락=파랑) 적용. 기본은 글로벌 관례(상승=녹/하락=빨). */
  koreanPalette?: boolean;
}

function defaultPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const sizeToClass = {
  sm: { wrap: 'text-[11px] gap-1', icon: 'w-3 h-3' },
  md: { wrap: 'text-xs gap-1.5', icon: 'w-3.5 h-3.5' },
  lg: { wrap: 'text-sm gap-2', icon: 'w-4 h-4' },
};

export function TrendIndicator({
  value,
  format = defaultPct,
  size = 'md',
  direction,
  className,
  showIcon = true,
  koreanPalette = false,
}: TrendIndicatorProps) {
  const dir: TrendDirection = direction ?? (value > 0 ? 'up' : value < 0 ? 'down' : 'neutral');

  const colorClass = getColor(dir, koreanPalette);
  const ariaLabel = getAriaLabel(dir, value);
  const Icon =
    dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;

  return (
    <span
      role="text"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center font-bold tabular-nums',
        sizeToClass[size].wrap,
        colorClass,
        className,
      )}
    >
      {showIcon && <Icon className={cn(sizeToClass[size].icon, 'shrink-0')} aria-hidden />}
      <span>{format(value)}</span>
    </span>
  );
}

function getColor(dir: TrendDirection, korean: boolean): string {
  if (dir === 'neutral') return 'text-theme-text-muted';
  if (korean) {
    return dir === 'up' ? 'text-red-400' : 'text-blue-400';
  }
  return dir === 'up' ? 'text-emerald-400' : 'text-red-400';
}

function getAriaLabel(dir: TrendDirection, value: number): string {
  const magnitude = Math.abs(value);
  if (dir === 'up') return `상승 ${magnitude}`;
  if (dir === 'down') return `하락 ${magnitude}`;
  return `변동 없음`;
}
