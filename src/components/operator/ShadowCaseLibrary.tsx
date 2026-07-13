// @responsibility Operator Shadow Case Library UI for read-only Shadow Learning telemetry.
import * as React from 'react';
import {
  ALL_SHADOW_CASE_TYPES,
  countShadowCasesByStatus,
  countShadowCasesByType,
  deriveShadowCaseSeverity,
  deriveShadowLearningBanner,
  deriveShadowRecommendedAction,
  formatShadowCaseTimestamp,
  getCasesWithExecutionImpactRisk,
  getOutcomePendingCases,
  getOpenShadowCases,
  getShadowCaseTypeDescription,
  getShadowCaseTypeLabel,
  splitProviderIssueAndMarketSignal,
} from '../../lib/shadowCaseViewModel';
import type { ShadowCaseItem, ShadowCaseLibraryResponse, ShadowCounterfactualOutcome } from '../../types/shadowCase';

interface ShadowCaseLibraryProps {
  data?: ShadowCaseLibraryResponse;
  loading?: boolean;
  error?: Error | null;
}

function panelClass(extra = ''): string {
  return `rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-lg shadow-black/20 ${extra}`;
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'safe' | 'warn' | 'danger' | 'info' }): React.ReactElement {
  const toneClass = {
    neutral: 'border-zinc-700 bg-zinc-900 text-zinc-300',
    safe: 'border-emerald-700/60 bg-emerald-950/50 text-emerald-300',
    warn: 'border-amber-700/60 bg-amber-950/50 text-amber-300',
    danger: 'border-rose-700/60 bg-rose-950/50 text-rose-300',
    info: 'border-sky-700/60 bg-sky-950/50 text-sky-300',
  }[tone];
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass}`}>{children}</span>;
}

function EmptyState(): React.ReactElement {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/50 p-6 text-sm text-zinc-400">
      <p className="font-semibold text-zinc-200">📭 아직 수집된 Shadow Case 가 없습니다.</p>
      <p className="mt-2">실거래가 차단된 상황에서도 Shadow Learning 은 계속 가상 케이스를 기록합니다. 첫 케이스가 발생하면 자동으로 표시됩니다.</p>
      <p className="mt-2 text-xs text-zinc-500">Shadow Case 는 실제 체결이 아닌 학습용 가상/관측 데이터입니다.</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function impactTone(impact: string): 'neutral' | 'safe' | 'warn' | 'danger' | 'info' {
  if (impact === 'NONE') return 'safe';
  if (impact === 'NEW_BUY_BLOCKED_ONLY' || impact === 'SHADOW_ONLY') return 'warn';
  return 'danger';
}

function severityTone(severity: string): 'neutral' | 'safe' | 'warn' | 'danger' | 'info' {
  if (severity === 'INFO') return 'info';
  if (severity === 'WARN') return 'warn';
  return 'danger';
}

function ShadowLearningStatusCard({ data }: { data: ShadowCaseLibraryResponse }): React.ReactElement {
  const items = data.items;
  const byStatus = countShadowCasesByStatus(items);
  const impactRisk = getCasesWithExecutionImpactRisk(items);
  const banner = deriveShadowLearningBanner(items);
  const reassure = data.status.shadowLearning && data.status.shadowAllowed && impactRisk.length === 0;
  const warn = !data.status.shadowLearning || !data.status.shadowAllowed || impactRisk.length > 0;
  return (
    <section className={panelClass()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-zinc-100">Shadow Learning 상태</h2>
          <p className="mt-1 text-xs text-zinc-500">실거래 실행 제어는 Shadow 케이스 기록과 분리되어 표시됩니다.</p>
        </div>
        <Badge tone={data.status.shadowLearning ? 'safe' : 'danger'}>shadowLearning={String(data.status.shadowLearning)}</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="engineMode" value={<Badge tone={data.status.engineMode === 'NORMAL' ? 'safe' : 'info'}>{data.status.engineMode}</Badge>} />
        <Stat label="executionAllowed" value={String(data.status.executionAllowed)} />
        <Stat label="shadowAllowed" value={String(data.status.shadowAllowed)} />
        <Stat label="todayCaseCount" value={items.length} />
        <Stat label="openCaseCount" value={getOpenShadowCases(items).length} />
        <Stat label="resolvedCaseCount" value={byStatus.RESOLVED} />
        <Stat label="postOutcomePendingCount" value={getOutcomePendingCases(items).length} />
        <Stat label="lastCaseAt" value={formatShadowCaseTimestamp(data.status.lastCaseAt)} />
      </div>
      {reassure && banner && <div className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{banner}</div>}
      {warn && <div className="mt-4 rounded-xl border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">{banner ?? 'Shadow Learning 위험이 감지되었습니다. 텔레메트리 배선과 실행 영향 메타데이터를 점검하세요.'}</div>}
    </section>
  );
}

function ShadowCaseTypeSummary({ items }: { items: ShadowCaseItem[] }): React.ReactElement {
  const counts = countShadowCasesByType(items);
  const populated = ALL_SHADOW_CASE_TYPES.filter((caseType) => counts[caseType] > 0);
  return (
    <section className={panelClass()}>
      <h2 className="text-lg font-bold text-zinc-100">케이스 유형 요약</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(populated.length > 0 ? populated : ALL_SHADOW_CASE_TYPES.slice(0, 8)).map((caseType) => {
          const rows = items.filter((item) => item.caseType === caseType);
          const latest = rows[0];
          const severity = latest ? deriveShadowCaseSeverity(latest) : 'INFO';
          return (
            <div key={caseType} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3" title={getShadowCaseTypeDescription(caseType)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{getShadowCaseTypeLabel(caseType)}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{getShadowCaseTypeDescription(caseType)}</p>
                </div>
                <Badge tone={severityTone(severity)}>{severity}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-400">
                <span>count: <strong className="text-zinc-100">{counts[caseType]}</strong></span>
                <span>last: {formatShadowCaseTimestamp(latest?.timestamp)}</span>
                <span>impact: {latest?.executionImpact ?? 'NONE'}</span>
                <span>learning: {latest ? latest.confidenceLevel : 'N/A'}</span>
              </div>
              <p className="mt-2 text-xs text-zinc-500">{latest ? deriveShadowRecommendedAction(latest) : '권장 조치를 채우려면 텔레메트리를 연결하세요.'}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CaseRow({ item }: { item: ShadowCaseItem }): React.ReactElement {
  return (
    <tr className="border-t border-zinc-800 align-top text-xs text-zinc-300">
      <td className="px-3 py-3 whitespace-nowrap">{formatShadowCaseTimestamp(item.timestamp)}</td>
      <td className="px-3 py-3"><span className="font-mono text-zinc-100">{item.symbol ?? '-'}</span><div className="text-zinc-500">{item.symbolName ?? '-'}</div></td>
      <td className="px-3 py-3" title={getShadowCaseTypeDescription(item.caseType)}>{getShadowCaseTypeLabel(item.caseType)}</td>
      <td className="px-3 py-3"><Badge tone="info">{item.engineMode}</Badge></td>
      <td className="px-3 py-3">{item.blockedReason ?? '-'}</td>
      <td className="px-3 py-3">{item.dataProvider ?? '-'}<div className="text-zinc-500">{item.dataHealth}</div></td>
      <td className="px-3 py-3">{item.confidenceLevel}</td>
      <td className="px-3 py-3">{item.expectedDecision ?? '-'}</td>
      <td className="px-3 py-3">{item.actualDecision ?? '-'}</td>
      <td className="px-3 py-3"><Badge tone="neutral">Shadow: {item.shadowDecision ?? '-'}</Badge></td>
      <td className="px-3 py-3"><Badge tone={impactTone(item.executionImpact)}>{item.executionImpact}</Badge></td>
      <td className="px-3 py-3">{item.postOutcome}</td>
      <td className="px-3 py-3">{item.learningTag ?? '-'}</td>
      <td className="px-3 py-3">{item.status}</td>
      <td className="px-3 py-3">{item.nextAction ?? deriveShadowRecommendedAction(item)}</td>
    </tr>
  );
}

function CaseCard({ item }: { item: ShadowCaseItem }): React.ReactElement {
  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
      <div className="flex items-start justify-between gap-3">
        <div><strong className="text-zinc-100">{item.symbolName ?? item.symbol ?? '시장 케이스'}</strong><p className="text-xs text-zinc-500">{formatShadowCaseTimestamp(item.timestamp)}</p></div>
        <Badge tone={impactTone(item.executionImpact)}>{item.executionImpact}</Badge>
      </div>
      <p className="mt-2 text-zinc-200">{getShadowCaseTypeLabel(item.caseType)}</p>
      <p className="mt-1 text-xs text-zinc-500">{item.blockedReason ?? getShadowCaseTypeDescription(item.caseType)}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <span>engineMode: {item.engineMode}</span><span>dataHealth: {item.dataHealth}</span>
        <span>shadowDecision: {item.shadowDecision ?? '-'}</span><span>postOutcome: {item.postOutcome}</span>
        <span>status: {item.status}</span><span>provider: {item.dataProvider ?? '-'}</span>
      </div>
      <p className="mt-3 text-xs text-zinc-500">{item.nextAction ?? deriveShadowRecommendedAction(item)}</p>
    </article>
  );
}

function ShadowCaseTable({ items }: { items: ShadowCaseItem[] }): React.ReactElement {
  return (
    <section className={panelClass()}>
      <h2 className="text-lg font-bold text-zinc-100">Shadow 케이스 표</h2>
      <div className="mt-4 hidden overflow-x-auto lg:block">
        <table className="min-w-[1500px] w-full text-left">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>{['time', 'symbol', 'caseType', 'engineMode', 'blockedReason', 'dataProvider / health', 'confidence', 'expected', 'actual', 'shadow', 'executionImpact', 'postOutcome', 'learningTag', 'status', 'nextAction'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>{items.map((item) => <CaseRow key={item.id} item={item} />)}</tbody>
        </table>
      </div>
      <div className="mt-4 space-y-3 lg:hidden">{items.map((item) => <CaseCard key={item.id} item={item} />)}</div>
    </section>
  );
}

function formatPct(value?: number): string {
  return value === undefined ? 'N/A' : `${value.toFixed(2)}%`;
}

function formatPrice(value?: number): string {
  return value === undefined ? 'N/A' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function CounterfactualOutcomeCard({ outcomes }: { outcomes: ShadowCounterfactualOutcome[] }): React.ReactElement {
  const rows = outcomes.slice(0, 6);
  return (
    <section className={panelClass()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-zinc-100">반사실 결과</h2>
        <Badge tone="info">가상 / Shadow 전용</Badge>
      </div>
      {rows.length === 0 ? <p className="mt-4 text-sm text-zinc-500">아직 연결된 반사실 결과 텔레메트리가 없습니다.</p> : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <article key={row.caseId} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
              <div className="flex items-center justify-between"><strong className="font-mono text-zinc-100">{row.symbol}</strong><Badge tone={row.outcome === 'WIN' ? 'safe' : row.outcome === 'LOSS' ? 'danger' : 'neutral'}>{row.outcome}</Badge></div>
              <p className="mt-2 text-xs text-zinc-500">가상 진입 {formatPrice(row.virtualEntryPrice)} · 현재 {formatPrice(row.currentPrice)}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <span>stop: {formatPrice(row.virtualStopLoss)}</span><span>target: {formatPrice(row.virtualTargetPrice)}</span>
                <span>MFE: {formatPct(row.maxFavorableExcursion)}</span><span>MAE: {formatPct(row.maxAdverseExcursion)}</span>
                <span>return: {formatPct(row.returnPct)}</span><span>holdingDays: {row.holdingDays ?? 'N/A'}</span>
              </div>
              <p className="mt-3 text-xs text-zinc-500">{row.lesson ?? '차단된 실거래 액션에 대한 사후 결과 검증 대기 중.'}</p>
            </article>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-zinc-500">해석 예시: 실거래 실행은 차단될 수 있지만, Shadow 반사실은 이후 Gate 보정을 위해 가상 진행 상황을 계속 보여줄 수 있습니다.</p>
    </section>
  );
}

function ProviderMarketSignalSplitCard({ items }: { items: ShadowCaseItem[] }): React.ReactElement {
  const split = splitProviderIssueAndMarketSignal(items);
  const groups = [
    ['Provider 이슈', split.providerIssues, 'API/데이터 장애를 시장 해석과 분리해서 다룹니다.'],
    ['시장 신호', split.marketSignals, '사후 결과를 활용해 신호 임계값을 보정합니다.'],
    ['혼합 메타데이터', split.mixed, '운영 해석 전에 메타데이터 분리가 필요합니다.'],
    ['미분류', split.unknown, '소스에 providerIssue 및 marketSignal 메타데이터를 추가하세요.'],
  ] as const;
  return (
    <section className={panelClass()}>
      <h2 className="text-lg font-bold text-zinc-100">Provider vs 시장 신호 분리</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {groups.map(([title, rows, note]) => (
          <div key={title} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex items-center justify-between"><p className="font-semibold text-zinc-100">{title}</p><Badge tone={title === '혼합 메타데이터' ? 'warn' : 'neutral'}>{rows.length}</Badge></div>
            <p className="mt-2 text-xs text-zinc-500">{note}</p>
            <ul className="mt-3 space-y-1 text-xs text-zinc-400">{rows.slice(0, 3).map((item) => <li key={item.id}>{getShadowCaseTypeLabel(item.caseType)} · {item.symbol ?? '시장'}</li>)}</ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ShadowCaseLibrary({ data, loading = false, error = null }: ShadowCaseLibraryProps): React.ReactElement {
  const emptyData: ShadowCaseLibraryResponse = data ?? {
    status: { shadowLearning: false, engineMode: 'OBSERVE_ONLY', executionAllowed: false, shadowAllowed: false },
    items: [],
    counterfactualOutcomes: [],
  };
  return (
    <section className="space-y-4" data-testid="shadow-case-library">
      <div className="rounded-2xl border border-sky-800/60 bg-sky-950/30 p-4 text-sm text-sky-100">
        <h2 className="text-xl font-bold text-sky-50">Shadow Case 라이브러리</h2>
        <p className="mt-2">Shadow Case 기록은 실거래 체결이 아닙니다. 실거래 실행이 차단된 동안 학습용으로 기록된 가상/관측 데이터입니다.</p>
        <p className="mt-1">Provider 장애는 시장 신호와 분리해서 해석해야 합니다.</p>
      </div>
      {error && <div className="rounded-xl border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">Shadow Case 텔레메트리를 불러오지 못했습니다: {error.message}</div>}
      {loading && !data && <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-400">Shadow Case 텔레메트리를 불러오는 중…</div>}
      {!loading && emptyData.items.length === 0 ? <EmptyState /> : (
        <>
          <ShadowLearningStatusCard data={emptyData} />
          <ShadowCaseTypeSummary items={emptyData.items} />
          <ShadowCaseTable items={emptyData.items} />
          <CounterfactualOutcomeCard outcomes={emptyData.counterfactualOutcomes} />
          <ProviderMarketSignalSplitCard items={emptyData.items} />
        </>
      )}
    </section>
  );
}
