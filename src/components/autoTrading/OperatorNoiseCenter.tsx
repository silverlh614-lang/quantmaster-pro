// @responsibility autoTrading 영역 OperatorNoiseCenter 표시 전용 컴포넌트
/**
 * OperatorNoiseCenter — 알림 소음 억제/압축 상태를 보여주는 운영 가시성 패널.
 *
 * 제한:
 *   - 매매 엔진, 주문 실행, Shadow 체결, Telegram 라우팅/정책 로직을 변경하지 않는다.
 *   - alert/noise telemetry 가 연결되면 그 값을 표시하고, 미연결 상태에서는 empty state 만 보여준다.
 */
import React, { useMemo } from 'react';
import {
  BellOff,
  CheckCircle2,
  Clock3,
  Info,
  RadioTower,
  ShieldAlert,
  ShieldCheck,
  TableProperties,
  Waves,
} from 'lucide-react';
import { Badge, Card, CardHeader, CardTitle, DataTable, type DataTableColumn } from '../../ui';
import { cn } from '../../ui/cn';

type NoiseSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
type NoiseFinalSeverity = NoiseSeverity | 'SUPPRESSED';

type NoiseExecutionImpact = 'NONE' | 'DEGRADED' | 'BLOCKING';
type NoiseChannelMode = 'NORMAL' | 'QUIET' | 'DIGEST' | 'MUTED';
type NoiseEngineMode = 'NORMAL' | 'DEGRADED' | 'SELL_ONLY' | 'SHADOW_ONLY' | 'OBSERVE_ONLY';
type NoiseRecommendedAction = 'IGNORE' | 'OBSERVE' | 'PATCH_LATER' | 'PATCH_NOW';

export interface NoiseEventView {
  id: string;
  eventKey: string;
  source: string;
  count: number;
  lastSeenAt: string;
  reason: string;
  originalSeverity: NoiseSeverity;
  finalSeverity: NoiseFinalSeverity;
  executionImpact: NoiseExecutionImpact;
  visibleInTelegram: boolean;
  visibleInRailway: boolean;
  recommendedAction: NoiseRecommendedAction;
  channelId?: string;
  time?: string;
}

interface NoiseChannelImpact {
  channelId: string;
  channelName: string;
  sent: number;
  suppressed: number;
  deduped: number;
  lastMessageAt?: string;
  currentMode: NoiseChannelMode;
}

export interface NoiseTelemetryRaw {
  suppressedLastHour?: number;
  suppressedToday?: number;
  activeNoisePolicy?: string;
  executionImpact?: NoiseExecutionImpact;
  engineMode?: NoiseEngineMode;
  engineAlive?: boolean;
  shadowLearning?: boolean;
  events?: NoiseEventView[];
  channels?: NoiseChannelImpact[];
}

interface NoiseSummaryViewModel {
  suppressedLastHour: number;
  suppressedToday: number;
  activeNoisePolicy: string;
  executionImpact: NoiseExecutionImpact;
  engineMode: NoiseEngineMode;
  engineAlive: boolean;
  shadowLearning: boolean;
  topEvents: NoiseEventView[];
  channels: NoiseChannelImpact[];
  suppressedEvents: NoiseEventView[];
  hasTelemetry: boolean;
}

interface OperatorNoiseCenterProps {
  telemetry?: NoiseTelemetryRaw | null;
  className?: string;
}

const EMPTY_POLICY = 'UNWIRED';
const DEFAULT_ENGINE_MODE: NoiseEngineMode = 'OBSERVE_ONLY';

const CHANNEL_NAMES: Record<string, string> = {
  CH1_PUBLIC_SIGNAL: 'CH1 Public Signal',
  CH2_PROFESSIONAL_ANALYSIS: 'CH2 Professional Analysis',
  CH3_SYSTEM_HEALTH: 'CH3 System Health',
  CH4_DEBUG_DIAGNOSTIC: 'CH4 Debug Diagnostic',
};

export function OperatorNoiseCenter({ telemetry, className }: OperatorNoiseCenterProps) {
  const model = useMemo(() => buildNoiseSummaryViewModel(telemetry), [telemetry]);
  const suppressionColumns = useMemo(() => buildSuppressionColumns(), []);

  return (
    <section className={cn('space-y-4', className)} aria-labelledby="operator-noise-center-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
            <Waves className="h-3.5 w-3.5" />
            Operator Noise Center
          </div>
          <h2 id="operator-noise-center-title" className="mt-1 text-xl font-black text-theme-text">
            알림 소음 관제 센터
          </h2>
          <p className="mt-1 text-sm text-theme-text-secondary">
            압축·억제된 운영 알림과 실제 매매 영향 여부를 분리해서 표시합니다.
          </p>
        </div>
        <Badge variant={model.hasTelemetry ? 'info' : 'default'} size="sm">
          {model.hasTelemetry ? 'Telemetry connected' : 'Telemetry pending'}
        </Badge>
      </div>

      {!model.hasTelemetry && <NoiseTelemetryEmptyState />}

      <SafetyAssuranceBanner model={model} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <NoiseSummaryCard model={model} />
        <TopNoisySourcesCard events={model.topEvents} />
        <ChannelImpactCard channels={model.channels} />
      </div>

      <SuppressionReasonTable columns={suppressionColumns} events={model.suppressedEvents} />
    </section>
  );
}

function buildNoiseSummaryViewModel(raw?: NoiseTelemetryRaw | null): NoiseSummaryViewModel {
  const events = raw?.events ?? [];
  const channels = raw?.channels ?? groupNoiseByChannel(events);
  const topEvents = [...events]
    .sort((a, b) => b.count - a.count || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
    .slice(0, 5)
    .map((event) => ({
      ...event,
      originalSeverity: deriveNoiseSeverity(event),
      recommendedAction: deriveRecommendedAction(event),
    }));

  const suppressedEvents = events
    .filter((event) => event.finalSeverity === 'SUPPRESSED' || /dedup|suppress|throttle|digest/i.test(event.reason))
    .map((event) => ({
      ...event,
      originalSeverity: deriveNoiseSeverity(event),
      recommendedAction: deriveRecommendedAction(event),
    }));

  return {
    suppressedLastHour: raw?.suppressedLastHour ?? 0,
    suppressedToday: raw?.suppressedToday ?? 0,
    activeNoisePolicy: raw?.activeNoisePolicy ?? EMPTY_POLICY,
    executionImpact: raw?.executionImpact ?? deriveHighestExecutionImpact(events),
    engineMode: raw?.engineMode ?? DEFAULT_ENGINE_MODE,
    engineAlive: raw?.engineAlive ?? false,
    shadowLearning: raw?.shadowLearning ?? false,
    topEvents,
    channels,
    suppressedEvents,
    hasTelemetry: Boolean(raw && (events.length > 0 || channels.length > 0 || raw.activeNoisePolicy)),
  };
}

function deriveNoiseSeverity(event: NoiseEventView): NoiseSeverity {
  if (event.executionImpact === 'BLOCKING') return 'CRITICAL';
  if (event.executionImpact === 'DEGRADED') return event.originalSeverity === 'INFO' ? 'WARN' : event.originalSeverity;
  return event.originalSeverity;
}

function deriveRecommendedAction(event: NoiseEventView): NoiseRecommendedAction {
  if (event.executionImpact === 'BLOCKING') return 'PATCH_NOW';
  if (event.executionImpact === 'DEGRADED') return 'OBSERVE';
  if (event.finalSeverity === 'SUPPRESSED' || event.count >= 10) return 'IGNORE';
  if (event.originalSeverity === 'ERROR' || event.originalSeverity === 'CRITICAL') return 'PATCH_LATER';
  return event.recommendedAction ?? 'OBSERVE';
}

function groupNoiseByChannel(events: NoiseEventView[]): NoiseChannelImpact[] {
  const grouped = new Map<string, NoiseChannelImpact>();

  for (const event of events) {
    const channelId = event.channelId ?? 'CH3_SYSTEM_HEALTH';
    const current = grouped.get(channelId) ?? {
      channelId,
      channelName: CHANNEL_NAMES[channelId] ?? channelId,
      sent: 0,
      suppressed: 0,
      deduped: 0,
      lastMessageAt: undefined,
      currentMode: 'NORMAL' as NoiseChannelMode,
    };

    if (event.visibleInTelegram) current.sent += event.count;
    if (event.finalSeverity === 'SUPPRESSED') current.suppressed += event.count;
    if (/dedup/i.test(event.reason)) current.deduped += event.count;
    if (!current.lastMessageAt || Date.parse(event.lastSeenAt) > Date.parse(current.lastMessageAt)) {
      current.lastMessageAt = event.lastSeenAt;
    }
    current.currentMode = deriveChannelMode(current);
    grouped.set(channelId, current);
  }

  return Array.from(grouped.values()).sort((a, b) => b.suppressed + b.deduped - (a.suppressed + a.deduped));
}

function formatNoiseTimestamp(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getNoiseBadgeVariant(status: NoiseExecutionImpact | NoiseChannelMode | NoiseFinalSeverity | NoiseRecommendedAction) {
  if (status === 'BLOCKING' || status === 'CRITICAL' || status === 'PATCH_NOW') return 'danger' as const;
  if (status === 'DEGRADED' || status === 'WARN' || status === 'QUIET' || status === 'PATCH_LATER') return 'warning' as const;
  if (status === 'NONE' || status === 'NORMAL' || status === 'INFO' || status === 'IGNORE') return 'default' as const;
  if (status === 'DIGEST' || status === 'SUPPRESSED' || status === 'OBSERVE') return 'info' as const;
  return 'default' as const;
}

function NoiseTelemetryEmptyState() {
  return (
    <Card padding="sm" tone="info" className="border-dashed border-blue-400/25">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300">
          <Info className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-theme-text">No noise telemetry available yet</div>
          <div className="text-sm text-theme-text-secondary">
            Connect alert/noise telemetry source to populate this panel.
          </div>
        </div>
      </div>
    </Card>
  );
}

function SafetyAssuranceBanner({ model }: { model: NoiseSummaryViewModel }) {
  const safe = model.engineAlive && model.shadowLearning && model.executionImpact === 'NONE';
  const blocking = model.executionImpact === 'BLOCKING';

  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3 text-sm',
        safe && 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100',
        !safe && !blocking && 'border-slate-500/20 bg-white/[0.03] text-theme-text-secondary',
        blocking && 'border-red-500/35 bg-red-500/[0.08] text-red-100',
      )}
    >
      <div className="flex items-start gap-3">
        {safe ? <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-300" /> : <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-300" />}
        <div className="min-w-0 flex-1">
          <div className="font-black text-theme-text">
            {safe ? 'Trading Engine / Shadow Learning 상태 분리 유지' : 'Noise 정책과 실행 영향 상태를 분리 확인하세요'}
          </div>
          <div className="mt-1 text-xs leading-relaxed opacity-85">
            알림이 억제되어도 Trading Engine / Shadow Learning 상태는 별도로 유지됩니다.
            현재 executionImpact 는 <span className="font-mono font-bold">{model.executionImpact}</span>,
            engineMode 는 <span className="font-mono font-bold">{model.engineMode}</span> 입니다.
          </div>
        </div>
      </div>
    </div>
  );
}

function NoiseSummaryCard({ model }: { model: NoiseSummaryViewModel }) {
  const impactVariant = getNoiseBadgeVariant(model.executionImpact);
  return (
    <Card padding="sm" tone={model.executionImpact === 'NONE' ? 'neutral' : model.executionImpact === 'DEGRADED' ? 'warning' : 'danger'}>
      <CardHeader className="mb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellOff className="h-4 w-4 text-slate-300" /> Noise Summary
        </CardTitle>
        <Badge variant={impactVariant}>{model.executionImpact}</Badge>
      </CardHeader>
      <div className="grid grid-cols-2 gap-3">
        <MetricTile label="최근 1시간 suppressed" value={model.suppressedLastHour.toLocaleString()} />
        <MetricTile label="오늘 suppressed" value={model.suppressedToday.toLocaleString()} />
        <MetricTile label="Active policy" value={model.activeNoisePolicy} mono />
        <MetricTile label="Engine mode" value={model.engineMode} mono />
      </div>
    </Card>
  );
}

function TopNoisySourcesCard({ events }: { events: NoiseEventView[] }) {
  return (
    <Card padding="sm">
      <CardHeader className="mb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <RadioTower className="h-4 w-4 text-slate-300" /> Top Noisy Sources
        </CardTitle>
        <Badge variant="default">Top 5</Badge>
      </CardHeader>
      {events.length === 0 ? (
        <InlineEmpty message="No noisy source telemetry yet" />
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs font-bold text-theme-text">{event.eventKey}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant={getNoiseBadgeVariant(event.executionImpact)} size="sm">{event.executionImpact}</Badge>
                    <Badge variant={getNoiseBadgeVariant(event.originalSeverity)} size="sm">{event.originalSeverity}</Badge>
                    <Badge variant={getNoiseBadgeVariant(event.recommendedAction)} size="sm">{event.recommendedAction}</Badge>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-lg font-black text-theme-text">{event.count}</div>
                  <div className="text-[10px] text-theme-text-muted">{formatNoiseTimestamp(event.lastSeenAt)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ChannelImpactCard({ channels }: { channels: NoiseChannelImpact[] }) {
  return (
    <Card padding="sm">
      <CardHeader className="mb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock3 className="h-4 w-4 text-slate-300" /> Channel Impact
        </CardTitle>
      </CardHeader>
      {channels.length === 0 ? (
        <InlineEmpty message="No Telegram channel stats yet" />
      ) : (
        <div className="space-y-3">
          {channels.map((channel) => (
            <div key={channel.channelId} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-theme-text">{channel.channelName}</div>
                  <div className="mt-1 font-mono text-[10px] text-theme-text-muted">{channel.channelId}</div>
                </div>
                <Badge variant={getNoiseBadgeVariant(channel.currentMode)} size="sm">{channel.currentMode}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <MiniStat label="sent" value={channel.sent} />
                <MiniStat label="suppressed" value={channel.suppressed} />
                <MiniStat label="deduped" value={channel.deduped} />
              </div>
              <div className="mt-2 text-[10px] text-theme-text-muted">
                lastMessageAt: <span className="font-mono">{formatNoiseTimestamp(channel.lastMessageAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SuppressionReasonTable({
  columns,
  events,
}: {
  columns: DataTableColumn<NoiseEventView>[];
  events: NoiseEventView[];
}) {
  return (
    <Card padding="sm">
      <CardHeader className="mb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <TableProperties className="h-4 w-4 text-slate-300" /> Suppression Reason Table
        </CardTitle>
        <Badge variant="default">{events.length}</Badge>
      </CardHeader>
      <DataTable
        columns={columns}
        data={events}
        rowKey={(row) => row.id}
        emptyMessage="No suppressed or deduped events available yet"
        caption="Suppressed and deduped noise events"
        maxHeight="420px"
      />
    </Card>
  );
}

function buildSuppressionColumns(): DataTableColumn<NoiseEventView>[] {
  return [
    { key: 'time', header: 'time', accessor: (row) => formatNoiseTimestamp(row.time ?? row.lastSeenAt), sortKey: (row) => Date.parse(row.time ?? row.lastSeenAt) || 0 },
    { key: 'eventKey', header: 'eventKey', accessor: (row) => <span className="font-mono text-xs">{row.eventKey}</span>, sortKey: (row) => row.eventKey },
    { key: 'source', header: 'source', accessor: (row) => row.source, sortKey: (row) => row.source },
    { key: 'reason', header: 'reason', accessor: (row) => row.reason, sortKey: (row) => row.reason },
    { key: 'originalSeverity', header: 'originalSeverity', accessor: (row) => <Badge variant={getNoiseBadgeVariant(row.originalSeverity)} size="sm">{row.originalSeverity}</Badge>, sortKey: (row) => row.originalSeverity },
    { key: 'finalSeverity', header: 'finalSeverity', accessor: (row) => <Badge variant={getNoiseBadgeVariant(row.finalSeverity)} size="sm">{row.finalSeverity}</Badge>, sortKey: (row) => row.finalSeverity },
    { key: 'executionImpact', header: 'executionImpact', accessor: (row) => <Badge variant={getNoiseBadgeVariant(row.executionImpact)} size="sm">{row.executionImpact}</Badge>, sortKey: (row) => row.executionImpact },
    { key: 'visibleInTelegram', header: 'visibleInTelegram', accessor: (row) => booleanIcon(row.visibleInTelegram), sortKey: (row) => Number(row.visibleInTelegram), align: 'center' },
    { key: 'visibleInRailway', header: 'visibleInRailway', accessor: (row) => booleanIcon(row.visibleInRailway), sortKey: (row) => Number(row.visibleInRailway), align: 'center' },
    { key: 'nextAction', header: 'nextAction', accessor: (row) => <Badge variant={getNoiseBadgeVariant(row.recommendedAction)} size="sm">{row.recommendedAction}</Badge>, sortKey: (row) => row.recommendedAction },
  ];
}

function MetricTile({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-theme-text-muted">{label}</div>
      <div className={cn('mt-1 truncate text-lg font-black text-theme-text', mono && 'font-mono text-sm')}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/[0.035] px-2 py-1.5">
      <div className="font-mono text-sm font-black text-theme-text">{value.toLocaleString()}</div>
      <div className="text-[9px] uppercase tracking-wide text-theme-text-muted">{label}</div>
    </div>
  );
}

function InlineEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-6 text-center text-sm text-theme-text-muted">
      {message}
    </div>
  );
}

function booleanIcon(value: boolean) {
  return value ? <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-300" /> : <span className="text-theme-text-muted">false</span>;
}

function deriveChannelMode(channel: NoiseChannelImpact): NoiseChannelMode {
  if (channel.suppressed > channel.sent && channel.suppressed >= 10) return 'DIGEST';
  if (channel.suppressed > 0 || channel.deduped > 0) return 'QUIET';
  return channel.currentMode;
}

function deriveHighestExecutionImpact(events: NoiseEventView[]): NoiseExecutionImpact {
  if (events.some((event) => event.executionImpact === 'BLOCKING')) return 'BLOCKING';
  if (events.some((event) => event.executionImpact === 'DEGRADED')) return 'DEGRADED';
  return 'NONE';
}
