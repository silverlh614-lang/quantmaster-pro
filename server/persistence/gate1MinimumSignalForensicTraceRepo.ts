/**
 * @responsibility ADR-0505 Gate1 Minimum Signal Forensic Trace persistent ledger.
 *
 * sanitized per-symbol forensic audit 영속 SSOT — atomic write tmp→rename +
 * FIFO 200 + 7일 TTL + 손상 JSON 빈 배열 fallback.
 *
 * 사용자 명시 sanitized 정책 (ADR-0445 정합) — raw payload / token / cookie /
 * 계좌번호 / `total_assets` / `orderable_cash` / personal Telegram ID 영속 0건.
 * sanitized metadata 만 영속 (component scores / missing sources /
 * supplyScopeAudit / sectorEnergyAudit / wouldPassIf).
 *
 * 다른 ledger (shadow-trades / counterfactual-* / provisional-* /
 * krx-investor-flow-parser-diagnostics) 와 *물리 분리* — 별도 영속 파일.
 */

import fs from 'fs';
import path from 'path';
import { GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_FILE } from './paths.js';
import type { Gate1MinimumSignalForensicAuditAdr0505 } from '../trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.js';

/* ───────── 정책 상수 SSOT (절대 변경 금지) ───────── */

export const GATE1_FORENSIC_FIFO_LIMIT = 200;
export const GATE1_FORENSIC_TTL_DAYS = 7;
const TTL_MS = GATE1_FORENSIC_TTL_DAYS * 24 * 60 * 60 * 1000;

/* ───────── Sanitized trace entry ───────── */

export interface Gate1MinimumSignalForensicTraceEntry {
  scanId: string;
  capturedAtIso: string;
  audit: Gate1MinimumSignalForensicAuditAdr0505;
}

/* ───────── ENV 우회 SSOT ───────── */

export function isGate1ForensicTracePersistDisabled(): boolean {
  return process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_PERSIST_DISABLED === 'true';
}

/* ───────── load / save ───────── */

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore — atomic write 가 실패하면 호출자 catch
  }
}

export function loadGate1ForensicTrace(): Gate1MinimumSignalForensicTraceEntry[] {
  try {
    if (!fs.existsSync(GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_FILE)) return [];
    const raw = fs.readFileSync(GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

function isValidEntry(value: unknown): value is Gate1MinimumSignalForensicTraceEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.scanId === 'string' &&
    typeof v.capturedAtIso === 'string' &&
    v.audit !== null &&
    typeof v.audit === 'object'
  );
}

function saveGate1ForensicTraceAtomic(entries: Gate1MinimumSignalForensicTraceEntry[]): void {
  ensureDir(GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_FILE);
  const tmpPath = `${GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_FILE}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
  fs.renameSync(tmpPath, GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_FILE);
}

/**
 * Append per-symbol forensic audit + FIFO 200 trim + 7일 TTL filter.
 *
 * 호출자는 try/catch 격리 의무 — 본 함수가 throw 하면 LIVE 매매 흐름 영향 없음
 * (호출자 측 try/catch 가 격리). 반환값 — 실제 영속 성공 entries 수 (진단용).
 */
export function appendGate1ForensicTrace(
  scanId: string,
  capturedAtIso: string,
  audits: ReadonlyArray<Gate1MinimumSignalForensicAuditAdr0505>,
): number {
  if (isGate1ForensicTracePersistDisabled()) return 0;
  if (audits.length === 0) return 0;

  const existing = loadGate1ForensicTrace();
  const now = Date.now();

  // 7일 TTL filter — 잘못된 ISO 도 safely 처리 (NaN → 제외)
  const fresh = existing.filter((e) => {
    const t = Date.parse(e.capturedAtIso);
    if (!Number.isFinite(t)) return false;
    return now - t < TTL_MS;
  });

  // 신규 entries
  const newEntries: Gate1MinimumSignalForensicTraceEntry[] = audits.map((audit) => ({
    scanId,
    capturedAtIso,
    audit,
  }));

  // FIFO 200 — 가장 오래된 것부터 제거
  const combined = [...fresh, ...newEntries];
  const trimmed = combined.length > GATE1_FORENSIC_FIFO_LIMIT
    ? combined.slice(combined.length - GATE1_FORENSIC_FIFO_LIMIT)
    : combined;

  saveGate1ForensicTraceAtomic(trimmed);
  return newEntries.length;
}

/* ───────── 테스트 격리 헬퍼 ───────── */

export function __resetGate1ForensicTraceForTests(): void {
  try {
    if (fs.existsSync(GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_FILE)) {
      fs.unlinkSync(GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_FILE);
    }
  } catch {
    // ignore
  }
}
