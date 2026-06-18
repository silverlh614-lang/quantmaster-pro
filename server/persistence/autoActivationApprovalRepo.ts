// @responsibility ADR-0636 LIVE_ADJACENT_REVIEW lever 운영자 승인 활성화 영속 SSOT — atomic write·self-heal·승인 0건(기본) byte-identical. 주문/provider 호출 0.
/**
 * autoActivationApprovalRepo.ts — ADR-0636 운영자 승인 활성화 영속.
 *
 * 목적 (ADR-0636 §1 영속 승인 ledger):
 *   ADR-0635 가 등재한 LIVE_ADJACENT_REVIEW(T2) lever 4종
 *   (R6_TRIGGER_TRADEDATE_FRESHNESS·R6_RECOVERY_STUCK_EXIT·
 *    GATE1_RS_PERCENTILE_CONTINUOUS·INTRADAY_SCREENER_REFRESH)은 LIVE-인접 동작을
 *   바꿔 자가 활성(ADR-0633 evaluator)이 금지된 "운영자 1-체크포인트" 영역이다.
 *   운영자가 1-클릭(/approve_activation) 으로 명시 승인한 lever 를 재배포·재시작 후에도
 *   보존하기 위한 lever 별 승인 상태 영속. 부팅 시 reapplyOperatorApprovals 가 본 ledger
 *   를 process.env 에 재적용한다(ADR-0636 §4).
 *
 * 안전 invariant (ADR-0634 autoActivationStreakRepo / ADR-0625 shakeoutStopOutcomeRepo 동형):
 *   - atomic write (tmp → rename) — race 안전, 손상 부분쓰기 차단.
 *   - load 시 손상/부재 JSON → 빈 상태 `{}` self-heal (시스템 무중단, 불변식 #1).
 *     data/ 휘발(Railway Volume 미마운트) 시 빈 상태 = 부팅 재적용 no-op = byte-identical
 *     (default LIVE 동작 무변경). 승인 손실은 운영자가 /approve_activation 재승인으로 복구
 *     (보수적·안전 측 — 미승인 = LIVE 동작 무변경).
 *   - KIS/주문/provider 함수 import 0건 — 메타 자기관리 전용 (정적 grep 가드).
 *
 * 책임 경계 (ADR-0636 §2 순수성):
 *   - 본 repo 는 *영속만* 담당한다. eligibility 검증(LIVE_ADJACENT_REVIEW 만 허용)·
 *     process.env set/delete 는 엔진(selfValidationAutoActivationAdr0633.applyOperatorApproval/
 *     revokeOperatorApproval)이 담당한다. repo 는 leverId 를 신뢰하고 저장만 한다.
 *   - 호출 순서(telegram cmd): 엔진 검증 통과(verdict APPROVED) → 본 repo recordApproval.
 *     검증 실패(REJECTED_NOT_REVIEWABLE/NOT_FOUND) 시 cmd 는 repo 를 호출하지 않는다.
 *
 * 파일 경로: server/persistence/paths.ts `AUTO_ACTIVATION_APPROVAL_FILE`
 *   (`data/auto-activation-approval-adr0636.json` — 다른 ledger 와 *물리 분리*).
 */

import fs from 'fs';
import { AUTO_ACTIVATION_APPROVAL_FILE, ensureDataDir } from './paths.js';
import type {
  AutoActivationApprovalEntry,
  AutoActivationApprovalStore,
} from '../../src/types/autoActivationApproval.js';

/** leverId → 승인 entry 인 형 검증 (손상 JSON self-heal 가드). */
function isApprovalStore(value: unknown): value is AutoActivationApprovalStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as AutoActivationApprovalEntry).approvedAt !== 'string' ||
      typeof (entry as AutoActivationApprovalEntry).approvedBy !== 'string'
    ) {
      return false;
    }
  }
  return true;
}

/** 전체 store read — 파일 부재/파싱 실패/형 불일치 시 빈 `{}` self-heal (throw 0). */
function readStore(filePath = AUTO_ACTIVATION_APPROVAL_FILE): AutoActivationApprovalStore {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (isApprovalStore(parsed)) return parsed;
    console.warn(
      '[AutoActivationApproval] 형 불일치 approval store — 빈 상태 self-heal (보수적·미승인 = LIVE 동작 무변경).',
    );
    return {};
  } catch (e) {
    // 손상 JSON → 빈 상태 self-heal (시스템 무중단, 불변식 #1). 승인 손실은 LIVE 무영향(미승인 default).
    console.warn(
      `[AutoActivationApproval] approval store 파싱 실패 — 빈 상태 self-heal: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return {};
  }
}

/** atomic write (tmp → rename) — race 안전, 손상 부분쓰기 차단. */
function writeStore(
  store: AutoActivationApprovalStore,
  filePath = AUTO_ACTIVATION_APPROVAL_FILE,
): void {
  ensureDataDir();
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, filePath);
}

/** 전체 승인 store read — 손상/부재 시 빈 `{}` self-heal. */
export function loadApprovals(
  filePath: string = AUTO_ACTIVATION_APPROVAL_FILE,
): AutoActivationApprovalStore {
  return readStore(filePath);
}

/**
 * lever 승인 기록 (멱등 upsert) — approvedAt=now ISO, approvedBy 저장 후 atomic write.
 * 호출자(telegram cmd)는 엔진 검증(verdict APPROVED) 통과 후에만 호출한다.
 * eligibility 검증은 하지 않는다 — 엔진 책임. repo 는 leverId 를 신뢰하고 저장만 한다.
 */
export function recordApproval(
  leverId: string,
  approvedBy: string,
  filePath: string = AUTO_ACTIVATION_APPROVAL_FILE,
): AutoActivationApprovalEntry {
  const store = readStore(filePath);
  const entry: AutoActivationApprovalEntry = {
    approvedAt: new Date().toISOString(),
    approvedBy,
  };
  store[leverId] = entry;
  writeStore(store, filePath);
  return entry;
}

/**
 * lever 승인 철회 — store 에서 leverId 제거 후 atomic write.
 * @returns true = 실제로 제거됨(승인 존재했음) / false = 애초에 미승인(no-op).
 */
export function revokeApproval(
  leverId: string,
  filePath: string = AUTO_ACTIVATION_APPROVAL_FILE,
): boolean {
  const store = readStore(filePath);
  if (!(leverId in store)) return false;
  delete store[leverId];
  writeStore(store, filePath);
  return true;
}

/** lever 가 현재 승인 상태인가 (store[leverId] 존재 여부). */
export function isApproved(
  leverId: string,
  filePath: string = AUTO_ACTIVATION_APPROVAL_FILE,
): boolean {
  return !!readStore(filePath)[leverId];
}

/**
 * lever 1건의 승인 entry read (없으면 undefined) — /review_activations 표시용(approvedBy/At).
 */
export function getApproval(
  leverId: string,
  filePath: string = AUTO_ACTIVATION_APPROVAL_FILE,
): AutoActivationApprovalEntry | undefined {
  return readStore(filePath)[leverId];
}

/**
 * 현재 승인된 leverId 목록 (Object.keys(store)).
 * 부팅 재적용 `reapplyOperatorApprovals(listApprovedLeverIds())` 입력.
 */
export function listApprovedLeverIds(
  filePath: string = AUTO_ACTIVATION_APPROVAL_FILE,
): string[] {
  return Object.keys(readStore(filePath));
}

/** 테스트 전용 — 승인 파일 삭제 (self-heal 빈 상태 검증). */
export function __resetAutoActivationApprovalsForTests(
  filePath: string = AUTO_ACTIVATION_APPROVAL_FILE,
): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
