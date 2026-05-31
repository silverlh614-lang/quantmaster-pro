// @responsibility common WalkForwardView component
import React, { useState } from 'react';
import {
  Info, RefreshCw, ShieldCheck, HelpCircle, Zap, TrendingUp,
  Target, CheckCircle2, Shield, AlertTriangle, X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { performWalkForwardAnalysis, WalkForwardAnalysis } from '../../services/stockService';
import { toast } from 'sonner';
import { cn } from '../../ui/cn';

const GUIDE_ITEMS = [
  {
    title: 'Robustness Score',
    color: 'text-purple-400',
    body: 'Measures how consistently the strategy performs across in-sample and out-of-sample periods. Scores above 80 suggest strong real-world robustness.',
  },
  {
    title: 'Overfitting Risk',
    color: 'text-yellow-400',
    body: 'Highlights whether the strategy may be too tightly fitted to a specific historical window.',
  },
  {
    title: 'Trend Adaptability',
    color: 'text-blue-400',
    body: 'Checks how well the model adapts to current leading themes such as AI, semiconductors, and value-up flows.',
  },
  {
    title: 'IS vs OOS Stability',
    color: 'text-emerald-400',
    body: 'Compares training-period results with out-of-sample results to estimate persistence.',
  },
];

function isRateLimitError(message: string, status: unknown, code: unknown): boolean {
  return message.includes('429')
    || status === 429
    || code === 429
    || status === 'RESOURCE_EXHAUSTED'
    || message.includes('quota');
}

function HeaderBadge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <div className={cn('px-3 py-1 border rounded-full flex items-center gap-2', className)}>
      <Info className="w-3 h-3" />
      <span className="text-[10px] font-semibold tracking-tight">{label}</span>
    </div>
  );
}

function WalkForwardHeader({
  analyzing,
  onAnalyze,
}: {
  analyzing: boolean;
  onAnalyze: () => void;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
      <div>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-3 h-10 bg-purple-500 rounded-full shadow-[0_0_20px_rgba(168,85,247,0.5)]" />
          <h2 className="text-fluid-4xl font-black text-white tracking-tighter uppercase">Walk-Forward Analysis</h2>
        </div>
        <div className="flex flex-col gap-4">
          <p className="text-white/40 font-medium max-w-2xl text-lg leading-relaxed">
            Walk-forward analysis checks whether a strategy trained on prior data can remain useful in a later market period, reducing the risk of simple curve fitting.
          </p>
          <div className="flex items-center gap-2">
            <HeaderBadge label="In-Sample: 2025 (Training)" className="bg-purple-500/10 border-purple-500/20 text-purple-400" />
            <HeaderBadge label="Out-of-Sample: 2026 Q1 (Testing)" className="bg-blue-500/10 border-blue-500/20 text-blue-400" />
          </div>
        </div>
      </div>
      <button
        onClick={onAnalyze}
        disabled={analyzing}
        className="flex items-center gap-4 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-10 py-5 rounded-[2.5rem] font-black text-lg transition-all shadow-[0_10px_40px_rgba(168,85,247,0.3)] active:scale-95"
      >
        {analyzing ? <RefreshCw className="w-6 h-6 animate-spin" /> : <ShieldCheck className="w-6 h-6" />}
        <span>{analyzing ? 'Analyzing...' : 'Run Analysis'}</span>
      </button>
    </div>
  );
}

function GuideSection() {
  return (
    <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10">
      <div className="flex items-center gap-3 mb-6">
        <HelpCircle className="w-5 h-5 text-purple-400" />
        <h4 className="text-lg font-black text-white uppercase tracking-tighter">Analysis Guide</h4>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {GUIDE_ITEMS.map(item => (
          <div key={item.title} className="space-y-2">
            <div className={cn('text-[11px] font-semibold tracking-tight', item.color)}>{item.title}</div>
            <p className="text-xs text-white/60 leading-relaxed font-bold">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AiNotice() {
  return (
    <div className="flex items-center gap-2 px-6 py-3 bg-blue-500/5 border border-blue-500/10 rounded-2xl">
      <Info className="w-4 h-4 text-blue-400" />
      <p className="text-[11px] text-white/40 font-medium">
        <span className="text-blue-400 font-black mr-1">AI analysis note:</span>
        Scores may vary slightly as current market data and model context refresh.
      </p>
    </div>
  );
}

function robustnessLabel(score: number): string {
  if (score >= 80) return 'Highly Robust';
  if (score >= 60) return 'Moderately Robust';
  return 'Low Robustness';
}

function robustnessClass(score: number): string {
  if (score >= 80) return 'bg-green-500/20 text-green-400';
  if (score >= 60) return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-red-500/20 text-red-400';
}

function RobustnessHero({ analysis }: { analysis: WalkForwardAnalysis }) {
  return (
    <div className="glass-3d rounded-[3rem] p-12 border border-white/10 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-96 h-96 bg-purple-500/10 blur-[100px] -mr-48 -mt-48" />
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="text-center lg:text-left">
          <span className="text-[11px] font-black text-purple-400 uppercase tracking-[0.4em] block mb-4">Robustness Score</span>
          <div className="text-8xl font-black text-white tracking-tighter mb-6">
            {analysis.robustnessScore}<span className="text-4xl text-white/20">/100</span>
          </div>
          <div className={cn('inline-flex items-center gap-2 px-6 py-2 rounded-2xl text-sm font-semibold tracking-tight', robustnessClass(analysis.robustnessScore))}>
            {robustnessLabel(analysis.robustnessScore)}
          </div>
        </div>
        <div className="space-y-6">
          <ScoreDetailCard icon={<Zap className="w-5 h-5 text-yellow-400" />} title="Overfitting Risk">
            <div className="text-2xl font-black text-white">{analysis.overfittingRisk}</div>
          </ScoreDetailCard>
          <ScoreDetailCard icon={<TrendingUp className="w-5 h-5 text-blue-400" />} title="Trend Adaptability">
            <div className="text-2xl font-black text-white">{analysis.trendAdaptability.overall}/100</div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <TrendValue label="AI & Semi" value={`${analysis.trendAdaptability.aiSemiconductor}%`} />
              <TrendValue label="Value-Up" value={`${analysis.trendAdaptability.valueUp}%`} />
            </div>
          </ScoreDetailCard>
        </div>
      </div>
    </div>
  );
}

function ScoreDetailCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/5 rounded-[2rem] p-8 border border-white/10">
      <div className="flex items-center gap-4 mb-4">
        {icon}
        <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">{title}</span>
      </div>
      {children}
    </div>
  );
}

function TrendValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-black text-white/20 uppercase mb-1">{label}</div>
      <div className="text-sm font-black text-white">{value}</div>
    </div>
  );
}

function TextListCard({
  icon,
  title,
  items,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  accent: 'orange' | 'blue';
}) {
  return (
    <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
      <div className="flex items-center gap-4 mb-8">
        {icon}
        <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em]">{title}</span>
      </div>
      <div className="space-y-4">
        {(items || []).map((item, i) => (
          <div key={i} className="flex gap-4 p-4 bg-white/5 rounded-2xl border border-white/5">
            <div className={cn(
              'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1',
              accent === 'orange' ? 'bg-orange-500/20' : 'bg-blue-500/20'
            )}>
              {accent === 'orange'
                ? <span className="text-[10px] font-black text-orange-400">{i + 1}</span>
                : <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
            </div>
            <p className="text-sm text-white/70 font-bold leading-relaxed">{item}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailGrid({ analysis }: { analysis: WalkForwardAnalysis }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
      <TextListCard
        icon={<Target className="w-6 h-6 text-orange-400" />}
        title="Key Insights"
        items={analysis.insights || []}
        accent="orange"
      />
      <TextListCard
        icon={<RefreshCw className="w-6 h-6 text-blue-400" />}
        title="Optimization Recommendations"
        items={analysis.recommendations || []}
        accent="blue"
      />
    </div>
  );
}

function metricLabel(key: string): string {
  if (key === 'sharpeRatio') return 'Sharpe Ratio';
  if (key === 'maxDrawdown') return 'Max Drawdown';
  if (key === 'winRate') return 'Win Rate';
  return key;
}

function MetricsGrid({ analysis }: { analysis: WalkForwardAnalysis }) {
  return (
    <div className="glass-3d rounded-[3rem] p-10 border border-white/10 shadow-2xl">
      <span className="text-[11px] font-black text-white/20 uppercase tracking-[0.3em] block mb-10">Performance Metrics (IS vs OOS)</span>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {Object.entries(analysis.metrics).map(([key, value]) => {
          const v = value as { inSample: string | number; outOfSample: string | number };
          return <MetricCard key={key} label={metricLabel(key)} inSample={v.inSample} outOfSample={v.outOfSample} />;
        })}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  inSample,
  outOfSample,
}: {
  label: string;
  inSample: string | number;
  outOfSample: string | number;
}) {
  return (
    <div className="bg-white/5 rounded-2xl p-6 border border-white/5">
      <div className="text-[10px] font-black text-white/20 uppercase tracking-widest mb-4">{label}</div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[9px] font-black text-white/10 uppercase mb-1">In-Sample (2025)</div>
          <div className="text-lg font-black text-white">{inSample}</div>
        </div>
        <div className="w-px h-8 bg-white/10" />
        <div className="text-right">
          <div className="text-[9px] font-black text-white/10 uppercase mb-1">Out-of-Sample (2026 Q1)</div>
          <div className="text-lg font-black text-purple-400">{outOfSample}</div>
        </div>
      </div>
    </div>
  );
}

function AnalysisResult({ analysis }: { analysis: WalkForwardAnalysis }) {
  return (
    <div className="space-y-10">
      <GuideSection />
      <AiNotice />
      <RobustnessHero analysis={analysis} />
      <DetailGrid analysis={analysis} />
      <MetricsGrid analysis={analysis} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-32 flex flex-col items-center justify-center glass-3d rounded-[3rem] border border-white/10 border-dashed">
      <Shield className="w-16 h-16 text-white/10 mb-6" />
      <h3 className="text-2xl font-black text-white/20 mb-3">No analysis result yet</h3>
      <p className="text-base text-white/10 font-bold">Run the walk-forward analysis to populate this view.</p>
    </div>
  );
}

export const WalkForwardView: React.FC = () => {
  const [walkForwardAnalysis, setWalkForwardAnalysis] = useState<WalkForwardAnalysis | null>(null);
  const [analyzingWalkForward, setAnalyzingWalkForward] = useState(false);
  // UI_WIRING_MATRIX §10.3 #4 — rate-limit 시 toast 만으론 사유가 사라져 사용자가
  // 재시도 시점을 알 수 없던 갭. sticky 배너로 사유·재시도 액션 영속 표시.
  const [rateLimited, setRateLimited] = useState(false);

  const handleWalkForwardAnalysis = async () => {
    setAnalyzingWalkForward(true);
    setWalkForwardAnalysis(null);
    setRateLimited(false);
    try {
      const result = await performWalkForwardAnalysis();
      if (result) {
        setWalkForwardAnalysis(result);
        toast.success('Walk-Forward analysis completed.');
      } else {
        toast.error('No analysis result was returned.');
      }
    } catch (err: any) {
      console.error(err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;

      if (isRateLimitError(message, status, code)) {
        toast.error('API quota exceeded. Please retry later.');
        setRateLimited(true);
      } else {
        toast.error('Analysis failed.');
      }
    } finally {
      setAnalyzingWalkForward(false);
    }
  };

  return (
    <motion.div
      key="walk-forward-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-12"
    >
      {rateLimited && !analyzingWalkForward && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-black text-amber-400 uppercase tracking-widest">API quota exceeded</p>
              <p className="text-[11px] sm:text-xs text-theme-text-secondary font-bold mt-0.5">
                Wait ~60s for the Gemini quota to refresh, then retry. The toast disappears but this banner stays so you don't lose context.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            <button
              type="button"
              onClick={handleWalkForwardAnalysis}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold tracking-tight transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry now
            </button>
            <button
              type="button"
              onClick={() => setRateLimited(false)}
              aria-label="Dismiss rate-limit banner"
              className="p-2 text-amber-400/70 hover:text-amber-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      <WalkForwardHeader analyzing={analyzingWalkForward} onAnalyze={handleWalkForwardAnalysis} />
      {walkForwardAnalysis ? <AnalysisResult analysis={walkForwardAnalysis} /> : <EmptyState />}
    </motion.div>
  );
};
