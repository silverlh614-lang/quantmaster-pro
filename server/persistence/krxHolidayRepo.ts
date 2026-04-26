/**
 * @responsibility KRX 휴장일 patch 영속 — 정적 STATIC_HOLIDAYS 위에 추가된 차년도 휴장일 (ADR-0039)
 *
 * 운영자가 차년도 KRX 휴장일을 알게 됐을 때, 코드 PR/재배포 없이 디스크 파일로
 * 추가 가능하도록 한다. `krxHolidays.reloadKrxHolidaySet()` 호출 시 본 모듈의
 * patch 가 정적 Set 과 합쳐져 활성 Set 으로 갱신.
 */

import fs from 'fs';
import path from 'path';
import { KRX_HOLIDAY_PATCH_FILE, DATA_DIR } from './paths.js';

export interface KrxHolidayPatchEntry {
  /** YYYY-MM-DD KST */
  date: string;
  /** '신정' / '설날' / 임시공휴일 등 */
  reason: string;
  /** ISO timestamp 추가 시각 */
  addedAt: string;
  /** 추가 출처 — 'manual' (수동 편집) / 'audit' (감사 cron 자동) / 'sync' (외부 API 자동, 향후) */
  addedBy: 'manual' | 'audit' | 'sync';
}

interface PatchFile {
  schemaVersion: number;
  entries: KrxHolidayPatchEntry[];
}

const SCHEMA_VERSION = 1;

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readRaw(): PatchFile {
  ensureDir();
  if (!fs.existsSync(KRX_HOLIDAY_PATCH_FILE)) {
    return { schemaVersion: SCHEMA_VERSION, entries: [] };
  }
  try {
    const content = fs.readFileSync(KRX_HOLIDAY_PATCH_FILE, 'utf-8');
    const parsed = JSON.parse(content) as PatchFile;
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { schemaVersion: SCHEMA_VERSION, entries: [] };
    }
    return parsed;
  } catch (e: unknown) {
    console.warn('[KrxHolidayRepo] patch 파일 손상 — 빈 Set 으로 fallback:', e instanceof Error ? e.message : e);
    return { schemaVersion: SCHEMA_VERSION, entries: [] };
  }
}

function writeRaw(data: PatchFile): void {
  ensureDir();
  const tmp = `${KRX_HOLIDAY_PATCH_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, KRX_HOLIDAY_PATCH_FILE);
}

/**
 * patch 항목들의 날짜 Set 반환 — `krxHolidays.reloadKrxHolidaySet()` 가 호출.
 * 파일 부재·손상 시 빈 Set 반환 (시스템 무중단).
 */
export function loadKrxHolidayPatch(): Set<string> {
  const data = readRaw();
  return new Set(data.entries.map((e) => e.date));
}

/** 디버깅·검증용 — 전체 entry 정보 반환. */
export function loadKrxHolidayPatchEntries(): KrxHolidayPatchEntry[] {
  return readRaw().entries.slice();
}

/**
 * patch 항목 추가. 동일 날짜 중복 시 idempotent (덮어쓰기).
 *
 * @returns 새로 추가된 항목 수 (중복 제외)
 */
export function appendKrxHolidayPatch(entries: KrxHolidayPatchEntry[]): number {
  const data = readRaw();
  const byDate = new Map<string, KrxHolidayPatchEntry>();
  for (const e of data.entries) byDate.set(e.date, e);

  let added = 0;
  for (const e of entries) {
    if (!isValidDateYmd(e.date)) {
      console.warn(`[KrxHolidayRepo] 잘못된 날짜 형식 무시: ${e.date}`);
      continue;
    }
    if (byDate.has(e.date)) {
      // idempotent — 기존 항목 덮어쓰기 (reason / addedBy 갱신 가능)
      byDate.set(e.date, e);
    } else {
      byDate.set(e.date, e);
      added += 1;
    }
  }

  const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  writeRaw({ schemaVersion: SCHEMA_VERSION, entries: sorted });
  return added;
}

/**
 * patch 항목 제거. 해당 날짜가 등록되어 있지 않으면 false.
 */
export function removeKrxHolidayPatchByDate(date: string): boolean {
  const data = readRaw();
  const before = data.entries.length;
  const after = data.entries.filter((e) => e.date !== date);
  if (after.length === before) return false;
  writeRaw({ schemaVersion: SCHEMA_VERSION, entries: after });
  return true;
}

/** 테스트용 — patch 파일 초기화. */
export function __resetKrxHolidayPatchForTests(): void {
  if (fs.existsSync(KRX_HOLIDAY_PATCH_FILE)) {
    fs.rmSync(KRX_HOLIDAY_PATCH_FILE);
  }
}

function isValidDateYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// path import only used by const at top; keep tree-shake friendly
void path;
