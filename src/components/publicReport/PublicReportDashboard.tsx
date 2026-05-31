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
          <p className="text-[10px] font-black tracking-tight text-white/45">데이터 신뢰도 표시</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">
            각 판단은 계산된 데이터, 결측 데이터, 오래된 공급자 데이터, AI 추정 근거를 구분합니다. 배지는 게이트 점수를 바꾸지 않고 데이터 신뢰도를 설명합니다.
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
  return `계산 ${summary.calculatedIndicatorCount} / AI 추정 ${summary.aiEstimatedIndicatorCount} / 결측 ${summary.missingIndicatorCount}`;
}

function newBuyLabel(allowed?: boolean, engineMode?: string) {
  if (allowed) return '허용';
  if (engineMode === 'SELL_ONLY' || engineMode === 'SHADOW_ONLY' || engineMode === 'OBSERVE_ONLY') return '차단';
  return '제한';
}

function mhsPolicy(score: number): string {
  if (score >= 70) return 'Risk-On / 정상 게이트 운영';
  if (score >= 40) return '주의 / 게이트 강화 / Shadow 우선';
  return 'Risk-Off / 신규 매수 차단 / Shadow 유지';
}

function sectorLabel(score: number): string {
  if (score >= 80) return '주도';
  if (score >= 65) return '관찰';
  if (score >= 50) return '중립';
  if (score >= 35) return '약세';
  return '회피';
}

function flowArrow(flow: string): string {
  if (flow === 'INFLOW') return '상승';
  if (flow === 'OUTFLOW') return '하락';
  return '횡보';
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
    toast.success('공개 리포트 스냅샷을 저장했습니다');
  };

  return (
    <div id="public-report-content" className="border-b border-white/[0.07] bg-[rgba(5,10,20,0.72)] backdrop-blur-xl">
      <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info" size="md">공개 리포트 모드</Badge>
              <Badge variant="default" size="md">{report.reportDate}</Badge>
              <Badge variant="default" size="md">스냅샷 {report.sourceSnapshotId}</Badge>
              {viewMode === 'PAID_PREVIEW_MODE' && <Badge variant="violet" size="md">유료 미리보기</Badge>}
            </div>
            <h2 className="mt-3 text-xl font-black tracking-tight text-white sm:text-2xl">
              QuantMaster 마켓 게이트 & 후보 리포트
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/60">
              {report.publicSummary} 공개 화면에는 원시 로그, 공급자 응답, 실행 추적, 진입가, 손절가, 목표가, 분할매수 계획이 포함되지 않습니다.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <DataConfidenceBadge confidence={reportConfidence.overall} source="리포트 번들" updatedAt={report.asOf} />
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
              onClick={() => copyText(report.blogTitle, '블로그 제목을 복사했습니다')}
            >
              블로그 제목 복사
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<ClipboardCopy className="h-4 w-4" />}
              onClick={() => copyText(report.markdownOutput, '블로그 Markdown을 복사했습니다')}
            >
              블로그 Markdown 복사
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<Send className="h-4 w-4" />}
              onClick={() => copyText(report.telegramOutput, 'Telegram 요약을 복사했습니다')}
            >
              Telegram 요약 복사
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<Save className="h-4 w-4" />}
              onClick={handleSaveSnapshot}
            >
              스냅샷 저장
            </Button>
          </div>
        </div>

        <DataTrustLegend />

        <div className="rounded-xl border border-blue-400/15 bg-blue-400/[0.04] p-3">
          <p className="text-[10px] font-black tracking-tight text-blue-100/70">공개 리포트 흐름</p>
          <p className="mt-1 text-sm font-bold text-white/70">
            {'마켓 게이트 -> 섹터 로테이션 -> 후보 요약 -> 종목 판단 -> 매수 차단 -> Shadow 성과 -> 블로그 내보내기'}
          </p>
        </div>

        {market && (
          <Card padding="sm">
            <CardHeader className="mb-3">
              <CardTitle>1. 마켓 게이트</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <DataConfidenceBadge confidence={market.dataConfidenceSummary.overall} source="마켓 게이트" compact />
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
              <Stat label="신규 매수" value={newBuyLabel(market.newBuyAllowed, market.engineMode)} tone={market.newBuyAllowed ? 'green' : 'yellow'} />
              <Stat label="실거래 집행" value={market.liveExecutionAllowed ? '허용' : '차단'} tone={market.liveExecutionAllowed ? 'green' : 'yellow'} />
              <Stat label="엔진 모드" value={market.engineMode} />
              <Stat label="Shadow Learning" value={market.shadowLearningAllowed ? 'ON' : 'OFF'} tone="green" />
            </div>
            <div className="mt-4 rounded-lg border border-white/[0.05] bg-black/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold tracking-tight text-white/40">매크로 헬스 점수</p>
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
                <p className="text-[10px] font-semibold tracking-tight text-white/40">주도 섹터</p>
                <p className="mt-1 text-sm font-bold text-white">{market.leadingSectorsTop3.join(' / ') || '검증 필요'}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold tracking-tight text-white/40">위험 섹터</p>
                <p className="mt-1 text-sm font-bold text-white">{market.weakSectorsTop3.join(' / ') || '검증 필요'}</p>
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
              <CardTitle>2. 섹터 로테이션</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <DataConfidenceBadge confidence={sector.topSectors.length > 0 ? 'VERIFIED' : 'MISSING'} source="섹터 로테이션" compact />
                <Badge variant="info" size="sm">상위 5개 공개</Badge>
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
              <p className="text-[10px] font-semibold tracking-tight text-red-100/70">위험 섹터</p>
              <p className="mt-1 text-sm font-bold text-white">
                {sector.weakSectors.slice(0, 3).map((item) => `${item.sectorName} ${item.sectorScore}`).join(' / ') || '없음'}
              </p>
            </div>
          </Card>
        )}

        <Card padding="sm">
          <CardHeader className="mb-3">
            <CardTitle>3. 오늘의 후보 요약</CardTitle>
            <DataConfidenceBadge confidence={reportConfidence.overall} source="후보 요약" compact />
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-9">
            <Stat label="합계" value={candidateSummary.totalCandidates} tone="blue" />
            <Stat label="확정" value={candidateSummary.confirmedCandidateCount} tone="green" />
            <Stat label="매수 후보" value={candidateSummary.buyCandidateCount} tone="green" />
            <Stat label="관찰" value={candidateSummary.watchCount} tone="yellow" />
            <Stat label="눌림목 대기" value={candidateSummary.waitPullbackCount} tone="yellow" />
            <Stat label="차단" value={candidateSummary.blockedCount} tone="red" />
            <Stat label="데이터" value={candidateSummary.dataInsufficientCount} tone="red" />
            <Stat label="매도 전용" value={candidateSummary.sellOnlyCount} />
            <Stat label="Shadow" value={candidateSummary.shadowTrackingCount} tone="blue" />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-white/50">
            공개 후보 요약은 비공개 가격 계획을 노출하지 않고 판단 상태, 데이터 신뢰도, Shadow 추적을 표시합니다.
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {stock && (
            <div>
              <p className="mb-2 text-[10px] font-black tracking-tight text-white/40">4. 종목 판단</p>
              <CandidateDecisionCard model={stock} mode="report" />
            </div>
          )}
          <Card padding="sm">
            <CardHeader className="mb-3">
              <CardTitle>5. 매수 차단 사유 카드</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <DataConfidenceBadge confidence={stock?.dataConfidenceSummary.overall ?? reportConfidence.overall} source="매수 차단" compact />
                <Badge variant={block ? 'warning' : 'success'} size="sm">{block ? block.blockLevel : 'NO_MAJOR_BLOCK'}</Badge>
              </div>
            </CardHeader>
            {block ? (
              <div className="space-y-3">
                <p className="text-sm font-black text-white">좋은 기업일 수 있으나 현재 매수 위치가 확인되지 않았습니다.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Stat label="실패한 게이트" value={block.failedGate} tone="yellow" />
                  <Stat label="집행 영향" value={block.executionImpact} />
                  <Stat label="Shadow 전용" value={block.shadowOnlyAllowed ? '허용' : '차단'} tone={block.shadowOnlyAllowed ? 'green' : 'red'} />
                  <Stat label="결과 추적" value={block.postOutcomeTrackingEnabled ? 'ON' : 'OFF'} tone="green" />
                </div>
                <div>
                  <p className="mb-2 text-[10px] font-semibold tracking-tight text-yellow-200/70">차단 사유 TOP 5</p>
                  <PanelList items={block.blockedReasons} emptyText="차단 사유 없음" limit={5} />
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <p className="mb-2 text-[10px] font-semibold tracking-tight text-red-200/70">리스크 플래그</p>
                    <PanelList items={block.riskFlags} emptyText="주요 리스크 플래그 없음" limit={3} />
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold tracking-tight text-blue-200/70">데이터 이슈</p>
                    <PanelList items={block.dataIssues} emptyText="데이터 이슈 없음" limit={3} />
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-semibold tracking-tight text-emerald-200/70">재진입 조건</p>
                    <PanelList items={block.requiredConditionsForReentry} emptyText="재진입 조건 없음" limit={3} />
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-white/50">
                  공급자 이슈는 시장 신호가 아닙니다. 데이터가 결측되면 실거래 판단은 보류되고 Shadow 추적은 계속 이용할 수 있습니다.
                </p>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-white/65">
                주요 공개 차단 사유가 감지되지 않았습니다. 진입가, 손절가, 목표가, 분할매수 계획은 공개 리포트에서 숨겨집니다.
              </p>
            )}
          </Card>
        </div>

        {shadow && (
          <Card padding="sm">
            <CardHeader className="mb-3">
              <CardTitle>6. Shadow 성과</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <DataConfidenceBadge confidence={shadow.totalShadowCandidates > 0 ? 'VERIFIED' : 'UNKNOWN'} source="Shadow 추적" compact />
                <Badge variant="success" size="sm">영향 없음</Badge>
              </div>
            </CardHeader>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <Stat label="후보" value={shadow.totalShadowCandidates} />
              <Stat label="보유" value={shadow.openShadowPositions} />
              <Stat label="목표 / 손절" value={`${shadow.targetHitCount} / ${shadow.stopLossHitCount}`} />
              <Stat label="대기" value={shadow.pendingCount} />
              <Stat label="승률" value={`${shadow.winRate}%`} tone="green" />
              <Stat label="PF" value={shadow.profitFactor} />
              <Stat label="MDD" value={`${shadow.maxDrawdown}%`} tone={shadow.maxDrawdown < -10 ? 'red' : 'yellow'} />
              <Stat label="전환" value={shadow.liveTransitionStatus} tone="yellow" />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-white/55">
              {shadow.period} - 표본={shadow.sampleSizeSufficiency}. Shadow 성과는 실거래 집행과 분리되며 영향 없음 상태를 유지합니다.
            </p>
            <PanelList items={shadow.improvementNotes} emptyText="Shadow 개선 메모 없음" limit={2} />
          </Card>
        )}
        {viewMode === 'PAID_PREVIEW_MODE' && (
          <div id="public-report-paid-preview" className="scroll-mt-24 rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-4">
            <p className="text-xs font-semibold tracking-tight text-violet-200">유료 미리보기 항목</p>
            <p className="mt-2 text-sm text-white/65">
              전체 후보 목록, 상세 팩터 점수, 진입/손절/목표가, 분할매수 계획은 paidPayload로 분리됩니다.
              공개 카드는 비공개 실행 계획 항목을 노출하지 않습니다.
            </p>
          </div>
        )}

        <BlogExportPanel report={report} />
      </div>
    </div>
  );
}
