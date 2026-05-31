// @responsibility Public Report Mode dashboard built from sanitized report cards.

import React, { useMemo } from 'react';
import { ClipboardCopy, Save, Send, Type } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Card, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { cn } from '../../ui/cn';
import { DataConfidenceBadge } from './DataConfidenceBadge';
import { DATA_CONFIDENCE_HELP, type DataConfidence } from '../common/DataConfidenceBadge';
import { CandidateDecisionCard } from '../watchlist/CandidateDecisionCard';
import { BlogExportPanel } from './BlogExportPanel';
import { savePublicReportSnapshot, toPublicReport } from '../../public-report/reportAdapter';
import type { ReportVisibility, ViewMode } from '../../public-report/reportTypes';
import type { MarketContext, MarketOverview, StockRecommendation } from '../../services/stockService';
import type { SectorEnergyResult } from '../../types/sectorEnergy';
import type { ShadowTrade } from '../../types/quant';

interface PublicReportDashboardProps {
  viewMode: ViewMode;
  marketOverview?: MarketOverview | null;
  marketContext?: MarketContext | null;
  recommendations: StockRecommendation[];
  sectorEnergyResult?: SectorEnergyResult | null;
  shadowTrades: ShadowTrade[];
}

function visibilityFor(viewMode: ViewMode): ReportVisibility {
  return viewMode === 'PAID_PREVIEW_MODE' ? 'PAID' : 'PUBLIC';
}

async function copyText(text: string, successMessage: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
  toast.success(successMessage);
}


const DATA_CONFIDENCE_ORDER: DataConfidence[] = ['VERIFIED', 'DEGRADED', 'STALE', 'MISSING', 'AI_ESTIMATED', 'UNKNOWN'];

function DataTrustLegend() {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-black tracking-tight text-white/45">Data Trust Visibility</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">
            Each decision separates calculated data, missing data, stale provider data, and AI-estimated evidence. The badge explains data trust without changing gate scores.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 lg:max-w-2xl lg:justify-end">
          {DATA_CONFIDENCE_ORDER.map((confidence) => (
            <DataConfidenceBadge key={confidence} confidence={confidence} compact />
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {DATA_CONFIDENCE_ORDER.map((confidence) => {
          const config = DATA_CONFIDENCE_HELP[confidence];
          return (
            <div key={confidence} className="rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <DataConfidenceBadge confidence={confidence} compact />
                <span className="text-[9px] font-semibold tracking-tight text-white/30">{config.label}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-white/50">{config.description}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-white/35">{config.caution}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'green' | 'yellow' | 'red' | 'blue' }) {
  return (
    <div className={cn(
      'rounded-lg border border-white/[0.07] bg-white/[0.03] p-3',
      tone === 'green' && 'border-emerald-400/20 bg-emerald-400/[0.04]',
      tone === 'yellow' && 'border-yellow-400/20 bg-yellow-400/[0.04]',
      tone === 'red' && 'border-red-400/20 bg-red-400/[0.04]',
      tone === 'blue' && 'border-blue-400/20 bg-blue-400/[0.04]',
    )}>
      <p className="text-[10px] font-semibold tracking-tight text-white/45">{label}</p>
      <div className="mt-1 text-sm font-black text-white">{value}</div>
    </div>
  );
}

function PanelList({ items, emptyText, limit = 3 }: { items: string[]; emptyText: string; limit?: number }) {
  const visibleItems = items.filter(Boolean).slice(0, limit);
  if (visibleItems.length === 0) {
    return <p className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-xs text-white/45">{emptyText}</p>;
  }

  return (
    <ul className="space-y-2">
      {visibleItems.map((item) => (
        <li key={item} className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-xs leading-relaxed text-white/65">
          {item}
        </li>
      ))}
    </ul>
  );
}

function confidenceSummaryText(summary: { calculatedIndicatorCount: number; aiEstimatedIndicatorCount: number; missingIndicatorCount: number }) {
  return `calculated ${summary.calculatedIndicatorCount} / AI estimated ${summary.aiEstimatedIndicatorCount} / missing ${summary.missingIndicatorCount}`;
}

function newBuyLabel(allowed?: boolean, engineMode?: string) {
  if (allowed) return 'ALLOWED';
  if (engineMode === 'SELL_ONLY' || engineMode === 'SHADOW_ONLY' || engineMode === 'OBSERVE_ONLY') return 'BLOCKED';
  return 'LIMITED';
}

function mhsPolicy(score: number): string {
  if (score >= 70) return 'Risk-On / normal gate operation';
  if (score >= 40) return 'Caution / stricter gates / Shadow first';
  return 'Risk-Off / new buys blocked / Shadow remains on';
}

function sectorLabel(score: number): string {
  if (score >= 80) return 'LEADING';
  if (score >= 65) return 'WATCH';
  if (score >= 50) return 'NEUTRAL';
  if (score >= 35) return 'WEAK';
  return 'AVOID';
}

function flowArrow(flow: string): string {
  if (flow === 'INFLOW') return 'UP';
  if (flow === 'OUTFLOW') return 'DOWN';
  return 'FLAT';
}
export function PublicReportDashboard({
  viewMode,
  marketOverview,
  marketContext,
  recommendations,
  sectorEnergyResult,
  shadowTrades,
}: PublicReportDashboardProps) {
  const report = useMemo(
    () => toPublicReport({
      marketOverview,
      marketContext,
      recommendations,
      sectorEnergyResult,
      shadowTrades,
      visibility: visibilityFor(viewMode),
    }),
    [marketOverview, marketContext, recommendations, sectorEnergyResult, shadowTrades, viewMode],
  );

  const stock = report.stockDecision;
  const market = report.marketGate;
  const sector = report.sectorRotation;
  const block = report.buyBlock;
  const shadow = report.shadowPerformance;
  const candidateSummary = report.candidateSummary;
  const reportConfidence = report.dataConfidenceSummary;

  const handleSaveSnapshot = () => {
    savePublicReportSnapshot(report);
    toast.success('Public report snapshot saved');
  };

  return (
    <div id="public-report-content" className="border-b border-white/[0.07] bg-[rgba(5,10,20,0.72)] backdrop-blur-xl">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info" size="md">Public Report Mode</Badge>
              <Badge variant="default" size="md">{report.reportDate}</Badge>
              <Badge variant="default" size="md">snapshot {report.sourceSnapshotId}</Badge>
              {viewMode === 'PAID_PREVIEW_MODE' && <Badge variant="violet" size="md">Paid Preview</Badge>}
            </div>
            <h2 className="mt-3 text-xl font-black tracking-tight text-white sm:text-2xl">
              QuantMaster Market Gate & Candidate Report
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/60">
              {report.publicSummary} Public view excludes raw logs, provider responses, execution traces, entry prices, stop prices, target prices, and tranche plans.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <DataConfidenceBadge confidence={reportConfidence.overall} source="report bundle" updatedAt={report.asOf} />
              <span className="text-xs font-bold text-white/45">{confidenceSummaryText(reportConfidence)}</span>
              <Badge variant={reportConfidence.providerIssue ? 'warning' : 'success'} size="sm">
                providerIssue={String(reportConfidence.providerIssue)}
              </Badge>
              <Badge variant="default" size="sm">marketSignal=false</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Type className="h-4 w-4" />}
              onClick={() => copyText(report.blogTitle, 'Blog title copied')}
            >
              Copy Blog Title
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<ClipboardCopy className="h-4 w-4" />}
              onClick={() => copyText(report.markdownOutput, 'Blog Markdown copied')}
            >
              Copy Blog Markdown
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Send className="h-4 w-4" />}
              onClick={() => copyText(report.telegramOutput, 'Telegram summary copied')}
            >
              Copy Telegram Summary
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Save className="h-4 w-4" />}
              onClick={handleSaveSnapshot}
            >
              Save Snapshot
            </Button>
          </div>
        </div>

        <DataTrustLegend />

        <div className="rounded-xl border border-blue-400/15 bg-blue-400/[0.04] p-3">
          <p className="text-[10px] font-black tracking-tight text-blue-100/70">Public report flow</p>
          <p className="mt-1 text-sm font-bold text-white/70">
            {'Market Gate -> Sector Rotation -> Candidate Summary -> Stock Decision -> Buy Block -> Shadow Performance -> Blog Export'}
          </p>
        </div>

        {market && (
          <Card padding="sm">
            <CardHeader className="mb-3">
              <CardTitle>1. Market Gate</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <DataConfidenceBadge confidence={market.dataConfidenceSummary.overall} source="market gate" compact />
                <Badge
                  variant={market.marketGateStatus === 'GREEN' ? 'success' : market.marketGateStatus === 'RED' ? 'danger' : market.marketGateStatus === 'GRAY' ? 'default' : 'warning'}
                  size="sm"
                >
                  {market.marketGateStatus}
                </Badge>
                <Badge variant={market.executionImpact === 'LIVE_EXECUTION_ALLOWED' ? 'success' : 'warning'} size="sm">
                  {market.executionImpact}
                </Badge>
              </div>
            </CardHeader>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="New buy" value={newBuyLabel(market.newBuyAllowed, market.engineMode)} tone={market.newBuyAllowed ? 'green' : 'yellow'} />
              <Stat label="Live execution" value={market.liveExecutionAllowed ? 'ALLOWED' : 'BLOCKED'} tone={market.liveExecutionAllowed ? 'green' : 'yellow'} />
              <Stat label="Engine mode" value={market.engineMode} />
              <Stat label="Shadow Learning" value={market.shadowLearningAllowed ? 'ON' : 'OFF'} tone="green" />
            </div>
            <div className="mt-4 rounded-lg border border-white/[0.05] bg-black/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold tracking-tight text-white/40">Macro Health Score</p>
                  <p className="mt-1 text-xl font-black text-white font-num">{market.macroHealthScore} / 100</p>
                </div>
                <p className="max-w-[12rem] text-right text-[11px] font-bold text-white/50">{mhsPolicy(market.macroHealthScore)}</p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={cn(
                    'h-full rounded-full',
                    market.macroHealthScore >= 70 ? 'bg-emerald-400' : market.macroHealthScore >= 40 ? 'bg-amber-400' : 'bg-red-400',
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, market.macroHealthScore))}%` }}
                />
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-white/65">{market.primaryReason} {market.riskSummary}</p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold tracking-tight text-white/40">Leading sectors</p>
                <p className="mt-1 text-sm font-bold text-white">{market.leadingSectorsTop3.join(' / ') || 'Needs verification'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold tracking-tight text-white/40">Risk sectors</p>
                <p className="mt-1 text-sm font-bold text-white">{market.weakSectorsTop3.join(' / ') || 'Needs verification'}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold tracking-tight text-white/42">
              <span>providerIssue={String(market.providerIssue)}</span>
              <span>marketSignal={String(market.marketSignal)}</span>
              <span>snapshot={market.sourceSnapshotId}</span>
            </div>
          </Card>
        )}

        {sector && (
          <Card padding="sm">
            <CardHeader className="mb-3">
              <CardTitle>2. Sector Rotation</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <DataConfidenceBadge confidence={sector.topSectors.length > 0 ? 'VERIFIED' : 'MISSING'} source="sector rotation" compact />
                <Badge variant="info" size="sm">Top 5 public</Badge>
              </div>
            </CardHeader>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-5">
              {sector.topSectors.slice(0, 5).map((item) => (
                <div key={item.sectorName} className="rounded-lg border border-white/[0.05] bg-white/[0.025] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-black text-white/40">#{item.relativeStrengthRank}</span>
                    <span className="text-sm font-black text-white">{item.sectorScore}</span>
                  </div>
                  <p className="mt-2 truncate text-sm font-black text-white">{item.sectorName}</p>
                  <p className="mt-1 text-[10px] font-bold text-white/42">{sectorLabel(item.sectorScore)} / {flowArrow(item.flowDirection)} / {item.trendChange}</p>
                  <Badge className="mt-2" variant={item.flowDirection === 'INFLOW' ? 'success' : item.flowDirection === 'OUTFLOW' ? 'danger' : 'default'} size="sm">
                    {item.flowDirection}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-red-400/15 bg-red-400/[0.04] p-3">
              <p className="text-[10px] font-semibold tracking-tight text-red-100/70">Risk sectors</p>
              <p className="mt-1 text-sm font-bold text-white">
                {sector.weakSectors.slice(0, 3).map((item) => `${item.sectorName} ${item.sectorScore}`).join(' / ') || 'None'}
              </p>
            </div>
          </Card>
        )}

        <Card padding="sm">
          <CardHeader className="mb-3">
            <CardTitle>3. Today Candidate Summary</CardTitle>
            <DataConfidenceBadge confidence={reportConfidence.overall} source="candidate summary" compact />
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-9">
            <Stat label="Total" value={candidateSummary.totalCandidates} tone="blue" />
            <Stat label="Confirmed" value={candidateSummary.confirmedCandidateCount} tone="green" />
            <Stat label="Buy Candidate" value={candidateSummary.buyCandidateCount} tone="green" />
            <Stat label="Watch" value={candidateSummary.watchCount} tone="yellow" />
            <Stat label="Wait Pullback" value={candidateSummary.waitPullbackCount} tone="yellow" />
            <Stat label="Blocked" value={candidateSummary.blockedCount} tone="red" />
            <Stat label="Data" value={candidateSummary.dataInsufficientCount} tone="red" />
            <Stat label="Sell Only" value={candidateSummary.sellOnlyCount} />
            <Stat label="Shadow" value={candidateSummary.shadowTrackingCount} tone="blue" />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-white/50">
            Public candidate summary shows decision status, data confidence, and Shadow tracking without exposing private price plans.
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {stock && (
            <div>
              <p className="mb-2 text-[10px] font-black tracking-tight text-white/40">4. Stock Decision</p>
              <CandidateDecisionCard model={stock} mode="report" />
            </div>
          )}
          <Card padding="sm">
            <CardHeader className="mb-3">
              <CardTitle>5. Buy Block Reason Card</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <DataConfidenceBadge confidence={stock?.dataConfidenceSummary.overall ?? reportConfidence.overall} source="buy block" compact />
                <Badge variant={block ? 'warning' : 'success'} size="sm">{block ? block.blockLevel : 'NO_MAJOR_BLOCK'}</Badge>
              </div>
            </CardHeader>
            {block ? (
              <div className="space-y-3">
                <p className="text-sm font-black text-white">This may be a good company, but the current buy location is not confirmed.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Stat label="Failed Gate" value={block.failedGate} tone="yellow" />
                  <Stat label="Execution Impact" value={block.executionImpact} />
                  <Stat label="Shadow Only" value={block.shadowOnlyAllowed ? 'ALLOWED' : 'BLOCKED'} tone={block.shadowOnlyAllowed ? 'green' : 'red'} />
                  <Stat label="Outcome Tracking" value={block.postOutcomeTrackingEnabled ? 'ON' : 'OFF'} tone="green" />
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-semibold tracking-tight text-yellow-200/70">Block Reasons TOP 5</p>
                  <PanelList items={block.blockedReasons} emptyText="No block reasons" limit={5} />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <p className="mb-2 text-[10px] font-semibold tracking-tight text-red-200/70">Risk Flags</p>
                    <PanelList items={block.riskFlags} emptyText="No major risk flags" limit={3} />
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold tracking-tight text-blue-200/70">Data Issues</p>
                    <PanelList items={block.dataIssues} emptyText="No data issues" limit={3} />
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold tracking-tight text-emerald-200/70">Re-entry Conditions</p>
                    <PanelList items={block.requiredConditionsForReentry} emptyText="No re-entry conditions" limit={3} />
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-white/50">
                  Provider issues are not market signals. Missing data defers live judgment while Shadow tracking remains available.
                </p>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-white/65">
                No major public block reason is detected. Entry, stop, target, and tranche plans remain hidden from the public report.
              </p>
            )}
          </Card>
        </div>

        {shadow && (
          <Card padding="sm">
            <CardHeader className="mb-3">
              <CardTitle>6. Shadow Performance</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <DataConfidenceBadge confidence={shadow.totalShadowCandidates > 0 ? 'VERIFIED' : 'UNKNOWN'} source="shadow tracking" compact />
                <Badge variant="success" size="sm">impact NONE</Badge>
              </div>
            </CardHeader>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <Stat label="Candidates" value={shadow.totalShadowCandidates} />
              <Stat label="Open" value={shadow.openShadowPositions} />
              <Stat label="Target / Stop" value={`${shadow.targetHitCount} / ${shadow.stopLossHitCount}`} />
              <Stat label="Pending" value={shadow.pendingCount} />
              <Stat label="Win rate" value={`${shadow.winRate}%`} tone="green" />
              <Stat label="PF" value={shadow.profitFactor} />
              <Stat label="MDD" value={`${shadow.maxDrawdown}%`} tone={shadow.maxDrawdown < -10 ? 'red' : 'yellow'} />
              <Stat label="Transition" value={shadow.liveTransitionStatus} tone="yellow" />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-white/55">
              {shadow.period} - sample={shadow.sampleSizeSufficiency}. Shadow performance is separate from live execution and remains impact NONE.
            </p>
            <PanelList items={shadow.improvementNotes} emptyText="No Shadow improvement notes" limit={2} />
          </Card>
        )}
        {viewMode === 'PAID_PREVIEW_MODE' && (
          <div id="public-report-paid-preview" className="scroll-mt-24 rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-4">
            <p className="text-xs font-semibold tracking-tight text-violet-200">Paid Preview Fields</p>
            <p className="mt-2 text-sm text-white/65">
              Full candidate lists, detailed factor scores, entry/stop/target prices, and tranche plans are separated into paidPayload.
              Public cards do not expose private execution planning fields.
            </p>
          </div>
        )}

        <BlogExportPanel report={report} />
      </div>
    </div>
  );
}
