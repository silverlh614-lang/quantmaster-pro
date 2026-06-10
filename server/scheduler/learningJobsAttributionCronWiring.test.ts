// @responsibility ADR-0174 Phase 2b — safety_gate_attribution / shadow_live_delta_report 일일 cron wiring 정적 가드
/**
 * learningJobsAttributionCronWiring.test.ts (PENDING_WIRING A12+A13 wiring)
 *
 * `learningJobs.ts` 의 ADR-0174 분석 cron 2건 등록 정적 검증:
 *   - safety_gate_attribution  — KST 평일 16:40 (UTC 07:40) + TRADING_DAY_ONLY
 *   - shadow_live_delta_report — KST 평일 16:45 (UTC 07:45) + TRADING_DAY_ONLY
 *
 * 핵심 invariant:
 *   1. ENV gate 첫 분기 (`isSafetyGateAttributionEnabled` / `isShadowVsLiveDeltaEnabled`)
 *      — default OFF 시 cron 본문 runtime byte-equivalent (compute 호출 0건)
 *   2. enqueueOnSkip 비전달 — stateless 재계산 분석이라 replay 무의미 (의도)
 *   3. KIS 주문 함수 import 0건 (학습 cron 절대 규칙)
 *   4. scheduleCatalog 등재 (jobName 정합)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.resolve(__dirname, 'learningJobs.ts');
const CATALOG_PATH = path.resolve(__dirname, 'scheduleCatalog.ts');

function loadSource(): string {
  return fs.readFileSync(SOURCE_PATH, 'utf-8');
}

/** 주석 strip — false positive 차단 (learningJobsCronWiring.test.ts 패턴 차용). */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

/** jobName 등장 후 첫 `});` 까지 region 발췌 (cron 본문 + options). */
function extractCronRegion(src: string, jobName: string): string {
  const code = stripComments(src);
  const jobIdx = code.indexOf(`'${jobName}'`);
  if (jobIdx < 0) return '';
  const slice = code.slice(jobIdx);
  const closeIdx = slice.indexOf('});');
  if (closeIdx < 0) return '';
  return slice.slice(0, closeIdx + 3);
}

describe('ADR-0174 Phase 2b — 분석 cron 2건 wiring 정적 가드', () => {
  it('1. safety_gate_attribution cron 등록 — TRADING_DAY_ONLY + 40 7 * * 1-5 (KST 16:40)', () => {
    const code = stripComments(loadSource());
    expect(code).toMatch(
      /scheduledJob\(\s*['"]40 7 \* \* 1-5['"]\s*,\s*['"]TRADING_DAY_ONLY['"]\s*,\s*['"]safety_gate_attribution['"]/,
    );
  });

  it('2. shadow_live_delta_report cron 등록 — TRADING_DAY_ONLY + 45 7 * * 1-5 (KST 16:45)', () => {
    const code = stripComments(loadSource());
    expect(code).toMatch(
      /scheduledJob\(\s*['"]45 7 \* \* 1-5['"]\s*,\s*['"]TRADING_DAY_ONLY['"]\s*,\s*['"]shadow_live_delta_report['"]/,
    );
  });

  it('3. safety_gate_attribution — ENV gate 첫 분기 (default OFF → compute 호출 0건 noop)', () => {
    const region = extractCronRegion(loadSource(), 'safety_gate_attribution');
    // 첫 statement 가 ENV gate early-return — compute 호출보다 *앞* 위치
    const gateIdx = region.indexOf('if (!isSafetyGateAttributionEnabled()) return;');
    const computeIdx = region.indexOf('computeSafetyGateAttribution(');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(computeIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(computeIdx);
  });

  it('4. shadow_live_delta_report — ENV gate 첫 분기 (default OFF → compute 호출 0건 noop)', () => {
    const region = extractCronRegion(loadSource(), 'shadow_live_delta_report');
    const gateIdx = region.indexOf('if (!isShadowVsLiveDeltaEnabled()) return;');
    const computeIdx = region.indexOf('computeShadowVsLiveDelta(');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(computeIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(computeIdx);
  });

  it('5. 분석 cron 2건 모두 enqueueOnSkip 비전달 (stateless 재계산 — replay 무의미 의도)', () => {
    const src = loadSource();
    for (const jobName of ['safety_gate_attribution', 'shadow_live_delta_report']) {
      const region = extractCronRegion(src, jobName);
      expect(region, `${jobName}: enqueueOnSkip 비전달 의도 위반`).not.toMatch(/enqueueOnSkip/);
    }
  });

  it('6. shadow_live_delta_report — Phase 1 영속 read 2종 입력 (shadowSignals + liveTrades)', () => {
    const region = extractCronRegion(loadSource(), 'shadow_live_delta_report');
    expect(region).toMatch(/shadowSignals\s*:\s*loadShadowLearningOnlySignals\(\)/);
    expect(region).toMatch(/liveTrades\s*:\s*loadShadowTrades\(\)/);
  });

  it('7. KIS 주문 함수 import 0건 (학습 cron 절대 규칙 — 무회귀)', () => {
    const code = stripComments(loadSource());
    expect(code).not.toMatch(/placeKisMarketOrder/);
    expect(code).not.toMatch(/placeKisSellOrder/);
    expect(code).not.toMatch(/cancelKisOrder/);
    expect(code).not.toMatch(/placeKisStopLossOrder/);
    expect(code).not.toMatch(/placeKisTakeProfitOrder/);
  });

  it('8. scheduleCatalog 등재 — jobName 2건 + ENV silentWhen 명시', () => {
    const catalog = fs.readFileSync(CATALOG_PATH, 'utf-8');
    expect(catalog).toMatch(/jobName:\s*'safety_gate_attribution'/);
    expect(catalog).toMatch(/jobName:\s*'shadow_live_delta_report'/);
    expect(catalog).toMatch(/SAFETY_GATE_ATTRIBUTION_ENABLED/);
    expect(catalog).toMatch(/SHADOW_LIVE_DELTA_REPORT_ENABLED/);
  });

  it('9. ENV 헬퍼 import — 분석 SSOT 모듈 단일 통로 (learning/ 경유)', () => {
    const src = loadSource();
    expect(src).toMatch(/from ['"]\.\.\/learning\/safetyGateAttribution\.js['"]/);
    expect(src).toMatch(/from ['"]\.\.\/learning\/shadowVsLiveDelta\.js['"]/);
  });
});
