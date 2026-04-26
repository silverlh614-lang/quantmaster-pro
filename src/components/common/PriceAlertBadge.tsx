// @responsibility WatchlistCard 4단계 가격 알림 배지 (ADR-0030 PR-C)

import React from 'react';
import { Target, AlertTriangle, AlertCircle, Check } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { PriceAlertLevel } from '../../types/ui';

interface PriceAlertBadgeProps {
  level: PriceAlertLevel;
  currentPrice: number;
  stopLoss: number;
  targetPrice: number;
  className?: string;
}

interface LevelStyle {
  label: string;
  cls: string;
  icon: React.ReactNode;
}

const LEVEL_STYLE: Record<PriceAlertLevel, LevelStyle> = {
  NORMAL: {
    label: '정상',
    cls: 'bg-gray-700/30 border-gray-500/30 text-gray-300',
    icon: <Check className="w-3 h-3" />,
  },
  CAUTION: {
    label: '주의',
    cls: 'bg-amber-900/40 border-amber-500/40 text-amber-200',
    icon: <AlertCircle className="w-3 h-3" />,
  },
  DANGER: {
    label: '손절가 도달',
    cls: 'bg-red-900/50 border-red-500/50 text-red-200 animate-pulse',
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  TAKE_PROFIT: {
    label: '익절 도달',
    cls: 'bg-cyan-900/40 border-cyan-500/40 text-cyan-200 animate-pulse',
    icon: <Target className="w-3 h-3" />,
  },
};

function formatDistanceLabel(level: PriceAlertLevel, currentPrice: number, stopLoss: number, targetPrice: number): string {
  if (level === 'CAUTION' && stopLoss > 0 && currentPrice > 0) {
    const pct = ((currentPrice - stopLoss) / currentPrice * 100).toFixed(1);
    return `손절선 ${pct}%`;
  }
  if (level === 'TAKE_PROFIT' && targetPrice > 0) {
    const cur = currentPrice.toLocaleString('ko-KR');
    return `${cur} ≥ ${targetPrice.toLocaleString('ko-KR')}`;
  }
  if (level === 'DANGER' && stopLoss > 0) {
    const cur = currentPrice.toLocaleString('ko-KR');
    return `${cur} ≤ ${stopLoss.toLocaleString('ko-KR')}`;
  }
  return '';
}

/**
 * 워치리스트 카드의 가격 알림 4단계 배지.
 *
 * - NORMAL: 회색 + ✓ "정상"
 * - CAUTION: 황색 + ⚠ "주의 — 손절선 N.N%"
 * - DANGER: 적색 + 🔴 "손절가 도달" + pulse
 * - TAKE_PROFIT: 청록 + 🎯 "익절 도달" + pulse
 *
 * Web Notification 발송 여부와 무관하게 in-app 배지는 항상 표시 (사용자 권한 거부 시에도).
 */
export function PriceAlertBadge({
  level, currentPrice, stopLoss, targetPrice, className,
}: PriceAlertBadgeProps) {
  const style = LEVEL_STYLE[level];
  const subLabel = formatDistanceLabel(level, currentPrice, stopLoss, targetPrice);
  const titleText = subLabel ? `${style.label} — ${subLabel}` : style.label;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap border',
        style.cls,
        className,
      )}
      role={level === 'DANGER' || level === 'TAKE_PROFIT' ? 'alert' : 'status'}
      aria-live={level === 'NORMAL' ? 'off' : 'polite'}
      title={titleText}
    >
      {style.icon}
      <span>{style.label}</span>
      {subLabel && <span className="opacity-70 ml-0.5 hidden sm:inline">{subLabel}</span>}
    </span>
  );
}
