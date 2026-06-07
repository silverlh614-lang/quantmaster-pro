// @responsibility hotfix 회귀 — probeFred 가 잘못된 FRED_API_BASE 에서 throw 하지 않고 BAD_FRED_API_BASE 반환.
//
// 배경: FRED_BASE 는 모듈 로드 시점 const 라 env 를 바꾸려면 resetModules + 동적 import 필요.
// probeFred 의 `new URL(FRED_BASE)` 가 try 밖에 있어, 릴레이 URL 오타 시 진단 명령이 조용히 죽던 버그.
import { describe, it, expect, afterEach, vi } from 'vitest';

const ORIG_BASE = process.env.FRED_API_BASE;
const ORIG_KEY = process.env.FRED_API_KEY;
const ORIG_DISABLED = process.env.FRED_API_DISABLED;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('FRED_API_BASE', ORIG_BASE);
  restore('FRED_API_KEY', ORIG_KEY);
  restore('FRED_API_DISABLED', ORIG_DISABLED);
  vi.resetModules();
});

describe('probeFred — FRED_API_BASE robustness (hotfix)', () => {
  it('프로토콜 없는 잘못된 base → BAD_FRED_API_BASE 반환 (throw 안 함)', async () => {
    process.env.FRED_API_KEY = 'test-key-1234567890';
    process.env.FRED_API_BASE = 'fred-relay.example.workers.dev'; // https:// 누락 = 흔한 오타
    delete process.env.FRED_API_DISABLED;
    vi.resetModules();
    const { probeFred } = await import('./fredClient.js');
    const r = await probeFred();
    expect(r.error).toContain('BAD_FRED_API_BASE');
    expect(r.reachedNetwork).toBe(false);
    // 키는 base 에 없으므로 에러에 노출되지 않는다.
    expect(r.error).not.toContain('test-key-1234567890');
  });

  it('따옴표가 섞인 base → BAD_FRED_API_BASE 반환', async () => {
    process.env.FRED_API_KEY = 'test-key-1234567890';
    process.env.FRED_API_BASE = '"https://fred-relay.example.workers.dev"'; // Railway 따옴표 실수
    delete process.env.FRED_API_DISABLED;
    vi.resetModules();
    const { probeFred } = await import('./fredClient.js');
    const r = await probeFred();
    expect(r.error).toContain('BAD_FRED_API_BASE');
    expect(r.reachedNetwork).toBe(false);
  });

  it('공백/빈문자열 base → default 폴백 (trim → default, BAD 아님)', async () => {
    // DISABLED 로 short-circuit → 네트워크 없이 FRED_BASE const 해석값(r.base)만 검증.
    process.env.FRED_API_KEY = 'test-key-1234567890';
    process.env.FRED_API_BASE = '   '; // 공백만 → trim 후 빈문자열 → || default
    process.env.FRED_API_DISABLED = 'true';
    vi.resetModules();
    const { probeFred } = await import('./fredClient.js');
    const r = await probeFred();
    expect(r.base).toBe('https://api.stlouisfed.org'); // trim+fallback 정상
    expect(r.error ?? '').not.toContain('BAD_FRED_API_BASE');
  });
});
