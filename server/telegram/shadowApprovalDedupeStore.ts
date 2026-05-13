/**
 * @responsibility Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow approval 중복 발송 차단 SSOT.
 *
 * 사용자 운영 사례 (오픈엣지테크놀로지 394280):
 *   - Shadow approval 카드 1차 수동 승인 후에도 동일 종목 카드가 2회 더 발송됨
 *   - 가격/Gate/RRR 변동만으로 새 approval 발송되던 결함 차단
 *   - 수동 승인 시 120초 auto approval timer clearTimeout 의무
 *
 * 안전 invariants (절대 변경 금지):
 *   - liveExecutionAllowed=false
 *   - liveOrderPlaced=false
 *   - executionImpact='NONE'
 *   - dedupeKey 에 price / stopLoss / targetPrice / gateScore / RRR 포함 금지
 *   - tradeDate / marketSession / symbol / sourceLane / approvalKind 만 사용
 *   - 중복 차단 시 Telegram 장문 발송 금지 (logger compact line 만)
 *   - KIS 주문 함수 import 0건
 */

export type ShadowApprovalState =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'SKIPPED'
  | 'EXPIRED'
  | 'DEDUPED';

export type ShadowApprovalSourceLane =
  | 'SHADOW'
  | 'DECISION_BROKER'
  | 'PROVISIONAL'
  | 'COUNTERFACTUAL';

export type ShadowApprovalKind = 'BUY_APPROVAL';

export interface ShadowApprovalDedupeRecord {
  /** SSOT — tradeDate:marketSession:symbol:sourceLane:approvalKind */
  dedupeKey: string;
  tradeDate: string;
  marketSession: string;
  symbol: string;
  name?: string;
  sourceLane: ShadowApprovalSourceLane;
  approvalKind: ShadowApprovalKind;
  state: ShadowApprovalState;
  firstSeenAt: string;
  lastSeenAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  skippedAt?: string;
  lastPrice?: number;
  lastGateScore?: number;
  lastRrr?: number;
  /** Auto-approval timer handle (수동 승인 시 clearTimeout 의무) */
  timerId?: NodeJS.Timeout;
  autoApprovalCancelled?: boolean;
  /** 절대 invariant — Shadow lane 에서는 항상 false */
  liveOrderPlaced: false;
  /** 절대 invariant — diagnostic / shadow only */
  executionImpact: 'NONE';
}

export interface ShadowApprovalDedupeInput {
  tradeDate: string;
  marketSession: string;
  symbol: string;
  name?: string;
  sourceLane?: ShadowApprovalSourceLane;
  approvalKind?: ShadowApprovalKind;
}

/* ───────── dedupeKey SSOT ───────── */

/**
 * dedupeKey 생성 — 사용자 명시 §B 규칙 (절대 변경 금지).
 *
 * `SHADOW_APPROVAL:tradeDate:marketSession:symbol:sourceLane:approvalKind`
 *
 * 금지:
 *   - price 포함 금지
 *   - stopLoss / targetPrice 포함 금지
 *   - gateScore / RRR 포함 금지
 *
 * 이유: 가격/지표 변동만으로 새 카드 발송되는 결함을 차단하기 위함.
 */
export function buildShadowApprovalDedupeKey(input: ShadowApprovalDedupeInput): string {
  const sourceLane = input.sourceLane ?? 'SHADOW';
  const approvalKind = input.approvalKind ?? 'BUY_APPROVAL';
  return `SHADOW_APPROVAL:${input.tradeDate}:${input.marketSession}:${input.symbol}:${sourceLane}:${approvalKind}`;
}

/**
 * Shadow approval 컨텍스트 (tradeDate + marketSession) SSOT 헬퍼.
 *
 * 호출자 측 (buyPipeline / buyListLoop) 가 이 헬퍼 1회 호출로 두 필드 일관 산출 — drift 차단.
 *
 *   tradeDate: KST yyyy-mm-dd
 *   marketSession: PRE_OPEN(<09:00) / REGULAR(09:00~12:00 + 13:00~15:00) /
 *                  LUNCH_BREAK(12:00~13:00) / AFTER_HOURS(15:00~15:30) / CLOSED(≥15:30)
 *
 * 시간 비교는 KST 기준. process.env.TZ 무관 (UTC+9 명시 offset 사용).
 */
export function deriveShadowApprovalContext(nowMs?: number): {
  tradeDate: string;
  marketSession: 'PRE_OPEN' | 'REGULAR' | 'LUNCH_BREAK' | 'AFTER_HOURS' | 'CLOSED';
} {
  const ms = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  // KST = UTC+9
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  const tradeDate = `${year}-${month}-${day}`;
  const kstMinutes = kst.getUTCHours() * 100 + kst.getUTCMinutes();
  let marketSession: 'PRE_OPEN' | 'REGULAR' | 'LUNCH_BREAK' | 'AFTER_HOURS' | 'CLOSED';
  if (kstMinutes < 900) marketSession = 'PRE_OPEN';
  else if (kstMinutes < 1200) marketSession = 'REGULAR';
  else if (kstMinutes < 1300) marketSession = 'LUNCH_BREAK';
  else if (kstMinutes < 1500) marketSession = 'REGULAR';
  else if (kstMinutes < 1530) marketSession = 'AFTER_HOURS';
  else marketSession = 'CLOSED';
  return { tradeDate, marketSession };
}

/* ───────── In-memory store SSOT ───────── */

const _store = new Map<string, ShadowApprovalDedupeRecord>();

/** dedupeKey → record (없으면 undefined). */
export function getShadowApprovalRecord(dedupeKey: string): ShadowApprovalDedupeRecord | undefined {
  return _store.get(dedupeKey);
}

/** 같은 symbol 의 모든 record. 운영자 진단 용도. */
export function getRecordsBySymbol(symbol: string): ShadowApprovalDedupeRecord[] {
  const out: ShadowApprovalDedupeRecord[] = [];
  for (const r of _store.values()) {
    if (r.symbol === symbol) out.push(r);
  }
  return out;
}

/**
 * PENDING record 생성 또는 갱신.
 *
 * 이미 record 가 있고 state 가 PENDING/APPROVED/REJECTED/SKIPPED 면:
 *   - 새 record 만들지 않음
 *   - lastSeenAt / lastPrice / lastGateScore / lastRrr 만 갱신
 *   - 반환값: { isDuplicate: true, record: 기존 record }
 *
 * EXPIRED 상태는 같은 session 안에선 새 카드 발송 금지 (사용자 §C).
 *
 * 새 record 생성 시: state='PENDING' 으로 시작.
 */
export function recordPendingShadowApproval(input: {
  dedupeKey: string;
  tradeDate: string;
  marketSession: string;
  symbol: string;
  name?: string;
  sourceLane: ShadowApprovalSourceLane;
  approvalKind: ShadowApprovalKind;
  price?: number;
  gateScore?: number;
  rrr?: number;
  timerId?: NodeJS.Timeout;
  now?: string;
}): { isDuplicate: boolean; record: ShadowApprovalDedupeRecord; previousState?: ShadowApprovalState } {
  const now = input.now ?? new Date().toISOString();
  const existing = _store.get(input.dedupeKey);
  if (existing) {
    // 이미 PENDING/APPROVED/REJECTED/SKIPPED/EXPIRED 어떤 state 든
    // 같은 dedupeKey 면 새 record 만들지 않음 — 호출자가 isDuplicate 분기.
    const updated: ShadowApprovalDedupeRecord = {
      ...existing,
      lastSeenAt: now,
      ...(input.price !== undefined && Number.isFinite(input.price) ? { lastPrice: input.price } : {}),
      ...(input.gateScore !== undefined && Number.isFinite(input.gateScore) ? { lastGateScore: input.gateScore } : {}),
      ...(input.rrr !== undefined && Number.isFinite(input.rrr) ? { lastRrr: input.rrr } : {}),
    };
    _store.set(input.dedupeKey, updated);
    return { isDuplicate: true, record: updated, previousState: existing.state };
  }
  const fresh: ShadowApprovalDedupeRecord = {
    dedupeKey: input.dedupeKey,
    tradeDate: input.tradeDate,
    marketSession: input.marketSession,
    symbol: input.symbol,
    ...(input.name !== undefined ? { name: input.name } : {}),
    sourceLane: input.sourceLane,
    approvalKind: input.approvalKind,
    state: 'PENDING',
    firstSeenAt: now,
    lastSeenAt: now,
    ...(input.price !== undefined && Number.isFinite(input.price) ? { lastPrice: input.price } : {}),
    ...(input.gateScore !== undefined && Number.isFinite(input.gateScore) ? { lastGateScore: input.gateScore } : {}),
    ...(input.rrr !== undefined && Number.isFinite(input.rrr) ? { lastRrr: input.rrr } : {}),
    ...(input.timerId !== undefined ? { timerId: input.timerId } : {}),
    liveOrderPlaced: false,
    executionImpact: 'NONE',
  };
  _store.set(input.dedupeKey, fresh);
  return { isDuplicate: false, record: fresh };
}

/**
 * 수동 승인 처리 — APPROVED 로 전이 + timer clearTimeout.
 * record 가 없거나 PENDING 이 아니면 no-op (방어).
 */
export function markShadowApprovalApproved(
  dedupeKey: string,
  now?: string,
): { transitioned: boolean; record?: ShadowApprovalDedupeRecord; timerWasActive: boolean } {
  const existing = _store.get(dedupeKey);
  if (!existing) return { transitioned: false, timerWasActive: false };
  if (existing.state !== 'PENDING') return { transitioned: false, record: existing, timerWasActive: false };
  const timerWasActive = !!existing.timerId;
  if (existing.timerId) {
    try {
      clearTimeout(existing.timerId);
    } catch {
      // ignore
    }
  }
  const ts = now ?? new Date().toISOString();
  const updated: ShadowApprovalDedupeRecord = {
    ...existing,
    state: 'APPROVED',
    approvedAt: ts,
    lastSeenAt: ts,
    autoApprovalCancelled: timerWasActive,
    liveOrderPlaced: false,
    executionImpact: 'NONE',
  };
  // timer 제거 — Map 안 record 가 더 이상 timer 참조 안 함.
  delete updated.timerId;
  _store.set(dedupeKey, updated);
  return { transitioned: true, record: updated, timerWasActive };
}

/** 수동 거부 처리 — REJECTED 전이 + timer clearTimeout. */
export function markShadowApprovalRejected(dedupeKey: string, now?: string): boolean {
  const existing = _store.get(dedupeKey);
  if (!existing) return false;
  if (existing.state !== 'PENDING') return false;
  if (existing.timerId) {
    try { clearTimeout(existing.timerId); } catch { /* ignore */ }
  }
  const ts = now ?? new Date().toISOString();
  const updated: ShadowApprovalDedupeRecord = {
    ...existing,
    state: 'REJECTED',
    rejectedAt: ts,
    lastSeenAt: ts,
    liveOrderPlaced: false,
    executionImpact: 'NONE',
  };
  delete updated.timerId;
  _store.set(dedupeKey, updated);
  return true;
}

/** 스킵 처리 — SKIPPED 전이 + timer clearTimeout. */
export function markShadowApprovalSkipped(dedupeKey: string, now?: string): boolean {
  const existing = _store.get(dedupeKey);
  if (!existing) return false;
  if (existing.state !== 'PENDING') return false;
  if (existing.timerId) {
    try { clearTimeout(existing.timerId); } catch { /* ignore */ }
  }
  const ts = now ?? new Date().toISOString();
  const updated: ShadowApprovalDedupeRecord = {
    ...existing,
    state: 'SKIPPED',
    skippedAt: ts,
    lastSeenAt: ts,
    liveOrderPlaced: false,
    executionImpact: 'NONE',
  };
  delete updated.timerId;
  _store.set(dedupeKey, updated);
  return true;
}

/**
 * Auto-approval timer 발동 시점 호출 — state 검사 후 APPROVED 전이 (아직 PENDING 일 때만).
 *
 * 사용자 §E 규약:
 *   - state !== PENDING 이면 아무 작업도 하지 않음 (return false)
 *   - PENDING 이면 APPROVED 전이 + timerId 제거 + autoApprovalCancelled=false
 */
export function markShadowApprovalAutoApproved(
  dedupeKey: string,
  now?: string,
): { transitioned: boolean; record?: ShadowApprovalDedupeRecord } {
  const existing = _store.get(dedupeKey);
  if (!existing) return { transitioned: false };
  if (existing.state !== 'PENDING') return { transitioned: false, record: existing };
  const ts = now ?? new Date().toISOString();
  const updated: ShadowApprovalDedupeRecord = {
    ...existing,
    state: 'APPROVED',
    approvedAt: ts,
    lastSeenAt: ts,
    autoApprovalCancelled: false,
    liveOrderPlaced: false,
    executionImpact: 'NONE',
  };
  delete updated.timerId;
  _store.set(dedupeKey, updated);
  return { transitioned: true, record: updated };
}

/**
 * dedupe 결과 기록 (DEDUPED state 명시) — 사용자 §F 정합.
 * 이미 record 가 있으면 lastSeenAt 만 갱신 — state 는 보존.
 */
export function markShadowApprovalDeduped(input: {
  dedupeKey: string;
  tradeDate: string;
  marketSession: string;
  symbol: string;
  name?: string;
  sourceLane: ShadowApprovalSourceLane;
  approvalKind: ShadowApprovalKind;
  now?: string;
}): ShadowApprovalDedupeRecord {
  const now = input.now ?? new Date().toISOString();
  const existing = _store.get(input.dedupeKey);
  if (existing) {
    const updated: ShadowApprovalDedupeRecord = {
      ...existing,
      lastSeenAt: now,
      liveOrderPlaced: false,
      executionImpact: 'NONE',
    };
    _store.set(input.dedupeKey, updated);
    return updated;
  }
  const fresh: ShadowApprovalDedupeRecord = {
    dedupeKey: input.dedupeKey,
    tradeDate: input.tradeDate,
    marketSession: input.marketSession,
    symbol: input.symbol,
    ...(input.name !== undefined ? { name: input.name } : {}),
    sourceLane: input.sourceLane,
    approvalKind: input.approvalKind,
    state: 'DEDUPED',
    firstSeenAt: now,
    lastSeenAt: now,
    liveOrderPlaced: false,
    executionImpact: 'NONE',
  };
  _store.set(input.dedupeKey, fresh);
  return fresh;
}

/* ───────── 운영자 진단 SSOT ───────── */

export interface ShadowApprovalDedupeStats {
  pending: number;
  approved: number;
  rejected: number;
  skipped: number;
  expired: number;
  deduped: number;
  duplicateSuppressed: number;
  autoTimerCancelled: number;
  lastSuppressedSymbol?: string;
  lastSuppressedName?: string;
}

let _duplicateSuppressedCount = 0;
let _lastSuppressedSymbol: string | undefined;
let _lastSuppressedName: string | undefined;

/** 중복 차단 발생 시 카운터 증가 (운영자 진단). */
export function recordDuplicateSuppressed(symbol: string, name?: string): void {
  _duplicateSuppressedCount += 1;
  _lastSuppressedSymbol = symbol;
  if (name !== undefined) _lastSuppressedName = name;
}

export function getShadowApprovalDedupeStats(): ShadowApprovalDedupeStats {
  const stats: ShadowApprovalDedupeStats = {
    pending: 0,
    approved: 0,
    rejected: 0,
    skipped: 0,
    expired: 0,
    deduped: 0,
    duplicateSuppressed: _duplicateSuppressedCount,
    autoTimerCancelled: 0,
  };
  for (const r of _store.values()) {
    switch (r.state) {
      case 'PENDING': stats.pending += 1; break;
      case 'APPROVED': stats.approved += 1; break;
      case 'REJECTED': stats.rejected += 1; break;
      case 'SKIPPED': stats.skipped += 1; break;
      case 'EXPIRED': stats.expired += 1; break;
      case 'DEDUPED': stats.deduped += 1; break;
    }
    if (r.autoApprovalCancelled) stats.autoTimerCancelled += 1;
  }
  if (_lastSuppressedSymbol !== undefined) stats.lastSuppressedSymbol = _lastSuppressedSymbol;
  if (_lastSuppressedName !== undefined) stats.lastSuppressedName = _lastSuppressedName;
  return stats;
}

/** /scan_blockers compact line 포맷. */
export function formatShadowApprovalDedupeSection(stats: ShadowApprovalDedupeStats): string {
  const lines: string[] = [];
  // Patch-SHADOW-APPROVAL-DEDUP-001 — `[PATCH-RUNTIME]` 태그로 sectionMatchesMode('runtime') 통과.
  lines.push('🧾 ShadowApproval Dedup [PATCH-RUNTIME]');
  lines.push(`• pending=${stats.pending} approved=${stats.approved} deduped=${stats.deduped}`);
  if (stats.duplicateSuppressed > 0) {
    const last = stats.lastSuppressedSymbol
      ? `${stats.lastSuppressedSymbol}${stats.lastSuppressedName ? ` ${stats.lastSuppressedName}` : ''}`
      : 'n/a';
    lines.push(`• duplicateSuppressed=${stats.duplicateSuppressed} lastSuppressed=${last}`);
  }
  if (stats.autoTimerCancelled > 0) lines.push(`• autoTimerCancelled=${stats.autoTimerCancelled}`);
  lines.push('• liveOrderPlaced=false');
  lines.push('• executionImpact=NONE');
  return lines.join('\n');
}

/* ───────── 테스트 격리 SSOT ───────── */

/** 테스트 격리용 — production 호출 금지. */
export function __resetShadowApprovalDedupeStoreForTests(): void {
  _store.clear();
  _duplicateSuppressedCount = 0;
  _lastSuppressedSymbol = undefined;
  _lastSuppressedName = undefined;
}

/** 테스트 격리용 — 내부 Map 직접 접근 (production 호출 금지). */
export function __getAllShadowApprovalRecordsForTests(): ShadowApprovalDedupeRecord[] {
  return Array.from(_store.values());
}
