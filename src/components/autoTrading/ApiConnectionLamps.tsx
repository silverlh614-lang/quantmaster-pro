/**
 * ApiConnectionLamps — 자동매매 페이지 상단에 배치되는 외부 API 연결 상태 램프.
 *
 * `/api/health/pipeline` 의 필드를 30초 주기로 폴링해 네 개의 데이터 소스
 * (KIS REST · KIS WebSocket · KRX OpenAPI · Yahoo Finance) 의 가용성을
 * 한 줄로 노출한다. 트래픽을 가중하지 않기 위해 실패는 조용히 무시한다.
 */
import React, { useEffect, useState } from 'react';
import { Section } from '../../ui/section';
import { cn } from '../../ui/cn';

type LampState = 'ok' | 'warn' | 'down' | 'unknown';

interface LampInfo {
  label: string;
  state: LampState;
  detail: string;
}

interface PipelineHealth {
  kisConfigured?: boolean;
  kisTokenValid?: boolean;
  kisTokenHoursLeft?: number;
  krxTokenConfigured?: boolean;
  krxTokenValid?: boolean;
  krxCircuitState?: string;
  krxFailures?: number;
  yahooApiStatus?: 'OK' | 'STALE' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
  yahooApiDetail?:
    | 'NO_SCAN_HISTORY'
    | 'NO_CANDIDATES'
    | 'HAS_CANDIDATES'
    | 'HEARTBEAT_OK'
    | 'HEARTBEAT_STALE'
    | 'HEARTBEAT_DOWN';
  lastScanSummary?: {
    candidates?: number;
  };
  kisStream?: {
    connected?: boolean;
    subscribedCount?: number;
  };
}

const STATE_COLORS: Record<LampState, { dot: string; pill: string; text: string; ring: string }> = {
  ok: {
    dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]',
    pill: 'bg-emerald-500/10 border-emerald-500/30',
    text: 'text-emerald-300',
    ring: 'ring-emerald-400/30',
  },
  warn: {
    dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)] animate-pulse',
    pill: 'bg-amber-500/10 border-amber-500/30',
    text: 'text-amber-300',
    ring: 'ring-amber-400/30',
  },
  down: {
    dot: 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.75)] animate-pulse',
    pill: 'bg-red-500/10 border-red-500/30',
    text: 'text-red-300',
    ring: 'ring-red-400/30',
  },
  unknown: {
    dot: 'bg-slate-500',
    pill: 'bg-white/5 border-theme-border',
    text: 'text-theme-text-muted',
    ring: 'ring-slate-500/20',
  },
};

function deriveKisRest(h: PipelineHealth | null): LampInfo {
  if (!h) return { label: 'KIS REST', state: 'unknown', detail: '상태 조회 중' };
  if (!h.kisConfigured) return { label: 'KIS REST', state: 'down', detail: 'KIS_APP_KEY 미설정' };
  if (h.kisTokenValid === false) return { label: 'KIS REST', state: 'down', detail: '토큰 만료' };
  const hrs = h.kisTokenHoursLeft ?? 0;
  if (hrs > 0 && hrs <= 2) return { label: 'KIS REST', state: 'warn', detail: `토큰 ${hrs}시간 남음` };
  return { label: 'KIS REST', state: 'ok', detail: hrs > 0 ? `토큰 ${hrs}시간 유효` : '연결됨' };
}

function deriveKisStream(h: PipelineHealth | null): LampInfo {
  if (!h) return { label: 'KIS 실시간', state: 'unknown', detail: '상태 조회 중' };
  const s = h.kisStream ?? {};
  if (s.connected) {
    return { label: 'KIS 실시간', state: 'ok', detail: `${s.subscribedCount ?? 0}종목 구독` };
  }
  return { label: 'KIS 실시간', state: 'warn', detail: 'WebSocket 미연결' };
}

function deriveKrx(h: PipelineHealth | null): LampInfo {
  if (!h) return { label: 'KRX OpenAPI', state: 'unknown', detail: '상태 조회 중' };
  if (!h.krxTokenConfigured) return { label: 'KRX OpenAPI', state: 'warn', detail: 'AUTH_KEY 미설정' };
  if (h.krxTokenValid === false) {
    const circuit = h.krxCircuitState ?? 'UNKNOWN';
    const fails = h.krxFailures ?? 0;
    return { label: 'KRX OpenAPI', state: 'down', detail: `서킷 ${circuit} (실패 ${fails}회)` };
  }
  return { label: 'KRX OpenAPI', state: 'ok', detail: `서킷 ${h.krxCircuitState ?? 'CLOSED'}` };
}

function deriveYahoo(h: PipelineHealth | null): LampInfo {
  if (!h) return { label: 'Yahoo Finance', state: 'unknown', detail: 'Loading' };
  // 새 heartbeat 기반 상세값 우선 처리 (스캐너 idle 시에도 Yahoo 가용성 표시)
  if (h.yahooApiDetail === 'HEARTBEAT_OK') {
    return { label: 'Yahoo Finance', state: 'ok', detail: 'Heartbeat OK' };
  }
  if (h.yahooApiDetail === 'HEARTBEAT_STALE') {
    return { label: 'Yahoo Finance', state: 'warn', detail: 'Heartbeat stale (>1h)' };
  }
  if (h.yahooApiDetail === 'HEARTBEAT_DOWN') {
    return { label: 'Yahoo Finance', state: 'down', detail: 'Heartbeat down' };
  }
  if (h.yahooApiDetail === 'NO_SCAN_HISTORY') {
    return { label: 'Yahoo Finance', state: 'unknown', detail: 'No scan & no fetch yet' };
  }
  if (h.yahooApiDetail === 'NO_CANDIDATES') {
    const n = h.lastScanSummary?.candidates ?? 0;
    return { label: 'Yahoo Finance', state: 'ok', detail: `No candidates (${n})` };
  }
  switch (h.yahooApiStatus) {
    case 'OK':       return { label: 'Yahoo Finance', state: 'ok',   detail: 'Healthy' };
    case 'STALE':    return { label: 'Yahoo Finance', state: 'warn', detail: 'Stale (>1h)' };
    case 'DEGRADED': return { label: 'Yahoo Finance', state: 'warn', detail: 'Degraded' };
    case 'DOWN':     return { label: 'Yahoo Finance', state: 'down', detail: 'Unavailable' };
    default:         return { label: 'Yahoo Finance', state: 'unknown', detail: 'No scan history' };
  }
}

function Lamp({ lamp }: { lamp: LampInfo }) {
  const style = STATE_COLORS[lamp.state];
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border',
        'ring-1',
        style.pill,
        style.ring,
      )}
      role="status"
      aria-label={`${lamp.label} ${lamp.state}`}
      title={`${lamp.label} — ${lamp.detail}`}
    >
      <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', style.dot)} />
      <div className="flex flex-col leading-tight min-w-0">
        <span className={cn('text-[10px] font-black uppercase tracking-widest', style.text)}>
          {lamp.label}
        </span>
        <span className="text-[10px] text-theme-text-muted font-medium truncate">
          {lamp.detail}
        </span>
      </div>
    </div>
  );
}

export function ApiConnectionLamps() {
  const [health, setHealth] = useState<PipelineHealth | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/health/pipeline');
        if (!res.ok) return;
        const json = (await res.json()) as PipelineHealth;
        if (!cancelled) {
          setHealth(json);
          setFetchedAt(Date.now());
        }
      } catch {
        /* 서버 미응답은 조용히 패스 — 램프는 UNKNOWN 유지 */
      }
    };
    void poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const lamps: LampInfo[] = [
    deriveKisRest(health),
    deriveKisStream(health),
    deriveKrx(health),
    deriveYahoo(health),
  ];

  const syncedLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '대기 중';

  return (
    <Section
      title="API 연결 상태"
      subtitle="External Data Sources · 30s polling"
      actions={
        <span className="text-[10px] text-theme-text-muted font-num">
          동기화 {syncedLabel}
        </span>
      }
      compact
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {lamps.map((lamp) => (
          <Lamp key={lamp.label} lamp={lamp} />
        ))}
      </div>
    </Section>
  );
}
