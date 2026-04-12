/**
 * SectorEnergyPanel.tsx — 섹터 에너지 맵 & 로테이션 마스터 게이트 패널
 *
 * KRX 12개 섹터 에너지 점수를 시각화하고 주도/소외 섹터를 표시한다.
 * Gate 2 완화 조건 및 포지션 사이즈 제한을 함께 표시한다.
 */
import React, { useState } from 'react';
import { Zap, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { cn } from '../ui/cn';
import type { SectorEnergyResult, SectorEnergyInput, SectorTierResult } from '../types/sectorEnergy';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  result: SectorEnergyResult | null;
  inputs: SectorEnergyInput[];
  onInputsChange: (inputs: SectorEnergyInput[]) => void;
}

// ─── 티어 배지 ─────────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: SectorTierResult['tier'] }) {
  if (tier === 'LEADING') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-900/60 px-2 py-0.5 text-xs font-semibold text-emerald-300">
        <TrendingUp className="w-3 h-3" /> 주도
      </span>
    );
  }
  if (tier === 'LAGGING') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-900/60 px-2 py-0.5 text-xs font-semibold text-red-300">
        <TrendingDown className="w-3 h-3" /> 소외
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-full bg-gray-700/60 px-2 py-0.5 text-xs text-gray-400">
      <Minus className="w-3 h-3" /> 중립
    </span>
  );
}

// ─── 에너지 바 ─────────────────────────────────────────────────────────────────

function EnergyBar({ score, tier }: { score: number; tier: SectorTierResult['tier'] }) {
  const color =
    tier === 'LEADING' ? 'bg-emerald-400' :
    tier === 'LAGGING' ? 'bg-red-500' : 'bg-blue-500';

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <div className="flex-1 h-2 rounded-full bg-gray-700/60 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{score.toFixed(0)}</span>
    </div>
  );
}

// ─── 입력 편집 행 ─────────────────────────────────────────────────────────────

function InputRow({
  input,
  onChange,
}: {
  input: SectorEnergyInput;
  onChange: (updated: SectorEnergyInput) => void;
}) {
  return (
    <tr className="border-b border-gray-700/40 hover:bg-gray-800/30">
      <td className="py-1.5 pr-2 text-xs text-gray-300 whitespace-nowrap">{input.name}</td>
      {(['return4w', 'volumeChangePct', 'foreignConcentration'] as const).map((field) => (
        <td key={field} className="py-1.5 px-1">
          <input
            type="number"
            step={field === 'foreignConcentration' ? '1' : '0.1'}
            min={field === 'foreignConcentration' ? '0' : undefined}
            max={field === 'foreignConcentration' ? '100' : undefined}
            value={input[field]}
            onChange={(e) => onChange({ ...input, [field]: parseFloat(e.target.value) || 0 })}
            className="w-16 rounded bg-gray-800 border border-gray-600 text-xs text-gray-200 px-1.5 py-0.5 text-right focus:border-indigo-500 focus:outline-none"
          />
        </td>
      ))}
    </tr>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export const SectorEnergyPanel: React.FC<Props> = ({ result, inputs, onInputsChange }) => {
  const [expanded, setExpanded] = useState(false);
  const [showInputs, setShowInputs] = useState(false);

  const handleInputChange = (index: number, updated: SectorEnergyInput) => {
    const next = [...inputs];
    next[index] = updated;
    onInputsChange(next);
  };

  // 모든 섹터를 점수 내림차순으로 통합
  const allTiers = result
    ? [...result.leadingSectors, ...result.neutralSectors, ...result.laggingSectors]
    : [];

  return (
    <div className="rounded-xl border border-indigo-800/40 bg-gray-900/50 px-5 py-4 space-y-4">
      {/* 헤더 */}
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-amber-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-100">
              섹터 에너지 맵 &amp; 로테이션 마스터 게이트
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {result ? result.summary : '데이터 로딩 중...'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <span className="text-xs text-gray-500">
              계절: <span className="text-amber-400 font-medium">{result.currentSeason}</span>
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* 주도/소외 섹터 요약 카드 */}
      {result && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-emerald-800/40 bg-emerald-900/10 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-300">주도 섹터 Top 3</span>
              <span className="ml-auto text-xs text-emerald-600">Gate2 -1 완화</span>
            </div>
            {result.leadingSectors.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <span className="truncate">{s.name}</span>
                <span className="ml-auto text-emerald-400 font-medium">{s.energyScore.toFixed(0)}</span>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-red-800/40 bg-red-900/10 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingDown className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs font-semibold text-red-300">소외 섹터 Bottom 3</span>
              <span className="ml-auto text-xs text-red-600">포지션 40%</span>
            </div>
            {result.laggingSectors.map((s) => (
              <div key={s.name} className="flex items-center gap-2 text-xs text-gray-300 py-0.5">
                <span className="truncate">{s.name}</span>
                <span className="ml-auto text-red-400 font-medium">{s.energyScore.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 확장 영역 */}
      {expanded && result && (
        <div className="space-y-3 pt-2 border-t border-gray-700/40">
          {/* 전체 섹터 에너지 바 */}
          <div className="space-y-2">
            <p className="text-xs text-gray-500 font-medium">전체 섹터 에너지 순위</p>
            {allTiers.map((tier) => (
              <div key={tier.name} className="flex items-center gap-3">
                <span className="text-xs text-gray-300 w-24 shrink-0 truncate">{tier.name}</span>
                <EnergyBar score={tier.energyScore} tier={tier.tier} />
                <TierBadge tier={tier.tier} />
                {tier.tier === 'LAGGING' && (
                  <span className="text-xs text-red-400 shrink-0">포지션 {tier.positionSizeLimit}%</span>
                )}
              </div>
            ))}
          </div>

          {/* 입력 편집 토글 */}
          <button
            className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            onClick={() => setShowInputs(!showInputs)}
          >
            <RefreshCw className="w-3 h-3" />
            {showInputs ? '입력값 숨기기' : '섹터 데이터 직접 입력'}
          </button>

          {showInputs && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700/40">
                    <th className="py-1 pr-2 text-left font-normal">섹터</th>
                    <th className="py-1 px-1 text-right font-normal">4주수익률(%)</th>
                    <th className="py-1 px-1 text-right font-normal">거래량증가(%)</th>
                    <th className="py-1 px-1 text-right font-normal">외국인집중(0-100)</th>
                  </tr>
                </thead>
                <tbody>
                  {inputs.map((inp, i) => (
                    <InputRow
                      key={inp.name}
                      input={inp}
                      onChange={(updated) => handleInputChange(i, updated)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 알고리즘 설명 */}
          <div className="rounded-lg bg-gray-800/40 p-3 text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-400 font-medium">에너지 점수 산식: </span>
            (4주수익률 × 0.4) + (거래량증가율 × 0.3) + (외국인집중도 × 0.3) × 계절성 배수
            <br />
            <span className="text-amber-400/80">원리: 좋은 종목을 나쁜 바다에서 낚는 것보다,
            보통 종목을 좋은 바다에서 낚는 것이 더 높은 기댓값을 갖는다.</span>
          </div>
        </div>
      )}

      {!result && (
        <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          섹터 에너지 계산 대기 중...
        </div>
      )}
    </div>
  );
};
