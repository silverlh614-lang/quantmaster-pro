/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @responsibility 섹션별 데이터 연결/로딩/신선도를 한 줄 pill로 요약 노출.
 */
import React from 'react';
import { RefreshCw, Wifi, WifiOff, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '../../ui/cn';

export type ConnectionState = 'live' | 'loading' | 'stale' | 'error' | 'idle';

interface ConnectionStatusProps {
  label: string;
  state: ConnectionState;
  /** ISO timestamp 또는 Date — live/stale 판정용 보조 정보. */
  lastUpdated?: string | number | Date | null;
  /** 추가 상세 텍스트 (에러 메시지 등). 말풍선 title로 표시. */
  detail?: string;
  className?: string;
}

const STATE_STYLES: Record<ConnectionState, { icon: React.ReactNode; text: string; pill: string; label: string; dot: string }> = {
  live: {
    icon: <Wifi className="w-3 h-3" />,
    text: 'text-green-400',
    pill: 'bg-green-500/10 border-green-500/30',
    label: '실시간',
    dot: 'bg-green-400',
  },
  loading: {
    icon: <RefreshCw className="w-3 h-3 animate-spin" />,
    text: 'text-blue-400',
    pill: 'bg-blue-500/10 border-blue-500/30',
    label: '연결 중',
    dot: 'bg-blue-400 animate-pulse',
  },
  stale: {
    icon: <Clock className="w-3 h-3" />,
    text: 'text-amber-400',
    pill: 'bg-amber-500/10 border-amber-500/30',
    label: '오래된 데이터',
    dot: 'bg-amber-400',
  },
  error: {
    icon: <AlertTriangle className="w-3 h-3" />,
    text: 'text-red-400',
    pill: 'bg-red-500/10 border-red-500/30',
    label: '연결 실패',
    dot: 'bg-red-400 animate-pulse',
  },
  idle: {
    icon: <WifiOff className="w-3 h-3" />,
    text: 'text-theme-text-muted',
    pill: 'bg-white/5 border-theme-border',
    label: '대기',
    dot: 'bg-theme-text-muted',
  },
};

/** `lastUpdated` 로부터 'N분 전' 문자열 반환. 값 없으면 빈 문자열. */
export function formatRelative(lastUpdated?: string | number | Date | null): string {
  if (lastUpdated == null) return '';
  const ts = typeof lastUpdated === 'string' || typeof lastUpdated === 'number'
    ? new Date(lastUpdated).getTime()
    : lastUpdated.getTime();
  if (!Number.isFinite(ts)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}초 전`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
}

/**
 * 섹션 헤더 옆에 배치해 해당 섹션의 데이터 소스 상태를 보여준다.
 * ex) <ConnectionStatus label="시장 데이터" state="live" lastUpdated={...} />
 */
export function ConnectionStatus({ label, state, lastUpdated, detail, className }: ConnectionStatusProps) {
  const style = STATE_STYLES[state];
  const relative = formatRelative(lastUpdated);
  const titleText = [detail, relative && `업데이트: ${relative}`].filter(Boolean).join(' · ');

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest whitespace-nowrap',
        style.pill,
        style.text,
        className,
      )}
      role="status"
      aria-label={`${label} ${style.label}`}
      title={titleText || undefined}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', style.dot)} />
      {style.icon}
      <span className="hidden sm:inline">{label}</span>
      <span className="hidden md:inline text-theme-text-muted font-bold normal-case tracking-normal">
        · {style.label}
        {relative ? ` · ${relative}` : ''}
      </span>
    </span>
  );
}
