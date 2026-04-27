// @responsibility signals 영역 SatelliteCascaderPanel 컴포넌트
/**
 * SatelliteCascaderPanel.tsx — 위성 종목 연쇄 추적 시스템 패널
 *
 * 주도주가 Gate 3 통과 매수 이후 동일 섹터 지연 반응 종목(Laggard)의
 * RS 점수 추이를 추적해 2차·3차 진입 기회를 시각화한다.
 */
import React, { useState } from 'react';
import {
  Satellite, TrendingUp, TrendingDown, Clock, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle, Plus, Trash2,
} from 'lucide-react';
import { cn } from '../../ui/cn';
import { evaluateSatelliteCascader } from '../../services/quant/satelliteCascaderEngine';
import type {
  SatelliteCascaderInput,
  SatelliteCascaderResult,
  SatelliteStock,
  SatelliteStockInput,
} from '../../types/satellite';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  result: SatelliteCascaderResult | null;
  input: SatelliteCascaderInput | null;
  onInputChange: (input: SatelliteCascaderInput | null) => void;
}

// ─── 진입 윈도우 배지 ──────────────────────────────────────────────────────────

function EntryWindowBadge({ window: w }: { window: SatelliteStock['expectedEntryWindow'] }) {
  const cfg: Record<
    SatelliteStock['expectedEntryWindow'],
    { label: string; color: string }
  > = {
    TOO_EARLY: { label: '대기 중', color: 'bg-gray-700/60 text-gray-400 border-gray-600/40' },
    ENTRY_WINDOW: { label: '진입 윈도우', color: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/40' },
    LATE: { label: '윈도우 초과', color: 'bg-gray-700/40 text-gray-500 border-gray-600/30' },
  };
  const { label, color } = cfg[w];
  return (
    <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', color)}>
      {label}
    </span>
  );
}

// ─── RS 추이 아이콘 ────────────────────────────────────────────────────────────

function RsTrendIcon({ trend }: { trend: number }) {
  if (trend > 1) return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
  if (trend > 0) return <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />;
  if (trend < 0) return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
  return <span className="w-3.5 h-3.5 inline-block text-gray-500 text-xs">—</span>;
}

// ─── 입력 폼 (주도주 + 위성 종목 편집) ────────────────────────────────────────

interface InputFormProps {
  input: SatelliteCascaderInput | null;
  onSave: (input: SatelliteCascaderInput) => void;
}

function InputForm({ input, onSave }: InputFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [leaderCode, setLeaderCode] = useState(input?.leaderCode ?? '');
  const [leaderName, setLeaderName] = useState(input?.leaderName ?? '');
  const [leaderSector, setLeaderSector] = useState(input?.leaderSector ?? '');
  const [leaderRsScore, setLeaderRsScore] = useState(String(input?.leaderRsScore ?? 85));
  const [leaderEntryDate, setLeaderEntryDate] = useState(input?.leaderEntryDate?.slice(0, 10) ?? today);
  const [satellites, setSatellites] = useState<SatelliteStockInput[]>(
    input?.satellites ?? [],
  );

  const addSatellite = () => {
    setSatellites((prev) => [
      ...prev,
      { code: '', name: '', rsScore: 60, rsTrend: 0, volumeMultiple: 1.0 },
    ]);
  };

  const removeSatellite = (idx: number) => {
    setSatellites((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSatellite = (idx: number, field: keyof SatelliteStockInput, value: string) => {
    setSatellites((prev) =>
      prev.map((s, i) =>
        i === idx
          ? { ...s, [field]: ['code', 'name'].includes(field) ? value : parseFloat(value) || 0 }
          : s,
      ),
    );
  };

  const handleSave = () => {
    if (!leaderCode || !leaderName) return;
    onSave({
      leaderCode,
      leaderName,
      leaderSector,
      leaderRsScore: parseFloat(leaderRsScore) || 80,
      leaderEntryDate: leaderEntryDate,
      satellites,
    });
  };

  return (
    <div className="space-y-4 pt-3 border-t border-gray-700/50">
      {/* 주도주 */}
      <div>
        <p className="text-xs font-semibold text-gray-400 mb-2">주도주 정보</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            { label: '코드', val: leaderCode, set: setLeaderCode, type: 'text' },
            { label: '종목명', val: leaderName, set: setLeaderName, type: 'text' },
            { label: '섹터', val: leaderSector, set: setLeaderSector, type: 'text' },
            { label: 'RS 점수', val: leaderRsScore, set: setLeaderRsScore, type: 'number' },
            { label: '매수 진입일', val: leaderEntryDate, set: setLeaderEntryDate, type: 'date' },
          ].map(({ label, val, set, type }) => (
            <label key={label} className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">{label}</span>
              <input
                type={type}
                value={val}
                onChange={(e) => set(e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-violet-500"
              />
            </label>
          ))}
        </div>
      </div>

      {/* 위성 종목 목록 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-400">위성 종목 ({satellites.length})</p>
          <button
            onClick={addSatellite}
            className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
          >
            <Plus className="w-3.5 h-3.5" /> 추가
          </button>
        </div>

        {satellites.length === 0 && (
          <p className="text-xs text-gray-600 text-center py-3">위성 종목을 추가하세요.</p>
        )}

        {satellites.map((s, idx) => (
          <div key={idx} className="grid grid-cols-5 gap-1.5 mb-2 items-end">
            {(
              [
                { field: 'code' as const, label: '코드', type: 'text' },
                { field: 'name' as const, label: '종목명', type: 'text' },
                { field: 'rsScore' as const, label: 'RS', type: 'number' },
                { field: 'rsTrend' as const, label: 'RS추이', type: 'number' },
                { field: 'volumeMultiple' as const, label: '거래량배율', type: 'number' },
              ] as { field: keyof SatelliteStockInput; label: string; type: string }[]
            ).map(({ field, label, type }) => (
              <label key={field} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-500">{label}</span>
                <input
                  type={type}
                  value={String(s[field])}
                  onChange={(e) => updateSatellite(idx, field, e.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 focus:outline-none focus:border-violet-500 w-full"
                />
              </label>
            ))}
            <button
              onClick={() => removeSatellite(idx)}
              className="pb-0.5 text-gray-600 hover:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        className="w-full py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-xs text-white font-semibold"
      >
        추적 시작
      </button>
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export const SatelliteCascaderPanel: React.FC<Props> = ({ result, input, onInputChange }) => {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleSave = (newInput: SatelliteCascaderInput) => {
    onInputChange(newInput);
    setEditing(false);
  };

  const handleClear = () => {
    onInputChange(null);
    setEditing(false);
  };

  const hasSignals = (result?.activeSignalCount ?? 0) > 0;

  return (
    <div
      className={cn(
        'rounded-xl border-2 bg-gray-900/60 overflow-hidden',
        hasSignals ? 'border-violet-500' : 'border-gray-700',
      )}
    >
      {/* 헤더 */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <Satellite className="w-5 h-5 text-violet-400" />
          <div>
            <h3 className="text-sm font-semibold text-gray-100">
              위성 종목 연쇄 추적 시스템
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {result
                ? result.summary
                : '주도주를 등록하고 동일 섹터 위성 종목을 추적하세요.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasSignals && (
            <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border bg-violet-900/60 text-violet-300 border-violet-700/50">
              <CheckCircle className="w-3 h-3" /> 신호 {result!.activeSignalCount}건
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* 내용 */}
      {expanded && (
        <div className="px-5 pb-5 space-y-4">
          {/* 주도주 정보 */}
          {result && !editing && (
            <div className="rounded-lg border border-violet-800/40 bg-violet-900/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-violet-300">주도주</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(true)}
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    편집
                  </button>
                  <button
                    onClick={handleClear}
                    className="text-xs text-gray-500 hover:text-red-400"
                  >
                    초기화
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-gray-500">종목</span>
                  <p className="text-gray-100 font-semibold">{result.leader.name} ({result.leader.code})</p>
                </div>
                <div>
                  <span className="text-gray-500">섹터</span>
                  <p className="text-gray-100">{result.leader.sector}</p>
                </div>
                <div>
                  <span className="text-gray-500">진입 후 경과</span>
                  <p className="text-gray-100 font-semibold">
                    {result.leader.weeksElapsed.toFixed(1)}주
                    <span className={cn(
                      'ml-1 text-[10px]',
                      result.leader.weeksElapsed >= 4 && result.leader.weeksElapsed <= 8
                        ? 'text-emerald-400' : 'text-gray-500',
                    )}>
                      {result.leader.weeksElapsed >= 4 && result.leader.weeksElapsed <= 8
                        ? '진입 윈도우' : result.leader.weeksElapsed < 4 ? '대기 중' : '윈도우 초과'}
                    </span>
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">RS 점수</span>
                  <p className="text-gray-100 font-semibold">{result.leader.rsScore.toFixed(0)}</p>
                </div>
                <div>
                  <span className="text-gray-500">진입일</span>
                  <p className="text-gray-100">{result.leader.entryDate.slice(0, 10)}</p>
                </div>
                <div>
                  <span className="text-gray-500">위성 종목</span>
                  <p className="text-gray-100 font-semibold">{result.satellites.length}개</p>
                </div>
              </div>
            </div>
          )}

          {/* 위성 종목 테이블 */}
          {result && !editing && result.satellites.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-700/60">
                    <th className="text-left py-2 pr-3 text-gray-500 font-semibold">종목</th>
                    <th className="text-right py-2 px-2 text-gray-500 font-semibold">RS</th>
                    <th className="text-right py-2 px-2 text-gray-500 font-semibold">RS갭</th>
                    <th className="text-center py-2 px-2 text-gray-500 font-semibold">추이</th>
                    <th className="text-right py-2 px-2 text-gray-500 font-semibold">거래량배율</th>
                    <th className="text-center py-2 pl-2 text-gray-500 font-semibold">진입</th>
                  </tr>
                </thead>
                <tbody>
                  {result.satellites.map((s) => (
                    <tr
                      key={s.code}
                      className={cn(
                        'border-b border-gray-800/40 hover:bg-gray-800/20',
                        s.laggardSignal && 'bg-violet-900/10',
                      )}
                    >
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5">
                          {s.laggardSignal && (
                            <AlertTriangle className="w-3 h-3 text-violet-400 flex-shrink-0" />
                          )}
                          <div>
                            <span className={cn(
                              'font-medium',
                              s.laggardSignal ? 'text-violet-300' : 'text-gray-300',
                            )}>
                              {s.name}
                            </span>
                            <span className="text-gray-600 ml-1">({s.code})</span>
                          </div>
                        </div>
                      </td>
                      <td className="text-right py-2 px-2 text-gray-200">
                        {s.rsScore.toFixed(0)}
                      </td>
                      <td className={cn(
                        'text-right py-2 px-2 font-medium',
                        s.rsDelta <= -20 ? 'text-amber-400' : s.rsDelta < 0 ? 'text-gray-400' : 'text-emerald-400',
                      )}>
                        {s.rsDelta > 0 ? '+' : ''}{s.rsDelta.toFixed(1)}
                      </td>
                      <td className="text-center py-2 px-2">
                        <div className="flex items-center justify-center gap-1">
                          <RsTrendIcon trend={s.rsTrend} />
                          <span className={cn(
                            'text-[10px]',
                            s.rsTrend > 0 ? 'text-emerald-500' : 'text-gray-600',
                          )}>
                            {s.rsTrend > 0 ? '+' : ''}{s.rsTrend.toFixed(1)}
                          </span>
                        </div>
                      </td>
                      <td className={cn(
                        'text-right py-2 px-2',
                        s.volumeMultiple >= 1.3 ? 'text-emerald-400' : 'text-gray-400',
                      )}>
                        {s.volumeMultiple.toFixed(2)}x
                      </td>
                      <td className="text-center py-2 pl-2">
                        <EntryWindowBadge window={s.expectedEntryWindow} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 지연 진입 신호 설명 */}
          {result && !editing && (
            <div className="rounded-lg border border-gray-700/40 bg-gray-800/20 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Clock className="w-3.5 h-3.5" />
                <span className="font-semibold">지연 진입 신호 조건</span>
              </div>
              <ul className="text-xs text-gray-500 space-y-0.5 pl-5 list-disc">
                <li>주도주 대비 RS 갭 ≤ -20점 (지연 상태)</li>
                <li>최근 7일 RS 추이 양수 (따라잡기 시작)</li>
                <li>주도주 진입 후 4~8주 구간 (역사적 패턴 기반)</li>
                <li>거래량 배율 ≥ 1.3 (확인 신호)</li>
              </ul>
            </div>
          )}

          {/* 편집 폼 또는 초기 등록 폼 */}
          {(!result || editing) && (
            <div>
              {editing && (
                <div className="flex justify-end mb-2">
                  <button
                    onClick={() => setEditing(false)}
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    취소
                  </button>
                </div>
              )}
              <InputForm input={input} onSave={handleSave} />
            </div>
          )}

          {/* 신규 등록 버튼 (결과 없는 초기 상태) */}
          {!result && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="w-full py-2 rounded-lg border border-dashed border-violet-700/50 text-xs text-violet-400 hover:border-violet-500 hover:text-violet-300"
            >
              + 주도주 등록하기
            </button>
          )}
        </div>
      )}
    </div>
  );
};
