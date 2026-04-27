// @responsibility info-tile UI 프리미티브 컴포넌트
/**
 * InfoTile — 라벨 + 값의 반복 쌍을 담는 공용 정보 타일.
 *
 * 대시보드의 "한 눈 요약" 섹션에서 동일한 bordered box 패턴이 반복되어 왔던 것을
 * 단일 프리미티브로 통일. Card 보다 가볍고, KpiStrip 보다 작은 단위.
 *
 * 사용 예:
 *   <InfoTile label="모드" value={<ModeBadge .../>} />
 *   <InfoTile label="주문 가능" value="가능" tone="success" icon={<Wifi />} />
 */
import React from 'react';
import { cn } from './cn';

type InfoTileTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

interface InfoTileProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** 라벨 좌측 아이콘 (optional). */
  icon?: React.ReactNode;
  /** 값의 의미 컬러 — 툴킷 매트릭스와 일치. */
  tone?: InfoTileTone;
  className?: string;
}

const toneValueClass: Record<InfoTileTone, string> = {
  neutral: 'text-theme-text',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  danger: 'text-red-300',
  info: 'text-blue-300',
  accent: 'text-orange-300',
};

const toneRingClass: Record<InfoTileTone, string> = {
  neutral: '',
  success: 'ring-1 ring-emerald-500/15',
  warning: 'ring-1 ring-amber-500/15',
  danger: 'ring-1 ring-red-500/15',
  info: 'ring-1 ring-blue-500/15',
  accent: 'ring-1 ring-orange-500/15',
};

export function InfoTile({
  label,
  value,
  icon,
  tone = 'neutral',
  className,
}: InfoTileProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-white/10 bg-white/5 p-4 subtle-hover-lift',
        toneRingClass[tone],
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs text-theme-text-muted">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn('mt-2 text-sm font-medium', toneValueClass[tone])}>
        {value}
      </div>
    </div>
  );
}
