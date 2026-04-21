/**
 * @responsibility 수동 청산 빈도를 0~1 축으로 정규화해 심리 온도계용 등급을 산출한다.
 *
 * biasHeatmap.ts — P2 #16: 심리 온도계 (수동 빈도 축).
 *
 * 기존 reflectionModules/biasHeatmap.ts 는 10개 편향의 "상태 증거 기반" 스코어를 산출한다.
 * 여기서는 그 위에 얹히는 **행동 축 (Manual Frequency Axis)** 을 다룬다.
 *
 * 직관:
 *   - 편향 스코어가 높아도 "수동 개입이 없다" 면 자기통제 정상.
 *   - 반대로 편향 스코어가 낮아도 "수동 개입이 반복" 되면 자동 신호를 불신한다는 징후.
 *   - 따라서 두 축은 독립적으로 추적되어야 한다.
 *
 * 산출:
 *   - manualFrequencyAxis(today, 7d, 30d) → 0~1 정규화 점수 + 등급 + 경보 플래그.
 *   - 3회/5회/7회 임계값은 manualOverrideMonitor.ts 와 동일 상수를 공유.
 *
 * 결정적 함수. Gemini 호출 0.
 */

import type { ManualExitRecord } from '../persistence/manualExitsRepo.js';

/** 3회 이상이면 관찰, 5회 주의, 7회 경보 (고정 상수 — manualOverrideMonitor 와 동일). */
export const MANUAL_FREQ_WATCH   = 3;
export const MANUAL_FREQ_CAUTION = 5;
export const MANUAL_FREQ_ALARM   = 7;

export type ManualFrequencyGrade = 'CALM' | 'WATCH' | 'CAUTION' | 'ALARM';

export interface ManualFrequencyAxisScore {
  /** 0~1 정규화 — 7일 카운트를 경보 임계값(7)으로 나눈 값. */
  score:   number;
  grade:   ManualFrequencyGrade;
  /** 오늘 수동 청산 건수 */
  todayCount:  number;
  /** 최근 7일 롤링 카운트 */
  rolling7d:   number;
  /** 최근 30일 롤링 카운트 */
  rolling30d:  number;
  /** 사람이 읽는 한 줄 근거 */
  evidence: string;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function gradeFor(rolling7d: number, todayCount: number): ManualFrequencyGrade {
  if (rolling7d >= MANUAL_FREQ_ALARM || todayCount >= MANUAL_FREQ_ALARM) return 'ALARM';
  if (rolling7d >= MANUAL_FREQ_CAUTION) return 'CAUTION';
  if (rolling7d >= MANUAL_FREQ_WATCH) return 'WATCH';
  return 'CALM';
}

/**
 * 수동 빈도 축 스코어를 계산한다.
 *
 * @param today      오늘(KST) 수동 청산 레코드
 * @param rolling7d  최근 7 일 수동 청산 레코드
 * @param rolling30d 최근 30 일 수동 청산 레코드
 */
export function computeManualFrequencyAxis(
  today: ManualExitRecord[],
  rolling7d: ManualExitRecord[],
  rolling30d: ManualExitRecord[],
): ManualFrequencyAxisScore {
  const todayCount = today.length;
  const r7 = rolling7d.length;
  const r30 = rolling30d.length;
  const score = Number(clamp01(r7 / MANUAL_FREQ_ALARM).toFixed(2));
  const grade = gradeFor(r7, todayCount);
  const evidence = `오늘 ${todayCount}회 / 7일 ${r7}회 / 30일 ${r30}회 — ${grade}`;
  return { score, grade, todayCount, rolling7d: r7, rolling30d: r30, evidence };
}

/** 3 일 연속 grade ≥ WATCH 인지 판정 — followUpActions 자동 제안 근거. */
export function isChronicManualFrequency(
  recent3: ManualFrequencyAxisScore[],
): boolean {
  if (recent3.length < 3) return false;
  return recent3.every((s) => s.grade !== 'CALM');
}
