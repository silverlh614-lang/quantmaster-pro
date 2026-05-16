// @responsibility KIS chart symbol+period cooldown 공개 SSOT 회귀 (PR-KIS-CHART-COOLDOWN)
import { describe, it, expect, beforeEach } from 'vitest';
import { isKisChartCooldownActive } from './http.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));

/**
 * PR-KIS-CHART-COOLDOWN — http.ts 의 _realData5xxCooldownUntil Map 내부 상태에
 * 의존하지 않고 *공개 API 시그니처* 와 *barrel 등록* 을 정적 grep 가드로 검증한다.
 *
 * 안전 invariants:
 *   1) isKisChartCooldownActive(symbol, period?) 시그니처 export
 *   2) trId 인자 미노출 — 호출자 측 trId 하드코딩 차단 (FHKST03010100 SSOT 위임)
 *   3) period default 'D' (가장 흔한 daily candle cooldown)
 *   4) symbol padStart(6, '0') 정규화 (호출자 측 inline padStart 0건)
 *   5) 6자리 외 invalid symbol → false 반환 (sanity)
 *   6) barrel index.ts re-export 정합 (외부 소비자 import 경로 일관)
 *   7) KIS 주문 함수 5종 import 0건 (read-only query helper)
 */
describe('PR-KIS-CHART-COOLDOWN — public SSOT 시그니처 + barrel 등록', () => {
  beforeEach(() => {
    // 모듈 cache 격리는 본 테스트가 동작 검증이 아닌 정적 grep 만 수행하므로 불필요.
  });

  it('A1. http.ts 가 isKisChartCooldownActive 공개 export 보유', () => {
    const httpPath = resolve(__dirnameLocal, 'http.ts');
    const src = readFileSync(httpPath, 'utf-8');
    expect(src).toContain('export function isKisChartCooldownActive(');
    expect(src).toContain("period: 'D' | 'W' | 'M' = 'D'");
    expect(src).toContain("purpose = 'DISCOVERY'");
  });

  it('A2. 시그니처가 trId 인자 노출 0건 — FHKST03010100 SSOT 위임', () => {
    const httpPath = resolve(__dirnameLocal, 'http.ts');
    const src = readFileSync(httpPath, 'utf-8');
    // 공개 export 시그니처 라인에 trId 매개변수 없음
    expect(src).toMatch(
      /export function isKisChartCooldownActive\([\s\S]*symbol: string,[\s\S]*period: 'D' \| 'W' \| 'M' = 'D',[\s\S]*purpose = 'DISCOVERY',[\s\S]*\)/,
    );
  });

  it('A3. 내부에서 trId=KIS_CHART_TR_ID 자동 주입 — 호출자 측 하드코딩 차단', () => {
    const httpPath = resolve(__dirnameLocal, 'http.ts');
    const src = readFileSync(httpPath, 'utf-8');
    expect(src).toContain('isKisChart5xxCooldownActive({ trId: KIS_CHART_TR_ID, symbol: padded, period, purpose })');
  });

  it('A4. symbol 6자리 padStart 정규화 — 호출자 측 inline padStart 0건', () => {
    const httpPath = resolve(__dirnameLocal, 'http.ts');
    const src = readFileSync(httpPath, 'utf-8');
    expect(src).toContain("const padded = (symbol ?? '').padStart(6, '0');");
    expect(src).toContain("if (!padded || padded.length !== 6) return false;");
  });

  it('A5. barrel index.ts 가 isKisChartCooldownActive re-export', () => {
    const indexPath = resolve(__dirnameLocal, 'index.ts');
    const src = readFileSync(indexPath, 'utf-8');
    // SSOT-aware multi-token check (export 라인 정합 — kisGet/kisPost/realDataKisGet/
    // isKisChartCooldownActive 는 필수, 추가 export 인 getKisChartCooldownRemainingMs
    // 같은 부수 함수가 같은 export 절에 합쳐져도 통과. './http.js' 경유 의무.
    expect(src).toMatch(/export\s*\{[^}]*\bkisGet\b[^}]*\}\s*from\s*['"]\.\/http\.js['"]/);
    expect(src).toMatch(/export\s*\{[^}]*\bkisPost\b[^}]*\}\s*from\s*['"]\.\/http\.js['"]/);
    expect(src).toMatch(/export\s*\{[^}]*\brealDataKisGet\b[^}]*\}\s*from\s*['"]\.\/http\.js['"]/);
    expect(src).toMatch(/export\s*\{[^}]*\bisKisChartCooldownActive\b[^}]*\}\s*from\s*['"]\.\/http\.js['"]/);
  });

  it('A6. KIS 주문 함수 5종 import 0건 (read-only query helper)', () => {
    const httpPath = resolve(__dirnameLocal, 'http.ts');
    const src = readFileSync(httpPath, 'utf-8');
    // 본 SSOT 가 placeKisMarketOrder / placeKisSellOrder / placeKisStopLossOrder /
    // placeKisTakeProfitOrder / cancelKisOrder 직접 참조 0건. http.ts 자체는 4 함수
    // (kisGet/kisPost/realDataKisGet/isKisChartCooldownActive) 만 export.
    expect(src).not.toMatch(/\bplaceKisMarketOrder\b/);
    expect(src).not.toMatch(/\bplaceKisSellOrder\b/);
    expect(src).not.toMatch(/\bplaceKisStopLossOrder\b/);
    expect(src).not.toMatch(/\bplaceKisTakeProfitOrder\b/);
    expect(src).not.toMatch(/\bcancelKisOrder\b/);
  });
});

describe('PR-KIS-CHART-COOLDOWN — runtime behavior', () => {
  it('B1. invalid symbol (빈 / 5자리 / 7자리) → false 반환', () => {
    expect(isKisChartCooldownActive('', 'D')).toBe(false);
    expect(isKisChartCooldownActive('12345', 'D')).toBe(false);
    expect(isKisChartCooldownActive('1234567', 'D')).toBe(false);
  });

  it('B2. 6자리 정상 symbol — cooldown 미설정 시 false', () => {
    expect(isKisChartCooldownActive('298380', 'D')).toBe(false);
  });

  it('B3. 5자리 symbol → padStart(6) 으로 정규화 후 동일 cooldown 키 사용', () => {
    // padStart 후 '012345' 가 되어 별도 cooldown 키. 미설정 상태에서 false.
    expect(isKisChartCooldownActive('12345', 'D')).toBe(false);
  });

  it('B4. period default = D — 인자 생략 시 daily 차트 cooldown 조회', () => {
    // period 미전달 시 fallback 'D' 적용. 서로 다른 period 는 별도 키이므로
    // D=false 라면 W/M 도 일반적으로 false (cross-pollination 0).
    expect(isKisChartCooldownActive('298380')).toBe(false);
    expect(isKisChartCooldownActive('298380', 'W')).toBe(false);
    expect(isKisChartCooldownActive('298380', 'M')).toBe(false);
  });
});
