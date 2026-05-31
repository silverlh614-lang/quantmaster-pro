// @responsibility Public Report page for blog, Telegram, and paid-preview export entry.

import React, { useEffect, useState } from 'react';
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
  focusSection?: 'TOP' | 'BLOG_EXPORT' | 'TELEGRAM_SUMMARY' | 'PAID_PREVIEW';
}

export function PublicReportPage({ preferredMode, focusSection = 'TOP' }: PublicReportPageProps) {
  const { marketOverview, marketContext } = useMarketStore();
  const recommendations = useRecommendationStore((state) => state.recommendations);
  const shadowTrades = useShadowTradeStore((state) => state.shadowTrades);
  const sectorEnergyResult = useGlobalIntelStore((state) => state.sectorEnergyResult);
  const { publicReportViewMode, setPublicReportViewMode } = useSettingsStore();
  const [activeMode, setActiveMode] = useState<ViewMode>(() => preferredMode ?? publicReportViewMode);

  useEffect(() => {
    if (preferredMode) {
      setActiveMode(preferredMode);
      setPublicReportViewMode(preferredMode);
    }
  }, [preferredMode, setPublicReportViewMode]);

  useEffect(() => {
    if (focusSection === 'TOP') return;
    const sectionId = focusSection === 'PAID_PREVIEW'
      ? 'public-report-paid-preview'
      : focusSection === 'TELEGRAM_SUMMARY'
        ? 'public-report-telegram-summary'
        : 'public-report-blog-export';
    const timer = window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusSection]);

  const handleModeChange = (mode: ViewMode) => {
    setActiveMode(mode);
    setPublicReportViewMode(mode);
  };

  return (
    <div className="mx-auto max-w-screen-2xl space-y-5 px-4 py-4 sm:px-6 sm:py-6">
      <PageHeader
        title="공개 리포트"
        subtitle="마켓 게이트, 섹터 로테이션, 후보 판단, 매수 차단, Shadow 결과를 블로그 및 Telegram 검토용으로 패키징합니다."
        accentColor="bg-blue-500"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <PublicReportModeToggle value={activeMode} onChange={handleModeChange} />
            <Badge variant="success" size="md">섀도우 러닝 ON</Badge>
          </div>
        )}
      >
        공개 출력물은 매매 지시가 아니라 데이터 리포트입니다. 원시 로그, 공급자 응답, 실행 추적, 비공개 가격 계획은 내보내기 범위 밖에 유지합니다.
      </PageHeader>

      <Section
        title="리포트 내보내기 흐름"
        subtitle="기본 경로는 먼저 복사/다운로드한 뒤, 게시 전 운영자가 최종 검토하는 것입니다."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <FileText className="h-5 w-5 text-blue-300" />
            <p className="mt-3 text-sm font-black text-white">블로그 Markdown / HTML</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">
              제목, 한 줄 결론, 마켓 게이트, 섹터 로테이션, 후보 요약, 매수 차단, Shadow 결과, 태그, 투자 유의사항을 생성합니다.
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <Send className="h-5 w-5 text-emerald-300" />
            <p className="mt-3 text-sm font-black text-white">Telegram 요약</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">
              동일한 소스 스냅샷과 Shadow Learning 상태를 유지하면서 공개 채널 출력을 짧게 유지합니다.
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <ShieldCheck className="h-5 w-5 text-amber-300" />
            <p className="mt-3 text-sm font-black text-white">데이터 신뢰 경계</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">
              VERIFIED, AI_ESTIMATED, MISSING와 공급자 이슈는 데이터 결함을 시장 신호로 바꾸지 않고 그대로 표시됩니다.
            </p>
          </div>
        </div>
      </Section>

      <PublicReportDashboard
        viewMode={activeMode}
        marketOverview={marketOverview}
        marketContext={marketContext}
        recommendations={recommendations}
        sectorEnergyResult={sectorEnergyResult}
        shadowTrades={shadowTrades}
      />
    </div>
  );
}
