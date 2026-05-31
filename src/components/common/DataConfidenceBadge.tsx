// @responsibility 전역 데이터 신뢰도 배지 — VERIFIED/DEGRADED/STALE/MISSING/AI_ESTIMATED/UNKNOWN 표시

import React from 'react';
import { AlertTriangle, Bot, CheckCircle2, Clock3, HelpCircle, MinusCircle, ShieldAlert } from 'lucide-react';
import { cn } from '../../ui/cn';

export type DataConfidence =
  | 'VERIFIED'
  | 'DEGRADED'
  | 'STALE'
  | 'MISSING'
  | 'AI_ESTIMATED'
  | 'UNKNOWN';

export interface DataConfidenceBadgeProps {
  confidence: DataConfidence;
  source?: string;
  updatedAt?: string;
  compact?: boolean;
  showTooltip?: boolean;
  className?: string;
  label?: string;
}

interface ConfidenceConfig {
  label: string;
  compactLabel: string;
  description: string;
  caution: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  className: string;
  dotClassName: string;
}

const CONFIDENCE_CONFIG: Record<DataConfidence, ConfidenceConfig> = {
  VERIFIED: {
    label: '실계산/검증',
    compactLabel: 'VERIFIED',
    description: '실계산 또는 검증된 데이터입니다.',
    caution: '핵심 판단에 사용할 수 있는 우선 신뢰 데이터입니다.',
    icon: CheckCircle2,
    className: 'border-emerald-400/35 bg-emerald-400/12 text-emerald-200 shadow-[0_0_12px_rgba(52,211,153,0.16)]',
    dotClassName: 'bg-emerald-300',
  },
  DEGRADED: {
    label: '품질 저하',
    compactLabel: 'DEGRADED',
    description: '일부 불안정하지만 참고 가능한 데이터입니다.',
    caution: '보조 판단으로만 해석하고 최신 데이터 확인이 필요합니다.',
    icon: AlertTriangle,
    className: 'border-amber-400/35 bg-amber-400/12 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.14)]',
    dotClassName: 'bg-amber-300',
  },
  STALE: {
    label: '지연/오래됨',
    compactLabel: 'STALE',
    description: '업데이트 시간이 오래되었거나 지연된 데이터입니다.',
    caution: '실시간 가격·수급 판단처럼 민감한 영역에서는 재확인이 필요합니다.',
    icon: Clock3,
    className: 'border-orange-400/35 bg-orange-400/12 text-orange-200 shadow-[0_0_12px_rgba(251,146,60,0.14)]',
    dotClassName: 'bg-orange-300',
  },
  MISSING: {
    label: '데이터 없음',
    compactLabel: 'MISSING',
    description: '필요 데이터가 없거나 수집되지 않았습니다.',
    caution: '해당 항목은 판단 근거로 사용하지 않아야 합니다.',
    icon: MinusCircle,
    className: 'border-red-400/35 bg-red-400/12 text-red-200 shadow-[0_0_12px_rgba(248,113,113,0.14)]',
    dotClassName: 'bg-red-300',
  },
  AI_ESTIMATED: {
    label: 'AI 추정',
    compactLabel: 'AI_EST',
    description: '뉴스·촉매·해석 기반 AI 추정값입니다.',
    caution: '실계산값이 아니며 실거래 핵심 판단에는 주의가 필요합니다.',
    icon: Bot,
    className: 'border-violet-400/40 bg-violet-400/12 text-violet-200 shadow-[0_0_14px_rgba(167,139,250,0.18)] ring-1 ring-violet-400/10',
    dotClassName: 'bg-violet-300',
  },
  UNKNOWN: {
    label: '출처 미확인',
    compactLabel: 'UNKNOWN',
    description: '데이터 출처 또는 신뢰도 메타를 확인할 수 없습니다.',
    caution: '실계산 데이터로 간주하지 말고 보수적으로 해석해야 합니다.',
    icon: HelpCircle,
    className: 'border-slate-400/30 bg-slate-400/10 text-slate-200 shadow-[0_0_10px_rgba(148,163,184,0.12)]',
    dotClassName: 'bg-slate-300',
  },
};

export const DATA_CONFIDENCE_HELP = CONFIDENCE_CONFIG;

function formatTitle(confidence: DataConfidence, source?: string, updatedAt?: string): string {
  const config = CONFIDENCE_CONFIG[confidence];
  return [
    `${confidence}: ${config.description}`,
    config.caution,
    source ? `Source: ${source}` : undefined,
    updatedAt ? `Updated: ${updatedAt}` : undefined,
  ].filter(Boolean).join('\n');
}

export function DataConfidenceBadge({
  confidence,
  source,
  updatedAt,
  compact = false,
  showTooltip = true,
  className,
  label,
}: DataConfidenceBadgeProps) {
  const config = CONFIDENCE_CONFIG[confidence] ?? CONFIDENCE_CONFIG.UNKNOWN;
  const Icon = config.icon;
  const visibleLabel = label ?? (compact ? config.compactLabel : config.label);
  const sourceText = source && !compact ? source : undefined;
  const updatedText = updatedAt && !compact ? updatedAt : undefined;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-tight whitespace-nowrap',
        config.className,
        compact ? 'px-1.5 text-[9px]' : 'py-1',
        confidence === 'AI_ESTIMATED' && 'normal-case',
        className,
      )}
      title={showTooltip ? formatTitle(confidence, source, updatedAt) : undefined}
      aria-label={`데이터 신뢰도 ${confidence}: ${config.description}${source ? ` 출처 ${source}` : ''}${updatedAt ? ` 업데이트 ${updatedAt}` : ''}`}
      data-confidence={confidence}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', config.dotClassName)} aria-hidden={true} />
      <Icon className="h-3 w-3 shrink-0" aria-hidden={true} />
      <span>{visibleLabel}</span>
      {sourceText && <span className="max-w-[9rem] truncate text-white/45 normal-case">via {sourceText}</span>}
      {updatedText && (
        <span className="font-mono text-[9px] text-white/40 normal-case">{updatedText}</span>
      )}
      {confidence === 'AI_ESTIMATED' && !compact && (
        <ShieldAlert className="h-3 w-3 shrink-0 text-violet-100/80" aria-hidden={true} />
      )}
    </span>
  );
}
