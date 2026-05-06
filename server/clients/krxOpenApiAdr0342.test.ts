// @responsibility ADR-0342 fetchIndexDaily 빈 응답 자동 재시도 회귀 (정적 grep 가드)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isKrxAutoRetryOnEmptyDisabled } from './krxOpenApi.js';

const SOURCE = readFileSync(
  resolve(__dirname, 'krxOpenApi.ts'),
  'utf-8',
);

describe('isKrxAutoRetryOnEmptyDisabled — ENV 정확 비교 (ADR-0342)', () => {
  const ORIGINAL = process.env.KRX_AUTO_RETRY_ON_EMPTY_DISABLED;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.KRX_AUTO_RETRY_ON_EMPTY_DISABLED;
    else process.env.KRX_AUTO_RETRY_ON_EMPTY_DISABLED = ORIGINAL;
  });

  it('미설정 → false (default 자동 재시도 활성)', () => {
    delete process.env.KRX_AUTO_RETRY_ON_EMPTY_DISABLED;
    expect(isKrxAutoRetryOnEmptyDisabled()).toBe(false);
  });

  it('"true" → true (재시도 비활성)', () => {
    process.env.KRX_AUTO_RETRY_ON_EMPTY_DISABLED = 'true';
    expect(isKrxAutoRetryOnEmptyDisabled()).toBe(true);
  });

  it('"1" / "TRUE" → false (정확 비교)', () => {
    process.env.KRX_AUTO_RETRY_ON_EMPTY_DISABLED = '1';
    expect(isKrxAutoRetryOnEmptyDisabled()).toBe(false);
    process.env.KRX_AUTO_RETRY_ON_EMPTY_DISABLED = 'TRUE';
    expect(isKrxAutoRetryOnEmptyDisabled()).toBe(false);
  });
});

import { afterEach } from 'vitest';

describe('fetchIndexDaily 정적 가드 (ADR-0342)', () => {
  it('retryDepth 시그니처 추가', () => {
    expect(SOURCE).toMatch(/retryDepth:\s*number\s*=\s*0/);
  });

  it('KRX_INDEX_RETRY_MAX = 5 상수 SSOT', () => {
    expect(SOURCE).toMatch(/KRX_INDEX_RETRY_MAX\s*=\s*5/);
  });

  it('previousBusinessDayYyyymmdd 헬퍼 정의', () => {
    expect(SOURCE).toMatch(/function\s+previousBusinessDayYyyymmdd/);
  });

  it('빈 응답 + retryDepth < MAX 시 재귀 호출', () => {
    expect(SOURCE).toMatch(/out\.length\s*===\s*0[\s\S]{0,200}KRX_INDEX_RETRY_MAX/);
    expect(SOURCE).toMatch(/return\s+fetchIndexDaily\([^)]*retryDepth\s*\+\s*1\)/);
  });

  it('재시도 시 ENV 우회 분기', () => {
    expect(SOURCE).toMatch(/!isKrxAutoRetryOnEmptyDisabled\(\)/);
  });

  it('fetchStockDaily 도 동일 재시도 적용 (사용자 추가 요청 — 설날/추석 대응)', () => {
    expect(SOURCE).toMatch(/async\s+function\s+fetchStockDaily[\s\S]{0,500}retryDepth:\s*number\s*=\s*0/);
    expect(SOURCE).toMatch(/KRX_STOCK_RETRY_MAX\s*=\s*5/);
    // fetchStockDaily 의 재귀 호출도 존재
    expect(SOURCE).toMatch(/return\s+fetchStockDaily\([^)]*retryDepth\s*\+\s*1\)/);
  });

  it('이전 거래일 동일 시 무한 루프 차단 (basDd 비교)', () => {
    expect(SOURCE).toMatch(/prevYyyymmdd\s*!==\s*basDd/);
  });

  it('재시도 진단 로그에 ADR-0342 마커 + depth 표기', () => {
    expect(SOURCE).toMatch(/ADR-0342[\s\S]{0,100}retry/);
    expect(SOURCE).toMatch(/depth=/);
  });

  it('previousKrxTradingDay (krxTradingCalendar SSOT) import 사용', () => {
    expect(SOURCE).toMatch(/from\s+'\.\.\/calendar\/krxTradingCalendar/);
    expect(SOURCE).toMatch(/previousKrxTradingDay/);
  });

  it('retryDepth=0 default — 호출자 무수정 후방호환', () => {
    // export 시그니처 자체는 retryDepth 미노출 (private async 함수)
    // 외부 export 함수 (fetchKospiIndexDaily 등) 는 date?: string 만 노출
    expect(SOURCE).toMatch(/export\s+function\s+fetchKospiIndexDaily\s*\(\s*date\?:\s*string\s*\)/);
  });

  it('isValidYyyymmdd 가드 — 잘못된 입력 → null fallback', () => {
    expect(SOURCE).toMatch(/if\s*\(!isValidYyyymmdd\(yyyymmdd\)\)\s*return\s+null/);
  });

  it('빈 응답 캐시 미저장 (재시도 가치 보존)', () => {
    expect(SOURCE).toMatch(/if\s*\(out\.length\s*>\s*0\)\s*cacheSet/);
  });
});
