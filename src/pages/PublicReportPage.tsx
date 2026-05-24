// @responsibility Public Report 정식 페이지 — 블로그/Telegram/paid preview 출력 진입점.
import React, { useEffect } from 'react';
import { FileText, Send, ShieldCheck } from 'lucide-react';
import { PublicReportDashboard } from '../components/publicReport/PublicReportDashboard';
import { PublicReportModeToggle } from '../components/publicReport/PublicReportModeToggle';
import { useGlobalIntelStore, useMarketStore, useRecommendationStore, useSettingsStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import type { ViewMode } from '../public-report/reportTypes';
import { PageHeader } from '../ui/page-header';
import { Badge } from '../ui/badge';
import { Section } from '../ui/section';

interface PublicReportPageProps {
  preferredMode?: ViewMode;
}

export function PublicReportPage({ preferredMode }: PublicReportPageProps) {
  const { marketOverview, marketContext } = useMarketStore();
  const recommendations = useRecommendationStore(s => s.recommendations);
  const shadowTrades = useShadowTradeStore(s => s.shadowTrades);
  const sectorEnergyResult = useGlobalIntelStore(s => s.sectorEnergyResult);
  const { publicReportViewMode, setPublicReportViewMode } = useSettingsStore();

  useEffect(() => {
    if (preferredMode && publicReportViewMode === 'OPERATION_MODE') {
      setPublicReportViewMode(preferredMode);
    }
  }, [preferredMode, publicReportViewMode, setPublicReportViewMode]);

  const viewMode = publicReportViewMode === 'OPERATION_MODE' && preferredMode
    ? preferredMode
    : publicReportViewMode;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">
      <PageHeader
        title="Public Report"
        subtitle="시장 Gate → 섹터 로테이션 → 후보 판정 → 매수 차단 → Shadow 검증"
        accentColor="bg-blue-500"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <PublicReportModeToggle value={viewMode} onChange={setPublicReportViewMode} />
            <Badge variant="success" size="md">Shadow Learning ON</Badge>
          </div>
        )}
      >
        매수 권유 문구보다 Source Snapshot 기준 판정, 데이터 신뢰도, 차단 사유, 공개/유료/내부 필드 분리를 우선 표시합니다.
      </PageHeader>

      <Section
        title="리포트 출력 흐름"
        subtitle="기본 화면은 공개 카드, 상세 수치와 원자료는 paid/private payload로 분리합니다."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <FileText className="h-5 w-5 text-blue-300" />
            <p className="mt-3 text-sm font-black text-white">Blog Markdown</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">블로그 게시용 제목, 시장 Gate, 후보 요약, 투자 유의를 한 번에 복사합니다.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <Send className="h-5 w-5 text-emerald-300" />
            <p className="mt-3 text-sm font-black text-white">Telegram Summary</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">운영 채널에는 짧은 요약만 보내고, 내부 forensic은 공개 카드에서 제외합니다.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <ShieldCheck className="h-5 w-5 text-amber-300" />
            <p className="mt-3 text-sm font-black text-white">Data Confidence</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">실계산, AI 추정, 누락, provider issue를 분리해 시장 악재처럼 보이지 않게 표시합니다.</p>
          </div>
        </div>
      </Section>

      <PublicReportDashboard
        viewMode={viewMode}
        marketOverview={marketOverview}
        marketContext={marketContext}
        recommendations={recommendations}
        sectorEnergyResult={sectorEnergyResult}
        shadowTrades={shadowTrades}
      />
    </div>
  );
}
