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
        title="Public Report"
        subtitle="Market Gate, sector rotation, candidate decisions, buy blocks, and Shadow results are packaged for blog and Telegram review."
        accentColor="bg-blue-500"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <PublicReportModeToggle value={activeMode} onChange={handleModeChange} />
            <Badge variant="success" size="md">Shadow Learning ON</Badge>
          </div>
        )}
      >
        Public output is a data report, not a trade instruction. It keeps raw logs, provider responses, execution traces, and private price plans outside the export boundary.
      </PageHeader>

      <Section
        title="Report Export Flow"
        subtitle="The default path is copy/download first, then final operator review before posting."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <FileText className="h-5 w-5 text-blue-300" />
            <p className="mt-3 text-sm font-black text-white">Blog Markdown / HTML</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">
              Generates title, one-line conclusion, Market Gate, sector rotation, candidate summary, buy block, Shadow result, tags, and investment notice.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <Send className="h-5 w-5 text-emerald-300" />
            <p className="mt-3 text-sm font-black text-white">Telegram Summary</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">
              Keeps public channel output short while preserving the same source snapshot and Shadow Learning state.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <ShieldCheck className="h-5 w-5 text-amber-300" />
            <p className="mt-3 text-sm font-black text-white">Data Trust Boundary</p>
            <p className="mt-1 text-xs leading-relaxed text-white/55">
              VERIFIED, AI_ESTIMATED, MISSING, and provider issues stay visible without turning data faults into market signals.
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
