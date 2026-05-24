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
import { ConfluenceMeter } from '../common/ConfluenceMeter';
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
    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/45">Data Trust Visibility</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">
            각 지표가 실계산 데이터인지, 지연/누락 데이터인지, AI 추정값인지 분리해 표시합니다. 배지는 표시 의미만 설명하며 gate·score·후보 판정 로직을 변경하지 않습니다.
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
                <span className="text-[9px] font-black uppercase tracking-wider text-white/30">{config.label}</span>
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
      'rounded-lg border border-white/10 bg-white/[0.03] p-3',
      tone === 'green' && 'border-emerald-400/20 bg-emerald-400/[0.04]',
      tone === 'yellow' && 'border-yellow-400/20 bg-yellow-400/[0.04]',
      tone === 'red' && 'border-red-400/20 bg-red-400/[0.04]',
      tone === 'blue' && 'border-blue-400/20 bg-blue-400/[0.04]',
    )}>
      <p className="text-[10px] font-black uppercase tracking-wider text-white/45">{label}</p>
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
  return `실계산 ${summary.calculatedIndicatorCount} / AI 추정 ${summary.aiEstimatedIndicatorCount} / 누락 ${summary.missingIndicatorCount}`;
}

function newBuyLabel(allowed?: boolean, engineMode?: string) {
  if (allowed) return '허용';
  if (engineMode === 'SELL_ONLY' || engineMode === 'SHADOW_ONLY' || engineMode === 'OBSERVE_ONLY') return '차단';
  return '제한';
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
    <div id="public-report-content" className="border-b border-white/10 bg-[rgba(5,10,20,0.72)] backdrop-blur-xl">
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
              QuantMaster 후보 판정 공개 리포트
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/60">
              {report.publicSummary} 공개용 화면은 내부 로그, provider raw response, 매수가, 손절가, 목표가, 트랑슈 세부 계획을 숨깁니다.
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

        <Card padding="sm">
          <CardHeader className="mb-3">
            <CardTitle>Today Candidate Summary</CardTitle>
            <DataConfidenceBadge confidence={reportConfidence.overall} source="candidate summary" compact />
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Total" value={candidateSummary.totalCandidates} tone="blue" />
            <Stat label="Confirmed" value={candidateSummary.confirmedCandidateCount} tone="green" />
            <Stat label="Buy Candidate" value={candidateSummary.buyCandidateCount} tone="green" />
            <Stat label="Watch" value={candidateSummary.watchCount} tone="yellow" />
            <Stat label="Wait Pullback" value={candidateSummary.waitPullbackCount} tone="yellow" />
            <Stat label="Blocked" value={candidateSummary.blockedCount} tone="red" />
            <Stat label="Data" value={candidateSummary.dataInsufficientCount} tone="red" />
            <Stat label="Sell Only" value={candidateSummary.sellOnlyCount} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-white/50">
            공개용 후보 요약은 매수가·목표가·손절가를 제외하고, 판정 상태와 데이터 신뢰도만 표시합니다.
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          {market && (
            <Card padding="sm" className="xl:col-span-2">
              <CardHeader className="mb-3">
                <CardTitle>Daily Market Gate</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <DataConfidenceBadge confidence={reportConfidence.providerIssue ? 'DEGRADED' : 'VERIFIED'} source="market gate" compact />
                  <Badge
                    variant={market.marketGateStatus === 'GREEN' ? 'success' : market.marketGateStatus === 'RED' ? 'danger' : 'warning'}
                    size="sm"
                  >
                    {market.marketGateStatus}
                  </Badge>
                </div>
              </CardHeader>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="New buy" value={newBuyLabel(market.newBuyAllowed, market.engineMode)} tone={market.newBuyAllowed ? 'green' : 'yellow'} />
                <Stat label="MHS" value={`${market.macroHealthScore}/100`} tone="blue" />
                <Stat label="Engine mode" value={market.engineMode} />
                <Stat label="Shadow Learning" value={market.shadowLearningAllowed ? 'ON' : 'OFF'} tone="green" />
              </div>
              <p className="mt-4 text-sm leading-relaxed text-white/65">{market.riskSummary}</p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-white/40">Leading sectors</p>
                  <p className="mt-1 text-sm font-bold text-white">{market.leadingSectorsTop3.join(' / ') || '확인 필요'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-white/40">Weak sectors</p>
                  <p className="mt-1 text-sm font-bold text-white">{market.weakSectorsTop3.join(' / ') || '확인 필요'}</p>
                </div>
              </div>
            </Card>
          )}

          {stock && (
            <Card padding="sm" className="xl:col-span-2">
              <CardHeader className="mb-3">
                <CardTitle>Candidate Decision Card</CardTitle>
                <DataConfidenceBadge
                  confidence={stock.dataConfidenceSummary.overall}
                  source="stock decision indicators"
                  updatedAt={report.reportDate}
                />
              </CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent" size="md">{stock.displayDecision}</Badge>
                <span className="text-sm font-black text-white">{stock.stockName}</span>
                <span className="text-xs font-bold text-white/55">({stock.stockCode})</span>
                <span className="text-xs text-white/45">{stock.sector}</span>
              </div>
              <p className="mt-2 text-[11px] font-mono text-white/35">snapshot {stock.sourceSnapshotId}</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Score" value={`${stock.finalScore}/100`} tone="blue" />
                <Stat label="Gate 0" value={stock.gate0MacroStatus} />
                <Stat label="Gate 1" value={stock.gate1SurvivalResult} />
                <Stat label="Gate 2" value={stock.gate2GrowthResult} />
                <Stat label="Gate 3" value={stock.gate3TimingResult} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <DataConfidenceBadge confidence="VERIFIED" label={`실계산 ${stock.calculatedIndicatorCount}`} compact showTooltip={false} />
                <DataConfidenceBadge confidence="AI_ESTIMATED" label={`추정 ${stock.aiEstimatedIndicatorCount}`} compact />
                <DataConfidenceBadge confidence="MISSING" label={`누락 ${stock.missingIndicatorCount}`} compact />
              </div>
              <div className="mt-4 rounded-lg border border-white/[0.07] bg-black/10 p-3">
                <ConfluenceMeter axes={stock.confluenceAxes} compact forceShow />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-emerald-200/70">긍정 사유 TOP 3</p>
                  <PanelList items={stock.bullishReasons} emptyText="긍정 사유는 추가 검증 중입니다." />
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-red-200/70">부정 사유 TOP 3</p>
                  <PanelList items={stock.bearishReasons} emptyText="주요 부정 사유 없음" />
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-yellow-200/70">다음 확인 조건</p>
                  <PanelList items={stock.nextCheckConditions} emptyText="다음 확인 조건 없음" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant={stock.shadowRegistrationStatus === 'REGISTERED' ? 'success' : 'info'} size="sm">
                  Shadow {stock.shadowRegistrationStatus}
                </Badge>
                <Badge variant={stock.executionImpact === 'LIVE_EXECUTION_ALLOWED' ? 'success' : 'warning'} size="sm">
                  impact {stock.executionImpact}
                </Badge>
              </div>
            </Card>
          )}

          {shadow && (
            <Card padding="sm">
              <CardHeader className="mb-3">
                <CardTitle>Shadow Performance</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <DataConfidenceBadge confidence={shadow.totalShadowCandidates > 0 ? 'VERIFIED' : 'UNKNOWN'} source="shadow tracking" compact />
                  <Badge variant="success" size="sm">impact NONE</Badge>
                </div>
              </CardHeader>
              <div className="space-y-3">
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
                {shadow.period} · sample={shadow.sampleSizeSufficiency}. Shadow 성과는 실거래와 분리되며 executionImpact=NONE으로 표시됩니다.
              </p>
              <PanelList items={shadow.improvementNotes} emptyText="Shadow 개선 메모 없음" limit={2} />
            </Card>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sector && (
            <Card padding="sm">
              <CardHeader className="mb-3">
                <CardTitle>Sector Rotation Heatmap Card</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <DataConfidenceBadge confidence={sector.topSectors.length > 0 ? 'VERIFIED' : 'MISSING'} source="sector rotation" compact />
                  <Badge variant="info" size="sm">Top 5 public</Badge>
                </div>
              </CardHeader>
              <div className="space-y-2">
                {sector.topSectors.slice(0, 5).map((item) => (
                  <div key={item.sectorName} className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2">
                    <span className="w-6 text-xs font-black text-white/40">{item.relativeStrengthRank}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-black text-white">{item.sectorName}</span>
                    <Badge variant={item.flowDirection === 'INFLOW' ? 'success' : item.flowDirection === 'OUTFLOW' ? 'danger' : 'default'} size="sm">
                      {item.flowDirection}
                    </Badge>
                    <span className="w-10 text-right text-sm font-black text-white">{item.sectorScore}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card padding="sm">
            <CardHeader className="mb-3">
              <CardTitle>Buy Block Reason Card</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <DataConfidenceBadge confidence={stock?.dataConfidenceSummary.overall ?? reportConfidence.overall} source="buy block" compact />
                <Badge variant={block ? 'warning' : 'success'} size="sm">{block ? block.blockLevel : 'NO_MAJOR_BLOCK'}</Badge>
              </div>
            </CardHeader>
            {block ? (
              <div className="space-y-3">
                <p className="text-sm font-black text-white">좋은 종목일 수 있으나, 현재는 좋은 매수 자리가 아닙니다.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Stat label="Failed Gate" value={block.failedGate} tone="yellow" />
                  <Stat label="Execution Impact" value={block.executionImpact} />
                  <Stat label="Shadow Only" value={block.shadowOnlyAllowed ? 'ALLOWED' : 'BLOCKED'} tone={block.shadowOnlyAllowed ? 'green' : 'red'} />
                  <Stat label="Outcome Tracking" value={block.postOutcomeTrackingEnabled ? 'ON' : 'OFF'} tone="green" />
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-yellow-200/70">차단 사유 TOP 5</p>
                  <PanelList items={block.blockedReasons} emptyText="차단 사유 없음" limit={5} />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-red-200/70">Risk Flags</p>
                    <PanelList items={block.riskFlags} emptyText="주요 리스크 플래그 없음" limit={3} />
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-blue-200/70">Data Issues</p>
                    <PanelList items={block.dataIssues} emptyText="데이터 이슈 없음" limit={3} />
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-emerald-200/70">재진입 조건</p>
                    <PanelList items={block.requiredConditionsForReentry} emptyText="재진입 조건 없음" limit={3} />
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-white/50">
                  Provider 장애는 시장 악재가 아니며 marketSignal=false로 격리됩니다. 데이터 부족 시 실거래 판단은 보류하고 Shadow 추적만 수행합니다.
                </p>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-white/65">
                공개 카드 기준 주요 차단 사유는 없습니다. 실제 매수가/손절가/목표가는 공개 화면에서 숨깁니다.
              </p>
            )}
          </Card>
        </div>

        {viewMode === 'PAID_PREVIEW_MODE' && (
          <div className="rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-4">
            <p className="text-xs font-black uppercase tracking-wider text-violet-200">Paid Preview Fields</p>
            <p className="mt-2 text-sm text-white/65">
              전체 후보군, 조건별 상세 점수, 매수가/손절가/목표가, 트랑슈 계획은 paidPayload에 분리되어 있습니다.
              Public 카드에는 노출하지 않습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
