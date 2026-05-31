// @responsibility analysis 영역 AIIntelligenceSection 컴포넌트
import React from 'react';
import {
  TrendingUp, TrendingDown, Info, Zap, Star, ArrowUpRight, ArrowDownRight,
  Brain, Target, Flame, FileText, CheckCircle2, Clock, History,
  Sparkles, Radar, Hash, Lightbulb
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../../ui/cn';
import { getMarketPhaseInfo } from '../../../constants/checklist';
import { toKoLabel } from '../../../utils/displayLabels';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

function SectionHeader() {
  return (
    <div className="flex items-center gap-3 mb-6 px-4">
      <div className="w-1.5 h-6 bg-orange-500 rounded-full" />
      <h3 className="text-xl font-black text-white uppercase tracking-tighter">AI 고급 인텔리전스</h3>
    </div>
  );
}

function AiCardShell({
  icon,
  title,
  titleIcon,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  titleIcon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white/5 rounded-2xl p-6 border border-white/[0.07] relative overflow-hidden group/ai-card">
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/ai-card:opacity-20 transition-opacity">
        {icon}
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
          {titleIcon}
        </div>
        <span className="text-[11px] font-black text-white/40 tracking-tight">{title}</span>
      </div>
      {children}
    </div>
  );
}

function resolveMarketPhaseClass(phase: string | undefined): string {
  if (phase === 'RISK_ON' || phase === 'BULL') return 'bg-green-500/20 text-green-400';
  if (phase === 'RISK_OFF' || phase === 'BEAR') return 'bg-red-500/20 text-red-400';
  if (phase === 'SIDEWAYS') return 'bg-blue-500/20 text-blue-400';
  if (phase === 'TRANSITION') return 'bg-purple-500/20 text-purple-400';
  return 'bg-white/10 text-white/40';
}

function AiConvictionFactors({ stock }: Props) {
  return (
    <div className="space-y-2 mb-4">
      {(stock.aiConvictionScore?.factors || []).map((f, i) => (
        <div key={i} className="flex items-center justify-between text-[10px]">
          <span className="text-white/40 font-bold">{f.name}</span>
          <div className="flex items-center gap-2 flex-1 mx-4">
            <div className="h-1 bg-white/5 flex-1 rounded-full overflow-hidden">
              <div className="h-full bg-orange-500/50" style={{ width: `${f.score}%` }} />
            </div>
          </div>
          <span className="text-white/60 font-black">{f.score}</span>
        </div>
      ))}
    </div>
  );
}

function MarketPhaseAnalysis({ stock }: Props) {
  const phase = stock.aiConvictionScore?.marketPhase;
  const phaseInfo = getMarketPhaseInfo(phase);
  return (
    <div className="pt-4 border-t border-white/5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className={cn('px-2 py-0.5 rounded text-[8px] font-black uppercase', resolveMarketPhaseClass(phase))}>
          {phaseInfo.label}
        </div>
        <span className="text-[9px] font-black text-white/20 tracking-tight">국면 분석</span>
      </div>

      <div className="bg-white/5 rounded-xl p-3 border border-white/5 mb-3">
        <div className="flex items-center gap-2 mb-1">
          <Lightbulb className="w-3 h-3 text-yellow-500" />
          <span className="text-[9px] font-black text-white/40 tracking-tight">추천</span>
        </div>
        <p className="text-[11px] text-white/80 font-bold leading-relaxed">
          {phaseInfo.recommendation}
        </p>
      </div>

      <p className="text-[11px] text-white/40 leading-relaxed font-medium italic break-words">
        {stock.aiConvictionScore?.description}
      </p>
    </div>
  );
}

function AiConvictionCard({ stock }: Props) {
  return (
    <AiCardShell
      icon={<Brain className="w-12 h-12 text-orange-500" />}
      title="AI 확신도 점수"
      titleIcon={<Target className="w-5 h-5 text-orange-500" />}
    >
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-4xl font-black text-white tracking-tighter">{stock.aiConvictionScore?.totalScore || 0}</span>
        <span className="text-sm font-bold text-white/20">/ 100</span>
      </div>
      <div className="text-[10px] text-orange-300/60 -mt-2 mb-4">
        ⓘ Gemini 정성 평가 — 자동매매 진입 기준 아님
      </div>
      <div className="bg-orange-500/10 p-3 rounded-xl border border-orange-500/20 mb-4">
        <span className="text-[10px] font-black text-orange-500 tracking-tight block mb-1">시장 맥락 가중치</span>
        <p className="text-[11px] text-orange-400/80 font-bold leading-tight">
          {stock.aiConvictionScore?.description}
        </p>
      </div>
      <AiConvictionFactors stock={stock} />
      <MarketPhaseAnalysis stock={stock} />
    </AiCardShell>
  );
}

function CatalystAnalysisCard({ stock }: Props) {
  return (
    <AiCardShell
      icon={<Zap className="w-12 h-12 text-orange-500" />}
      title="촉매 분석"
      titleIcon={<Flame className="w-5 h-5 text-orange-500" />}
    >
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-4xl font-black text-white tracking-tighter">{stock.catalystDetail?.score || 0}</span>
        <span className="text-sm font-bold text-white/20">/ 20 bonus</span>
        {stock.catalystSummary && (
          <span className="ml-auto px-3 py-1 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-[10px] font-black text-yellow-500 tracking-tight">
            {stock.catalystSummary}
          </span>
        )}
      </div>
      <div className="space-y-4">
        <div>
          <span className="text-[10px] font-black text-white/30 tracking-tight block mb-2">핵심 촉매</span>
          <p className="text-xs text-white/70 font-bold leading-relaxed">
            {stock.catalystDetail?.description || '발굴된 촉매제가 없습니다.'}
          </p>
        </div>
        {stock.catalystDetail?.upcomingEvents && stock.catalystDetail.upcomingEvents.length > 0 && (
          <div>
            <span className="text-[10px] font-black text-white/30 tracking-tight block mb-2">예정된 이벤트</span>
            <div className="space-y-1.5">
              {(stock.catalystDetail?.upcomingEvents || []).map((event, i) => (
                <div key={i} className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
                  <Clock className="w-3 h-3 text-orange-500" />
                  <span className="text-[10px] font-bold text-white/60">{event}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AiCardShell>
  );
}

function VisualGradeRow({
  label,
  grade,
  color,
}: {
  label: string;
  grade: number | undefined;
  color: string;
}) {
  // visualReport 점수는 0~10 척도에서 '높을수록 우수' (confluenceAxes 와 동일 방향).
  // 직전엔 `{grade}등급` + `6 - grade` 별 계산이라 1~5 만 가정 → 8·9 점이 별 0개로
  // 깨져 보이고 "등급" 표기가 1=최고 오해를 유발했다. 명시적 'N/10' + 비례 별로 정정.
  const score = Math.max(0, Math.min(10, grade ?? 0));
  const filledStars = Math.round(score / 2);
  return (
    <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
      <span className="text-[10px] font-black text-white/40 tracking-tight">{label}</span>
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map(star => (
            <Star
              key={star}
              className={cn(
                'w-2.5 h-2.5',
                star <= filledStars ? color + ' fill-current' : 'text-white/10',
              )}
            />
          ))}
        </div>
        <span className={cn('text-xs font-black', color)}>{score}/10</span>
      </div>
    </div>
  );
}

function VisualReportCard({ stock }: Props) {
  return (
    <AiCardShell
      icon={<FileText className="w-12 h-12 text-orange-500" />}
      title="비주얼 리포트"
      titleIcon={<CheckCircle2 className="w-5 h-5 text-orange-500" />}
    >
      <div className="grid grid-cols-1 gap-3 mb-4">
        <VisualGradeRow label="재무" grade={stock.visualReport?.financial} color="text-blue-400" />
        <VisualGradeRow label="기술적" grade={stock.visualReport?.technical} color="text-orange-400" />
        <VisualGradeRow label="수급" grade={stock.visualReport?.supply} color="text-green-400" />
      </div>
      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
        <span className="text-[10px] font-black text-white/30 tracking-tight block mb-1">AI 판정</span>
        <p className="text-[11px] text-white/70 font-bold leading-tight italic">
          "{stock.visualReport?.summary}"
        </p>
      </div>
    </AiCardShell>
  );
}

function SupplyDataStatCard({
  label,
  value,
  valueClassName,
  subLabel,
}: {
  label: string;
  value: string;
  valueClassName: string;
  subLabel: string;
}) {
  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/[0.07]">
      <span className="text-[10px] font-black text-white/30 tracking-tight block mb-1">{label}</span>
      <span className={cn('text-xl font-black', valueClassName)}>{value}</span>
      <span className="text-[10px] text-white/30 block mt-1">{subLabel}</span>
    </div>
  );
}

function SupplyDataCard({ stock }: Props) {
  if (!stock.supplyData) return null;
  const sd = stock.supplyData;
  // 순매수(net flow) 측정 소스가 KIS/KRX 일 때만 실데이터. 기본 경로는 Naver snapshot
  // stub(buildSnapshotSupplyStub — 순매수 0 박제)이므로 그 경우 0주를 '실데이터' 로
  // 오인시키지 않고 '미연동' 으로 정직 표기한다 (KIS 투자자별 매매동향 배선 시 자동 노출).
  // 'NAVER'(frgn.naver 실 순매수) 는 실데이터. 'NAVER_SNAPSHOT'(stub, 순매수 0)은 제외.
  const hasRealFlow =
    sd.dataSource === 'KIS' || sd.dataSource === 'KIS_OFFICIAL' ||
    sd.dataSource === 'KRX' || sd.dataSource === 'NAVER';
  // 외국인 보유율 — Naver 모바일 snapshot 실데이터. 5일 순매수(KIS 필요)와 달리 KIS 없이도 가용.
  const ownRatio = typeof sd.foreignerOwnRatio === 'number' && sd.foreignerOwnRatio > 0
    ? sd.foreignerOwnRatio
    : null;
  return (
    <div className="glass-3d rounded-2xl p-8 border border-white/[0.07] mb-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
          <TrendingUp className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <span className="text-[10px] font-black text-blue-400/60 tracking-tight block">KIS 수급</span>
          <h3 className="text-sm font-black text-white uppercase tracking-tight">외국인 / 기관 수급</h3>
        </div>
        <span className={cn(
          'ml-auto text-[9px] font-black px-2 py-1 rounded-lg border tracking-tight',
          hasRealFlow
            ? 'text-blue-400/50 bg-blue-500/10 border-blue-500/20'
            : 'text-white/40 bg-white/5 border-white/[0.07]',
        )}>
          {hasRealFlow ? '실데이터' : ownRatio != null ? 'Naver 보유율' : '미연동'}
        </span>
      </div>

      {hasRealFlow ? (
        <>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <SupplyDataStatCard
              label="외국인 5일 순매수"
              value={`${sd.foreignNet > 0 ? '+' : ''}${sd.foreignNet.toLocaleString()}주`}
              valueClassName={sd.foreignNet > 0 ? 'text-red-400' : 'text-blue-400'}
              subLabel={`연속 ${sd.foreignConsecutive}일 순매수`}
            />
            <SupplyDataStatCard
              label="기관 5일 순매수"
              value={`${sd.institutionNet > 0 ? '+' : ''}${sd.institutionNet.toLocaleString()}주`}
              valueClassName={sd.institutionNet > 0 ? 'text-red-400' : 'text-blue-400'}
              subLabel={`${sd.individualNet < 0 ? '개인 매도' : '개인 매수'} 동반`}
            />
          </div>

          <div className={cn(
            'p-4 rounded-2xl border',
            sd.isPassiveAndActive ? 'bg-red-500/10 border-red-500/20' : 'bg-white/5 border-white/[0.07]',
          )}>
            <div className="flex items-center gap-2">
              {sd.isPassiveAndActive
                ? <Zap className="w-4 h-4 text-red-400 fill-current" />
                : <Info className="w-4 h-4 text-white/30" />
              }
              <span className={cn(
                'text-xs font-semibold tracking-tight',
                sd.isPassiveAndActive ? 'text-red-400' : 'text-white/30',
              )}>
                {sd.isPassiveAndActive
                  ? 'P+A 동반매수 — 가장 강한 수급 신호'
                  : '단일 주체 매수 — 수급 신호 보통'}
              </span>
            </div>
          </div>
        </>
      ) : (
        <>
          {ownRatio != null && (
            <div className="bg-white/5 rounded-2xl p-4 border border-white/[0.07] mb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black text-white/30 tracking-tight">외국인 보유율</span>
                <span className="text-[9px] font-black text-blue-400/60 tracking-tight">Naver 실데이터</span>
              </div>
              <span className="text-2xl font-black text-blue-400 block">{ownRatio.toFixed(2)}%</span>
            </div>
          )}
          <div className="p-4 rounded-2xl border bg-white/5 border-white/[0.07]">
            <div className="flex items-center gap-2 mb-1.5">
              <Info className="w-4 h-4 text-white/30" />
              <span className="text-xs font-black text-white/40 tracking-tight">
                외국인·기관 순매수 미연동
              </span>
            </div>
            <p className="text-[11px] text-white/40 font-bold leading-relaxed">
              5일 순매수는 KIS 투자자별 매매동향(읽기 전용)이 필요합니다.
              {ownRatio != null ? ' 위 외국인 보유율은 Naver 실데이터입니다.' : ' (표시되던 0주는 실측값이 아닌 placeholder 였습니다)'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function ShortSellingCard({ stock }: Props) {
  // ratio 0 은 AI 플레이스홀더(프롬프트가 'shortSelling ratio 0' 지시 — 실측 아님).
  // 실측 공매도 비중이 들어올 때만 수치 표기하고, 그 외엔 '미수집' 으로 정직 표기한다
  // (KIS daily-short-sale FHPST04830000 ssts_vol_rlim 배선 시 자동 노출).
  const short = stock.shortSelling;
  const hasShortData = !!short && short.ratio > 0;
  return (
    <AiCardShell
      icon={<TrendingDown className="w-12 h-12 text-red-500" />}
      title="공매도"
      titleIcon={<TrendingDown className="w-5 h-5 text-red-500" />}
    >
      {hasShortData ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/[0.07]">
            <div>
              <span className="text-[10px] font-black text-white/30 tracking-tight block mb-1">공매도 비율</span>
              <span className="text-2xl font-black text-white">{short.ratio}%</span>
            </div>
            <div className={cn(
              'flex items-center gap-2 font-black',
              short.trend === 'DECREASING' ? 'text-green-400' : 'text-red-400',
            )}>
              {short.trend === 'DECREASING'
                ? <ArrowDownRight className="w-5 h-5" />
                : <ArrowUpRight className="w-5 h-5" />}
              <span className="text-sm">{toKoLabel(short.trend)}</span>
            </div>
          </div>
          <div className="bg-orange-500/10 p-4 rounded-2xl border border-orange-500/20">
            <p className="text-[11px] text-orange-400/90 font-bold leading-relaxed">
              {short.implication}
            </p>
          </div>
        </div>
      ) : (
        <EmptyAnalysisState label="공매도 데이터 미수집" />
      )}
    </AiCardShell>
  );
}

function EmptyAnalysisState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-white/20">
      <Info className="w-8 h-8 mb-3 opacity-20" />
      <p className="text-xs font-semibold tracking-tight">{label}</p>
    </div>
  );
}

function TenbaggerDnaCard({ stock }: Props) {
  return (
    <AiCardShell
      icon={<Sparkles className="w-12 h-12 text-blue-400" />}
      title="텐배거 DNA"
      titleIcon={<Sparkles className="w-5 h-5 text-blue-400" />}
    >
      {stock.tenbaggerDNA ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white/5 p-4 rounded-2xl border border-white/[0.07]">
            <div>
              <span className="text-[10px] font-black text-white/30 tracking-tight block mb-1">매칭 패턴</span>
              <span className="text-sm font-black text-white">{stock.tenbaggerDNA.matchPattern}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-black text-white/30 tracking-tight block mb-1">유사도</span>
              <span className="text-2xl font-black text-blue-400">{stock.tenbaggerDNA.similarity}%</span>
            </div>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${stock.tenbaggerDNA.similarity}%` }}
              className="h-full bg-gradient-to-r from-blue-600 to-blue-400"
            />
          </div>
          <div className="bg-blue-500/10 p-4 rounded-2xl border border-blue-500/20">
            <p className="text-[11px] text-blue-400/90 font-bold leading-relaxed">
              {stock.tenbaggerDNA.reason}
            </p>
          </div>
        </div>
      ) : (
        <EmptyAnalysisState label="패턴 분석 중..." />
      )}
    </AiCardShell>
  );
}

function HistoricalAnalogyCard({ stock }: Props) {
  return (
    <AiCardShell
      icon={<History className="w-12 h-12 text-blue-500" />}
      title="과거 유사 사례"
      titleIcon={<History className="w-5 h-5 text-blue-500" />}
    >
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg font-black text-blue-400">{stock.historicalAnalogy?.stockName}</span>
          <span className="text-xs font-bold text-white/30">({stock.historicalAnalogy?.period})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: `${stock.historicalAnalogy?.similarity}%` }} />
          </div>
          <span className="text-xs font-black text-blue-400">{stock.historicalAnalogy?.similarity}%</span>
        </div>
        <span className="text-[9px] font-black text-white/20 tracking-tight">유사도 매칭</span>
      </div>
      <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
        {stock.historicalAnalogy?.reason}
      </p>
    </AiCardShell>
  );
}

function resolveAnomalyClass(type: string | undefined): string {
  if (type === 'FUNDAMENTAL_DIVERGENCE') return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
  if (type === 'SMART_MONEY_ACCUMULATION') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  return 'bg-white/5 text-white/30 border-white/[0.07]';
}

function AnomalyDetectionCard({ stock }: Props) {
  const anomaly = stock.anomalyDetection;
  // type 이 NONE/미정이고 intensity 0 이면 "이상 없음(정상)" 으로 명확히 표기한다.
  // 직전엔 'NONE' 배지 + '0 Intensity' 만 떠서 카드가 깨졌거나 미연동된 것처럼 보였다.
  const hasAnomaly = !!anomaly && anomaly.type !== 'NONE' && (anomaly.score ?? 0) > 0;
  return (
    <AiCardShell
      icon={<Radar className="w-12 h-12 text-purple-500" />}
      title="이상 징후 탐지"
      titleIcon={<Radar className="w-5 h-5 text-purple-500" />}
    >
      {hasAnomaly ? (
        <>
          <div className="mb-4">
            <div className={cn('inline-block px-3 py-1 rounded-full text-[10px] font-black mb-3 border', resolveAnomalyClass(anomaly.type))}>
              {toKoLabel(anomaly.type)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-white tracking-tighter">{anomaly.score}</span>
              <span className="text-[10px] font-bold text-white/20 uppercase">강도</span>
            </div>
          </div>
          <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
            {anomaly.description}
          </p>
        </>
      ) : (
        <div className="py-2">
          <div className="inline-block px-3 py-1 rounded-full text-[10px] font-black mb-3 border bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20">
            정상 — 특이 신호 없음
          </div>
          <p className="text-[12px] text-white/50 leading-relaxed font-bold break-words">
            {anomaly?.description || '펀더멘털·수급 다이버전스 등 이상 징후가 감지되지 않았습니다.'}
          </p>
        </div>
      )}
    </AiCardShell>
  );
}

function SemanticMappingCard({ stock }: Props) {
  return (
    <AiCardShell
      icon={<Hash className="w-12 h-12 text-emerald-500" />}
      title="시맨틱 매핑"
      titleIcon={<Hash className="w-5 h-5 text-emerald-500" />}
    >
      <div className="mb-4">
        <span className="text-sm font-black text-emerald-400 block mb-2">{stock.semanticMapping?.theme}</span>
        <div className="flex flex-wrap gap-1.5">
          {(stock.semanticMapping?.keywords || []).map((k, i) => (
            <span key={i} className="text-[9px] font-black px-2 py-0.5 bg-emerald-500/10 text-emerald-400/70 rounded-md border border-emerald-500/20">
              #{k}
            </span>
          ))}
        </div>
      </div>
      <p className="text-[12px] text-white/70 leading-relaxed font-bold break-words">
        {stock.semanticMapping?.description}
      </p>
    </AiCardShell>
  );
}

export function AIIntelligenceSection({ stock }: Props) {
  return (
    <div className="mb-8">
      <SectionHeader />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <AiConvictionCard stock={stock} />
        <CatalystAnalysisCard stock={stock} />
        <VisualReportCard stock={stock} />
        <SupplyDataCard stock={stock} />
        <ShortSellingCard stock={stock} />
        <TenbaggerDnaCard stock={stock} />
        <HistoricalAnalogyCard stock={stock} />
        <AnomalyDetectionCard stock={stock} />
        <SemanticMappingCard stock={stock} />
      </div>
    </div>
  );
}
