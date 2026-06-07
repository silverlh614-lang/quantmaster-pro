// @responsibility ADR-0583 — deriveMhsDegrade 진리표 + isMhsDegradeGuardEnabled flag 회귀.
import { describe, it, expect, afterEach } from 'vitest';
import { deriveMhsDegrade, isMhsDegradeGuardEnabled } from './mhsDegrade.js';

describe('deriveMhsDegrade — MHS 소스 저하 판정 SSOT (ADR-0583)', () => {
  it('양쪽 정상 → FULL, degraded=false', () => {
    expect(deriveMhsDegrade({ ecos: true, fred: true })).toEqual({
      sourcesOk: { ecos: true, fred: true },
      confidence: 'FULL',
      degraded: false,
    });
  });

  it('fred 결손 → PARTIAL, degraded=true (실측 시나리오: 배포지 egress 차단)', () => {
    expect(deriveMhsDegrade({ ecos: true, fred: false })).toEqual({
      sourcesOk: { ecos: true, fred: false },
      confidence: 'PARTIAL',
      degraded: true,
    });
  });

  it('ecos 결손 → PARTIAL, degraded=true', () => {
    expect(deriveMhsDegrade({ ecos: false, fred: true })).toEqual({
      sourcesOk: { ecos: false, fred: true },
      confidence: 'PARTIAL',
      degraded: true,
    });
  });

  it('전면 결손 → FALLBACK, degraded=true (computeMacroIndex MHS 50 폴백 상태)', () => {
    expect(deriveMhsDegrade({ ecos: false, fred: false })).toEqual({
      sourcesOk: { ecos: false, fred: false },
      confidence: 'FALLBACK',
      degraded: true,
    });
  });
});

describe('isMhsDegradeGuardEnabled — flag default OFF (ADR-0583 Phase B)', () => {
  const original = process.env.MHS_DEGRADE_GUARD_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.MHS_DEGRADE_GUARD_ENABLED;
    else process.env.MHS_DEGRADE_GUARD_ENABLED = original;
  });

  it('미설정 → false (default OFF, byte-identical)', () => {
    delete process.env.MHS_DEGRADE_GUARD_ENABLED;
    expect(isMhsDegradeGuardEnabled()).toBe(false);
  });

  it("'false' → false", () => {
    process.env.MHS_DEGRADE_GUARD_ENABLED = 'false';
    expect(isMhsDegradeGuardEnabled()).toBe(false);
  });

  it("임의값('1') → false (정확히 'true' 만 활성)", () => {
    process.env.MHS_DEGRADE_GUARD_ENABLED = '1';
    expect(isMhsDegradeGuardEnabled()).toBe(false);
  });

  it("'true' → true (명시 활성)", () => {
    process.env.MHS_DEGRADE_GUARD_ENABLED = 'true';
    expect(isMhsDegradeGuardEnabled()).toBe(true);
  });
});
