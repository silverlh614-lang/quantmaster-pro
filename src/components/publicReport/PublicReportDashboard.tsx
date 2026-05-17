// @responsibility Public Report Mode dashboard built from sanitized report cards.

import React, { useMemo } from 'react';
import { ClipboardCopy, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Card, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { cn } from '../../ui/cn';
import { DataConfidenceBadge } from './DataConfidenceBadge';
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
              {viewMode === 'PAID_PREVIEW_MODE' && <Badge variant="violet" size="md">Paid Preview</Badge>}
            </div>
            <h2 className="mt-3 text-xl font-black tracking-tight text-white sm:text-2xl">
              QuantMaster Public Report Cards
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/60">
              {report.publicSummary} 공개용 화면은 내부 로그, provider raw response, 매수가, 손절가, 트랑슈 세부 계획을 숨깁니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          {market && (
            <Card padding="sm" className="xl:col-span-2">
              <CardHeader className="mb-3">
                <CardTitle>Daily Market Gate</CardTitle>
                <Badge
                  variant={market.marketGateStatus === 'GREEN' ? 'success' : market.marketGateStatus === 'RED' ? 'danger' : 'warning'}
                  size="sm"
                >
                  {market.marketGateStatus}
                </Badge>
              </CardHeader>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="New buy" value={market.newBuyAllowed ? '관찰 가능' : '제한'} tone={market.newBuyAllowed ? 'green' : 'yellow'} />
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
                <CardTitle>Stock Decision Card</CardTitle>
                <DataConfidenceBadge confidence={stock.dataConfidenceSummary.overall} />
              </CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent" size="md">{stock.finalDecision}</Badge>
                <span className="text-sm font-black text-white">{stock.stockName}</span>
                <span className="text-xs text-white/45">{stock.sector}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Score" value={`${stock.finalScore}/100`} tone="blue" />
                <Stat label="Gate 0" value={stock.gate0MacroStatus} />
                <Stat label="Gate 1" value={stock.gate1SurvivalResult} />
                <Stat label="Gate 3" value={stock.gate3TimingResult} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <Badge variant="success" size="sm">실계산 {stock.calculatedIndicatorCount}</Badge>
                <Badge variant="violet" size="sm">AI 추정 {stock.aiEstimatedIndicatorCount}</Badge>
                <Badge variant="warning" size="sm">누락 {stock.missingIndicatorCount}</Badge>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-white/65">
                {stock.blockedReasons[0] ?? stock.bullishReasons[0] ?? '조건 기반 판정 리포트입니다.'}
              </p>
            </Card>
          )}

          {shadow && (
            <Card padding="sm">
              <CardHeader className="mb-3">
                <CardTitle>Shadow Performance</CardTitle>
                <Badge variant="success" size="sm">NONE</Badge>
              </CardHeader>
              <div className="space-y-3">
                <Stat label="Candidates" value={shadow.totalShadowCandidates} />
                <Stat label="Win rate" value={`${shadow.winRate}%`} tone="green" />
                <Stat label="PF" value={shadow.profitFactor} />
                <Stat label="Transition" value={shadow.liveTransitionStatus} tone="yellow" />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-white/55">
                Shadow 성과는 실거래와 분리되며 executionImpact=NONE으로 표시됩니다.
              </p>
            </Card>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sector && (
            <Card padding="sm">
              <CardHeader className="mb-3">
                <CardTitle>Sector Rotation Heatmap Card</CardTitle>
                <Badge variant="info" size="sm">Top 5 public</Badge>
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
              <Badge variant={block ? 'warning' : 'success'} size="sm">{block ? block.blockLevel : 'NO_MAJOR_BLOCK'}</Badge>
            </CardHeader>
            {block ? (
              <div className="space-y-3">
                <p className="text-sm font-black text-white">현재 조건상 매수 차단</p>
                <ul className="space-y-2 text-sm text-white/65">
                  {block.blockedReasons.slice(0, 5).map((reason) => (
                    <li key={reason} className="rounded-lg bg-white/[0.025] px-3 py-2">{reason}</li>
                  ))}
                </ul>
                <p className="text-xs leading-relaxed text-white/50">
                  좋은 종목일 수 있으나, 좋은 매수 자리는 아닐 수 있습니다. Shadow 추적은 계속 가능합니다.
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
