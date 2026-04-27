// @responsibility metaDecisionJournal 학습 엔진 모듈
/**
 * metaDecisionJournal.ts — Meta-Decision Journal (#10).
 *
 * "시스템이 그 매매를 하기로 결정한 프로세스" 자체를 기록.
 *
 * 기록 대상:
 *   - 후보 종목 수 → Gate0/1/2 통과 수 → 최종 선택 (종목 또는 null)
 *   - 결정 시각, 결정 해시(판단엔진+가중치+매크로 스냅샷), 체결 지연
 *
 * 분석:
 *   - 월간 decision hash 분포 → 코드 변경 없이도 결정 경로 편향 감지.
 *   - 최종 선택율 0% / 100% 극단 지속 → 파이프라인 고장 or 과보수 징후.
 *
 * 저장: data/meta-decisions-YYYYMM.jsonl (append-only).
 * 호출 지점: buyPipeline / signalScanner 최종 판정 직후 (Phase 5 에서 실제 wiring).
 */

import crypto from 'crypto';
import {
  appendMetaDecision,
  readMetaDecisionsForMonth,
} from '../../persistence/reflectionRepo.js';
import type { MetaDecisionEntry } from '../reflectionTypes.js';

/** 판단 엔진 버전 + 현재 가중치 해시 + 매크로 스냅샷으로 결정 경로 지문 생성. */
export function computeDecisionHash(parts: {
  engineVersion: string;
  weightsSignature: string;
  macroSnapshot: string;
}): string {
  return crypto
    .createHash('sha256')
    .update([parts.engineVersion, parts.weightsSignature, parts.macroSnapshot].join('|'))
    .digest('hex')
    .slice(0, 12);
}

/** 새로운 결정 레코드를 기록한다. 호출자는 모든 필드를 채워 전달. */
export function recordMetaDecision(entry: Omit<MetaDecisionEntry, 'decisionId'>): MetaDecisionEntry {
  const decisionId = `dec_${entry.decidedAt.replace(/[-:TZ.]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 6)}`;
  const full: MetaDecisionEntry = { decisionId, ...entry };
  appendMetaDecision(full);
  return full;
}

export interface MetaDecisionSummary {
  yyyymm: string;
  totalDecisions: number;
  selectedCount:  number;
  selectionRatePct: number;
  /** decisionHash → count. Top-5 반환. */
  topHashes: Array<{ hash: string; count: number }>;
  /** 평균 gate 통과율 */
  avgGate0Pass: number;
  avgGate1Pass: number;
  avgGate2Pass: number;
  /** 평균 체결 지연 (ms). 체결 성공 건만 집계. */
  avgFillLatencyMs: number | null;
}

export function summarizeMetaDecisions(yyyymm: string): MetaDecisionSummary {
  const entries = readMetaDecisionsForMonth(yyyymm);
  const total = entries.length;
  const selected = entries.filter((e) => e.finalSelection != null).length;
  const hashCounts = new Map<string, number>();
  let g0 = 0, g1 = 0, g2 = 0, g0n = 0, g1n = 0, g2n = 0;
  let fillSum = 0, fillN = 0;
  for (const e of entries) {
    hashCounts.set(e.decisionHash, (hashCounts.get(e.decisionHash) ?? 0) + 1);
    if (e.candidateCount > 0) {
      g0 += e.gatePassCounts.gate0 / e.candidateCount; g0n++;
    }
    if (e.gatePassCounts.gate0 > 0) {
      g1 += e.gatePassCounts.gate1 / e.gatePassCounts.gate0; g1n++;
    }
    if (e.gatePassCounts.gate1 > 0) {
      g2 += e.gatePassCounts.gate2 / e.gatePassCounts.gate1; g2n++;
    }
    if (e.fillLatencyMs != null) { fillSum += e.fillLatencyMs; fillN++; }
  }
  const topHashes = [...hashCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([hash, count]) => ({ hash, count }));
  return {
    yyyymm,
    totalDecisions: total,
    selectedCount: selected,
    selectionRatePct: total > 0 ? Number(((selected / total) * 100).toFixed(1)) : 0,
    topHashes,
    avgGate0Pass: g0n > 0 ? Number((g0 / g0n).toFixed(3)) : 0,
    avgGate1Pass: g1n > 0 ? Number((g1 / g1n).toFixed(3)) : 0,
    avgGate2Pass: g2n > 0 ? Number((g2 / g2n).toFixed(3)) : 0,
    avgFillLatencyMs: fillN > 0 ? Math.round(fillSum / fillN) : null,
  };
}
