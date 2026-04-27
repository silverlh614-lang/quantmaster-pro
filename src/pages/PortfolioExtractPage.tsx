// @responsibility PortfolioExtractPage 페이지 컴포넌트
import React, { useState, useCallback } from 'react';
import {
  Filter, Layers, Play, Scale, SlidersHorizontal,
  Shield, TrendingUp, Clock, CheckCircle2, Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../ui/cn';
import { PageHeader } from '../ui/page-header';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Stack } from '../layout/Stack';
import { ConnectionStatus, type ConnectionState } from '../components/common/ConnectionStatus';
import { useRecommendationStore } from '../stores';

// ── Gate extraction step definition ─────────────────────────────────────────
interface GateStep {
  key: string;
  label: string;
  labelKo: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
}

const GATE_STEPS: GateStep[] = [
  {
    key: 'gate1', label: 'Gate 1', labelKo: '필수 조건 필터',
    description: '재무 건전성·거래대금 등 최소 자격을 통과한 종목만 남깁니다.',
    color: 'text-red-400', bgColor: 'bg-red-500/15', borderColor: 'border-red-500/40',
    icon: <Shield className="w-5 h-5 text-red-400" />,
  },
  {
    key: 'gate2', label: 'Gate 2', labelKo: '성장성 스코어링',
    description: '매출·이익 성장, ROE 품질 등을 점수화해 상위 후보를 선별합니다.',
    color: 'text-amber-400', bgColor: 'bg-amber-500/15', borderColor: 'border-amber-500/40',
    icon: <TrendingUp className="w-5 h-5 text-amber-400" />,
  },
  {
    key: 'gate3', label: 'Gate 3', labelKo: '타이밍 최적화',
    description: '이동평균 정배열·모멘텀으로 진입 타이밍이 좋은 종목을 고릅니다.',
    color: 'text-green-400', bgColor: 'bg-green-500/15', borderColor: 'border-green-500/40',
    icon: <Clock className="w-5 h-5 text-green-400" />,
  },
];

type PositionSizeMode = 'kelly' | 'equal';

export function PortfolioExtractPage() {
  const { recommendations, lastUpdated, loading } = useRecommendationStore();
  const upstreamState: ConnectionState = loading
    ? 'loading'
    : recommendations && recommendations.length > 0
      ? 'live'
      : 'idle';

  // ── Section 1: Stock Count ─────────────────────────────────────────────────
  const [stockCount, setStockCount] = useState(10);

  // ── Section 2: Gate Weights ────────────────────────────────────────────────
  const [gate1Weight, setGate1Weight] = useState(40);
  const [gate2Weight, setGate2Weight] = useState(35);
  const [gate3Weight, setGate3Weight] = useState(25);
  const totalGateWeight = gate1Weight + gate2Weight + gate3Weight;

  // ── Section 3: Position Sizing ─────────────────────────────────────────────
  const [positionMode, setPositionMode] = useState<PositionSizeMode>('equal');

  // ── Extraction State ───────────────────────────────────────────────────────
  const [extracting, setExtracting] = useState(false);
  const [currentGate, setCurrentGate] = useState<number>(-1); // -1 = idle, 0/1/2 = gate index
  const [completedGates, setCompletedGates] = useState<number[]>([]);
  const [extracted, setExtracted] = useState(false);

  // ── Extraction handler with sequential gate animation ──────────────────────
  const handleExtract = useCallback(async () => {
    if (totalGateWeight !== 100) return;
    setExtracting(true);
    setExtracted(false);
    setCompletedGates([]);

    for (let i = 0; i < 3; i++) {
      setCurrentGate(i);
      await new Promise(r => setTimeout(r, 1200 + Math.random() * 600));
      setCompletedGates(prev => [...prev, i]);
    }

    setCurrentGate(-1);
    setExtracting(false);
    setExtracted(true);
  }, [totalGateWeight]);

  // ── Weight adjustment helper ───────────────────────────────────────────────
  const clampWeight = (v: number) => Math.max(0, Math.min(100, v));

  return (
    <motion.div
      key="portfolio-extract-view"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Stack gap="xl">
        {/* Header */}
        <PageHeader
          title="Portfolio Extraction"
          subtitle="3-Gate 포트폴리오 추출 엔진"
          accentColor="bg-purple-500"
          actions={
            <ConnectionStatus
              label="추천 데이터"
              state={upstreamState}
              lastUpdated={lastUpdated}
              detail={upstreamState === 'idle' ? 'AI 추천이 없으면 추출할 후보가 없습니다. 탐색 탭에서 추천을 먼저 실행하세요.' : undefined}
            />
          }
        >
          Gate 1(필수) &rarr; Gate 2(성장) &rarr; Gate 3(타이밍)을 순차 통과시켜 최적 종목을 추출합니다.
        </PageHeader>

        {/* ═══════════════════════════════════════════════════════════════════
            THREE SECTIONS — Quantus-inspired 3-section layout
            ═══════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6 lg:gap-8">

          {/* ─── SECTION 1: Stock Count Slider ────────────────────────────── */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card padding="lg" className="h-full relative hover:border-purple-500/30 transition-all">
              <div className="flex items-center gap-3 mb-6 sm:mb-8">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-purple-500/15 flex items-center justify-center">
                  <Filter className="w-5 h-5 sm:w-6 sm:h-6 text-purple-400" />
                </div>
                <div>
                  <span className="text-micro block">종목 수 선택</span>
                  <span className="text-[10px] font-bold text-theme-text-muted">Number of Stocks</span>
                </div>
              </div>

              {/* Large number display */}
              <div className="text-center mb-6 sm:mb-8">
                <span className="text-5xl sm:text-6xl lg:text-7xl font-black text-purple-400 font-mono tabular-nums tracking-tighter leading-none">
                  {stockCount}
                </span>
                <span className="text-lg sm:text-xl font-black text-theme-text-muted ml-1">개</span>
              </div>

              {/* Slider */}
              <div className="space-y-3">
                <input
                  type="range"
                  min={5}
                  max={20}
                  value={stockCount}
                  onChange={(e) => setStockCount(parseInt(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer bg-white/10 accent-purple-500
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500
                    [&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(168,85,247,0.4)] [&::-webkit-slider-thumb]:border-2
                    [&::-webkit-slider-thumb]:border-purple-300 [&::-webkit-slider-thumb]:cursor-pointer"
                />
                <div className="flex justify-between text-[10px] font-black text-theme-text-muted uppercase tracking-widest">
                  <span>5개</span>
                  <span>20개</span>
                </div>
              </div>

              {/* Quick picks */}
              <div className="flex gap-2 mt-5 sm:mt-6">
                {[5, 10, 15, 20].map((n) => (
                  <button
                    key={n}
                    onClick={() => setStockCount(n)}
                    className={cn(
                      'flex-1 py-2 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all border',
                      stockCount === n
                        ? 'bg-purple-500/15 border-purple-500/40 text-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.12)]'
                        : 'bg-white/5 border-theme-border text-theme-text-muted hover:bg-white/10'
                    )}
                  >
                    {n}개
                  </button>
                ))}
              </div>
            </Card>
          </motion.div>

          {/* ─── SECTION 2: Gate Weights ──────────────────────────────────── */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card padding="lg" className="h-full relative hover:border-blue-500/30 transition-all">
              <div className="flex items-center justify-between mb-6 sm:mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-500/15 flex items-center justify-center">
                    <SlidersHorizontal className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" />
                  </div>
                  <div>
                    <span className="text-micro block">Gate 가중치</span>
                    <span className="text-[10px] font-bold text-theme-text-muted">Factor Weights</span>
                  </div>
                </div>
                <Badge variant={totalGateWeight === 100 ? 'success' : 'danger'} size="sm">
                  {totalGateWeight}%
                </Badge>
              </div>

              <div className="space-y-5 sm:space-y-6">
                {/* Gate 1 - 필수 비중 */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
                      <span className="text-xs font-black text-theme-text uppercase tracking-wider">Gate 1</span>
                      <span className="text-[10px] font-bold text-theme-text-muted">필수</span>
                    </div>
                    <span className="text-sm font-black text-red-400 font-mono tabular-nums">{gate1Weight}%</span>
                  </div>
                  <input
                    type="range"
                    min={0} max={100}
                    value={gate1Weight}
                    onChange={(e) => setGate1Weight(clampWeight(parseInt(e.target.value)))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-white/10 accent-red-500
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                      [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-500 [&::-webkit-slider-thumb]:cursor-pointer
                      [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                  />
                </div>

                {/* Gate 2 - 성장 비중 */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
                      <span className="text-xs font-black text-theme-text uppercase tracking-wider">Gate 2</span>
                      <span className="text-[10px] font-bold text-theme-text-muted">성장</span>
                    </div>
                    <span className="text-sm font-black text-amber-400 font-mono tabular-nums">{gate2Weight}%</span>
                  </div>
                  <input
                    type="range"
                    min={0} max={100}
                    value={gate2Weight}
                    onChange={(e) => setGate2Weight(clampWeight(parseInt(e.target.value)))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-white/10 accent-amber-500
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                      [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-500 [&::-webkit-slider-thumb]:cursor-pointer
                      [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                  />
                </div>

                {/* Gate 3 - 타이밍 비중 */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
                      <span className="text-xs font-black text-theme-text uppercase tracking-wider">Gate 3</span>
                      <span className="text-[10px] font-bold text-theme-text-muted">타이밍</span>
                    </div>
                    <span className="text-sm font-black text-green-400 font-mono tabular-nums">{gate3Weight}%</span>
                  </div>
                  <input
                    type="range"
                    min={0} max={100}
                    value={gate3Weight}
                    onChange={(e) => setGate3Weight(clampWeight(parseInt(e.target.value)))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-white/10 accent-green-500
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                      [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-green-500 [&::-webkit-slider-thumb]:cursor-pointer
                      [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                  />
                </div>

                {/* Combined bar visualization */}
                <div className="h-3 rounded-full overflow-hidden flex bg-white/5 border border-theme-border">
                  <motion.div animate={{ width: `${gate1Weight}%` }} className="gate-bar-g1 h-full" />
                  <motion.div animate={{ width: `${gate2Weight}%` }} className="gate-bar-g2 h-full" />
                  <motion.div animate={{ width: `${gate3Weight}%` }} className="gate-bar-g3 h-full" />
                </div>

                {totalGateWeight !== 100 && (
                  <p className="text-[10px] font-black text-red-400 text-center">
                    가중치 합계가 100%여야 합니다 (현재 {totalGateWeight}%)
                  </p>
                )}
              </div>
            </Card>
          </motion.div>

          {/* ─── SECTION 3: Position Sizing ───────────────────────────────── */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <Card padding="lg" className="h-full relative hover:border-orange-500/30 transition-all">
              <div className="flex items-center gap-3 mb-6 sm:mb-8">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-orange-500/15 flex items-center justify-center">
                  <Scale className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400" />
                </div>
                <div>
                  <span className="text-micro block">포지션 사이즈</span>
                  <span className="text-[10px] font-bold text-theme-text-muted">Position Sizing</span>
                </div>
              </div>

              <div className="space-y-3 sm:space-y-4">
                {/* Kelly option */}
                <button
                  onClick={() => setPositionMode('kelly')}
                  className={cn(
                    'w-full text-left p-4 sm:p-5 rounded-xl sm:rounded-2xl border transition-all',
                    positionMode === 'kelly'
                      ? 'bg-orange-500/10 border-orange-500/40 shadow-[0_0_20px_rgba(249,115,22,0.08)]'
                      : 'bg-white/5 border-theme-border hover:bg-white/[0.08]'
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Zap className={cn('w-4 h-4', positionMode === 'kelly' ? 'text-orange-400' : 'text-theme-text-muted')} />
                      <span className={cn('text-sm font-black uppercase tracking-wider', positionMode === 'kelly' ? 'text-orange-400' : 'text-theme-text')}>
                        Kelly Formula
                      </span>
                    </div>
                    <div className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
                      positionMode === 'kelly' ? 'border-orange-500 bg-orange-500' : 'border-theme-border'
                    )}>
                      {positionMode === 'kelly' && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                  </div>
                  <p className="text-[10px] sm:text-xs text-theme-text-muted font-bold leading-relaxed">
                    승률과 손익비 기반 최적 비중 자동 계산. 변동성에 따라 종목별 비중 차등 배분.
                  </p>
                </button>

                {/* Equal weight option */}
                <button
                  onClick={() => setPositionMode('equal')}
                  className={cn(
                    'w-full text-left p-4 sm:p-5 rounded-xl sm:rounded-2xl border transition-all',
                    positionMode === 'equal'
                      ? 'bg-blue-500/10 border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.08)]'
                      : 'bg-white/5 border-theme-border hover:bg-white/[0.08]'
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Layers className={cn('w-4 h-4', positionMode === 'equal' ? 'text-blue-400' : 'text-theme-text-muted')} />
                      <span className={cn('text-sm font-black uppercase tracking-wider', positionMode === 'equal' ? 'text-blue-400' : 'text-theme-text')}>
                        Equal Weight
                      </span>
                    </div>
                    <div className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
                      positionMode === 'equal' ? 'border-blue-500 bg-blue-500' : 'border-theme-border'
                    )}>
                      {positionMode === 'equal' && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                  </div>
                  <p className="text-[10px] sm:text-xs text-theme-text-muted font-bold leading-relaxed">
                    모든 종목에 동일 비중({stockCount > 0 ? (100 / stockCount).toFixed(1) : 0}%) 배분. 단순하고 분산 효과 극대화.
                  </p>
                </button>
              </div>
            </Card>
          </motion.div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            EXTRACTION BUTTON + GATE PROGRESS ANIMATION
            ═══════════════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card padding="lg" className={cn(extracting && 'border-purple-500/30')}>
            {/* Gate Progress Visualization */}
            <div className="flex items-center justify-center gap-2 sm:gap-4 mb-4">
              {GATE_STEPS.map((gate, idx) => {
                const isActive = currentGate === idx;
                const isCompleted = completedGates.includes(idx);
                return (
                  <React.Fragment key={gate.key}>
                    {idx > 0 && (
                      <motion.div
                        className="h-0.5 w-8 sm:w-16 rounded-full"
                        animate={{
                          backgroundColor: isCompleted || completedGates.includes(idx - 1)
                            ? 'rgba(168, 85, 247, 0.6)' : 'rgba(255,255,255,0.08)',
                        }}
                        transition={{ duration: 0.4 }}
                      />
                    )}
                    <motion.div
                      className={cn(
                        'flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl border-2 transition-all',
                        isActive ? `${gate.bgColor} ${gate.borderColor}` :
                        isCompleted ? 'bg-green-500/10 border-green-500/40' :
                        'bg-white/5 border-theme-border'
                      )}
                      animate={isActive ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                      transition={isActive ? { repeat: Infinity, duration: 1 } : {}}
                      title={`${gate.label} · ${gate.labelKo} — ${gate.description}`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
                      ) : isActive ? (
                        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                          {gate.icon}
                        </motion.div>
                      ) : (
                        <span className="text-theme-text-muted">{gate.icon}</span>
                      )}
                      <div>
                        <span className={cn(
                          'text-[10px] sm:text-xs font-black uppercase tracking-wider block',
                          isActive ? gate.color : isCompleted ? 'text-green-400' : 'text-theme-text-muted'
                        )}>
                          {gate.label}
                        </span>
                        <span className="text-[9px] sm:text-[10px] font-bold text-theme-text-muted">{gate.labelKo}</span>
                      </div>
                    </motion.div>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Gate 설명 카드 — 각 Gate가 무엇을 하는지 명시 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 sm:mb-8">
              {GATE_STEPS.map((gate) => (
                <div
                  key={`${gate.key}-desc`}
                  className={cn(
                    "rounded-xl border p-3 sm:p-4 bg-white/[0.03]",
                    gate.borderColor.replace('/40', '/20')
                  )}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={cn("shrink-0", gate.color)}>{gate.icon}</span>
                    <div className="flex flex-col leading-tight">
                      <span className={cn("text-[10px] sm:text-xs font-black uppercase tracking-wider", gate.color)}>
                        {gate.label}
                      </span>
                      <span className="text-[10px] sm:text-[11px] font-bold text-theme-text">{gate.labelKo}</span>
                    </div>
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-theme-text-muted font-medium leading-relaxed">
                    {gate.description}
                  </p>
                </div>
              ))}
            </div>

            {/* Progress bar during extraction */}
            <AnimatePresence>
              {extracting && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6"
                >
                  <div className="h-2 rounded-full overflow-hidden bg-white/5 border border-theme-border">
                    <motion.div
                      className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-green-500"
                      animate={{ width: `${((completedGates.length + (currentGate >= 0 ? 0.5 : 0)) / 3) * 100}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                  <p className="text-center text-[10px] font-black text-theme-text-muted uppercase tracking-widest mt-2">
                    {currentGate >= 0
                      ? `${GATE_STEPS[currentGate].label} ${GATE_STEPS[currentGate].labelKo} 처리 중...`
                      : '완료'}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Extract button */}
            <div className="flex justify-center">
              <Button
                variant="primary"
                size="lg"
                icon={extracting
                  ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}><Filter className="w-5 h-5" /></motion.div>
                  : <Play className="w-5 h-5" />}
                onClick={handleExtract}
                disabled={extracting || totalGateWeight !== 100}
                className="px-10 sm:px-16 py-4 text-base sm:text-lg shadow-[0_8px_30px_rgba(249,115,22,0.3)]"
              >
                {extracting ? '추출 중...' : extracted ? '다시 추출하기' : '포트폴리오 추출'}
              </Button>
            </div>

            {/* Completion message */}
            <AnimatePresence>
              {extracted && !extracting && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-6 sm:mt-8 p-4 sm:p-6 bg-green-500/10 border border-green-500/25 rounded-xl sm:rounded-2xl text-center"
                >
                  <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-3" />
                  <p className="text-sm sm:text-base font-black text-green-400 uppercase tracking-wider mb-1">
                    추출 완료
                  </p>
                  <p className="text-xs text-theme-text-muted font-bold">
                    3-Gate 필터를 통과한 상위 {stockCount}개 종목이 추출되었습니다.
                    ({positionMode === 'kelly' ? 'Kelly 공식' : '균등배분'} 적용)
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </motion.div>
      </Stack>
    </motion.div>
  );
}
