// @responsibility common 영역 TopBlockersPanel 컴포넌트
/**
 * TopBlockersPanel — 오늘 가장 많이 탈락시킨 Gate 조건 TOP N.
 *
 * /api/diagnostics/top-blockers를 주기적으로 폴링해 실패율 상위 조건을 보여준다.
 * 증상(전체 통과율 %) 대신 원인(어떤 조건이 막았는지)을 노출하는 것이 목적 —
 * 자가개선의 출발점. 빈 스캔이 "모멘텀" 하나 때문인지 "정배열+볼륨돌파" 결합인지
 * 을 운용자가 한눈에 가늠할 수 있다.
 */
import React, { useEffect, useState } from 'react';
import { cn } from '../../ui/cn';

interface Blocker {
  conditionKey:  string;
  conditionName: string;
  passed:        number;
  failed:        number;
  total:         number;
  failRate:      number; // %
}

interface TopBlockersResponse {
  totalConditions: number;
  minSample:       number;
  topBlockers:     Blocker[];
  timestamp:       string;
}

interface Props {
  /** 기본 3개. */
  limit?: number;
  /** 폴링 주기(ms) — 0이면 폴링 없음. 기본 60초. */
  pollMs?: number;
}

function failColor(rate: number): string {
  if (rate >= 80) return 'text-red-400';
  if (rate >= 60) return 'text-amber-400';
  return 'text-theme-text';
}

function failBg(rate: number): string {
  if (rate >= 80) return 'bg-red-500';
  if (rate >= 60) return 'bg-amber-500';
  return 'bg-sky-500';
}

export function TopBlockersPanel({ limit = 3, pollMs = 60_000 }: Props) {
  const [data, setData] = useState<TopBlockersResponse | null>(null);
  const [err, setErr]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch(`/api/diagnostics/top-blockers?limit=${limit}`);
        if (!res.ok) { setErr(`HTTP ${res.status}`); return; }
        const json = (await res.json()) as TopBlockersResponse;
        if (!cancelled) { setData(json); setErr(null); }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'fetch failed');
      }
    };
    fetchOnce();
    if (pollMs <= 0) return;
    const id = setInterval(fetchOnce, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [limit, pollMs]);

  return (
    <div className="bg-[#0d0e11] border border-white/10 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
          오늘의 병목 TOP {limit}
        </span>
        {data && (
          <span className="text-[9px] text-theme-text-muted/70">
            {data.topBlockers.length === 0 ? '표본 부족' : `샘플≥${data.minSample}`}
          </span>
        )}
      </div>

      {err && (
        <div className="text-[10px] text-red-400">읽기 실패: {err}</div>
      )}

      {data && data.topBlockers.length === 0 && (
        <div className="text-[10px] text-theme-text-muted">오늘 누적 샘플이 아직 부족합니다.</div>
      )}

      <div className="space-y-1.5">
        {data?.topBlockers.map((b, i) => (
          <div
            key={b.conditionKey}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/[0.02]"
          >
            <span className="text-[10px] font-black font-num text-theme-text-muted w-4 shrink-0">
              #{i + 1}
            </span>
            <span className="text-[11px] font-bold flex-1 min-w-0 truncate text-theme-text">
              {b.conditionName}
              <span className="text-theme-text-muted ml-1 text-[9px] font-normal">
                ({b.conditionKey})
              </span>
            </span>
            <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden shrink-0">
              <div
                className={cn('h-full rounded-full', failBg(b.failRate))}
                style={{ width: `${Math.min(100, b.failRate)}%` }}
              />
            </div>
            <span className={cn('text-[10px] font-num font-black w-12 text-right shrink-0', failColor(b.failRate))}>
              {b.failRate.toFixed(1)}%
            </span>
            <span className="text-[9px] text-theme-text-muted/70 font-num w-14 text-right shrink-0">
              {b.failed}/{b.total}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
