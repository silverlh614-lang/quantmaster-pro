// @responsibility pending wiring dashboard 표시 컴포넌트
import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, FileClock, ShieldAlert } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Card } from '../../ui/card';
import { cn } from '../../ui/cn';
import { loadPendingWiringItems } from '../../lib/pendingWiringRegistry';
import {
  PENDING_PRIORITIES,
  countPendingByPriority,
  countPendingByScope,
  countPendingByStatus,
  derivePendingRiskBanner,
  derivePendingSafeBanner,
  getDueSoonPendingItems,
  getOverduePendingItems,
  getPendingImpactVariant,
  getPendingRecommendedAction,
  getPendingStatusDescription,
  getPendingStatusLabel,
} from '../../lib/pendingWiringViewModel';
import type {
  PendingPriority,
  PendingWiringItem,
  PendingWiringStatus,
} from '../../types/pendingWiring';

interface PendingWiringDashboardProps {
  items?: PendingWiringItem[] | null;
  className?: string;
  now?: Date;
}

export function PendingWiringDashboard({ items, className, now }: PendingWiringDashboardProps) {
  const registryItems = useMemo(() => items ?? loadPendingWiringItems(), [items]);
  const model = useMemo(() => buildPendingDashboardModel(registryItems, now), [registryItems, now]);

  return (
    <section className={cn('space-y-4', className)} aria-labelledby="pending-wiring-title">
      <DashboardHeader count={model.total} />
      {model.total === 0 ? <PendingEmptyState /> : <PendingBanner risk={model.riskBanner} safe={model.safeBanner} />}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <PendingSummaryCard model={model} />
        <PriorityBreakdownCard model={model} />
        <ScopeImpactCard model={model} />
      </div>
      <WiringStatusTable items={model.items} />
    </section>
  );
}

function buildPendingDashboardModel(items: PendingWiringItem[], now?: Date) {
  const byPriority = countPendingByPriority(items);
  const byStatus = countPendingByStatus(items);
  const byScope = countPendingByScope(items);
  const overdue = getOverduePendingItems(items, now);
  const dueSoon = getDueSoonPendingItems(items, now);
  return {
    items: sortPendingItems(items),
    total: items.length,
    byPriority,
    byStatus,
    byScope,
    overdue,
    dueSoon,
    riskBanner: derivePendingRiskBanner(items),
    safeBanner: derivePendingSafeBanner(items),
  };
}

function DashboardHeader({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-[10px] font-black tracking-tight text-slate-400">
          <FileClock className="h-3.5 w-3.5" />
          배선 대기 대시보드
        </div>
        <h2 id="pending-wiring-title" className="mt-1 text-xl font-black text-theme-text">
          배선 대기 가시성
        </h2>
        <p className="mt-1 text-sm text-theme-text-secondary">
          실행 경로를 바꾸지 않으면서 아직 완전히 배선되지 않은 모듈을 표시합니다.
        </p>
      </div>
      <Badge variant={count > 0 ? 'warning' : 'default'} size="sm">
        {count > 0 ? `대기 항목 ${count}건` : '레지스트리 비어 있음'}
      </Badge>
    </div>
  );
}

function PendingBanner({ risk, safe }: { risk: string | null; safe: string | null }) {
  if (risk) {
    return (
      <Card padding="sm" tone="danger" className="border border-red-500/25">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          <div>
            <div className="text-sm font-black text-red-200">위험 배너</div>
            <p className="mt-1 text-sm text-theme-text-secondary">{risk}</p>
          </div>
        </div>
      </Card>
    );
  }
  if (!safe) return null;
  return (
    <Card padding="sm" tone="success" className="border border-emerald-500/25">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
        <div>
          <div className="text-sm font-black text-emerald-200">안전 백로그 배너</div>
          <p className="mt-1 text-sm text-theme-text-secondary">{safe}</p>
        </div>
      </div>
    </Card>
  );
}

function PendingEmptyState() {
  return (
    <Card padding="sm" tone="info" className="border-dashed border-blue-400/25">
      <div className="flex items-start gap-3">
        <FileClock className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" />
        <div>
          <div className="text-sm font-black text-theme-text">배선 대기 텔레메트리가 없습니다.</div>
          <p className="mt-1 text-sm text-theme-text-secondary">
            이 대시보드를 채우려면 배선 대기 레지스트리 또는 파서를 연결하세요.
          </p>
        </div>
      </div>
    </Card>
  );
}

function PendingSummaryCard({ model }: { model: ReturnType<typeof buildPendingDashboardModel> }) {
  const statusChips: Array<[PendingWiringStatus, number]> = [
    ['INFRASTRUCTURE_ONLY', model.byStatus.INFRASTRUCTURE_ONLY],
    ['PARTIAL', model.byStatus.PARTIAL],
    ['OBSERVE_ONLY', model.byStatus.OBSERVE_ONLY],
    ['SHADOW_ONLY', model.byStatus.SHADOW_ONLY],
  ];
  return (
    <Card padding="sm" className="space-y-4">
      <CardTitleEyebrow title="대기 요약" eyebrow="레지스트리 합계" />
      <div className="grid grid-cols-2 gap-3">
        <Metric label="전체" value={model.total} tone="text-theme-text" />
        <Metric label="기한 초과" value={model.overdue.length} tone="text-red-300" />
        <Metric label="기한 임박" value={model.dueSoon.length} tone="text-amber-300" />
        <Metric label="LIVE 범위" value={model.byScope.LIVE} tone="text-red-300" />
      </div>
      <div className="flex flex-wrap gap-2">
        {PENDING_PRIORITIES.map((priority) => (
          <Badge key={priority} variant={priorityVariant(priority)} size="sm">
            {priority} {model.byPriority[priority]}
          </Badge>
        ))}
        {statusChips.map(([status, count]) => (
          <Badge key={status} variant={statusVariant(status)} size="sm" title={getPendingStatusDescription(status)}>
            {status} {count}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

function PriorityBreakdownCard({ model }: { model: ReturnType<typeof buildPendingDashboardModel> }) {
  return (
    <Card padding="sm" className="space-y-3">
      <CardTitleEyebrow title="우선순위 분류" eyebrow="상위 백로그" />
      {PENDING_PRIORITIES.map((priority) => (
        <PriorityRow key={priority} priority={priority} items={model.items.filter((item) => item.priority === priority)} />
      ))}
    </Card>
  );
}

function ScopeImpactCard({ model }: { model: ReturnType<typeof buildPendingDashboardModel> }) {
  const scopes = Object.entries(model.byScope).filter(([, count]) => count > 0).slice(0, 9);
  return (
    <Card padding="sm" className="space-y-3">
      <CardTitleEyebrow title="영향 범위" eyebrow="실행 격리" />
      <div className="flex flex-wrap gap-2">
        {scopes.map(([scope, count]) => (
          <Badge key={scope} variant={scope === 'LIVE' ? 'danger' : 'info'} size="sm">
            {scope} {count}
          </Badge>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-theme-text-secondary">
        빨간색은 LIVE 노출 또는 차단 영향에만 사용됩니다. 섀도우·관측 상태는 과도한 경보 없이 계속 표시됩니다.
      </p>
    </Card>
  );
}

function PriorityRow({ priority, items }: { priority: PendingPriority; items: PendingWiringItem[] }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={priorityVariant(priority)} size="sm">{priority}</Badge>
        <span className="text-xs font-black text-theme-text">{items.length}</span>
      </div>
      <p className="mt-2 text-xs font-semibold text-theme-text-secondary">{priorityDescription(priority)}</p>
      <ul className="mt-2 space-y-1 text-xs text-slate-300">
        {items.slice(0, 3).map((item) => <li key={item.id} className="truncate">{item.id} · {item.moduleName}</li>)}
        {items.length === 0 && <li className="text-slate-500">항목 없음</li>}
      </ul>
    </div>
  );
}

function WiringStatusTable({ items }: { items: PendingWiringItem[] }) {
  return (
    <Card padding="sm" className="space-y-4">
      <CardTitleEyebrow title="배선 상태 표" eyebrow="소스 레지스트리 행" />
      <div className="hidden overflow-x-auto lg:block">
        <table className="min-w-full text-left text-xs">
          <thead className="text-[10px] tracking-tight text-slate-500">
            <tr>
              {['우선순위', '모듈', '상태', '범위', '소스', '담당자', '생성일', '기한', '영향', '다음 조치'].map((header) => (
                <th key={header} className="border-b border-white/[0.07] px-3 py-2 font-black">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {items.map((item) => <WiringTableRow key={item.id} item={item} />)}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden">
        {items.map((item) => <WiringMobileCard key={item.id} item={item} />)}
      </div>
      {items.length === 0 && <PendingEmptyState />}
    </Card>
  );
}

function WiringTableRow({ item }: { item: PendingWiringItem }) {
  return (
    <tr className="align-top text-theme-text-secondary">
      <td className="px-3 py-3"><Badge variant={priorityVariant(item.priority)} size="sm">{item.priority}</Badge></td>
      <td className="max-w-[220px] px-3 py-3 font-bold text-theme-text">{item.moduleName}</td>
      <td className="px-3 py-3"><StatusBadge status={item.status} /></td>
      <td className="px-3 py-3"><ScopeList item={item} /></td>
      <td className="max-w-[220px] px-3 py-3 font-mono text-[11px]">{item.sourceFile ?? '—'}</td>
      <td className="px-3 py-3">{item.owner ?? '—'}</td>
      <td className="px-3 py-3">{item.createdAt ?? '—'}</td>
      <td className="px-3 py-3">{item.dueAt ?? '—'}</td>
      <td className="px-3 py-3"><Badge variant={getPendingImpactVariant(item.executionImpact)} size="sm">{item.executionImpact}</Badge></td>
      <td className="max-w-[320px] px-3 py-3">{getPendingRecommendedAction(item)}</td>
    </tr>
  );
}

function WiringMobileCard({ item }: { item: PendingWiringItem }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={priorityVariant(item.priority)} size="sm">{item.priority}</Badge>
        <StatusBadge status={item.status} />
        <Badge variant={getPendingImpactVariant(item.executionImpact)} size="sm">{item.executionImpact}</Badge>
      </div>
      <div className="mt-3 font-black text-theme-text">{item.moduleName}</div>
      <div className="mt-2"><ScopeList item={item} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-theme-text-secondary">
        <InfoTerm label="소스" value={item.sourceFile ?? '—'} />
        <InfoTerm label="담당자" value={item.owner ?? '—'} />
        <InfoTerm label="생성일" value={item.createdAt ?? '—'} />
        <InfoTerm label="기한" value={item.dueAt ?? '—'} />
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-slate-300">{getPendingRecommendedAction(item)}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: PendingWiringStatus }) {
  return (
    <Badge variant={statusVariant(status)} size="sm" title={getPendingStatusDescription(status)}>
      {getPendingStatusLabel(status)}
    </Badge>
  );
}

function ScopeList({ item }: { item: PendingWiringItem }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {item.scope.map((scope) => <Badge key={scope} variant={scope === 'LIVE' ? 'danger' : 'default'} size="sm">{scope}</Badge>)}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/10 p-3">
      <div className="text-[10px] font-black tracking-tight text-slate-500">{label}</div>
      <div className={cn('mt-1 text-2xl font-black', tone)}>{value}</div>
    </div>
  );
}

function InfoTerm({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold tracking-tight text-slate-500">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}

function CardTitleEyebrow({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div>
      <div className="text-[10px] font-black tracking-tight text-slate-500">{eyebrow}</div>
      <h3 className="mt-1 text-base font-black text-theme-text">{title}</h3>
    </div>
  );
}

function sortPendingItems(items: PendingWiringItem[]): PendingWiringItem[] {
  const priorityRank: Record<PendingPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return [...items].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.id.localeCompare(b.id));
}

function priorityVariant(priority: PendingPriority) {
  if (priority === 'P0') return 'danger' as const;
  if (priority === 'P1') return 'warning' as const;
  if (priority === 'P2') return 'info' as const;
  return 'default' as const;
}

function statusVariant(status: PendingWiringStatus) {
  if (status === 'BLOCKED') return 'danger' as const;
  if (status === 'PARTIAL' || status === 'INFRASTRUCTURE_ONLY') return 'warning' as const;
  if (status === 'SHADOW_ONLY' || status === 'OBSERVE_ONLY' || status === 'ADVISORY_ONLY') return 'info' as const;
  if (status === 'DONE') return 'success' as const;
  return 'default' as const;
}

function priorityDescription(priority: PendingPriority): string {
  if (priority === 'P0') return '즉시 검토 필요';
  if (priority === 'P1') return '다음 패치 우선순위';
  if (priority === 'P2') return '계획된 개선';
  return '저위험 백로그';
}
