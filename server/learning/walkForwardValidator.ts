// @responsibility walkForwardValidator 학습 엔진 모듈
/**
 * walkForwardValidator.ts — 아이디어 4: 워크포워드 자동 검증 루프
 *
 * 매월 말 자동으로 Out-of-Sample 검증을 수행하여 과최적화(Overfitting)를 조기 감지.
 *
 * IS (In-Sample)  : 3개월 전 ~ 2개월 전 데이터 (가중치가 최적화된 구간)
 * OOS (Out-of-Sample): 최근 30일 실전 성과 (미래 데이터)
 *
 * 판단 기준:
 *   - 성과 저하(IS - OOS 승률) > 15%p → 과최적화 경보
 *     → 가중치 기본값 리셋 + 동결 상태 파일 저장 (다음 달 캘리브레이션 차단)
 *   - 검증 통과 → 기존 동결 상태 해제
 *
 * 연동: calibrateSignalWeights()가 호출 시 WALK_FORWARD_STATE_FILE 존재 여부를
 *       확인하여 동결 중이면 가중치 조정을 건너뜀.
 */

import fs from 'fs';
import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import { loadConditionWeights, saveConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { DEFAULT_CONDITION_WEIGHTS } from '../quantFilter.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import {
  WALK_FORWARD_STATE_FILE,
  ensureDataDir,
} from '../persistence/paths.js';
import { computeMedianWeights } from '../persistence/weightHistoryRepo.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface WalkForwardState {
  frozenAt: string;   // ISO 타임스탬프
  reason: string;     // 사람이 읽을 수 있는 요약
  isWinRate: number;  // IS 승률 (0~1)
  oosWinRate: number; // OOS 승률 (0~1)
  degradation: number; // isWinRate - oosWinRate
}

// ── 상태 I/O ──────────────────────────────────────────────────────────────────

export function loadWalkForwardState(): WalkForwardState | null {
  ensureDataDir();
  if (!fs.existsSync(WALK_FORWARD_STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(WALK_FORWARD_STATE_FILE, 'utf-8')) as WalkForwardState;
  } catch {
    return null;
  }
}

function saveWalkForwardState(state: WalkForwardState): void {
  ensureDataDir();
  fs.writeFileSync(WALK_FORWARD_STATE_FILE, JSON.stringify(state, null, 2));
}

function clearWalkForwardState(): void {
  ensureDataDir();
  if (fs.existsSync(WALK_FORWARD_STATE_FILE)) fs.unlinkSync(WALK_FORWARD_STATE_FILE);
}

// ── 핵심 로직 ─────────────────────────────────────────────────────────────────

/**
 * signalTime이 [now - startDaysAgo, now - endDaysAgo] 구간 내인지 판별.
 * isInPeriod(t, 90, 60) → "90일 전 ~ 60일 전"
 */
function isInPeriod(signalTime: string, startDaysAgo: number, endDaysAgo: number): boolean {
  const t     = new Date(signalTime).getTime();
  const now   = Date.now();
  const start = now - startDaysAgo * 86_400_000; // 더 오래된 경계
  const end   = now - endDaysAgo   * 86_400_000; // 더 최근 경계
  return t >= start && t <= end;
}

function calcWinRate(recs: RecommendationRecord[]): number {
  const resolved = recs.filter((r) => r.status !== 'PENDING');
  if (resolved.length === 0) return 0;
  return resolved.filter((r) => r.status === 'WIN').length / resolved.length;
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 워크포워드 검증을 실행한다.
 * @returns `{ frozen: true }` — 과최적화 감지 (이후 캘리브레이션 건너뛸 것)
 *          `{ frozen: false }` — 정상 통과
 */
export async function runWalkForwardValidation(): Promise<{ frozen: boolean }> {
  const allRecs = getRecommendations();

  // IS: 3개월 전 ~ 2개월 전 (가중치 최적화 구간)
  const inSample  = allRecs.filter((r) => isInPeriod(r.signalTime, 90, 60));
  // OOS: 최근 30일 (실전 미래 구간)
  const outSample = allRecs.filter((r) => isInPeriod(r.signalTime, 30, 0));

  const isWinRate  = calcWinRate(inSample);
  const oosWinRate = calcWinRate(outSample);
  const degradation = isWinRate - oosWinRate;

  console.log(
    `[WalkForward] IS(3→2개월전): ${inSample.length}건 WR ${(isWinRate * 100).toFixed(1)}%` +
    ` | OOS(최근30일): ${outSample.length}건 WR ${(oosWinRate * 100).toFixed(1)}%` +
    ` | 저하: ${(degradation * 100).toFixed(1)}%p`,
  );

  const MIN_SAMPLE  = 5;
  const THRESHOLD   = 0.15; // 15%p 저하 → 과최적화

  if (inSample.length < MIN_SAMPLE || outSample.length < MIN_SAMPLE) {
    console.log(
      `[WalkForward] 샘플 부족 (IS: ${inSample.length}, OOS: ${outSample.length}) — 건너뜀`,
    );
    return { frozen: false };
  }

  if (degradation > THRESHOLD) {
    // ── 과최적화 감지 ──────────────────────────────────────────────────────────
    // 아이디어 8 (Phase 4): DEFAULT 리셋 대신 최근 3개월 스냅샷 중앙값을 앙상블로.
    // 스냅샷이 3개 미만이면 DEFAULT 로 안전 폴백.
    const ensemble = computeMedianWeights(3);
    let weightSource = 'DEFAULT(1.0)';
    if (ensemble) {
      saveConditionWeights(ensemble);
      weightSource = '최근 3개월 median 앙상블';
    } else {
      saveConditionWeights({ ...DEFAULT_CONDITION_WEIGHTS });
    }

    const state: WalkForwardState = {
      frozenAt: new Date().toISOString(),
      reason:
        `IS ${(isWinRate * 100).toFixed(1)}% → OOS ${(oosWinRate * 100).toFixed(1)}%` +
        ` (저하 ${(degradation * 100).toFixed(1)}%p > 15%p 임계값)`,
      isWinRate,
      oosWinRate,
      degradation,
    };
    saveWalkForwardState(state);

    await sendTelegramAlert(
      `⚠️ <b>[워크포워드 경보] 과최적화 감지</b>\n\n` +
      `IS 승률 (3→2개월전): <b>${(isWinRate * 100).toFixed(1)}%</b> (${inSample.length}건)\n` +
      `OOS 승률 (최근30일): <b>${(oosWinRate * 100).toFixed(1)}%</b> (${outSample.length}건)\n` +
      `성과 저하: <b>${(degradation * 100).toFixed(1)}%p</b>\n\n` +
      `🔄 가중치 복원: <b>${weightSource}</b>\n` +
      `🔒 다음 달 캘리브레이션까지 조정 동결`,
    ).catch(console.error);

    console.log(`[WalkForward] ⚠️ 과최적화 감지 — 가중치 ${weightSource} 복원, 동결 상태 저장`);
    return { frozen: true };
  }

  // ── 정상: 동결 상태였다면 해제 ────────────────────────────────────────────────
  const prevState = loadWalkForwardState();
  if (prevState) {
    clearWalkForwardState();
    console.log('[WalkForward] ✅ OOS 성과 양호 — 동결 해제');
    await sendTelegramAlert(
      `✅ <b>[워크포워드] 동결 해제</b>\n` +
      `IS: ${(isWinRate * 100).toFixed(1)}% | OOS: ${(oosWinRate * 100).toFixed(1)}%` +
      ` | 저하: ${(degradation * 100).toFixed(1)}%p`,
    ).catch(console.error);
  } else {
    await sendTelegramAlert(
      `✅ <b>[워크포워드 검증 통과]</b>\n` +
      `IS: ${(isWinRate * 100).toFixed(1)}% | OOS: ${(oosWinRate * 100).toFixed(1)}%` +
      ` | 저하: ${(degradation * 100).toFixed(1)}%p`,
    ).catch(console.error);
  }

  return { frozen: false };
}
