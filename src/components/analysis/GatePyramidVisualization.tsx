// @responsibility analysis 영역 GatePyramidVisualization 컴포넌트
import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, TrendingUp, Zap, Triangle, ChevronDown } from 'lucide-react';
import { cn } from '../../ui/cn';
import type { StockRecommendation } from '../../services/stockService';

// ─── Gate Configuration ─────────────────────────────────────────────────────

interface GateConfig {
  id: number;
  label: string;
  subtitle: string;
  description: string;
  color: string;           // Tailwind color token
  fillColor: string;       // SVG gradient stop color
  glowColor: string;       // Glow effect rgba
  icon: React.ElementType;
  conditions: string[];
}

const GATE_CONFIGS: GateConfig[] = [
  {
    id: 1,
    label: 'GATE 1',
    subtitle: 'Survival Filter',
    description: '생존 필터 — 살아있는 종목의 최소 조건',
    color: 'emerald',
    fillColor: '#10b981',
    glowColor: 'rgba(16,185,129,0.4)',
    icon: Shield,
    conditions: [
      '사이클 검증', 'ROE 유형 3', '리스크온 환경', '기계적 손절',
      '이전 주도주 아님',
    ],
  },
  {
    id: 2,
    label: 'GATE 2',
    subtitle: 'Growth Verification',
    description: '성장 검증 — 펀더멘털 + 기술적 복합 검증',
    color: 'blue',
    fillColor: '#3b82f6',
    glowColor: 'rgba(59,130,246,0.4)',
    icon: TrendingUp,
    conditions: [
      '수급 유입', '일목 돌파', '경제적 해자', '골든크로스',
      '거래량 급증', '기관 매수', '컨센서스 목표가',
      '어닝 서프라이즈', '실적 현실', '정책 정합', 'OCF 품질',
      '상대강도',
    ],
  },
  {
    id: 3,
    label: 'GATE 3',
    subtitle: 'Precision Timing',
    description: '정밀 타이밍 — 최적 진입 시점 & 베팅 사이즈',
    color: 'orange',
    fillColor: '#f97316',
    glowColor: 'rgba(249,115,22,0.5)',
    icon: Zap,
    conditions: [
      '모멘텀 랭킹', '심리적 객관성', '터틀 돌파',
      '피보나치 레벨', '엘리엇 파동', '마진 가속',
      '이자보상배율', 'VCP 패턴', '다이버전스 체크',
      '촉매제 분석',
    ],
  },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface GatePyramidVisualizationProps {
  recommendations: StockRecommendation[];
  totalUniverse?: number;
}

interface GateStats {
  gate1: number;
  gate2: number;
  gate3: number;
  total: number;
}

// ─── Utility: compute gate counts from recommendations ──────────────────────

function computeGateStats(recommendations: StockRecommendation[], totalUniverse?: number): GateStats {
  let gate1 = 0;
  let gate2 = 0;
  let gate3 = 0;

  for (const rec of recommendations) {
    // Use gateEvaluation if available, else fall back to `gate` field
    if (rec.gateEvaluation) {
      if (rec.gateEvaluation.gate1Passed) gate1++;
      if (rec.gateEvaluation.gate2Passed) gate2++;
      if (rec.gateEvaluation.gate3Passed) gate3++;
    } else if (rec.gate != null) {
      if (rec.gate >= 1) gate1++;
      if (rec.gate >= 2) gate2++;
      if (rec.gate >= 3) gate3++;
    }
  }

  const total = totalUniverse ?? Math.max(recommendations.length, gate1);

  return { gate1, gate2, gate3, total };
}

// ─── SVG Pyramid Layer Component ────────────────────────────────────────────

interface PyramidLayerProps {
  index: number;         // 0=Gate3 (top), 1=Gate2, 2=Gate1 (bottom)
  config: GateConfig;
  count: number;
  prevCount: number;     // count of the broader funnel level (or total)
  total: number;
  isHovered: boolean;
  onHover: (id: number | null) => void;
  svgWidth: number;
  layerHeight: number;
  yOffset: number;
}

function PyramidLayer({
  index, config, count, prevCount, total, isHovered, onHover,
  svgWidth, layerHeight, yOffset,
}: PyramidLayerProps) {
  const cx = svgWidth / 2;

  // Pyramid narrows from bottom to top
  // topWidth < bottomWidth for each trapezoidal layer
  const pyramidTopInset = svgWidth * 0.38; // how narrow the apex is
  const pyramidBottomPad = svgWidth * 0.04;
  const totalHeight = layerHeight * 3;

  // Calculate left/right edges at top and bottom of this layer
  const layerTopY = yOffset;
  const layerBottomY = yOffset + layerHeight;

  const leftAtTop = pyramidBottomPad + (pyramidTopInset - pyramidBottomPad) * (1 - layerTopY / totalHeight);
  const rightAtTop = svgWidth - pyramidBottomPad - (pyramidTopInset - pyramidBottomPad) * (1 - layerTopY / totalHeight);
  const leftAtBottom = pyramidBottomPad + (pyramidTopInset - pyramidBottomPad) * (1 - layerBottomY / totalHeight);
  const rightAtBottom = svgWidth - pyramidBottomPad - (pyramidTopInset - pyramidBottomPad) * (1 - layerBottomY / totalHeight);

  const path = `M ${leftAtTop} ${layerTopY} L ${rightAtTop} ${layerTopY} L ${rightAtBottom} ${layerBottomY} L ${leftAtBottom} ${layerBottomY} Z`;

  // Fill ratio (how much of this layer is "lit up")
  const ratio = prevCount > 0 ? count / prevCount : 0;
  const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : '0';

  // Filled portion (from the left)
  const fillWidth = (rightAtBottom - leftAtBottom) * Math.min(ratio, 1);
  const midY = (layerTopY + layerBottomY) / 2;

  return (
    <g
      onMouseEnter={() => onHover(config.id)}
      onMouseLeave={() => onHover(null)}
      className="cursor-pointer"
      role="button"
      aria-label={`${config.label}: ${count}개 통과`}
    >
      {/* Background layer (dim) */}
      <path
        d={path}
        fill={`${config.fillColor}15`}
        stroke={isHovered ? config.fillColor : `${config.fillColor}40`}
        strokeWidth={isHovered ? 2 : 1}
        className="transition-all duration-300"
      />

      {/* Animated fill */}
      <clipPath id={`clip-gate-${config.id}`}>
        <path d={path} />
      </clipPath>
      <rect
        x={leftAtBottom}
        y={layerTopY}
        width={fillWidth}
        height={layerHeight}
        fill={`url(#gradient-gate-${config.id})`}
        clipPath={`url(#clip-gate-${config.id})`}
        className="transition-all duration-700 ease-out"
        opacity={isHovered ? 1 : 0.8}
      />

      {/* Glow effect on hover */}
      {isHovered && (
        <path
          d={path}
          fill="none"
          stroke={config.fillColor}
          strokeWidth={2}
          filter={`url(#glow-${config.id})`}
          opacity={0.6}
        />
      )}

      {/* Gate label */}
      <text
        x={cx}
        y={midY - 10}
        textAnchor="middle"
        className="fill-white text-[11px] font-black uppercase tracking-[0.15em]"
        style={{ fontFamily: 'inherit' }}
      >
        {config.label}: {config.subtitle}
      </text>

      {/* Count */}
      <text
        x={cx}
        y={midY + 14}
        textAnchor="middle"
        className="text-[22px] font-black tracking-tight"
        fill={config.fillColor}
        style={{ fontFamily: 'inherit' }}
      >
        {count}
      </text>

      {/* Percentage tag */}
      <text
        x={cx}
        y={midY + 32}
        textAnchor="middle"
        className="text-[10px] font-bold"
        fill={`${config.fillColor}99`}
        style={{ fontFamily: 'inherit' }}
      >
        {percentage}% of universe
      </text>
    </g>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function GatePyramidVisualization({ recommendations, totalUniverse }: GatePyramidVisualizationProps) {
  const [hoveredGate, setHoveredGate] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const stats = useMemo(
    () => computeGateStats(recommendations, totalUniverse),
    [recommendations, totalUniverse],
  );

  const hasData = stats.total > 0 && (stats.gate1 > 0 || stats.gate2 > 0 || stats.gate3 > 0);

  // SVG dimensions
  const svgWidth = 520;
  const layerHeight = 80;
  const topPadding = 30;
  const bottomPadding = 20;
  const svgHeight = layerHeight * 3 + topPadding + bottomPadding;

  // The pyramid layers from top to bottom: Gate3, Gate2, Gate1
  const layers = [
    { config: GATE_CONFIGS[2], count: stats.gate3, prevCount: stats.gate2 || stats.total },
    { config: GATE_CONFIGS[1], count: stats.gate2, prevCount: stats.gate1 || stats.total },
    { config: GATE_CONFIGS[0], count: stats.gate1, prevCount: stats.total },
  ];

  const hoveredConfig = hoveredGate ? GATE_CONFIGS.find(g => g.id === hoveredGate) : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      <div className="glass-3d rounded-2xl sm:rounded-3xl border border-white/10 overflow-hidden relative">
        {/* Background glow orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/4 w-64 h-64 bg-orange-500/[0.04] blur-[100px]" />
          <div className="absolute bottom-0 right-1/4 w-48 h-48 bg-blue-500/[0.05] blur-[80px]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/[0.03] blur-[120px]" />
        </div>

        {/* Header */}
        <div className="relative z-10 px-6 sm:px-10 pt-8 sm:pt-10 pb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-500/15 rounded-xl flex items-center justify-center">
                <Triangle className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-black text-theme-text tracking-tight uppercase">
                  3-Gate Pyramid
                </h3>
                <p className="text-[10px] sm:text-xs font-bold text-theme-text-muted uppercase tracking-[0.15em]">
                  27 Conditions Funnel Visualization
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsExpanded(prev => !prev)}
              className={cn(
                "p-2 rounded-lg border transition-all",
                isExpanded
                  ? "bg-orange-500/10 border-orange-500/20 text-orange-400"
                  : "bg-white/5 border-white/10 text-white/40 hover:text-white/60"
              )}
            >
              <ChevronDown className={cn("w-4 h-4 transition-transform duration-300", isExpanded && "rotate-180")} />
            </button>
          </div>
        </div>

        {/* Pyramid SVG */}
        <div className="relative z-10 px-4 sm:px-6 pb-4 flex justify-center">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full max-w-[520px]"
            aria-label="Gate Pyramid Visualization"
          >
            <defs>
              {/* Gradients for each gate */}
              {GATE_CONFIGS.map(gate => (
                <linearGradient key={gate.id} id={`gradient-gate-${gate.id}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={gate.fillColor} stopOpacity={0.9} />
                  <stop offset="100%" stopColor={gate.fillColor} stopOpacity={0.4} />
                </linearGradient>
              ))}
              {/* Glow filters */}
              {GATE_CONFIGS.map(gate => (
                <filter key={`glow-${gate.id}`} id={`glow-${gate.id}`} x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feFlood floodColor={gate.fillColor} floodOpacity="0.4" result="color" />
                  <feComposite in2="blur" operator="in" />
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              ))}
            </defs>

            {/* Pyramid layers */}
            {layers.map((layer, i) => (
              <PyramidLayer
                key={layer.config.id}
                index={i}
                config={layer.config}
                count={layer.count}
                prevCount={layer.prevCount}
                total={stats.total}
                isHovered={hoveredGate === layer.config.id}
                onHover={setHoveredGate}
                svgWidth={svgWidth}
                layerHeight={layerHeight}
                yOffset={topPadding + i * layerHeight}
              />
            ))}

            {/* Total Universe bar at bottom */}
            <g>
              <rect
                x={svgWidth * 0.04}
                y={topPadding + 3 * layerHeight + 6}
                width={svgWidth * 0.92}
                height={2}
                rx={1}
                fill="white"
                opacity={0.1}
              />
              <text
                x={svgWidth / 2}
                y={topPadding + 3 * layerHeight + 20}
                textAnchor="middle"
                className="text-[10px] font-black uppercase tracking-[0.2em]"
                fill="white"
                opacity={0.25}
                style={{ fontFamily: 'inherit' }}
              >
                Total Universe: {stats.total} stocks
              </text>
            </g>

            {/* Connecting arrows between layers */}
            {[0, 1].map(i => {
              const y = topPadding + (i + 1) * layerHeight;
              return (
                <g key={`arrow-${i}`} opacity={0.15}>
                  <line x1={svgWidth / 2 - 6} y1={y - 3} x2={svgWidth / 2} y2={y + 3} stroke="white" strokeWidth={1.5} />
                  <line x1={svgWidth / 2 + 6} y1={y - 3} x2={svgWidth / 2} y2={y + 3} stroke="white" strokeWidth={1.5} />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Funnel stats row */}
        <div className="relative z-10 px-6 sm:px-10 pb-6">
          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {[
              { label: 'Universe', value: stats.total, color: 'text-white/60', bg: 'bg-white/5', border: 'border-white/10' },
              { label: 'Gate 1', value: stats.gate1, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
              { label: 'Gate 2', value: stats.gate2, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
              { label: 'Gate 3', value: stats.gate3, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
            ].map(item => (
              <div key={item.label} className={cn("rounded-xl sm:rounded-2xl border p-3 sm:p-4 text-center transition-all", item.bg, item.border)}>
                <div className={cn("text-xl sm:text-2xl font-black tracking-tighter font-num", item.color)}>
                  {item.value}
                </div>
                <div className="text-[9px] sm:text-[10px] font-black text-white/30 uppercase tracking-[0.1em] sm:tracking-[0.15em] mt-1">
                  {item.label}
                </div>
              </div>
            ))}
          </div>

          {/* Funnel flow indicator */}
          <div className="flex items-center justify-center gap-1.5 mt-4">
            <span className="text-[9px] font-black text-white/15 uppercase tracking-widest">
              {stats.total}
            </span>
            <span className="text-white/10">&rarr;</span>
            <span className="text-[9px] font-black text-emerald-500/50 uppercase tracking-widest">
              {stats.gate1}
            </span>
            <span className="text-white/10">&rarr;</span>
            <span className="text-[9px] font-black text-blue-500/50 uppercase tracking-widest">
              {stats.gate2}
            </span>
            <span className="text-white/10">&rarr;</span>
            <span className="text-[9px] font-black text-orange-500/60 uppercase tracking-widest">
              {stats.gate3} Final
            </span>
          </div>
        </div>

        {/* Expandable detail panel */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="px-6 sm:px-10 pb-8 pt-2 border-t border-white/5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  {GATE_CONFIGS.map(gate => {
                    const count = gate.id === 1 ? stats.gate1 : gate.id === 2 ? stats.gate2 : stats.gate3;
                    const Icon = gate.icon;
                    return (
                      <div
                        key={gate.id}
                        className={cn(
                          "rounded-xl border p-4 sm:p-5 transition-all",
                          hoveredGate === gate.id ? `border-${gate.color}-500/30 bg-${gate.color}-500/10` : "border-white/5 bg-white/[0.02]"
                        )}
                        onMouseEnter={() => setHoveredGate(gate.id)}
                        onMouseLeave={() => setHoveredGate(null)}
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center",
                            gate.id === 1 ? "bg-emerald-500/15" : gate.id === 2 ? "bg-blue-500/15" : "bg-orange-500/15"
                          )}>
                            <Icon className={cn(
                              "w-4 h-4",
                              gate.id === 1 ? "text-emerald-400" : gate.id === 2 ? "text-blue-400" : "text-orange-400"
                            )} />
                          </div>
                          <div>
                            <div className="text-xs font-black text-white uppercase tracking-widest">{gate.label}</div>
                            <div className="text-[10px] font-bold text-white/30">{gate.subtitle}</div>
                          </div>
                        </div>

                        <p className="text-[11px] font-bold text-white/40 mb-3 leading-relaxed">{gate.description}</p>

                        <div className="flex flex-wrap gap-1">
                          {gate.conditions.map(cond => (
                            <span
                              key={cond}
                              className={cn(
                                "text-[9px] font-bold px-2 py-0.5 rounded-md border",
                                gate.id === 1 ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-400/60"
                                : gate.id === 2 ? "bg-blue-500/5 border-blue-500/10 text-blue-400/60"
                                : "bg-orange-500/5 border-orange-500/10 text-orange-400/60"
                              )}
                            >
                              {cond}
                            </span>
                          ))}
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">통과</span>
                          <span className={cn(
                            "text-lg font-black tracking-tight",
                            gate.id === 1 ? "text-emerald-400" : gate.id === 2 ? "text-blue-400" : "text-orange-400"
                          )}>
                            {count}
                            <span className="text-[10px] font-bold text-white/20 ml-1">종목</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {!hasData && (
          <div className="relative z-10 px-6 sm:px-10 pb-8">
            <div className="text-center py-6 border border-dashed border-white/5 rounded-2xl bg-white/[0.01]">
              <Triangle className="w-10 h-10 text-white/10 mx-auto mb-3" />
              <p className="text-sm font-black text-white/20 uppercase tracking-widest mb-1">Gate 데이터 없음</p>
              <p className="text-xs text-white/10 font-bold">분석을 실행하면 Gate 통과 현황이 피라미드로 표시됩니다</p>
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}
