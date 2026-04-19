/**
 * sectorMap.ts — 종목 코드 → 섹터 결정적 조회 모듈
 *
 * @responsibility "코드 → 섹터" 매핑 한 가지 책임만 수행한다. 외부 데이터 수집은
 * scripts/updateSectorMap.ts, 세분화된 수동 매핑은 pipelineHelpers.ts::SECTOR_MAP 가
 * 각각 담당한다.
 *
 * 조회 우선순위:
 *   1) 수동 오버라이드 (SECTOR_MAP) — 세분화(반도체소재/반도체장비 등)
 *   2) KRX 자동 스냅샷 (data/krx-sector-map.json) — KOSPI·KOSDAQ 전종목 대분류
 *   3) '미분류' — 위 둘 모두 누락된 신규 상장주 등
 *
 * 이 구조로 Stage 3 프롬프트에 '미분류' 종목이 거의 남지 않아 Gemini 섹터 재추론이
 * 사실상 0건이 된다. 동시에 수동 SECTOR_MAP 이 상위 우선순위이므로 세분화 손실이 없다.
 */

import fs from 'fs';
import path from 'path';
import { SECTOR_MAP as MANUAL_OVERRIDES } from './pipelineHelpers.js';

const DATA_DIR = process.env.PERSIST_DATA_DIR
  ? path.resolve(process.env.PERSIST_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

const KRX_MAP_PATH = path.join(DATA_DIR, 'krx-sector-map.json');

// ── mtime 기반 캐시 ───────────────────────────────────────────────────────────
// updateSectorMap.ts 가 파일을 교체(rename) 하면 mtime 이 변하므로 자동 무효화된다.

let _cache: Record<string, string> | null = null;
let _mtimeMs = 0;
let _missingWarned = false;

function loadKrxMap(): Record<string, string> {
  try {
    const stat = fs.statSync(KRX_MAP_PATH);
    if (_cache && stat.mtimeMs === _mtimeMs) return _cache;

    const raw = fs.readFileSync(KRX_MAP_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('krx-sector-map.json 형식 오류 — 객체 아님');
    }
    _cache = parsed as Record<string, string>;
    _mtimeMs = stat.mtimeMs;
    return _cache;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      if (!_missingWarned) {
        console.warn('[SectorMap] data/krx-sector-map.json 없음 — `npx tsx scripts/updateSectorMap.ts` 실행 필요. 수동 오버라이드만 적용.');
        _missingWarned = true;
      }
    } else {
      console.error('[SectorMap] 읽기/파싱 실패:', err.message);
    }
    // 이전 캐시가 있으면 유지, 없으면 빈 객체. mtime 은 0 으로 리셋해서 다음 호출에 재시도.
    _mtimeMs = 0;
    return _cache ?? {};
  }
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 종목 코드로 섹터를 조회한다. 입력은 4~6자리 숫자이며 내부에서 6자리로 zero-pad 된다.
 * 우선순위: 수동 오버라이드 > KRX 자동맵 > '미분류'.
 */
export function getSectorByCode(code: string | undefined | null): string {
  if (!code) return '미분류';
  const trimmed = String(code).trim();
  if (!trimmed) return '미분류';
  const normalized = trimmed.padStart(6, '0');
  const manual = MANUAL_OVERRIDES[normalized];
  if (manual) return manual;
  const krxMap = loadKrxMap();
  return krxMap[normalized] ?? '미분류';
}

/** 테스트/핫스왑용 — 캐시 강제 무효화. */
export function invalidateSectorMapCache(): void {
  _cache = null;
  _mtimeMs = 0;
  _missingWarned = false;
}

export interface SectorMapStats {
  manualOverrides: number;
  krxAutoMap:      number;
  totalCoverage:   number;
  krxMapLoaded:    boolean;
}

/** 운영 지표 — 커버리지 및 파일 로드 여부 확인. */
export function getSectorMapStats(): SectorMapStats {
  const krxMap = loadKrxMap();
  const krxCount = Object.keys(krxMap).length;
  const manualCount = Object.keys(MANUAL_OVERRIDES).length;
  const union = new Set<string>([...Object.keys(MANUAL_OVERRIDES), ...Object.keys(krxMap)]);
  return {
    manualOverrides: manualCount,
    krxAutoMap:      krxCount,
    totalCoverage:   union.size,
    krxMapLoaded:    krxCount > 0,
  };
}
