// @responsibility macro source probe(FRED/ECOS) no-key 분기 + 키 redact 회귀 (결정론·fetch mock, 실네트워크 0).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { probeFred } from './fredClient.js';
import { probeEcos } from './ecosClient.js';

const savedFred = process.env.FRED_API_KEY;
const savedEcos = process.env.ECOS_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  if (savedFred === undefined) delete process.env.FRED_API_KEY; else process.env.FRED_API_KEY = savedFred;
  if (savedEcos === undefined) delete process.env.ECOS_API_KEY; else process.env.ECOS_API_KEY = savedEcos;
});

describe('macro source probe — no-key branch (no network)', () => {
  it('probeFred: 키 없으면 hasKey=false·미접촉·사유 반환 (fetch 안 함)', async () => {
    delete process.env.FRED_API_KEY;
    const r = await probeFred();
    expect(r.source).toBe('FRED');
    expect(r.hasKey).toBe(false);
    expect(r.reachedNetwork).toBe(false);
    expect(r.httpStatus).toBeNull();
    expect(r.error).toContain('FRED_API_KEY');
  });

  it('probeEcos: 키 없으면 hasKey=false·미접촉·사유 반환 (fetch 안 함)', async () => {
    delete process.env.ECOS_API_KEY;
    const r = await probeEcos();
    expect(r.source).toBe('ECOS');
    expect(r.hasKey).toBe(false);
    expect(r.reachedNetwork).toBe(false);
    expect(r.httpStatus).toBeNull();
    expect(r.error).toContain('ECOS_API_KEY');
  });

  it('redact 계약: HTTP 오류 본문에 키가 echo 돼도 결과에 원문 키 미포함 (fetch mock)', async () => {
    const KEY = 'SECRET_FRED_KEY_1234567890ABCDEF';
    process.env.FRED_API_KEY = KEY;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(`Bad Request. api_key ${KEY} is not registered`, { status: 400 }),
    );
    const r = await probeFred();
    expect(r.httpStatus).toBe(400);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(r.errorBody).toContain('***');
  });
});
