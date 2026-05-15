// @responsibility intradaySnapshotRepo 15:19 KST market-close replay snapshot 영속 SSOT

/**
 * Patch-MARKET-CLOSE-SNAPSHOT-001 — Market Close Replay Snapshot Repo.
 *
 * 사용자 명시 framing:
 *   "15:19 KST에 자동으로 replay snapshot을 저장 (sell only 시간 회피),
 *    장 종료 후 Telegram 명령으로 호출/재현할 수 있게 한다."
 *
 * Lifecycle 정책 (사용자 명시 절대 변경 금지):
 *   - 매일 15:19 KST 자동 capture
 *   - **다음 거래일 개장 시 초기화 안 함** — snapshot 은 다음 거래일 09:00 ~ 15:19 까지 유지
 *   - 다음 거래일 15:19 capture 가 이전 일자 디렉토리 cleanup (overwrite)
 *   - 금요일 snapshot → 월요일 15:19 capture 가 덮어쓰기 (주말 + 월요일 개장 동안 Fri snapshot 그대로)
 *
 * 저장 정책:
 *   - 디렉토리: `data/intraday-snapshots/YYYY-MM-DD/`
 *   - 파일명: `market-close-1519.json` (revision 1) 또는 `market-close-1519-r2.json` (r2~)
 *   - revision: 같은 marketDate 중복 실행 시 revision 증가 (overwrite 아님)
 *   - revision 상한: 5 (FIFO trim — 가장 오래된 revision 제거, 같은 일자 안에서만)
 *   - 일자 단위 cleanup: save 성공 후 이전 일자 디렉토리 자동 삭제 (단일 일자만 유지)
 *   - latest pointer: `data/intraday-snapshots/latest-market-close.json`
 *   - atomic write tmp → rename (race 안전)
 *
 * 절대 invariants:
 *   1. raw API payload 영속 0건 (sanitized fields 만)
 *   2. 민감정보 영속 0건 (token / accountNo / orderId / authorization 등)
 *   3. executionImpact: 'NONE' literal type 강제
 *   4. replayOnly: true literal 강제
 *   5. 외부 API 호출 0건 (영속 read/write 만)
 *   6. KIS 주문 함수 5종 import 0건
 *   7. 손상 JSON 시 null fallback (시스템 무중단)
 *   8. cleanup 은 save 성공 후에만 실행 (이전 일자 손실 차단)
 *   9. cleanup 은 ONLY 다음 거래일 15:19 capture 시점에만 (개장 시 초기화 cron 절대 금지)
 */

import fs from 'fs';
import path from 'path';
import {
  INTRADAY_SNAPSHOTS_DIR,
  LATEST_MARKET_CLOSE_POINTER_FILE,
  intradaySnapshotDayDir,
  marketCloseSnapshotFile,
  ensureIntradaySnapshotsDir,
} from './paths.js';

// ============================================================================
// Schema SSOT — literal types 컴파일 타임 강제
// ============================================================================

export type SnapshotCaptureKind = 'MARKET_CLOSE_1519';

export interface MarketCloseReplaySnapshot {
  // Identity + invariants
  snapshotId: string;
  capturedAt: string; // ISO 8601 UTC
  marketDate: string; // YYYY-MM-DD KST
  captureKind: SnapshotCaptureKind;
  timezone: 'Asia/Seoul';
  source: 'RUNTIME_SNAPSHOT';
  replayOnly: true; // literal — TypeScript 컴파일 타임 강제
  executionImpact: 'NONE'; // literal — replay 결과는 매매 의사결정 입력 절대 금지
  revision: number;
  schemaVersion: 1;

  // Capture quality
  captureStatus: 'OK' | 'PARTIAL';
  missingSections?: string[];
  warnings?: string[];

  // Runtime state (sanitized — 민감정보 0건)
  runtime?: SanitizedRuntimeBlock;
  universe?: SanitizedUniverseBlock;
  gate?: SanitizedGateBlock;
  supply?: SanitizedSupplyBlock;
  watchlist?: SanitizedWatchlistBlock;
  sectorEnergy?: SanitizedSectorEnergyBlock;
  programTrading?: SanitizedProgramTradingBlock;
  shadow?: SanitizedShadowBlock;
  counterfactual?: SanitizedCounterfactualBlock;
  providerDiagnostics?: SanitizedProviderDiagnosticsBlock;
}

// 각 블록 schema — 모두 옵셔널·sanitized. 호출자(capture orchestrator) 가 채움.
// 본 PR 은 진단 강도가 다양한 source 를 그대로 propagate — Record<string, unknown> 으로
// 유연성 보존 (drift 시 capture 측 sanitize 강제).
export interface SanitizedRuntimeBlock {
  marketSession?: string;
  sellOnly?: boolean;
  kisLoadState?: string;
  regime?: string;
  fomcPhase?: string;
  kellyMultiplier?: number;
  engineAlive?: boolean;
  shadowLearningEnabled?: boolean;
  emergencyStop?: boolean;
  [key: string]: unknown;
}

export interface SanitizedUniverseBlock {
  candidateCount?: number;
  watchlistCount?: number;
  sections?: Record<string, number>;
  [key: string]: unknown;
}

export interface SanitizedGateBlock {
  gate1Pass?: number;
  gate2Pass?: number;
  gate3Pass?: number;
  blockers?: Array<{ reason: string; count: number }>;
  [key: string]: unknown;
}

export interface SanitizedSupplyBlock {
  selectedProvider?: string;
  semanticAvailable?: number;
  rawInvestorRowAvailable?: number;
  scoreUsageDistribution?: Record<string, number>;
  providerIssue?: boolean;
  marketSignal?: boolean;
  [key: string]: unknown;
}

export interface SanitizedWatchlistBlock {
  imported?: number;
  momentumCount?: number;
  saturationStatus?: string;
  detachedShadowCount?: number;
  [key: string]: unknown;
}

export interface SanitizedSectorEnergyBlock {
  dataQuality?: string;
  validSectorCount?: number;
  sourceTier?: string;
  sectorBoostAllowed?: boolean;
  strongBuyAllowed?: boolean;
  [key: string]: unknown;
}

export interface SanitizedProgramTradingBlock {
  stockProgramStatus?: string;
  marketProgramStatus?: string;
  sessionState?: string;
  [key: string]: unknown;
}

export interface SanitizedShadowBlock {
  openPositions?: number;
  detachedPositions?: number;
  todayCreated?: number;
  todayClosed?: number;
  [key: string]: unknown;
}

export interface SanitizedCounterfactualBlock {
  recordedCount?: number;
  nearMissCount?: number;
  dryRunRows?: number;
  [key: string]: unknown;
}

export interface SanitizedProviderDiagnosticsBlock {
  kis?: Record<string, unknown>;
  krx?: Record<string, unknown>;
  naver?: Record<string, unknown>;
  cache?: Record<string, unknown>;
  yahoo?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================================================
// SSOT 상수
// ============================================================================

/** 같은 marketDate 의 revision 누적 상한. 초과 시 가장 오래된 revision 자동 제거. */
export const MARKET_CLOSE_SNAPSHOT_REVISION_LIMIT = 5;

/** 사용자 명시 — 7일 이내 snapshot 목록 default 표시 한도. */
export const SNAPSHOT_LIST_DEFAULT_DAYS = 7;

// ============================================================================
// Sensitive Field Redaction SSOT — 영속 직전 자동 제거
// ============================================================================

/**
 * 영속 전 sanitize 통과 의무 — 민감정보 키 자동 제거.
 * 사용자 명시 (§"snapshot 스키마 주의"):
 *   "계좌번호, 주문번호, 토큰, authorization header 저장 금지"
 *
 * 키 매칭은 대소문자 무관 + 부분 매치 (`appkey`, `appKey`, `APP_KEY` 모두 제거).
 */
const FORBIDDEN_FIELD_PATTERNS = [
  /token/i,
  /authorization/i,
  /appkey/i,
  /appsecret/i,
  /^cano$/i,
  /accountno/i,
  /accountnumber/i,
  /orderno/i,
  /orderid/i,
  /custtype/i,
  /password/i,
  /secret/i,
  /credential/i,
  /^auth$/i,
  /cookie/i,
];

export function isForbiddenSnapshotField(key: string): boolean {
  return FORBIDDEN_FIELD_PATTERNS.some((re) => re.test(key));
}

/**
 * 객체에서 민감 키를 재귀적으로 제거 — 영속 전 자동 호출.
 * - Object: 키 단위 검사 + nested 재귀
 * - Array: 각 element 재귀
 * - Primitive: 그대로 반환
 * - circular reference 차단을 위해 depth 6 제한 (정상 sanitized block 충분)
 */
export function redactSensitiveFields<T>(value: T, depth = 0): T {
  if (depth > 6) return value; // depth guard
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, depth + 1)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenSnapshotField(key)) continue;
    result[key] = redactSensitiveFields(val, depth + 1);
  }
  return result as T;
}

// ============================================================================
// 영속 IO — atomic write tmp → rename + 손상 JSON fallback
// ============================================================================

interface LatestPointer {
  snapshotId: string;
  marketDate: string;
  revision: number;
  capturedAt: string;
  filePath: string;
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function safeReadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(
      `[IntradaySnapshotRepo] 손상 JSON 무시 (file=${filePath}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Market-close snapshot 영속.
 *
 * 알고리즘:
 *   1. sanitized snapshot 을 receive (호출자는 redactSensitiveFields 통과 의무)
 *   2. marketDate 디렉토리 안 기존 revision 파일들 스캔 → 다음 revision 결정
 *   3. revision > LIMIT 시 가장 오래된 revision 파일 삭제 (FIFO trim, 같은 일자 안에서만)
 *   4. atomic write — `market-close-1519{-rN}.json`
 *   5. latest pointer 갱신 — 가장 최근 성공 snapshot 가리킴
 *   6. **이전 일자 디렉토리 cleanup** — save 성공 후에만, 다른 marketDate 디렉토리 모두 제거
 *      (사용자 명시 lifecycle: Fri snapshot 은 Mon 15:19 capture 시점에 cleanup)
 *
 * 영속 실패 시 throw (호출자가 try/catch 격리 의무).
 * Cleanup 실패는 console.warn 만 — save 자체는 성공으로 간주.
 */
export function saveMarketCloseReplaySnapshot(
  snapshot: MarketCloseReplaySnapshot
): MarketCloseReplaySnapshot {
  ensureIntradaySnapshotsDir();
  const dayDir = intradaySnapshotDayDir(snapshot.marketDate);
  if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });

  // 기존 revision 파일 스캔
  const existingRevisions = scanDayRevisions(snapshot.marketDate);
  const nextRevision = existingRevisions.length === 0 ? 1 : Math.max(...existingRevisions) + 1;

  // FIFO trim — revision 누적 상한 초과 시 가장 오래된 제거
  if (existingRevisions.length >= MARKET_CLOSE_SNAPSHOT_REVISION_LIMIT) {
    const sorted = [...existingRevisions].sort((a, b) => a - b);
    const toRemoveCount = sorted.length - MARKET_CLOSE_SNAPSHOT_REVISION_LIMIT + 1;
    for (let i = 0; i < toRemoveCount; i++) {
      const oldestRev = sorted[i];
      if (oldestRev === undefined) continue;
      const oldFile = marketCloseSnapshotFile(snapshot.marketDate, oldestRev);
      try {
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      } catch (err) {
        console.warn(
          `[IntradaySnapshotRepo] revision trim 실패 (rev=${oldestRev}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }

  // sanitized snapshot 영속 — redaction 한 번 더 통과 (방어적)
  const finalSnapshot: MarketCloseReplaySnapshot = {
    ...redactSensitiveFields(snapshot),
    revision: nextRevision,
    schemaVersion: 1,
    replayOnly: true,
    executionImpact: 'NONE',
    source: 'RUNTIME_SNAPSHOT',
    timezone: 'Asia/Seoul',
  };

  const targetFile = marketCloseSnapshotFile(snapshot.marketDate, nextRevision);
  atomicWriteJson(targetFile, finalSnapshot);

  // latest pointer 갱신
  const pointer: LatestPointer = {
    snapshotId: finalSnapshot.snapshotId,
    marketDate: finalSnapshot.marketDate,
    revision: finalSnapshot.revision,
    capturedAt: finalSnapshot.capturedAt,
    filePath: targetFile,
  };
  atomicWriteJson(LATEST_MARKET_CLOSE_POINTER_FILE, pointer);

  // 사용자 명시 lifecycle: 다음 거래일 15:19 capture 시점에 이전 일자 디렉토리 cleanup.
  // 이 cleanup 은 *save 성공 후에만* 실행 — 이전 일자 손실 차단 (절대 invariant #8).
  // 다음 거래일 개장 시 별도 cron 으로 초기화하지 않음 (절대 invariant #9).
  const cleanup = cleanupOlderDayDirectories(snapshot.marketDate);
  for (const warning of cleanup.warnings) console.warn(warning);

  return finalSnapshot;
}

/**
 * 이전 일자 snapshot 디렉토리 일괄 cleanup.
 *
 * 사용자 명시 lifecycle:
 *   - 다음 거래일 15:19 capture *직후* 이전 일자 디렉토리 일괄 삭제
 *   - 단일 일자 (`currentMarketDate`) 만 영속 유지 — 운영자가 `/snapshot_latest` 로 항상 최신 1개 조회
 *   - 다음 거래일 09:00 ~ 15:19 동안에는 이전 일자 디렉토리 그대로 유지 (개장 시 초기화 안 함)
 *
 * Cleanup 실패는 silent — save 자체는 성공으로 간주 (warning 만 반환).
 */
function cleanupOlderDayDirectories(currentMarketDate: string): {
  removed: string[];
  warnings: string[];
} {
  const removed: string[] = [];
  const warnings: string[] = [];
  if (!fs.existsSync(INTRADAY_SNAPSHOTS_DIR)) return { removed, warnings };
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(INTRADAY_SNAPSHOTS_DIR, { withFileTypes: true });
  } catch (err) {
    warnings.push(
      `[IntradaySnapshotRepo] cleanup readdir 실패: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { removed, warnings };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue; // 잘못된 디렉토리 무시
    if (entry.name === currentMarketDate) continue; // 현재 일자 보존
    const dirPath = path.join(INTRADAY_SNAPSHOTS_DIR, entry.name);
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      removed.push(entry.name);
    } catch (err) {
      warnings.push(
        `[IntradaySnapshotRepo] 이전 일자 디렉토리 cleanup 실패 (${entry.name}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return { removed, warnings };
}

/**
 * 최신 market-close snapshot 로드.
 * latest pointer 가 부재하거나 손상 시 null.
 */
export function loadLatestMarketCloseReplaySnapshot(): MarketCloseReplaySnapshot | null {
  const pointer = safeReadJson<LatestPointer>(LATEST_MARKET_CLOSE_POINTER_FILE);
  if (!pointer || typeof pointer.filePath !== 'string') return null;
  const snapshot = safeReadJson<MarketCloseReplaySnapshot>(pointer.filePath);
  if (!snapshot || snapshot.replayOnly !== true) return null;
  return snapshot;
}

/**
 * 특정 일자의 최신 revision snapshot 로드.
 * 일자에 snapshot 부재 시 null.
 */
export function loadMarketCloseReplaySnapshot(yyyymmdd: string): MarketCloseReplaySnapshot | null {
  const revisions = scanDayRevisions(yyyymmdd);
  if (revisions.length === 0) return null;
  const latestRev = Math.max(...revisions);
  const filePath = marketCloseSnapshotFile(yyyymmdd, latestRev);
  const snapshot = safeReadJson<MarketCloseReplaySnapshot>(filePath);
  if (!snapshot || snapshot.replayOnly !== true) return null;
  return snapshot;
}

/**
 * 최근 N일 snapshot 목록 — 일자/revision/capturedAt 메타 (본문 미포함, 가벼움).
 * 사용자 명시 §5.C — `/snapshot_list` 텔레그램 명령용.
 */
export interface SnapshotListEntry {
  marketDate: string;
  revision: number;
  capturedAt: string;
  filePath: string;
  snapshotId: string;
}

export function listMarketCloseReplaySnapshots(limit: number = SNAPSHOT_LIST_DEFAULT_DAYS): SnapshotListEntry[] {
  if (!fs.existsSync(INTRADAY_SNAPSHOTS_DIR)) return [];
  const cappedLimit = Math.max(1, Math.min(30, Math.floor(limit)));
  const dayDirs = fs
    .readdirSync(INTRADAY_SNAPSHOTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse() // 최신 일자 우선
    .slice(0, cappedLimit);

  const results: SnapshotListEntry[] = [];
  for (const dayName of dayDirs) {
    const revisions = scanDayRevisions(dayName);
    if (revisions.length === 0) continue;
    const latestRev = Math.max(...revisions);
    const filePath = marketCloseSnapshotFile(dayName, latestRev);
    const snapshot = safeReadJson<MarketCloseReplaySnapshot>(filePath);
    if (!snapshot) continue;
    results.push({
      marketDate: dayName,
      revision: latestRev,
      capturedAt: snapshot.capturedAt,
      filePath,
      snapshotId: snapshot.snapshotId,
    });
  }
  return results;
}

/**
 * 특정 일자 디렉토리의 모든 revision 번호 스캔.
 * 파일명 `market-close-1519.json` → revision 1
 * 파일명 `market-close-1519-rN.json` → revision N
 */
function scanDayRevisions(yyyymmdd: string): number[] {
  const dayDir = intradaySnapshotDayDir(yyyymmdd);
  if (!fs.existsSync(dayDir)) return [];
  const revisions: number[] = [];
  for (const file of fs.readdirSync(dayDir)) {
    if (file === 'market-close-1519.json') {
      revisions.push(1);
    } else {
      const match = file.match(/^market-close-1519-r(\d+)\.json$/);
      if (match) {
        const n = Number(match[1]);
        if (Number.isFinite(n) && n >= 2 && n <= 99) revisions.push(n);
      }
    }
  }
  return revisions;
}

/** 테스트 격리 헬퍼 — 운영 환경 호출 금지. */
export function __resetIntradaySnapshotRepoForTests(): void {
  // No in-memory state — repo 는 stateless. 호출자가 PERSIST_DATA_DIR 분리로 격리.
}
