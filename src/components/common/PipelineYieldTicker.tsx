// @responsibility common 영역 PipelineYieldTicker 컴포넌트
/**
 * PipelineYieldTicker — 장중 Pipeline Yield 실시간 3-막대 티커.
 *
 * /api/health/pipeline 의 intradayYield 스냅샷을 1분마다 폴링해
 * Discovery / Gate / Signal 수율을 초록/노랑/빨강 막대로 표시한다.
 * 빈 스캔이 터졌을 때 "어느 단계가 범인인지" 즉시 보이도록 한다.
 */
import React, { useEffect, useState } from 'react';
import { cn } from '../../ui/cn';

interface IntradayYield {
  computedAt: string;
  discoveryYield: number;
  gateYield: number;
  signalYield: number;
  counts: {
    universeScanned: number;
    watchlistCount:  number;
    scanCandidates:  number;
    gateReached:     number;
    gatePassed:      number;
    buyExecuted:     number;
  };
  status: {
    discovery: 'green' | 'yellow' | 'red' | 'gray';
    gate:      'green' | 'yellow' | 'red' | 'gray';
    signal:    'green' | 'yellow' | 'red' | 'gray';
  };
}

const STATUS_COLOR: Record<IntradayYield['status']['discovery'], string> = {
  green:  'bg-green-400',
  yellow: 'bg-amber-400',
  red:    'bg-red-400',
  gray:   'bg-gray-500',
};

const STATUS_TEXT: Record<IntradayYield['status']['discovery'], string> = {
  green:  'text-green-400',
  yellow: 'text-amber-400',
  red:    'text-red-400',
  gray:   'text-gray-500',
};

interface BarProps {
  label:     string;
  pct:       number;
  status:    IntradayYield['status']['discovery'];
  numerator: number;
  denominator: number;
}

function Bar({ label, pct, status, numerator, denominator }: BarProps) {
  const width = Math.min(100, Math.max(2, pct));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[10px]">
        <span className="font-black uppercase tracking-widest text-theme-text-muted">{label}</span>
        <span className={cn('font-num font-black', STATUS_TEXT[status])}>
          {pct.toFixed(1)}%
          <span className="text-theme-text-muted ml-1 font-normal">
            ({numerator}/{denominator})
          </span>
        </span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', STATUS_COLOR[status])}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function PipelineYieldTicker() {
  const [data, setData] = useState<IntradayYield | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/health/pipeline');
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json.intradayYield) setData(json.intradayYield as IntradayYield);
      } catch { /* 서버 미응답은 조용히 패스 */ }
    };
    poll();
    const id = setInterval(poll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!data) return null;

  return (
    <div className="bg-[#0d0e11] border border-white/10 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
          Intraday Pipeline Yield
        </span>
        <span className="text-[9px] text-theme-text-muted/70 font-num">
          {new Date(data.computedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Bar
          label="Discovery"
          pct={data.discoveryYield}
          status={data.status.discovery}
          numerator={data.counts.watchlistCount}
          denominator={data.counts.universeScanned}
        />
        <Bar
          label="Gate"
          pct={data.gateYield}
          status={data.status.gate}
          numerator={data.counts.gatePassed}
          denominator={data.counts.gateReached}
        />
        <Bar
          label="Signal"
          pct={data.signalYield}
          status={data.status.signal}
          numerator={data.counts.buyExecuted}
          denominator={data.counts.gatePassed}
        />
      </div>
    </div>
  );
}
