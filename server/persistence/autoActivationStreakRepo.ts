// @responsibility ADR-0634 LIVE-safe lever 의 일별 READY 연속일수(streak) 영속 SSOT — 멱등 일별 갱신·atomic write·휘발 시 빈 상태 self-heal(보수적 리셋). 주문/provider 호출 0.
/**
 * autoActivationStreakRepo.ts — ADR-0634 자가 활성 anti-flap streak 영속 (SKELETON).
 *
 * 목적 (ADR-0634 §영속 streak):
 *   ADR-0633 evaluator 의 `minConsecutiveReadyDays` (anti-flap hysteresis) 입력을
 *   재배포·재시작 후에도 보존하기 위한 lever 별 일별 READY 연속일수 영속.
 *   evaluator 는 순수(now·증거를 입력으로 받음)라 streak 추적을 직접 못 한다 — 본 repo 가
 *   일별 cron 호출자(learningJobs self_validation_auto_activation)와 evaluator 사이의
 *   상태 다리(state bridge) 역할만 한다.
 *
 * 안전 invariant (ADR-0625 shakeoutStopOutcomeRepo / ADR-0427 provisionalShadowLedger 동형):
 *   - atomic write (tmp → rename) — race 안전, 손상 부분쓰기 차단.
 *   - load 시 손상/부재 JSON → 빈 상태 `{}` self-heal (시스템 무중단, 불변식 #1).
 *     data/ 휘발(Railway Volume 미마운트) 시 streak=0 으로 시작 → 자가 활성이 늦춰질
 *     뿐(보수적·안전 측). streak 손실이 LIVE 영향을 주지 않는다(LIVE_SAFE lever 전용).
 *   - recordLeverReadiness 는 **dateKey 멱등** — 같은 dateKey 재실행 시 streak 증가 0
 *     (cron 재실행·startup 중복 호출 안전). 오늘 첫 평가만 streak 갱신.
 *   - KIS/주문/provider 함수 import 0건 — 메타 자기관리 전용 (정적 grep 가드).
 *
 * 파일 경로 (engine-dev): `server/persistence/paths.ts` 에 신규 상수 추가 후 import.
 *   권장 상수명: `AUTO_ACTIVATION_STREAK_FILE = path.join(DATA_DIR, 'auto-activation-streak-adr0634.json')`
 *   (다른 ledger 와 *물리 분리* — ADR-0445 분리 원칙. shadow-trades.json·counterfactual-* 등과 합치지 않는다.)
 *   atomic write 패턴은 shakeoutStopOutcomeRepo.ts writeLedger (tmp→rename) 그대로 차용.
 *
 * dateKey 규약 (engine-dev): KST 거래일 `YYYY-MM-DD` 문자열 (cron 호출자가 생성·주입).
 *   같은 dateKey == "오늘 이미 평가함" 판정 기준. timezone 계산은 호출자 책임(repo 는 순수 문자열 비교).
 */

import fs from 'fs';
import { AUTO_ACTIVATION_STREAK_FILE, ensureDataDir } from './paths.js';
import type {
  AutoActivationLeverStreak,
  AutoActivationStreakStore,
} from '../../src/types/autoActivationStreak.js';

/** leverId → streak 상태인 형 검증 (손상 JSON self-heal 가드). */
function isStreakStore(value: unknown): value is AutoActivationStreakStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as AutoActivationLeverStreak).streak !== 'number' ||
      typeof (entry as AutoActivationLeverStreak).lastDateKey !== 'string'
    ) {
      return false;
    }
  }
  return true;
}

/** 전체 store read — 파일 부재/파싱 실패/형 불일치 시 빈 `{}` self-heal (throw 0). */
function readStore(filePath = AUTO_ACTIVATION_STREAK_FILE): AutoActivationStreakStore {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (isStreakStore(parsed)) return parsed;
    console.warn(
      '[AutoActivationStreak] 형 불일치 streak store — 빈 상태 self-heal (보수적 리셋, LIVE_SAFE 전용).',
    );
    return {};
  } catch (e) {
    // 손상 JSON → 빈 상태 self-heal (시스템 무중단, 불변식 #1). streak 손실은 LIVE 무영향.
    console.warn(
      `[AutoActivationStreak] streak store 파싱 실패 — 빈 상태 self-heal: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return {};
  }
}

/** atomic write (tmp → rename) — race 안전, 손상 부분쓰기 차단. */
function writeStore(
  store: AutoActivationStreakStore,
  filePath = AUTO_ACTIVATION_STREAK_FILE,
): void {
  ensureDataDir();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, filePath);
}

/**
 * 전체 streak store read — 손상/부재 시 빈 `{}` self-heal.
 */
export function loadAutoActivationStreaks(
  filePath = AUTO_ACTIVATION_STREAK_FILE,
): AutoActivationStreakStore {
  return readStore(filePath);
}

/** recordLeverReadiness 결과 — 멱등 갱신 후의 현재 streak + 이번 호출이 실제 갱신했는지. */
export interface RecordLeverReadinessResult {
  leverId: string;
  /** 멱등 갱신 후의 현재 연속 READY 일수. */
  streak: number;
  /** 이번 dateKey 가 처음 기록됐는가 (true=갱신 수행 / false=같은 dateKey 멱등 skip). */
  updatedToday: boolean;
  /** 갱신 후 lastDateKey. */
  lastDateKey: string;
}

/**
 * lever 의 "오늘 READY 여부" 로 일별 streak 멱등 갱신 후 결과 반환.
 *
 * 멱등 규약 (ADR-0634):
 *   - 기존 lastDateKey === dateKey → 이미 오늘 기록됨 → 증가 0, 기존 streak 반환 (updatedToday=false).
 *   - 오늘 첫 기록 + readyToday=true → streak += 1.
 *   - 오늘 첫 기록 + readyToday=false → streak = 0 (anti-flap 리셋).
 *   - 갱신 시 lastDateKey = dateKey, atomic write.
 *
 * `readyToday` 는 evaluator 와 **동일 criteria** (streak 제외 기준: matureOk·reviewOk·perfOk)
 *   로 판정해야 한다 — engine-dev 는 `selfValidationAutoActivationAdr0633.ts` 의
 *   `evaluateLeverReadiness(...).readyExclStreak` (ADR-0634 helper 추출 계약)를 사용한다.
 *   두 번째 판정 공식 발명 금지.
 */
export function recordLeverReadiness(
  leverId: string,
  readyToday: boolean,
  dateKey: string,
  filePath = AUTO_ACTIVATION_STREAK_FILE,
): RecordLeverReadinessResult {
  const store = readStore(filePath);
  const cur = store[leverId];
  // 멱등 — 오늘(같은 dateKey) 이미 기록됨 → 증가 0, 기존 streak 반환.
  if (cur && cur.lastDateKey === dateKey) {
    return { leverId, streak: cur.streak, updatedToday: false, lastDateKey: cur.lastDateKey };
  }
  const nextStreak = readyToday ? (cur?.streak ?? 0) + 1 : 0;
  store[leverId] = { streak: nextStreak, lastDateKey: dateKey };
  writeStore(store, filePath);
  return { leverId, streak: nextStreak, updatedToday: true, lastDateKey: dateKey };
}

/**
 * lever 의 현재 연속 READY 일수 read (없으면 0 — self-heal 보수값).
 * evaluator 입력 `consecutiveReadyDaysByLever[leverId]` 구성에 사용.
 */
export function getConsecutiveReadyDays(
  leverId: string,
  filePath = AUTO_ACTIVATION_STREAK_FILE,
): number {
  return readStore(filePath)[leverId]?.streak ?? 0;
}

/** 테스트 전용 — streak 파일 삭제 (self-heal 빈 상태 검증). */
export function __resetAutoActivationStreaksForTests(
  filePath = AUTO_ACTIVATION_STREAK_FILE,
): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
