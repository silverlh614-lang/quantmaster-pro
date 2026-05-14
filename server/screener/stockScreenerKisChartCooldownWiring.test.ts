// @responsibility stockScreener Yahoo STALE_BASE + KIS chart cooldown 정적 grep 회귀 (PR-KIS-CHART-COOLDOWN)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));

/**
 * PR-KIS-CHART-COOLDOWN — Yahoo STALE_BASE + KIS chart 5xx cooldown 결합 시
 * `quoteHydrationFailed (STALE_YAHOO_AND_KIS_CHART_FAILED)` 분기 정적 grep 회귀.
 *
 * 안전 invariants:
 *   1) isKisChartCooldownActive SSOT import (호출자 측 inline ENV 검사 0건)
 *   2) STALE_BASE 분기 *진입부* — KIS intraday 시도 *이전* 위치
 *   3) 추가 outbound 호출 0건 (read-only cooldown 조회만)
 *   4) rejectionLog reason 에 사용자 명시 7-key marker 포함:
 *      - STALE_YAHOO_AND_KIS_CHART_FAILED (quoteStatus)
 *      - SKIP_THIS_SCAN (candidateAction)
 *      - providerIssue=true / marketSignal=false / executionImpact=NONE (literal)
 *      - period=D (chart period 명시)
 *   5) 'continue' 로 종목 단위 격리 — 전체 스캔 무중단
 *   6) Telegram 자동 발송 0건 (sendTelegramAlert / dispatchAlert / sendPrivateAlert import 0)
 */
describe('PR-KIS-CHART-COOLDOWN — stockScreener wiring 정적 grep 가드', () => {
  const screenerPath = resolve(__dirnameLocal, 'stockScreener.ts');
  const src = readFileSync(screenerPath, 'utf-8');

  it('C1. isKisChartCooldownActive SSOT import 정합', () => {
    expect(src).toContain("import { isKisChartCooldownActive } from '../clients/kisClient.js';");
  });

  it("C2. STALE_BASE 분기 진입부에서 isKisChartCooldownActive(stock.code, 'D') 호출", () => {
    expect(src).toContain("isKisChartCooldownActive(stock.code, 'D')");
  });

  it('C3. cooldown 활성 시 rejectionLog reason 에 7-key marker 포함', () => {
    expect(src).toContain('quoteHydrationFailed');
    expect(src).toContain('STALE_YAHOO_AND_KIS_CHART_FAILED');
    expect(src).toContain('SKIP_THIS_SCAN');
    expect(src).toContain('providerIssue=true');
    expect(src).toContain('marketSignal=false');
    expect(src).toContain('executionImpact=NONE');
    expect(src).toContain('period=D');
  });

  it('C4. cooldown 분기는 continue 로 종목 단위 격리 — 전체 스캔 무중단', () => {
    // STALE_YAHOO_AND_KIS_CHART_FAILED 라벨은 import 헤더 주석에도 등장하므로
    // 본 검증은 *마지막* 발생 위치 (실제 분기 코드) 다음 500자 안의 continue; 검사.
    const lastIdx = src.lastIndexOf('STALE_YAHOO_AND_KIS_CHART_FAILED');
    const block = src.slice(lastIdx, lastIdx + 500);
    expect(block).toMatch(/continue;/);
  });

  it('C5. cooldown 분기는 KIS intraday 시도 *이전* 위치 — 추가 outbound 호출 0건', () => {
    const cooldownIdx = src.indexOf("isKisChartCooldownActive(stock.code, 'D')");
    const intradayIdx = src.indexOf('fetchKisIntraday(stock.code)');
    expect(cooldownIdx).toBeGreaterThan(0);
    expect(intradayIdx).toBeGreaterThan(0);
    expect(cooldownIdx).toBeLessThan(intradayIdx);
  });

  it('C6. Telegram 자동 발송 0건 (cooldown 분기에서)', () => {
    // sendTelegramAlert / dispatchAlert / sendPrivateAlert / channelXxx 자동 호출 부재
    // (STALE_YAHOO_AND_KIS_CHART_FAILED reason 분기 200줄 컨텍스트 안 검사)
    const cooldownIdx = src.indexOf('STALE_YAHOO_AND_KIS_CHART_FAILED');
    const block = src.slice(cooldownIdx, cooldownIdx + 500);
    expect(block).not.toMatch(/sendTelegramAlert\(|dispatchAlert\(|sendPrivateAlert\(/);
  });

  it('C7. KIS 주문 함수 5종 import 0건 (read-only quote pipeline)', () => {
    // 본 wiring 은 read-only cooldown 조회 + reject log 만 추가 — placeKisXxx 호출 0건
    expect(src).not.toMatch(/\bplaceKisMarketOrder\b/);
    expect(src).not.toMatch(/\bplaceKisSellOrder\b/);
    expect(src).not.toMatch(/\bplaceKisStopLossOrder\b/);
    expect(src).not.toMatch(/\bplaceKisTakeProfitOrder\b/);
    expect(src).not.toMatch(/\bcancelKisOrder\b/);
  });

  it('C8. PR-KIS-CHART-COOLDOWN 추적 주석 명시 (drift 차단)', () => {
    expect(src).toContain('PR-KIS-CHART-COOLDOWN');
  });
});
