// @responsibility /snapshot_status 텔레그램 명령 — runtime debug snapshot capture 인프라 read-only 진단.
/**
 * Patch-SNAPSHOT-STATUS-CMD-001 — `/snapshot_status` read-only 명령.
 *
 * 사용자 명시 framing (Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-003 후속 / Patch-001/002/003 lifecycle 정합):
 *   "snapshot 인프라 자체 (ENV / cron / 파일 존재 / 파일 age / 다음 capture 시각) 진단.
 *    `/snapshot_latest` 가 snapshot 내용을 보여준다면, 본 명령은 capture 인프라 자체를 진단."
 *
 * 본 명령의 책임:
 *   - `isRuntimeDebugSnapshotCaptureDisabled()` ENV gate 상태 표시
 *   - `LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE` 영속 파일 존재 + mtime + size 표시
 *   - `loadLatestRuntimeDebugSnapshot()` schema 유효성 확인 (정상 load 여부)
 *   - 다음 18:00 KST capture 예정 시각 산출 + age 노출
 *   - capture 결손 4 분기 원인 안내 (ENV / 부팅 직후 / 휴장일 / cron 실패)
 *
 * 절대 invariants:
 *   - read-only (영속 read + 메모리 read-only, KIS/KRX/Yahoo/Naver outbound 0건)
 *   - LIVE 매매 본체 import 0건 (signalScanner / entryEngine / exitEngine / kisClient orders 등)
 *   - autoTradeEngine / orderExecutor / trancheExecutor import 0건
 *   - external fetch / axios / node-fetch import 0건 (영속 fs.statSync 만 사용)
 *   - `replayOnly=true` + `executionImpact=NONE` 항상 노출 (운영자 인지 의무)
 *   - `formatSnapshotStatusMessage` 는 순수 함수 (단위 테스트 가능, nowMs 옵셔널 주입)
 *   - ADR-0157 ENV 정확 비교 의무 (`isRuntimeDebugSnapshotCaptureDisabled` SSOT 위임)
 *
 * 출력 형식 (compact, ≤2000 chars):
 *   📊 [Snapshot Status] runtime debug capture 인프라 진단
 *   • ENV: RUNTIME_DEBUG_SNAPSHOT_DISABLED = false (default, 활성)
 *   • Cron: 18:00 KST 평일 (TRADING_DAY_ONLY)
 *   • 파일 경로: data/replay/latest-runtime-debug-snapshot.json
 *   • 파일 상태: ✅ 존재 | ❌ 부재
 *   • 마지막 capture: MM/DD HH:mm KST (N시간 M분 전)
 *   • 다음 capture: MM/DD 18:00 KST (Nh 후)
 *   • Schema 유효성: ✅ OK | ⚠️ PARTIAL | ❌ INVALID
 *   • 결손 시 운영자 안내 4 분기 (ENV / 부팅 직후 / 휴장일 / cron 실패)
 *   • 절대 invariants: replayOnly=true · executionImpact=NONE · providerCalls=0
 *   • 사용법: /snapshot_status /snap_status /ss
 */

import fs from 'node:fs';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE } from '../../../persistence/paths.js';
import {
  loadLatestRuntimeDebugSnapshot,
  type RuntimeDebugSnapshot,
} from '../../../replay/runtimeDebugSnapshotRepo.js';
import { isRuntimeDebugSnapshotCaptureDisabled } from '../../../replay/runtimeDebugSnapshotCapture.js';

// ============================================================================
// 시간 헬퍼 — KST 변환 + age 산출 + 다음 18:00 KST 계산
// ============================================================================

/** UTC ms → KST "MM/DD HH:mm" 형식 (Asia/Seoul = UTC+9, DST 미적용). */
function formatKstShort(ms: number | undefined, fallback = 'N/A'): string {
  if (ms === undefined || !Number.isFinite(ms)) return fallback;
  const kstMs = ms + 9 * 60 * 60 * 1000;
  const date = new Date(kstMs);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi} KST`;
}

/** mtime 으로부터 age 산출 — 분/시간/일 단위 분기. */
function formatAge(targetMs: number | undefined, nowMs: number): string {
  if (targetMs === undefined || !Number.isFinite(targetMs)) return '';
  const elapsedMs = nowMs - targetMs;
  if (elapsedMs < 0) return ' (미래 시각)'; // clock skew 안전 fallback
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return ` (${minutes}분 전)`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ` (${hours}시간 ${minutes % 60}분 전)`;
  const days = Math.floor(hours / 24);
  return ` (${days}일 ${hours % 24}시간 전)`;
}

/** 다음 평일 18:00 KST 산출 — 토/일은 다음 월요일로 건너뜀. */
export function computeNextCaptureKstMs(nowMs: number): number {
  const kstMs = nowMs + 9 * 60 * 60 * 1000;
  const kstDate = new Date(kstMs);
  const year = kstDate.getUTCFullYear();
  const month = kstDate.getUTCMonth();
  const day = kstDate.getUTCDate();
  const hour = kstDate.getUTCHours();
  const minute = kstDate.getUTCMinutes();
  const dayOfWeek = kstDate.getUTCDay(); // 0=일, 1=월, ..., 6=토

  // 오늘 18:00 KST (UTC = KST - 9h)
  const today18Kst = Date.UTC(year, month, day, 18, 0, 0) - 9 * 60 * 60 * 1000;

  // 오늘이 평일이고 18:00 이전이면 오늘 18:00, 그 외엔 다음 평일
  const beforeToday18 = hour < 18 || (hour === 18 && minute === 0);
  if (dayOfWeek >= 1 && dayOfWeek <= 5 && beforeToday18) {
    return today18Kst;
  }

  // 다음 평일까지 일자 증가
  let daysToAdd = 1;
  let nextDayOfWeek = (dayOfWeek + daysToAdd) % 7;
  while (nextDayOfWeek === 0 || nextDayOfWeek === 6) {
    daysToAdd += 1;
    nextDayOfWeek = (dayOfWeek + daysToAdd) % 7;
  }
  return Date.UTC(year, month, day + daysToAdd, 18, 0, 0) - 9 * 60 * 60 * 1000;
}

/** 다음 capture 까지 남은 시간 — "Nh M분 후" 형식. */
function formatUntilNext(nextMs: number, nowMs: number): string {
  const remainingMs = nextMs - nowMs;
  if (remainingMs <= 0) return ' (지났음)';
  const minutes = Math.floor(remainingMs / 60_000);
  if (minutes < 60) return ` (${minutes}분 후)`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ` (${hours}시간 ${minutes % 60}분 후)`;
  const days = Math.floor(hours / 24);
  return ` (${days}일 ${hours % 24}시간 후)`;
}

// ============================================================================
// 진단 입력 schema — fs.statSync 결과를 순수 함수에 주입 (단위 테스트 가능)
// ============================================================================

export interface SnapshotStatusInput {
  /** ENV `RUNTIME_DEBUG_SNAPSHOT_DISABLED === 'true'` 결과. */
  envDisabled: boolean;
  /** 영속 파일 절대 경로 — 표시 + 운영자 안내용. */
  filePath: string;
  /** 파일 존재 여부 (fs.statSync 성공 시 true). */
  fileExists: boolean;
  /** 파일 mtime UTC ms (fileExists 일 때만 의미). */
  fileMtimeMs?: number;
  /** 파일 size bytes (fileExists 일 때만 의미). */
  fileSizeBytes?: number;
  /** loadLatestRuntimeDebugSnapshot() 결과 — schema 유효성 확인. */
  snapshot: RuntimeDebugSnapshot | null;
  /** 현재 시각 (단위 테스트용 주입, 미전달 시 Date.now()). */
  nowMs?: number;
}

// ============================================================================
// 출력 빌더 — 순수 함수 (외부 의존성 0건, nowMs 주입 가능)
// ============================================================================

/**
 * `/snapshot_status` 메시지 빌더 SSOT — 순수 함수.
 *
 * 입력 분기:
 *   - envDisabled=true → ENV 비활성 명시 안내 + 활성화 방법
 *   - fileExists=false → 부재 + 4 분기 원인 안내 (ENV / 부팅 직후 / 휴장일 / cron 실패)
 *   - fileExists=true + snapshot=null → 파일 존재하지만 schema 손상 → 복구 안내
 *   - fileExists=true + snapshot!=null → 정상: mtime / size / schema / 다음 capture 시각
 */
export function formatSnapshotStatusMessage(input: SnapshotStatusInput): string {
  const nowMs = input.nowMs ?? Date.now();
  const lines: string[] = [];

  lines.push('📊 [Snapshot Status] runtime debug capture 인프라 진단');
  lines.push('');

  // ENV 상태
  if (input.envDisabled) {
    lines.push('• ENV: RUNTIME_DEBUG_SNAPSHOT_DISABLED = true ❌ (비활성)');
    lines.push('  → cron 발동되어도 capture skip — `=false` 또는 미설정 시 재활성');
  } else {
    lines.push('• ENV: RUNTIME_DEBUG_SNAPSHOT_DISABLED = false ✅ (활성)');
  }

  // Cron 일정
  lines.push('• Cron: 18:00 KST 평일 (TRADING_DAY_ONLY, KRX 휴장일 자동 silent skip)');

  // 파일 경로
  lines.push(`• 파일 경로: ${input.filePath}`);

  // 파일 상태
  if (input.fileExists) {
    const sizeKb = input.fileSizeBytes !== undefined ? (input.fileSizeBytes / 1024).toFixed(1) : 'N/A';
    lines.push(`• 파일 상태: ✅ 존재 (${sizeKb} KB)`);
    lines.push(`• 마지막 capture: ${formatKstShort(input.fileMtimeMs)}${formatAge(input.fileMtimeMs, nowMs)}`);
  } else {
    lines.push('• 파일 상태: ❌ 부재');
  }

  // 다음 capture 시각
  const nextMs = computeNextCaptureKstMs(nowMs);
  lines.push(`• 다음 capture: ${formatKstShort(nextMs)}${formatUntilNext(nextMs, nowMs)}`);

  // Schema 유효성
  if (input.fileExists) {
    if (input.snapshot === null) {
      lines.push('• Schema: ❌ INVALID (파일 존재하나 load 실패)');
      lines.push('  → 손상 JSON 또는 schema 불일치 — `data/replay/` 파일 점검 또는 다음 capture 대기');
    } else if (input.snapshot.captureStatus === 'PARTIAL') {
      const missingCount = input.snapshot.missingSections?.length ?? 0;
      lines.push(`• Schema: ⚠️ PARTIAL (${missingCount} sections missing)`);
      if (input.snapshot.missingSections && input.snapshot.missingSections.length > 0) {
        lines.push(`  → 결손 sections: ${input.snapshot.missingSections.slice(0, 5).join(', ')}`);
      }
    } else {
      lines.push('• Schema: ✅ OK (captureStatus=OK)');
    }
  }

  // 결손 시 운영자 안내 4 분기
  if (!input.fileExists && !input.envDisabled) {
    lines.push('');
    lines.push('🔍 파일 부재 원인 분석:');
    lines.push('  1. 부팅 직후 — 첫 18:00 KST capture 전');
    lines.push('  2. 컨테이너 재시작 — 영속 디렉토리 초기화');
    lines.push('  3. KRX 휴장일 — TRADING_DAY_ONLY ScheduleClass 자동 skip');
    lines.push('  4. cron 실패 — /cron_status 진단 권장');
  }

  // 절대 invariants 노출 (운영자 인지 의무)
  lines.push('');
  lines.push('🔒 절대 invariants:');
  lines.push('  • replayOnly=true · executionImpact=NONE (매매 의사결정 입력 아님)');
  lines.push('  • providerCalls=0 (replay 시 KIS/KRX/Yahoo/Naver 호출 0건)');
  lines.push('  • SINGLE_LATEST_OVERWRITE (다음 18:00 capture 가 덮어쓰기)');

  // Lifecycle invariant
  lines.push('  • 다음 거래일 09:00 개장 시 초기화 ❌ (다음 평일 18:00 capture overwrite)');

  // 사용법
  lines.push('');
  lines.push('사용법: /snapshot_status · /snap_status · /ss');
  lines.push('관련 명령: /snapshot_latest (snapshot 내용 조회)');

  return lines.join('\n');
}

// ============================================================================
// 텔레그램 명령 정의 — commandRegistry.register() 자체 호출 (barrel side-effect)
// ============================================================================

const snapshotStatusCommand: TelegramCommand = {
  name: '/snapshot_status',
  aliases: ['/snap_status', '/ss'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    '18:00 KST runtime debug snapshot capture 인프라 진단 (ENV / cron / 파일 / age, read-only).',
  usage: '/snapshot_status',
  async execute({ reply }) {
    try {
      const envDisabled = isRuntimeDebugSnapshotCaptureDisabled();
      const filePath = LATEST_RUNTIME_DEBUG_SNAPSHOT_FILE;

      let fileExists = false;
      let fileMtimeMs: number | undefined;
      let fileSizeBytes: number | undefined;
      try {
        const stat = fs.statSync(filePath);
        fileExists = true;
        fileMtimeMs = stat.mtimeMs;
        fileSizeBytes = stat.size;
      } catch {
        // 파일 부재 — fileExists=false 유지
      }

      const snapshot = fileExists ? loadLatestRuntimeDebugSnapshot() : null;

      const message = formatSnapshotStatusMessage({
        envDisabled,
        filePath,
        fileExists,
        fileMtimeMs,
        fileSizeBytes,
        snapshot,
      });
      await reply(message);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await reply(`❌ snapshot_status 명령 실행 실패: ${detail}`);
    }
  },
};

commandRegistry.register(snapshotStatusCommand);
