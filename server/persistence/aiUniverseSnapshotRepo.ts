/**
 * @responsibility AI 추천 universe Tier 2 폴백 영속 — Tier 1 GOOGLE_OK 만 갱신 (ADR-0016, PR-37)
 *
 * `discoverUniverse(mode)` 가 Tier 1 (GOOGLE_OK + candidates ≥ 3) 성공 시 본 모듈로
 * mode 별 별도 파일에 atomic write 한다. Tier 2~5 응답은 절대 갱신 거부 (오염 방지).
 * Tier 2 (FALLBACK_SNAPSHOT) 진입 시 본 모듈의 loadAiUniverseSnapshot(mode) 가 7일
 * 만료 가드 후 반환한다. 손상 JSON 은 null 처리 후 호출자가 Tier 3 으로 진행.
 */

import fs from 'fs';
import path from 'path';
import { aiUniverseSnapshotFile, ensureDataDir } from './paths.js';
import type {
  AiUniverseMode,
  AiUniverseSnapshot,
  AiUniverseSnapshotCandidate,
} from '../services/aiUniverseTypes.js';

/** 만료 임계 (KST 영업일 기준 7일). */
export const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 갱신 정책 가드 — 갱신 자격 (ADR-0016 §4). */
const MIN_CANDIDATES_TO_PERSIST = 3;

export interface SnapshotMeta {
  exists: boolean;
  generatedAt: number | null;
  tradingDate: string | null;
  ageDays: number | null;
  expired: boolean;
}

/**
 * 입력 데이터 검증 — atomic write 진입 전 호출. 무효한 snapshot 은 false.
 * - sourceStatus === 'GOOGLE_OK' (Tier 1 만)
 * - candidates 배열 + length >= 3
 * - mode 정상 + tradingDate 정상
 */
function isPersistable(snapshot: AiUniverseSnapshot): boolean {
  if (snapshot.sourceStatus !== 'GOOGLE_OK') return false;
  if (!Array.isArray(snapshot.candidates)) return false;
  if (snapshot.candidates.length < MIN_CANDIDATES_TO_PERSIST) return false;
  if (typeof snapshot.tradingDate !== 'string' || snapshot.tradingDate.length === 0) return false;
  if (typeof snapshot.generatedAt !== 'number' || snapshot.generatedAt <= 0) return false;
  return true;
}

/**
 * Tier 1 응답을 디스크에 atomic write. `tmp` 파일에 작성한 뒤 rename 으로
 * 원자적 교체 — 부분 쓰기/동시 갱신 race 시 이전 정상 본을 보존한다.
 *
 * 갱신 정책 (ADR-0016 §4):
 * - sourceStatus === 'GOOGLE_OK' + candidates ≥ 3 만 허용
 * - 그 외는 warn 로그 후 무시 (Tier 2~5 응답 오염 방지)
 */
export function saveAiUniverseSnapshot(
  mode: AiUniverseMode | string,
  snapshot: AiUniverseSnapshot,
): boolean {
  if (!isPersistable(snapshot)) {
    console.warn(
      `[AiUniverseSnapshot] 갱신 거부 — sourceStatus=${snapshot.sourceStatus} ` +
      `candidates=${snapshot.candidates?.length ?? 0} (Tier 1 GOOGLE_OK + ≥3 만 허용)`,
    );
    return false;
  }

  ensureDataDir();
  const target = aiUniverseSnapshotFile(String(mode));
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    console.warn(
      `[AiUniverseSnapshot] 저장 실패 mode=${mode}:`,
      e instanceof Error ? e.message : e,
    );
    // tmp 정리 — rename 전 실패 시 잔존 가능
    try { fs.unlinkSync(tmp); } catch { /* not present */ }
    return false;
  }
}

function readSnapshotFile(target: string): AiUniverseSnapshot | null {
  try {
    const raw = fs.readFileSync(target, 'utf-8');
    const parsed = JSON.parse(raw) as AiUniverseSnapshot;
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.generatedAt !== 'number') return null;
    if (typeof parsed.tradingDate !== 'string') return null;
    if (!Array.isArray(parsed.candidates)) return null;
    return parsed;
  } catch (e) {
    // JSON 손상 — 호출자가 Tier 3 진행
    console.warn(
      `[AiUniverseSnapshot] 손상된 JSON ${path.basename(target)}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * mode 별 디스크 스냅샷 로드. 7일 만료 또는 손상 시 null.
 * 만료 판정도 본 함수가 SSOT — 호출자는 null 만 보고 Tier 3 으로 진행하면 된다.
 */
export function loadAiUniverseSnapshot(
  mode: AiUniverseMode | string,
  now: number = Date.now(),
): AiUniverseSnapshot | null {
  ensureDataDir();
  const target = aiUniverseSnapshotFile(String(mode));
  if (!fs.existsSync(target)) return null;
  const parsed = readSnapshotFile(target);
  if (!parsed) return null;
  if (now - parsed.generatedAt > SNAPSHOT_TTL_MS) {
    return null;
  }
  return parsed;
}

/** 운영자 진단용 — `/api/health/ai-universe` 응답에서 사용. */
export function getSnapshotMeta(
  mode: AiUniverseMode | string,
  now: number = Date.now(),
): SnapshotMeta {
  ensureDataDir();
  const target = aiUniverseSnapshotFile(String(mode));
  if (!fs.existsSync(target)) {
    return { exists: false, generatedAt: null, tradingDate: null, ageDays: null, expired: false };
  }
  const parsed = readSnapshotFile(target);
  if (!parsed) {
    // 파일은 있지만 손상 — exists=true, 만료/유효는 의미 없음
    return { exists: true, generatedAt: null, tradingDate: null, ageDays: null, expired: false };
  }
  const ageMs = Math.max(0, now - parsed.generatedAt);
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const expired = ageMs > SNAPSHOT_TTL_MS;
  return {
    exists: true,
    generatedAt: parsed.generatedAt,
    tradingDate: parsed.tradingDate,
    ageDays,
    expired,
  };
}

/**
 * 테스트·진단 헬퍼 — snapshot candidate 배열을 외부에서 가져올 수 있도록.
 * Tier 2 entry 변환 (snapshot.candidates → AiUniverseCandidate) 은 호출자 책임.
 */
export function getSnapshotCandidates(
  mode: AiUniverseMode | string,
  now: number = Date.now(),
): AiUniverseSnapshotCandidate[] {
  const snap = loadAiUniverseSnapshot(mode, now);
  return snap ? snap.candidates : [];
}

// 테스트 전용 — 파일 강제 삭제
export const __testOnly = {
  removeSnapshotFile(mode: AiUniverseMode | string): void {
    try { fs.unlinkSync(aiUniverseSnapshotFile(String(mode))); } catch { /* not present */ }
  },
  SNAPSHOT_TTL_MS,
  MIN_CANDIDATES_TO_PERSIST,
};
