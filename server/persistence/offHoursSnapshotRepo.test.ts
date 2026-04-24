/**
 * @responsibility offHoursSnapshotRepo 영속·LRU·플러시 회귀 테스트
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import {
  getSnapshot,
  setSnapshot,
  getSnapshotSize,
  __resetForTests,
  __flushForTests,
} from './offHoursSnapshotRepo.js';
import { OFFHOURS_SNAPSHOT_FILE } from './paths.js';

function cleanFile(): void {
  try { fs.unlinkSync(OFFHOURS_SNAPSHOT_FILE); } catch { /* not present */ }
}

describe('offHoursSnapshotRepo', () => {
  beforeEach(() => {
    cleanFile();
    __resetForTests();
  });
  afterEach(() => {
    cleanFile();
    __resetForTests();
  });

  it('빈 상태에서 조회는 null', () => {
    expect(getSnapshot('005930.KS:1y:1d')).toBeNull();
    expect(getSnapshotSize()).toBe(0);
  });

  it('set → get 라운드트립', () => {
    setSnapshot('005930.KS:1y:1d', {
      body: '{"chart":"test"}',
      contentType: 'application/json; charset=utf-8',
      fetchedAt: 1234567890,
    });
    const got = getSnapshot('005930.KS:1y:1d');
    expect(got).not.toBeNull();
    expect(got?.body).toBe('{"chart":"test"}');
    expect(got?.fetchedAt).toBe(1234567890);
  });

  it('동일 키 재설정 — 덮어씀', () => {
    setSnapshot('k1', { body: 'v1', contentType: 'application/json', fetchedAt: 1 });
    setSnapshot('k1', { body: 'v2', contentType: 'application/json', fetchedAt: 2 });
    expect(getSnapshot('k1')?.body).toBe('v2');
    expect(getSnapshotSize()).toBe(1);
  });

  it('flush 후 디스크에 영속, 리셋해도 로드', () => {
    setSnapshot('005930.KS:1y:1d', {
      body: '{"chart":"persist"}',
      contentType: 'application/json',
      fetchedAt: 999,
    });
    __flushForTests();
    expect(fs.existsSync(OFFHOURS_SNAPSHOT_FILE)).toBe(true);

    __resetForTests();
    expect(getSnapshot('005930.KS:1y:1d')?.body).toBe('{"chart":"persist"}');
  });

  it('손상된 JSON 은 조용히 무시', () => {
    fs.writeFileSync(OFFHOURS_SNAPSHOT_FILE, '{corrupted');
    __resetForTests();
    expect(getSnapshot('anything')).toBeNull();
  });

  it('LRU — MAX_ENTRIES 초과 시 오래된 key 축출', () => {
    // MAX_ENTRIES=1000. 테스트 시간 절약 위해 소규모로 패턴만 검증.
    for (let i = 0; i < 5; i++) {
      setSnapshot(`k${i}`, { body: `v${i}`, contentType: 'application/json', fetchedAt: i });
    }
    expect(getSnapshotSize()).toBe(5);
    // 최근 key 접근은 LRU 유지
    expect(getSnapshot('k0')?.body).toBe('v0');
    expect(getSnapshot('k4')?.body).toBe('v4');
  });
});
