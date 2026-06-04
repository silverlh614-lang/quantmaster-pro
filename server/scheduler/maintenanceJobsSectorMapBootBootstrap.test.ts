// @responsibility 섹터맵 부팅 부트스트랩 정적 가드 — flag default ON·비차단·결손시만·통로재사용 회귀 차단.
/**
 * maintenanceJobsSectorMapBootBootstrap.test.ts (Patch-SectorMap-Boot-Bootstrap)
 *
 * `maintenanceJobs.ts` 의 부팅 부트스트랩 정적 검증. 휘발 data/ 배포 직후 섹터맵 결손/stale 을
 * cron(주간/일일 19:00) 전까지 self-heal 하되, 다음 불변 제약을 회귀 차단한다:
 *
 *   1. registerMaintenanceJobs() 안에서 bootstrapSectorMapIfNeeded() 1회 호출.
 *   2. flag default ON — `SECTOR_MAP_BOOT_BOOTSTRAP_ENABLED === 'false'` 일 때만 비활성(opt-out).
 *   3. shouldRetrySectorMap() 결손/stale 일 때만 동작 — 최신(볼륨 영속)이면 no-op.
 *   4. setTimeout 비차단 fire-and-forget + unref — 불변식 #1(매매 엔진 boot 무차단).
 *   5. runSectorMapUpdate('boot') 재사용 — 신규 데이터 통로/raw fetch 0.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.resolve(__dirname, 'maintenanceJobs.ts');

function loadSource(): string {
  return fs.readFileSync(SOURCE_PATH, 'utf-8');
}

/** 주석 strip — false positive 차단. */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

describe('섹터맵 부팅 부트스트랩 정적 가드', () => {
  it('registerMaintenanceJobs() 안에서 bootstrapSectorMapIfNeeded() 1회 호출', () => {
    const src = stripComments(loadSource());
    // 호출문(세미콜론 종결) 정확 1건 — 정의 `bootstrapSectorMapIfNeeded(): void` 와 구분.
    const invocations = src.match(/bootstrapSectorMapIfNeeded\(\);/g) ?? [];
    expect(invocations.length).toBe(1);
    // 함수 정의 존재.
    expect(src).toMatch(/function bootstrapSectorMapIfNeeded\(\): void/);
    // registerMaintenanceJobs 본문 안쪽 호출인지 — 함수 시작 이후 위치 확인.
    const regIdx = src.indexOf('export function registerMaintenanceJobs');
    const callIdx = src.indexOf('bootstrapSectorMapIfNeeded();');
    expect(regIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(regIdx);
  });

  it('flag default ON — 정확 비교 `=== \'false\'` opt-out (미설정/true 면 동작)', () => {
    const src = stripComments(loadSource());
    expect(src).toMatch(/SECTOR_MAP_BOOT_BOOTSTRAP_ENABLED\s*===\s*'false'/);
    // default OFF 패턴(`!== 'true'`)을 쓰지 않았는지 — 부트스트랩은 default ON 이어야 갭을 메운다.
    expect(src).not.toMatch(/SECTOR_MAP_BOOT_BOOTSTRAP_ENABLED\s*!==\s*'true'/);
  });

  it('결손/stale 일 때만 동작 — shouldRetrySectorMap() 게이트', () => {
    const src = stripComments(loadSource());
    // 부트스트랩 함수 본문에 shouldRetrySectorMap 가드 존재.
    const fnStart = src.indexOf('function bootstrapSectorMapIfNeeded');
    const fnSlice = src.slice(fnStart, fnStart + 600);
    expect(fnSlice).toMatch(/if\s*\(\s*!shouldRetrySectorMap\(\)\s*\)\s*return/);
  });

  it('비차단 fire-and-forget — setTimeout + unref (불변식 #1 boot 무차단)', () => {
    const src = stripComments(loadSource());
    const fnStart = src.indexOf('function bootstrapSectorMapIfNeeded');
    const fnSlice = src.slice(fnStart, fnStart + 600);
    expect(fnSlice).toMatch(/setTimeout\(/);
    expect(fnSlice).toMatch(/\.unref\(\)/);
    expect(fnSlice).toMatch(/void runSectorMapUpdate\('boot'\)/);
  });

  it('통로 재사용 — runSectorMapUpdate 가 boot schedule 라벨 지원(신규 fetch 통로 0)', () => {
    const src = stripComments(loadSource());
    expect(src).toMatch(/'weekly'\s*\|\s*'daily-retry'\s*\|\s*'boot'/);
  });
});
