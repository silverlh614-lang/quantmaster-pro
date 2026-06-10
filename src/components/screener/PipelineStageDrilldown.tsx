// @responsibility 단계별 종목 드릴다운 모달 — 통과·탈락 분리 + 사유 (PR-J)

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Check, AlertTriangle } from 'lucide-react';
import { cn } from '../../ui/cn';
import {
  fetchPipelineStocks,
  type DrilldownStage,
  type ClientPipelineStockEntry,
} from '../../api/screenerPipelineClient';

const DROP_REASON_LABEL: Record<string, string> = {
  quote: '시세(KIS quote) 조회 실패',
  // 'yahoo' 는 구 서버 응답 호환 키 — 실제 출처는 KIS (ADR-0561/0563 stale 오칭 정정).
  yahoo: '시세(KIS quote) 조회 실패',
  gate: 'Gate 1 진입 검증 탈락',
  rrr: 'RRR 최소값 미달',
  buy_failed: '진입 실패 (호가/사이즈/잔고)',
};

function StockRow({ entry }: { entry: ClientPipelineStockEntry }) {
  const passed = entry.outcome === 'PASSED' || entry.outcome === 'EXECUTED';
  return (
    <li className="flex items-center gap-2 py-1 text-[11px]">
      <span className={cn('shrink-0', passed ? 'text-green-300' : 'text-red-300')}>
        {passed ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      </span>
      <span className="font-bold opacity-90 truncate">{entry.name}</span>
      <span className="text-white/40 font-num text-[10px] shrink-0">{entry.stock}</span>
      {entry.dropReason && (
        <span className="ml-auto text-[10px] text-red-300/80 shrink-0">
          {DROP_REASON_LABEL[entry.dropReason] ?? entry.dropReason}
        </span>
      )}
      {entry.outcome === 'EXECUTED' && (
        <span className="ml-auto text-[10px] text-green-300 font-black shrink-0">체결됨</span>
      )}
    </li>
  );
}

interface PipelineStageDrilldownProps {
  stage: DrilldownStage;
  /** 파이프라인 요약 funnel 의 해당 단계 집계 수 — 추적(trace) 수와 비교해 불일치를 정직하게 표기. */
  expectedCount?: number;
  onClose: () => void;
}

const STAGE_LABEL: Record<DrilldownStage, string> = {
  CANDIDATES: '거래 가능',
  MOMENTUM_PASS: '모멘텀 후보',
  GATE1_PASS: '생존 후보',
  RRR_PASS: 'RRR 통과',
  ENTRIES: '매수 후보',
};

/**
 * 단계별 종목 드릴다운 — passed / dropped 분리 표시.
 * 모달 형식 (overlay + close 버튼).
 */
export function PipelineStageDrilldown({ stage, expectedCount, onClose }: PipelineStageDrilldownProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['screener', 'pipeline-stocks', stage],
    queryFn: () => fetchPipelineStocks(stage),
    staleTime: 60_000,
    retry: 2,
  });

  // 요약 funnel 집계(expectedCount, 최근 스캔 카운터)와 trace 추적 수는 소스가 달라(중복 종목
  // 제거·부분 trace·스캔 시점 차이) 어긋날 수 있다 — 숨기지 않고 차이를 명시한다(정직 표시).
  const traceTotal = data ? data.counts.passed + data.counts.dropped : 0;
  const countMismatch = data != null && expectedCount != null && expectedCount !== traceTotal;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-label={`${STAGE_LABEL[stage]} 단계 종목 드릴다운`}
      onClick={onClose}
    >
      <div
        className="bg-neutral-950 border border-white/[0.07] rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-white/[0.07]">
          <div>
            <h2 className="text-base font-black">{STAGE_LABEL[stage]} 단계 드릴다운</h2>
            {data && (
              <p className="text-[10px] text-white/50 mt-0.5">
                통과 {data.counts.passed} · 탈락 {data.counts.dropped}
              </p>
            )}
            {countMismatch && (
              <p className="text-[10px] text-amber-300/70 mt-0.5">
                요약 집계 {expectedCount} · 추적 {traceTotal}건 — 차이 {Math.abs((expectedCount ?? 0) - traceTotal)}건(중복 종목 제거·부분 trace·스캔 시점)
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading ? (
            <p className="text-xs opacity-50">로드 중…</p>
          ) : isError ? (
            <p className="text-xs text-red-300">드릴다운 로드 실패</p>
          ) : !data ? (
            <p className="text-xs opacity-50">데이터 없음</p>
          ) : (
            <>
              {data.passed.length > 0 && (
                <section>
                  <h3 className="text-[10px] font-semibold tracking-tight opacity-60 mb-1.5">
                    통과 ({data.passed.length})
                  </h3>
                  <ul className="divide-y divide-white/5">
                    {data.passed.map(e => <StockRow key={`p-${e.stock}`} entry={e} />)}
                  </ul>
                </section>
              )}
              {data.dropped.length > 0 && (
                <section>
                  <h3 className="text-[10px] font-semibold tracking-tight opacity-60 mb-1.5">
                    탈락 ({data.dropped.length})
                  </h3>
                  <ul className="divide-y divide-white/5">
                    {data.dropped.map(e => <StockRow key={`d-${e.stock}`} entry={e} />)}
                  </ul>
                </section>
              )}
              {data.passed.length === 0 && data.dropped.length === 0 && (
                <p className="text-xs opacity-60">
                  오늘 스캔 trace 가 비어있습니다 — 스캔 미실행 또는 trace 파일 부재.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
