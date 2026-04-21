/**
 * NotificationsTimelineTable — 자동매매 알림 타임라인 테이블.
 *
 * 서버(telegramClient → alertsFeedRepo)가 축적한 최근 알림 200건을
 * 시간 역순 표 형태로 노출. 우선순위 필터 칩 · 유형 자동 분류 · 좌측
 * 우선순위 색 바 · 상대시간(ko) 병기.
 *
 * 데이터 소스: useAlertsFeed 훅 (페이지에서 이미 폴링 중) — prop 주입으로
 * 이중 폴링 방지.
 */

import React, { useMemo, useState } from 'react';
import { BellRing, CheckCheck, RefreshCw } from 'lucide-react';
import { Section } from '../../ui/section';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { cn } from '../../ui/cn';
import type { AlertFeedEntry, AlertFeedPriority } from '../../api';

interface NotificationsTimelineTableProps {
  entries: AlertFeedEntry[];
  unread: number;
  isLoading?: boolean;
  onMarkAllRead: () => void;
  onRefresh: () => void;
}

type PriorityFilter = 'ALL' | AlertFeedPriority;

const PRIORITY_BAR: Record<AlertFeedPriority, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-orange-400',
  NORMAL: 'bg-sky-400',
  LOW: 'bg-slate-400',
  INFO: 'bg-slate-400',
};

const PRIORITY_BADGE: Record<AlertFeedPriority, 'danger' | 'accent' | 'info' | 'default'> = {
  CRITICAL: 'danger',
  HIGH: 'accent',
  NORMAL: 'info',
  LOW: 'default',
  INFO: 'default',
};

const PRIORITY_ORDER: AlertFeedPriority[] = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW', 'INFO'];

// 텍스트 앞머리에서 유형을 추론 — 카테고리 필드가 서버에 없어 휴리스틱.
const CATEGORY_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /kill[- ]?switch|킬스위치|긴급정지/i, label: '킬스위치' },
  { pattern: /긴급|CRITICAL|🚨|🔴/i, label: '긴급' },
  { pattern: /\d+건\s*요약|digest|다이제스트/i, label: '요약' },
  { pattern: /체결|BUY|SELL|매수|매도|주문|ACK/i, label: '체결' },
  { pattern: /Sharpe|샤프|성과|백테스트|backtest/i, label: '성과' },
  { pattern: /워크포워드|WalkForward|walk-forward/i, label: '워크포워드' },
  { pattern: /반성|reflection|교훈/i, label: '반성' },
  { pattern: /DART|공시|foreign|외국인/i, label: '공시·수급' },
  { pattern: /DXY|환율|pre-?market|프리마켓|ADR|sector|섹터/i, label: '글로벌' },
  { pattern: /스캔|scan|momentum|신고가/i, label: '스캔' },
  { pattern: /budget|예산|governor/i, label: '예산' },
  { pattern: /override|오버라이드/i, label: '오버라이드' },
  { pattern: /bias|편향|heatmap|히트맵/i, label: '편향' },
];

function classifyCategory(text: string): string {
  const head = text.slice(0, 120);
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(head)) return rule.label;
  }
  return '일반';
}

function formatKstTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatKstDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatRelative(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffSec = Math.max(0, Math.floor((now - t) / 1000));
  if (diffSec < 60) return `${diffSec}초 전`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}일 전`;
}

export function NotificationsTimelineTable({
  entries,
  unread,
  isLoading = false,
  onMarkAllRead,
  onRefresh,
}: NotificationsTimelineTableProps) {
  const [filter, setFilter] = useState<PriorityFilter>('ALL');

  const priorityCounts = useMemo(() => {
    const counts: Record<AlertFeedPriority, number> = {
      CRITICAL: 0,
      HIGH: 0,
      NORMAL: 0,
      LOW: 0,
      INFO: 0,
    };
    for (const e of entries) counts[e.priority]++;
    return counts;
  }, [entries]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return entries;
    return entries.filter((e) => e.priority === filter);
  }, [entries, filter]);

  return (
    <Section
      title="알림 타임라인"
      subtitle={`Telegram ↔ UI 미러 · 최근 ${entries.length}건 · 미읽음 ${unread}건`}
      actions={
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            새로고침
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onMarkAllRead}
            disabled={unread === 0}
            className="gap-1.5"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            모두 읽음
          </Button>
        </>
      }
    >
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm">
        {/* 필터 칩 바 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
          <FilterChip
            label="전체"
            count={entries.length}
            active={filter === 'ALL'}
            onClick={() => setFilter('ALL')}
            tone="neutral"
          />
          {PRIORITY_ORDER.map((p) => (
            <FilterChip
              key={p}
              label={p}
              count={priorityCounts[p]}
              active={filter === p}
              onClick={() => setFilter(p)}
              tone={p}
            />
          ))}
        </div>

        {/* 테이블 */}
        {filtered.length === 0 ? (
          <div className="px-4 py-10">
            <EmptyState
              variant="minimal"
              icon={<BellRing className="h-6 w-6" />}
              title={
                filter === 'ALL'
                  ? '아직 알림이 없습니다'
                  : `${filter} 알림이 없습니다`
              }
              description="서버가 Telegram 경보를 발송할 때마다 이곳에 시간순으로 기록됩니다."
            />
          </div>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-slate-950/85 backdrop-blur-sm">
                <tr className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
                  <th className="w-[14%] px-4 py-3 text-left">시각 (KST)</th>
                  <th className="w-[12%] px-3 py-3 text-left">우선순위</th>
                  <th className="w-[14%] px-3 py-3 text-left">유형</th>
                  <th className="px-4 py-3 text-left">내용</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <TimelineRow key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

interface TimelineRowProps {
  entry: AlertFeedEntry;
}

function TimelineRow({ entry }: TimelineRowProps) {
  const time = formatKstTime(entry.at);
  const date = formatKstDate(entry.at);
  const rel = formatRelative(entry.at);
  const category = classifyCategory(entry.text);
  const badge = PRIORITY_BADGE[entry.priority];
  const bar = PRIORITY_BAR[entry.priority];

  return (
    <tr className="group border-t border-white/5 align-top transition-colors hover:bg-white/[0.03]">
      <td className="relative px-4 py-3 font-mono text-[11px] text-white/70">
        <span className={cn('absolute left-0 top-0 h-full w-1', bar)} />
        <div className="flex flex-col leading-tight">
          <span>{time}</span>
          <span className="text-[10px] text-white/35">{date}</span>
          <span className="text-[10px] text-white/30">{rel}</span>
        </div>
      </td>
      <td className="px-3 py-3">
        <Badge variant={badge} size="sm">
          {entry.priority}
        </Badge>
      </td>
      <td className="px-3 py-3 text-[11px] font-semibold text-white/70">
        {category}
      </td>
      <td className="px-4 py-3">
        <p className="line-clamp-3 whitespace-pre-line text-[12px] leading-relaxed text-white/85">
          {entry.text}
        </p>
      </td>
    </tr>
  );
}

interface FilterChipProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone: 'neutral' | AlertFeedPriority;
}

const CHIP_TONE: Record<FilterChipProps['tone'], string> = {
  neutral: 'border-white/15 text-white/70 hover:bg-white/5',
  CRITICAL: 'border-red-500/30 text-red-300 hover:bg-red-500/10',
  HIGH: 'border-orange-400/30 text-orange-300 hover:bg-orange-500/10',
  NORMAL: 'border-sky-400/30 text-sky-300 hover:bg-sky-500/10',
  LOW: 'border-slate-400/30 text-slate-300 hover:bg-slate-500/10',
  INFO: 'border-slate-400/30 text-slate-300 hover:bg-slate-500/10',
};

const CHIP_ACTIVE: Record<FilterChipProps['tone'], string> = {
  neutral: 'bg-white/10 text-white',
  CRITICAL: 'bg-red-500/20 text-red-200 ring-1 ring-red-500/40',
  HIGH: 'bg-orange-500/20 text-orange-200 ring-1 ring-orange-400/40',
  NORMAL: 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40',
  LOW: 'bg-slate-500/20 text-slate-200 ring-1 ring-slate-400/40',
  INFO: 'bg-slate-500/20 text-slate-200 ring-1 ring-slate-400/40',
};

function FilterChip({ label, count, active, onClick, tone }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors',
        active ? CHIP_ACTIVE[tone] : CHIP_TONE[tone],
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'rounded-full px-1.5 py-[1px] text-[10px] font-black',
          active ? 'bg-black/25' : 'bg-white/10',
        )}
      >
        {count}
      </span>
    </button>
  );
}
