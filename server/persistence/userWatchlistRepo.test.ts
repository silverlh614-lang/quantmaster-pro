/**
 * userWatchlistRepo.test.ts — 관심종목 서버 영속화 계약 테스트.
 *
 * load/save 라운드트립, toggle, remove, 최대 용량 트림.
 * (paths.ts 의 DATA_DIR 은 첫 import 시점에 frozen 되므로 shadowTradeRepo.test 와
 *  동일하게 repo 메서드를 통해서만 상태를 조작한다.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('userWatchlistRepo', () => {
  let tmpDir: string;
  let repo: typeof import('./userWatchlistRepo.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-wl-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    repo = await import('./userWatchlistRepo.js');
    // 이전 테스트 잔존 상태 제거 (DATA_DIR 은 frozen 이지만 같은 파일을 쓰므로 매번 reset).
    repo.saveUserWatchlist([]);
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('reset 이후 load 는 빈 배열', () => {
    expect(repo.loadUserWatchlist()).toEqual([]);
  });

  it('save → load 라운드트립 유지', () => {
    repo.saveUserWatchlist([
      { code: '005930', name: '삼성전자', watchedAt: '2026-04-24', watchedPrice: 70000 },
      { code: '035420', name: 'NAVER',   watchedAt: '2026-04-24' },
    ]);
    const loaded = repo.loadUserWatchlist();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.code).toBe('005930');
    expect(loaded[1]?.name).toBe('NAVER');
  });

  it('toggle 으로 없던 종목을 추가하면 ADDED 리턴 + watchedAt 자동 채움', () => {
    const res = repo.toggleUserWatchlistItem({
      code: '005930', name: '삼성전자', watchedAt: '',
    });
    expect(res.action).toBe('ADDED');
    expect(res.list).toHaveLength(1);
    expect(res.list[0]?.watchedAt).toBeTruthy();
  });

  it('toggle 을 두 번 호출하면 REMOVED', () => {
    repo.toggleUserWatchlistItem({ code: '005930', name: '삼성전자', watchedAt: '' });
    const res = repo.toggleUserWatchlistItem({ code: '005930', name: '삼성전자', watchedAt: '' });
    expect(res.action).toBe('REMOVED');
    expect(res.list).toHaveLength(0);
  });

  it('removeUserWatchlistItem 은 없는 코드에 대해 removed=false', () => {
    const res = repo.removeUserWatchlistItem('999999');
    expect(res.removed).toBe(false);
  });

  it('removeUserWatchlistItem 은 있는 코드를 지우고 removed=true', () => {
    repo.saveUserWatchlist([
      { code: '005930', name: '삼성전자', watchedAt: '' },
      { code: '035420', name: 'NAVER',   watchedAt: '' },
    ]);
    const res = repo.removeUserWatchlistItem('005930');
    expect(res.removed).toBe(true);
    expect(res.list).toHaveLength(1);
    expect(res.list[0]?.code).toBe('035420');
  });

  it('code 나 name 이 누락된 항목은 save 시점에 필터링', () => {
    const invalidInputs = [
      { code: '005930', name: '삼성전자', watchedAt: '' },
      { code: '',       name: '빈코드',   watchedAt: '' },
      { name: '코드없음', watchedAt: '' },
    ] as unknown as Array<{ code: string; name: string; watchedAt: string }>;
    repo.saveUserWatchlist(invalidInputs);
    const loaded = repo.loadUserWatchlist();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.code).toBe('005930');
  });

  it('500 개 초과 저장 시도는 최대 500 개로 트림', () => {
    const big: Array<{ code: string; name: string; watchedAt: string }> = [];
    for (let i = 0; i < 600; i++) {
      big.push({ code: String(i).padStart(6, '0'), name: `종목${i}`, watchedAt: '' });
    }
    repo.saveUserWatchlist(big);
    const loaded = repo.loadUserWatchlist();
    expect(loaded.length).toBe(500);
    // 뒤쪽 500 개가 남아야 함 (slice(-500)).
    expect(loaded[0]?.code).toBe('000100');
    expect(loaded[499]?.code).toBe('000599');
  });
});
