// @responsibility reflection 모듈 일자별 meaningful 영향 영속 (ADR-0047 PR-Y2)
/**
 * reflectionImpactRepo.ts — Reflection Module Half-Life 영향 데이터 SSOT
 *
 * 사용자 원안: "반성도 비용이다."
 *
 * 13개 reflection 모듈이 각각 일자별로 meaningful 결과를 만들었는지 boolean 으로
 * 누적 영속. 정책 SSOT(`reflectionImpactPolicy.ts`) 가 본 데이터를 윈도우(180일)
 * 평균으로 환원해 silent / deprecated 자동 분기.
 *
 * 영속 구조: data/reflection-impact.json
 *   { schemaVersion: 1, records: [{ date, module, meaningful, capturedAt }, ...] }
 *
 * 1년(365일) ring buffer trim — atomic write (tmp → rename).
 */

import fs from 'fs';
import path from 'path';
import { REFLECTION_IMPACT_FILE, DATA_DIR } from './paths.js';

export interface ReflectionImpactRecord {
  /** YYYY-MM-DD KST */
  date: string;
  /** mainReflection / biasHeatmap / experimentProposal 등 */
  module: string;
  /** true = 의미 있는 권고/heatmap/narrative 생성 / false = 빈 / no-op / 임계 미달 */
  meaningful: boolean;
  /** ISO timestamp 기록 시각 */
  capturedAt: string;
}

interface ImpactFile {
  schemaVersion: number;
  records: ReflectionImpactRecord[];
}

const SCHEMA_VERSION = 1;
const RING_BUFFER_MAX_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readRaw(): ImpactFile {
  ensureDir();
  if (!fs.existsSync(REFLECTION_IMPACT_FILE)) {
    return { schemaVersion: SCHEMA_VERSION, records: [] };
  }
  try {
    const content = fs.readFileSync(REFLECTION_IMPACT_FILE, 'utf-8');
    const parsed = JSON.parse(content) as ImpactFile;
    if (!parsed || !Array.isArray(parsed.records)) {
      return { schemaVersion: SCHEMA_VERSION, records: [] };
    }
    return parsed;
  } catch (e: unknown) {
    console.warn(
      '[ReflectionImpactRepo] 영속 파일 손상 — 빈 배열 fallback:',
      e instanceof Error ? e.message : e,
    );
    return { schemaVersion: SCHEMA_VERSION, records: [] };
  }
}

function writeAtomic(data: ImpactFile): void {
  ensureDir();
  const tmp = path.join(path.dirname(REFLECTION_IMPACT_FILE), `.reflection-impact.tmp.${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, REFLECTION_IMPACT_FILE);
}

/** YYYY-MM-DD KST 형식 검증 */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseDate(s: string): Date | null {
  if (!isValidDate(s)) return null;
  const d = new Date(s + 'T00:00:00.000Z');
  return Number.isFinite(d.getTime()) ? d : null;
}

export function loadReflectionImpactRecords(): ReflectionImpactRecord[] {
  return readRaw().records.filter(
    r =>
      r &&
      typeof r.module === 'string' &&
      r.module.length > 0 &&
      typeof r.meaningful === 'boolean' &&
      isValidDate(r.date) &&
      typeof r.capturedAt === 'string',
  );
}

/**
 * 모듈 1회 실행 결과 기록 — 동일 (date, module) 중복 방지 (마지막 호출이 우선).
 *
 * 1년(365일) 이전 레코드 자동 trim.
 */
export function recordReflectionImpact(
  module: string,
  date: string,
  meaningful: boolean,
  now: Date = new Date(),
): ReflectionImpactRecord {
  if (!module || typeof module !== 'string') {
    throw new Error('module 인자 필수');
  }
  if (!isValidDate(date)) {
    throw new Error(`date 형식 오류 — YYYY-MM-DD 필요 (받은 값: ${date})`);
  }

  const file = readRaw();
  const records = file.records.filter(r => !(r.date === date && r.module === module));

  const cutoff = now.getTime() - RING_BUFFER_MAX_DAYS * DAY_MS;
  const trimmed = records.filter(r => {
    const d = parseDate(r.date);
    return d ? d.getTime() >= cutoff : false;
  });

  const entry: ReflectionImpactRecord = {
    date,
    module,
    meaningful,
    capturedAt: now.toISOString(),
  };
  trimmed.push(entry);

  writeAtomic({ schemaVersion: SCHEMA_VERSION, records: trimmed });
  return entry;
}

export interface ModuleStats {
  module: string;
  runs: number;
  meaningfulRuns: number;
  /** 0~1 — runs > 0 일 때만 의미 있음 */
  impactRate: number;
  /** YYYY-MM-DD — 윈도우 내 첫 등장 일자, 0건이면 null */
  firstSeenAt: string | null;
}

/**
 * 모듈의 영향률 윈도우 통계.
 *
 * @param module 'mainReflection' 등
 * @param days 윈도우 (기본 180일)
 * @param now 테스트용 시각 주입
 */
export function getModuleStats(
  module: string,
  days: number = 180,
  now: Date = new Date(),
): ModuleStats {
  const all = loadReflectionImpactRecords().filter(r => r.module === module);
  if (all.length === 0) {
    return { module, runs: 0, meaningfulRuns: 0, impactRate: 0, firstSeenAt: null };
  }

  const cutoff = now.getTime() - days * DAY_MS;
  const window = all.filter(r => {
    const d = parseDate(r.date);
    return d ? d.getTime() >= cutoff : false;
  });

  const runs = window.length;
  const meaningfulRuns = window.filter(r => r.meaningful).length;
  const impactRate = runs > 0 ? Number((meaningfulRuns / runs).toFixed(4)) : 0;

  // firstSeenAt 은 전체 데이터 (윈도우 무관) 의 가장 오래된 기록 — grace period 판정용
  const sorted = all.slice().sort((a, b) => a.date.localeCompare(b.date));
  const firstSeenAt = sorted[0]?.date ?? null;

  return { module, runs, meaningfulRuns, impactRate, firstSeenAt };
}

/** 알려진 모든 모듈의 통계 일괄 반환 (impactRate 오름차순 — 가장 silent 한 모듈 선두) */
export function getAllModuleStats(
  days: number = 180,
  now: Date = new Date(),
): ModuleStats[] {
  const records = loadReflectionImpactRecords();
  const modules = Array.from(new Set(records.map(r => r.module))).sort();
  return modules
    .map(m => getModuleStats(m, days, now))
    .sort((a, b) => a.impactRate - b.impactRate);
}

/** 테스트 격리 헬퍼 — 프로덕션 코드는 호출 금지 */
export function __resetReflectionImpactForTests(): void {
  if (fs.existsSync(REFLECTION_IMPACT_FILE)) {
    fs.unlinkSync(REFLECTION_IMPACT_FILE);
  }
}

export const REFLECTION_IMPACT_CONSTANTS = {
  SCHEMA_VERSION,
  RING_BUFFER_MAX_DAYS,
  DEFAULT_WINDOW_DAYS: 180,
} as const;
