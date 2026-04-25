/**
 * @responsibility 스캔 진단 — ScanSummary·연속 제로 카운트·scan traces 영속화
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 진단 단계. 기존 signalScanner.ts 의
 * 모듈 전역 상태를 본 파일 내부로 캡슐화한다.
 *
 * 외부 노출 API (barrel re-export 대상):
 *   - ScanSummary 타입
 *   - getLastBuySignalAt() / getLastScanSummary() / getConsecutiveZeroScans()
 *   - setLastBuySignalAt() / createScanCounters() / persistScanResults()
 */

import { sendTelegramAlert } from '../../alerts/telegramClient.js';
import { appendScanTraces, type ScanTrace } from '../scanTracer.js';

export interface ScanSummary {
  time: string;          // "HH:MM KST"
  candidates: number;    // SWING + CATALYST + Intraday 합산
  /** @deprecated trackB → swing + catalyst 합산. 하위 호환용. */
  trackB: number;        // buyList.length (main 워치리스트)
  swing: number;         // SWING 섹션 매수 대상 수
  catalyst: number;      // CATALYST 섹션 매수 대상 수
  momentum: number;      // MOMENTUM 섹션 관찰 전용 수
  yahooFails: number;    // Yahoo + KIS fallback 모두 실패한 종목 수
  gateMisses: number;    // entryRevalidation 탈락 수
  rrrMisses: number;     // RRR < 최솟값 탈락 수
  entries: number;       // 실제 진입(Shadow 포함 신호 등록) 수
}

let _lastBuySignalAt = 0;
let _consecutiveZeroScans = 0;
let _lastScanSummary: ScanSummary | null = null;

export function getLastBuySignalAt(): number    { return _lastBuySignalAt; }
export function getLastScanSummary(): ScanSummary | null { return _lastScanSummary; }
export function getConsecutiveZeroScans(): number { return _consecutiveZeroScans; }

export function setLastBuySignalAt(ts: number): void {
  _lastBuySignalAt = ts;
}

/**
 * 스캔 카운터 — perSymbolEvaluation 가 mutate. 스캔 1회당 1개 인스턴스 사용.
 * 글로벌 상태가 아니라 스캔별 객체로 분리해 동시 스캔/테스트 격리 가능.
 */
export interface ScanCounters {
  yahooFails: number;
  gateMisses: number;
  rrrMisses: number;
  entries: number;
  counterfactualRecordedToday: number;
  pendingTraces: ScanTrace[];
}

export function createScanCounters(): ScanCounters {
  return {
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    counterfactualRecordedToday: 0,
    pendingTraces: [],
  };
}

export interface PersistScanResultsOptions {
  sellOnly?: boolean;
  buyListLength: number;
  intradayBuyListLength: number;
  swingListLength: number;
  catalystListLength: number;
  momentumListLength: number;
}

/**
 * 스캔 종료 시 호출 — pendingTraces 영속화 + ScanSummary 갱신 + 3회 침묵 알림.
 * 원본 signalScanner.ts L1802-1843 동작과 100% 일치.
 */
export async function persistScanResults(
  counters: ScanCounters,
  options: PersistScanResultsOptions,
): Promise<void> {
  if (!options.sellOnly && counters.pendingTraces.length > 0) {
    appendScanTraces(counters.pendingTraces);
  }

  if (options.sellOnly) {
    return;
  }

  const kstNow = new Date(Date.now() + 9 * 3_600_000);
  const timeLabel = kstNow.toISOString().slice(11, 16) + ' KST';
  _lastScanSummary = {
    time:       timeLabel,
    candidates: options.buyListLength + options.intradayBuyListLength,
    trackB:     options.buyListLength,
    swing:      options.swingListLength,
    catalyst:   options.catalystListLength,
    momentum:   options.momentumListLength,
    yahooFails: counters.yahooFails,
    gateMisses: counters.gateMisses,
    rrrMisses:  counters.rrrMisses,
    entries:    counters.entries,
  };

  if (counters.entries === 0 && _lastScanSummary.candidates > 0) {
    _consecutiveZeroScans++;
  } else {
    _consecutiveZeroScans = 0;
  }

  if (_consecutiveZeroScans >= 3) {
    _consecutiveZeroScans = 0; // 알림 후 리셋 — 스팸 방지
    await sendTelegramAlert(
      `📊 <b>[스캔 요약]</b> ${timeLabel}\n` +
      `총 후보: ${_lastScanSummary.candidates}개 | SWING: ${_lastScanSummary.swing}개 | CATALYST: ${_lastScanSummary.catalyst}개 | MOMENTUM: ${_lastScanSummary.momentum}개\n` +
      `- Yahoo 실패: ${counters.yahooFails}개 → 진입 보류\n` +
      `- Gate 미달: ${counters.gateMisses}개\n` +
      `- RRR 미달: ${counters.rrrMisses}개\n` +
      `- 진입 성공: 0개\n` +
      `⚠️ 3회 연속 진입 없음 — 파이프라인 점검 필요`
    ).catch(console.error);
  }
}
