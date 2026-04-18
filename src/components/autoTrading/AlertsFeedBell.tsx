/**
 * AlertsFeedBell — Telegram ↔ UI 알림 동기화 벨 아이콘.
 *
 * 미읽음 카운트 배지 + 클릭 시 최근 알림 드롭다운 (타임라인).
 * 우선순위별 좌측 색 바 (CRITICAL red / HIGH orange / NORMAL sky / LOW slate).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellDot, CheckCheck } from 'lucide-react';
import type { AlertFeedEntry, AlertFeedPriority } from '../../api';

interface AlertsFeedBellProps {
  entries: AlertFeedEntry[];
  unread: number;
  onMarkAllRead: () => void;
}

const PRIORITY_BAR: Record<AlertFeedPriority, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-orange-400',
  NORMAL: 'bg-sky-400',
  LOW: 'bg-slate-400',
  INFO: 'bg-slate-400',
};

const PRIORITY_LABEL: Record<AlertFeedPriority, string> = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  NORMAL: 'NORMAL',
  LOW: 'LOW',
  INFO: 'INFO',
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
  } catch { return iso; }
}

export function AlertsFeedBell({ entries, unread, onMarkAllRead }: AlertsFeedBellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        aria-label={`알림 피드 (미읽음 ${unread}개)`}
      >
        {unread > 0 ? <BellDot className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black text-white shadow-lg shadow-red-500/40">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-80 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">
              알림 피드
            </div>
            <button
              type="button"
              onClick={() => { onMarkAllRead(); setOpen(false); }}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/10"
            >
              <CheckCheck className="h-3 w-3" />
              모두 읽음
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {entries.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-white/40">
                아직 알림이 없습니다.
              </div>
            ) : (
              entries.map((e) => (
                <div
                  key={e.id}
                  className="relative border-b border-white/5 px-4 py-3 last:border-b-0 hover:bg-white/[0.02]"
                >
                  <div className={`absolute left-0 top-0 h-full w-1 ${PRIORITY_BAR[e.priority]}`} />
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[9px] font-black uppercase tracking-[0.15em] text-white/40">
                      {PRIORITY_LABEL[e.priority]}
                    </span>
                    <span className="text-[10px] font-mono text-white/40">{formatTime(e.at)}</span>
                  </div>
                  <div className="mt-1 line-clamp-4 whitespace-pre-line text-xs text-white/80">
                    {e.text}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
