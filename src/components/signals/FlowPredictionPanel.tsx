// @responsibility signals 영역 FlowPredictionPanel 컴포넌트
/**
 * FlowPredictionPanel.tsx — 수급 예측 선행 모델 패널
 *
 * 외국인·기관 대량 매수 직전 패턴(거래량 마름 + 호가 저항 약화 + 프로그램 비차익 유입),
 * DART 의무보유 해제/블록딜 수급 왜곡 경고, 외국인 재진입 대기 종목을 시각화한다.
 */
import React, { useState } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle, Eye, ChevronDown, ChevronUp,
  BarChart2, Radio,
} from 'lucide-react';
import { cn } from '../../ui/cn';
import { evaluateFlowPrediction } from '../../services/quant/flowPredictionEngine';
import type {
  FlowPredictionInput,
  FlowPredictionResult,
  FlowPredictionSignal,
  SupplyDistortionSchedule,
} from '../../types/flowPrediction';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  result: FlowPredictionResult | null;
  input: FlowPredictionInput;
  onInputChange: (input: FlowPredictionInput) => void;
}

// ─── 신호 배지 ─────────────────────────────────────────────────────────────────

function SignalBadge({ signal }: { signal: FlowPredictionSignal }) {
  const configs: Record<FlowPredictionSignal, { label: string; color: string; icon: React.ReactNode }> = {
    BUY_PRECURSOR: {
      label: '선행 매수 신호',
      color: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/50',
      icon: <TrendingUp className="w-3 h-3" />,
    },
    DISTORTION_WARNING: {
      label: '수급 왜곡 경고',
      color: 'bg-red-900/60 text-red-300 border-red-700/50',
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    FOREIGN_REENTRY_CANDIDATE: {
      label: '외국인 재진입 대기',
      color: 'bg-violet-900/60 text-violet-300 border-violet-700/50',
      icon: <Eye className="w-3 h-3" />,
    },
    NEUTRAL: {
      label: '특이 신호 없음',
      color: 'bg-gray-800/60 text-gray-400 border-gray-600/50',
      icon: <Radio className="w-3 h-3" />,
    },
  };
  const { label, color, icon } = configs[signal];
  return (
    <span className={cn('flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border', color)}>
      {icon} {label}
    </span>
  );
}

// ─── 점수 바 ───────────────────────────────────────────────────────────────────

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color =
    score >= 80 ? 'bg-emerald-400' :
    score >= 55 ? 'bg-yellow-400' :
    score >= 35 ? 'bg-orange-400' : 'bg-gray-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span className="font-medium text-gray-200">{score}/100</span>
      </div>
      <div className="h-2 rounded-full bg-gray-700/60 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
    </div>
  );
}

// ─── 서브 신호 행 ──────────────────────────────────────────────────────────────

function SubSignalRow({
  detected,
  label,
  description,
}: {
  detected: boolean;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-gray-700/30 last:border-0">
      <span className={cn('mt-0.5 shrink-0 text-sm', detected ? 'text-emerald-400' : 'text-gray-600')}>
        {detected ? '✔' : '○'}
      </span>
      <div>
        <span className={cn('text-xs font-medium', detected ? 'text-gray-200' : 'text-gray-500')}>
          {label}
        </span>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// ─── 일정 카드 ─────────────────────────────────────────────────────────────────

function DistortionCard({ schedule }: { schedule: SupplyDistortionSchedule }) {
  const typeLabel = schedule.eventType === 'LOCKUP_RELEASE' ? '의무보유 해제' : '블록딜';
  const typeColor = schedule.eventType === 'LOCKUP_RELEASE'
    ? 'bg-orange-900/40 text-orange-300 border-orange-700/40'
    : 'bg-red-900/40 text-red-300 border-red-700/40';
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-700/40 bg-gray-800/30 px-3 py-2">
      <div>
        <span className="text-xs font-semibold text-gray-200">{schedule.stockName}</span>
        <span className="text-xs text-gray-500 ml-1.5">({schedule.stockCode})</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full border', typeColor)}>
          {typeLabel}
        </span>
        <span className="text-xs text-gray-400">{schedule.scheduledDate}</span>
      </div>
    </div>
  );
}

// ─── 수치 입력 행 ──────────────────────────────────────────────────────────────

function InputField({
  label,
  value,
  step,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-400 flex-1">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={step ?? 1}
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-24 rounded bg-gray-800 border border-gray-600 text-xs text-gray-200 px-2 py-1 text-right focus:border-indigo-500 focus:outline-none"
        />
        {unit && <span className="text-xs text-gray-500 w-8">{unit}</span>}
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export const FlowPredictionPanel: React.FC<Props> = ({ result, input, onInputChange }) => {
  const [expanded, setExpanded] = useState(false);
  const [showInputs, setShowInputs] = useState(false);

  const setField = <K extends keyof FlowPredictionInput>(key: K, value: FlowPredictionInput[K]) => {
    onInputChange({ ...input, [key]: value });
  };

  return (
    <div className="rounded-xl border border-cyan-800/40 bg-gray-900/50 px-5 py-4 space-y-4">
      {/* 헤더 */}
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <BarChart2 className="w-5 h-5 text-cyan-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-100">
              수급 예측 선행 모델 (Flow Prediction Engine)
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {result ? result.summary : '데이터 대기 중...'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result && <SignalBadge signal={result.signal} />}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* 요약 카드 */}
      {result && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-cyan-800/30 bg-cyan-900/10 p-3 text-center">
            <div className="text-xs text-gray-500 mb-1">패턴 점수</div>
            <div className={cn(
              'text-xl font-black',
              result.patternScore >= 80 ? 'text-emerald-400' :
              result.patternScore >= 55 ? 'text-yellow-400' :
              result.patternScore >= 35 ? 'text-orange-400' : 'text-gray-500',
            )}>
              {result.patternScore}
            </div>
            <div className="text-xs text-gray-600">/100</div>
          </div>

          <div className="rounded-lg border border-cyan-800/30 bg-cyan-900/10 p-3 text-center">
            <div className="text-xs text-gray-500 mb-1">선행 시간</div>
            <div className={cn(
              'text-xl font-black',
              result.estimatedLeadDays >= 2 ? 'text-cyan-300' : 'text-gray-500',
            )}>
              {result.estimatedLeadDays}일
            </div>
            <div className="text-xs text-gray-600">Gate 대비</div>
          </div>

          <div className="rounded-lg border border-cyan-800/30 bg-cyan-900/10 p-3 text-center">
            <div className="text-xs text-gray-500 mb-1">왜곡 일정</div>
            <div className={cn(
              'text-xl font-black',
              result.distortionWarning.active ? 'text-red-400' : 'text-gray-500',
            )}>
              {result.distortionWarning.schedules.length}
            </div>
            <div className="text-xs text-gray-600">건</div>
          </div>
        </div>
      )}

      {/* 확장 영역 */}
      {expanded && result && (
        <div className="space-y-4 pt-2 border-t border-gray-700/40">
          {/* 패턴 점수 바 */}
          <ScoreBar score={result.patternScore} label="선행 패턴 종합 점수" />

          {/* 3대 서브 신호 */}
          <div className="rounded-lg border border-gray-700/40 bg-gray-800/30 p-3">
            <p className="text-xs font-medium text-gray-400 mb-2">3대 선행 신호</p>
            <SubSignalRow
              detected={result.volumeDryUp.detected}
              label="거래량 마름 (Volume Dry-Up)"
              description={result.volumeDryUp.description}
            />
            <SubSignalRow
              detected={result.resistanceWeakening.detected}
              label="호가 저항 약화 (Resistance Weakening)"
              description={result.resistanceWeakening.description}
            />
            <SubSignalRow
              detected={result.programInflow.detected}
              label="프로그램 비차익 소폭 유입"
              description={result.programInflow.description}
            />
          </div>

          {/* 외국인 재진입 */}
          <div className={cn(
            'rounded-lg border p-3',
            result.foreignReentry.isCandidate
              ? 'border-violet-700/40 bg-violet-900/10'
              : 'border-gray-700/40 bg-gray-800/30',
          )}>
            <div className="flex items-center gap-2 mb-1">
              <Eye className={cn('w-3.5 h-3.5', result.foreignReentry.isCandidate ? 'text-violet-400' : 'text-gray-600')} />
              <p className="text-xs font-medium text-gray-300">외국인 재진입 대기 종목</p>
              {result.foreignReentry.isCandidate && (
                <span className="text-xs bg-violet-900/60 text-violet-300 rounded-full px-2 py-0.5 border border-violet-700/40">
                  후보
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{result.foreignReentry.description}</p>
          </div>

          {/* 수급 왜곡 경고 */}
          {result.distortionWarning.active && (
            <div className="rounded-lg border border-red-700/40 bg-red-900/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <p className="text-xs font-medium text-red-300">수급 왜곡 경고</p>
              </div>
              <div className="space-y-1.5">
                {result.distortionWarning.schedules.map((s, i) => (
                  <DistortionCard key={i} schedule={s} />
                ))}
              </div>
            </div>
          )}

          {/* 입력 편집 */}
          <button
            className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            onClick={(e) => { e.stopPropagation(); setShowInputs(!showInputs); }}
          >
            <BarChart2 className="w-3 h-3" />
            {showInputs ? '입력값 숨기기' : '수급 데이터 직접 입력'}
          </button>

          {showInputs && (
            <div className="space-y-2 rounded-lg border border-gray-700/40 bg-gray-800/30 p-3">
              <p className="text-xs text-gray-500 font-medium mb-2">수급 입력 데이터</p>
              <InputField
                label="최근 5일 평균 거래량 (주)"
                value={input.recentVolume5dAvg}
                step={10000}
                min={0}
                onChange={(v) => setField('recentVolume5dAvg', v)}
              />
              <InputField
                label="20일 평균 거래량 (주)"
                value={input.avgVolume20d}
                step={10000}
                min={0}
                onChange={(v) => setField('avgVolume20d', v)}
              />
              <InputField
                label="호가 스프레드 비율"
                value={input.bidAskSpreadRatio}
                step={0.0001}
                min={0}
                max={1}
                onChange={(v) => setField('bidAskSpreadRatio', v)}
              />
              <InputField
                label="프로그램 비차익 순매수"
                value={input.programNonArbitrageNetBuy}
                step={10}
                unit="억원"
                onChange={(v) => setField('programNonArbitrageNetBuy', v)}
              />
              <InputField
                label="외국인 보유 비중"
                value={input.foreignOwnershipRatio}
                step={0.1}
                min={0}
                max={100}
                unit="%"
                onChange={(v) => setField('foreignOwnershipRatio', v)}
              />
              <InputField
                label="외국인 재진입 임계값"
                value={input.foreignOwnershipThreshold ?? 15}
                step={1}
                min={0}
                max={100}
                unit="%"
                onChange={(v) => setField('foreignOwnershipThreshold', v)}
              />
              <InputField
                label="최근 5일 외국인 순매수"
                value={input.foreignNetBuy5d}
                step={1000}
                unit="주"
                onChange={(v) => setField('foreignNetBuy5d', v)}
              />
              <InputField
                label="최근 5일 기관 순매수"
                value={input.institutionalNetBuy5d}
                step={1000}
                unit="주"
                onChange={(v) => setField('institutionalNetBuy5d', v)}
              />
              <InputField
                label="펀더멘털 점수"
                value={input.fundamentalScore}
                step={1}
                min={0}
                max={100}
                onChange={(v) => setField('fundamentalScore', v)}
              />
            </div>
          )}

          {/* 알고리즘 설명 */}
          <div className="rounded-lg bg-gray-800/40 p-3 text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-400 font-medium">선행 원리: </span>
            외국인 대량 매수 직전 3~5거래일에 거래량 마름(5일 평균 ≤ 20일 평균의 60%) +
            호가 저항 약화 + 프로그램 비차익 소폭 유입이 공통으로 나타난다.
            이 3가지 신호가 동시 포착되면 Gate 필터보다 1~3일 앞서 진입 시점을 계산한다.
            <br /><br />
            <span className="text-gray-400 font-medium">DART 인텔리전스: </span>
            의무보유 해제·블록딜 일정은 대량 수급 왜곡을 유발한다.
            해당 날짜 전후 매수 판단을 보수적으로 적용하거나, 왜곡 해소 후 재진입 기회를 노린다.
            <br /><br />
            <span className="text-cyan-400/80">외국인 재진입 대기: </span>
            외국인 보유 비중이 임계값(기본 15%) 이하로 낮아진 종목 중 펀더멘털이 양호한 종목을 별도 관리한다.
          </div>
        </div>
      )}

      {!result && (
        <div className="text-xs text-gray-600 py-2 text-center">
          입력값을 설정하면 선행 수급 신호를 계산합니다.
        </div>
      )}
    </div>
  );
};
