/**
 * GlobalSignalsPanel — 진단 탭 하단 "오늘의 글로벌 신호 요약" 카드.
 *
 * 표시 소스(모두 읽기 전용 — 서버 cron 이 쓴 최신 스냅샷):
 *   - Pre-Market Bias Score (preMarketSignal)
 *   - DXY 모니터 (dxyMonitor)
 *   - ADR Gap 상태 (adrGapCalculator)
 *   - 미국 섹터 ETF 모멘텀 (sectorEtfMomentum)
 *
 * 각 카드는 서버에서 null 이면 "데이터 없음" 자리표시자만 표시하고,
 * 존재하는 필드만 방어적으로 렌더링한다(형식 변경에 강함).
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDown, ArrowUp, Globe, LineChart } from 'lucide-react';
import { autoTradeApi, type GlobalSignalsResponse } from '../../api';
import { Section } from '../../ui/section';
import { Card } from '../../ui/card';
import { Badge } from '../../ui/badge';

const QUERY_KEY = ['auto-trade', 'global-signals'] as const;

function formatKstTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function formatPct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v.toFixed(digits);
  return v >= 0 ? `+${s}%` : `${s}%`;
}

function toneFor(v: number | null | undefined): 'success' | 'danger' | 'default' {
  if (v == null) return 'default';
  if (v > 0) return 'success';
  if (v < 0) return 'danger';
  return 'default';
}

export function GlobalSignalsPanel() {
  const { data, isLoading, isError } = useQuery<GlobalSignalsResponse>({
    queryKey: QUERY_KEY,
    queryFn: () => autoTradeApi.getGlobalSignals(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return (
    <Section
      title="오늘의 글로벌 신호 요약"
      subtitle="Pre-Market · DXY · ADR Gap · 섹터 ETF Momentum"
    >
      {isLoading && (
        <Card variant="ghost" padding="sm" className="text-sm text-theme-text-muted">
          불러오는 중…
        </Card>
      )}
      {isError && (
        <Card variant="ghost" tone="danger" padding="sm" className="text-sm text-red-200">
          글로벌 신호 조회 실패 — 네트워크/서버를 확인하세요.
        </Card>
      )}
      {!isLoading && !isError && data && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PreMarketCard data={data.preMarket} />
          <DxyCard data={data.dxy} />
          <AdrGapCard data={data.adrGap} />
          <SectorEtfCard data={data.sectorEtf} />
        </div>
      )}
    </Section>
  );
}

// ────────────────────────────────────────────────────────────────

interface CardShellProps {
  title: string;
  icon: React.ReactNode;
  updatedAt?: string | null;
  children: React.ReactNode;
}

function CardShell({ title, icon, updatedAt, children }: CardShellProps) {
  return (
    <Card padding="md" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-theme-text-muted">{icon}</span>
          <span className="text-sm font-bold text-theme-text">{title}</span>
        </div>
        <span className="text-[10px] text-theme-text-muted font-num">
          {formatKstTime(updatedAt)}
        </span>
      </div>
      {children}
    </Card>
  );
}

// ── Pre-Market ──────────────────────────────────────────────────

function PreMarketCard({ data }: { data: GlobalSignalsResponse['preMarket'] }) {
  if (!data) {
    return (
      <CardShell title="Pre-Market Bias" icon={<Globe className="h-4 w-4" />}>
        <EmptySlot />
      </CardShell>
    );
  }

  const biasVariant =
    data.biasDirection === 'BULL' ? 'success'
    : data.biasDirection === 'BEAR' ? 'danger'
    : 'default';

  return (
    <CardShell title="Pre-Market Bias" icon={<Globe className="h-4 w-4" />} updatedAt={data.createdAt}>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-black font-num text-theme-text">
          {data.biasScore >= 0 ? '+' : ''}{data.biasScore.toFixed(0)}
        </span>
        <Badge variant={biasVariant} size="sm">
          {data.biasDirection}
        </Badge>
      </div>
      <div className="space-y-1 text-xs text-theme-text-secondary">
        {data.snapshots.slice(0, 4).map((s) => (
          <div key={s.symbol} className="flex items-center justify-between">
            <span className="truncate">{s.label}</span>
            <span className={`font-num ${s.changePct == null ? 'text-theme-text-muted' : s.changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatPct(s.changePct)}
            </span>
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ── DXY ─────────────────────────────────────────────────────────

function DxyCard({ data }: { data: GlobalSignalsResponse['dxy'] }) {
  if (!data) {
    return (
      <CardShell title="DXY 모니터" icon={<LineChart className="h-4 w-4" />}>
        <EmptySlot />
      </CardShell>
    );
  }

  const biasLabel =
    data.flowBias === 'FOREIGN_OUTFLOW' ? '외국인 이탈'
    : data.flowBias === 'FOREIGN_INFLOW' ? '외국인 복귀'
    : '교차검증 불일치';
  const biasVariant =
    data.flowBias === 'FOREIGN_OUTFLOW' ? 'danger'
    : data.flowBias === 'FOREIGN_INFLOW' ? 'success'
    : 'default';

  return (
    <CardShell title="DXY 모니터" icon={<LineChart className="h-4 w-4" />} updatedAt={data.createdAt}>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-black font-num text-theme-text">
          {data.reading.last.toFixed(2)}
        </span>
        <span className={`font-num text-sm ${data.reading.change1d >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {formatPct(data.reading.change1d)}
        </span>
      </div>
      <div className="space-y-1 text-xs text-theme-text-secondary">
        <div className="flex justify-between">
          <span>방향</span>
          <span>{data.direction === 'STRENGTH' ? '▲ STRENGTH' : '▼ WEAKNESS'} · {data.severity}</span>
        </div>
        <div className="flex justify-between">
          <span>USD/KRW 1d</span>
          <span className={`font-num ${toneFor(data.reading.krwChange) === 'success' ? 'text-green-400' : toneFor(data.reading.krwChange) === 'danger' ? 'text-red-400' : 'text-theme-text-muted'}`}>
            {formatPct(data.reading.krwChange)}
          </span>
        </div>
        <div className="flex justify-between">
          <span>EWY 1d</span>
          <span className={`font-num ${toneFor(data.reading.ewyChange) === 'success' ? 'text-green-400' : toneFor(data.reading.ewyChange) === 'danger' ? 'text-red-400' : 'text-theme-text-muted'}`}>
            {formatPct(data.reading.ewyChange)}
          </span>
        </div>
      </div>
      <Badge variant={biasVariant} size="sm">{biasLabel}</Badge>
    </CardShell>
  );
}

// ── ADR Gap ─────────────────────────────────────────────────────

function AdrGapCard({ data }: { data: GlobalSignalsResponse['adrGap'] }) {
  if (!data) {
    return (
      <CardShell title="ADR Gap" icon={<Activity className="h-4 w-4" />}>
        <EmptySlot />
      </CardShell>
    );
  }
  const entries = Object.entries(data.lastGaps ?? {});
  return (
    <CardShell title="ADR Gap" icon={<Activity className="h-4 w-4" />} updatedAt={data.lastSentAt}>
      {entries.length === 0 ? (
        <EmptySlot />
      ) : (
        <div className="space-y-1 text-xs text-theme-text-secondary">
          {entries.slice(0, 5).map(([sym, pct]) => (
            <div key={sym} className="flex items-center justify-between">
              <span className="truncate">{sym}</span>
              <span className={`font-num ${pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatPct(pct)}
              </span>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

// ── Sector ETF ──────────────────────────────────────────────────

function SectorEtfCard({ data }: { data: GlobalSignalsResponse['sectorEtf'] }) {
  if (!data) {
    return (
      <CardShell title="섹터 ETF Momentum" icon={<ArrowUp className="h-4 w-4" />}>
        <EmptySlot />
      </CardShell>
    );
  }

  const { topBullish, topBearish } = data;

  return (
    <CardShell title="섹터 ETF Momentum" icon={<ArrowUp className="h-4 w-4" />} updatedAt={data.createdAt}>
      <div className="space-y-2 text-xs">
        {topBullish && (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-green-400">
              <ArrowUp className="h-3 w-3" />
              {topBullish.label}
            </span>
            <span className="font-num text-green-400">{formatPct(topBullish.composite)}</span>
          </div>
        )}
        {topBearish && (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-red-400">
              <ArrowDown className="h-3 w-3" />
              {topBearish.label}
            </span>
            <span className="font-num text-red-400">{formatPct(topBearish.composite)}</span>
          </div>
        )}
        {!topBullish && !topBearish && <EmptySlot />}
      </div>
    </CardShell>
  );
}

function EmptySlot() {
  return (
    <div className="text-xs text-theme-text-muted italic">데이터 없음 — 다음 cron 실행을 기다리세요.</div>
  );
}
