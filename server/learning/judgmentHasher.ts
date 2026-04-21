/**
 * @responsibility Gate·가중치·실패패턴 DB 스냅샷을 해싱하여 한 건의 판단이 어떤 상태에서 나왔는지 식별한다.
 *
 * 목적:
 *   "오늘 진입한 판단이 내일 재현 가능한가?" — 가중치·임계값·실패DB가 재배포로 바뀌면
 *   같은 입력이라도 다른 출력이 나오는데, 그때 과거 판단의 무결성을 추적하려면
 *   **결정에 기여한 상태의 지문(fingerprint)** 이 필요하다.
 *
 * 해시 구성 요소 (현재 버전):
 *   1. GATE_SCORE_THRESHOLD_BY_REGIME — 레짐별 Gate 임계값
 *   2. loadConditionWeights() — 27조건 전역 가중치
 *   3. failure-patterns.json 엔트리 수(count) — 실패DB 규모 (개별 벡터는 해싱 비용↑)
 *   4. schemaVersion — 이 해셔의 버전 (구조 변경 시 증가)
 *
 * 의도적 제외:
 *   - 레짐별 가중치 파일(condition-weights-Rx.json) — 현재 레짐 하나만 로드하면 되어
 *     호출측이 regime 을 전달해 hashJudgmentFingerprint({regime}) 로 서명할 수 있다.
 *   - 실패 패턴 원본 벡터 — 변경 빈도 대비 해싱 비용 과다.
 *
 * 사용:
 *   const fp = computeJudgmentFingerprint();
 *   console.log(fp.hash);       // 'fp1:ab3e...'
 *   console.log(fp.components); // 소스별 부분 해시(디버깅용)
 *
 *   // 매수 직전 기록
 *   await persistDecision({ tradeId, fingerprint: fp.hash });
 */

import crypto from 'crypto';
import fs from 'fs';
import { GATE_SCORE_THRESHOLD_BY_REGIME } from '../trading/gateConfig.js';
import { loadConditionWeights, loadConditionWeightsByRegime } from '../persistence/conditionWeightsRepo.js';
import { FAILURE_PATTERN_FILE } from '../persistence/paths.js';

/** 해시 스키마 버전. 해시 입력 구조를 바꿀 때마다 증가시킨다. */
export const JUDGMENT_HASHER_SCHEMA_VERSION = 1;

export interface JudgmentFingerprint {
  /** 완전 해시 문자열 — 'fp<schemaVersion>:<sha256 12hex>' */
  hash: string;
  /** 해시 스키마 버전 */
  schemaVersion: number;
  /** 각 구성 요소의 부분 해시 (드리프트 디버깅용) */
  components: {
    gateThresholds: string;
    conditionWeights: string;
    failurePatternCount: number;
    regime: string | null;
  };
  /** 지문 생성 시각 (ISO) */
  computedAt: string;
}

export interface ComputeFingerprintOptions {
  /** 레짐별 가중치를 포함해 해싱할 레짐 코드 (미전달 시 전역 가중치만 사용) */
  regime?: string;
  /** 테스트 주입용 현재 시각 */
  now?: Date;
}

// ── 부분 해시 계산 ────────────────────────────────────────────────────────────

/** 임의 객체를 키 정렬 JSON 으로 안정적 직렬화. */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

function sha256Hex(s: string, len = 12): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, len);
}

function hashGateThresholds(): string {
  return sha256Hex(stableStringify(GATE_SCORE_THRESHOLD_BY_REGIME));
}

function hashConditionWeights(regime?: string): string {
  const global = loadConditionWeights();
  if (!regime) return sha256Hex(stableStringify({ global }));
  const regional = loadConditionWeightsByRegime(regime);
  return sha256Hex(stableStringify({ global, [regime]: regional }));
}

function readFailurePatternCount(): number {
  try {
    if (!fs.existsSync(FAILURE_PATTERN_FILE)) return 0;
    const raw = JSON.parse(fs.readFileSync(FAILURE_PATTERN_FILE, 'utf-8')) as unknown;
    return Array.isArray(raw) ? raw.length : 0;
  } catch {
    return 0;
  }
}

// ── 공개 API ────────────────────────────────────────────────────────────────

/**
 * 현재 환경의 판단 지문을 계산한다.
 * 호출마다 파일을 다시 읽으므로, 한 스캔 싸이클 내 여러 번 호출하면 결과가 동일해야 한다.
 */
export function computeJudgmentFingerprint(
  opts: ComputeFingerprintOptions = {},
): JudgmentFingerprint {
  const components = {
    gateThresholds: hashGateThresholds(),
    conditionWeights: hashConditionWeights(opts.regime),
    failurePatternCount: readFailurePatternCount(),
    regime: opts.regime ?? null,
  };
  const combined = stableStringify({ v: JUDGMENT_HASHER_SCHEMA_VERSION, ...components });
  const digest = sha256Hex(combined, 12);
  return {
    hash: `fp${JUDGMENT_HASHER_SCHEMA_VERSION}:${digest}`,
    schemaVersion: JUDGMENT_HASHER_SCHEMA_VERSION,
    components,
    computedAt: (opts.now ?? new Date()).toISOString(),
  };
}

/**
 * 두 지문이 같은 상태에서 생성됐는지 비교.
 * 스키마 버전이 다르면 무조건 false (비교 불가).
 */
export function areFingerprintsEqual(a: string, b: string): boolean {
  return a === b && a.startsWith(`fp${JUDGMENT_HASHER_SCHEMA_VERSION}:`);
}

/** 테스트용 내부 유틸 export. */
export const __test = {
  stableStringify,
  sha256Hex,
  hashGateThresholds,
  hashConditionWeights,
  readFailurePatternCount,
};
