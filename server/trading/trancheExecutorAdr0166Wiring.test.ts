/**
 * @responsibility audit-PR-520 §M2 wiring 회귀 — trancheExecutor 노출 예산 cap (isAddOnBuy=true)
 *
 * audit-PR-520 §M2: 4 wiring 모두 isAddOnBuy=false 고정이라 R3+ 추매 정책 미활성화.
 * 본 PR 이 trancheExecutor.checkPendingTranches LIVE 주문 직전에 동일 wiring 추가
 * (isAddOnBuy=true) → R3+ 추매 허용 정책 활성화.
 *
 * 정적 grep 가드 + 동작 분기 시나리오 (vi.spyOn 으로 외부 의존성 격리).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

function readSrc(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

const SRC = readSrc('server/trading/trancheExecutor.ts');

describe('audit-PR-520 §M2 — trancheExecutor 노출 예산 cap wiring', () => {
  describe('정적 grep 가드 — drift 차단', () => {
    it('applyExposureBudgetCap import 보유', () => {
      expect(SRC).toMatch(
        /import\s+\{[^}]*\bapplyExposureBudgetCap\b[^}]*\}\s+from\s+['"]\.\/sizing\/positionSizingEngineWiring\.js['"]/,
      );
    });

    it('resolveCurrentEquityExposure import 보유 (ADR-0167 SSOT)', () => {
      expect(SRC).toMatch(
        /import\s+\{[^}]*\bresolveCurrentEquityExposure\b[^}]*\}\s+from\s+['"]\.\/sizing\/currentEquityExposure\.js['"]/,
      );
    });

    it('fetchAccountBalance import 보유 (LIVE 잔고 fetch)', () => {
      expect(SRC).toMatch(
        /import\s+\{[^}]*\bfetchAccountBalance\b[^}]*\}\s+from\s+['"]\.\.\/clients\/kisClient\.js['"]/,
      );
    });

    it('computeShadowAccount import 보유 (SHADOW 잔고 fetch)', () => {
      expect(SRC).toMatch(
        /import\s+\{[^}]*\bcomputeShadowAccount\b[^}]*\}\s+from\s+['"]\.\.\/persistence\/shadowAccountRepo\.js['"]/,
      );
    });

    it('loadTradingSettings import 보유 (SHADOW startingCapital)', () => {
      expect(SRC).toMatch(
        /import\s+\{[^}]*\bloadTradingSettings\b[^}]*\}\s+from\s+['"]\.\.\/persistence\/tradingSettingsRepo\.js['"]/,
      );
    });

    it('checkPendingTranches 진입부 isLive 분기 잔고 fetch', () => {
      expect(SRC).toContain('if (isLive) {');
      expect(SRC).toContain('await fetchAccountBalance().catch(() => null)');
    });

    it('checkPendingTranches SHADOW 분기 computeShadowAccount 호출', () => {
      expect(SRC).toContain('computeShadowAccount(allShadows, startingCapital)');
    });

    it('currentEquityExposureAmount 산출 — resolveCurrentEquityExposure 사용', () => {
      expect(SRC).toContain('resolveCurrentEquityExposure(totalAssets, orderableCash, allShadows)');
    });

    it('applyExposureBudgetCap 호출 — isAddOnBuy: true 명시 (M2 핵심)', () => {
      expect(SRC).toMatch(/applyExposureBudgetCap\(\s*\{[\s\S]*?isAddOnBuy:\s*true/);
    });

    it('isAddOnBuy=false 패턴 부재 (drift 차단)', () => {
      // applyExposureBudgetCap 호출에 isAddOnBuy=false 가 들어가면 audit M2 의도 위반
      expect(SRC).not.toMatch(/applyExposureBudgetCap\(\s*\{[\s\S]*?isAddOnBuy:\s*false/);
    });

    it('cap 결과 cancel 분기 — finalQuantity ≤ 0 시 트랜치 취소', () => {
      expect(SRC).toContain("t.cancelReason = `노출 예산 cap");
      expect(SRC).toContain('exposureCap.applied && cappedQty <= 0');
    });

    it('cap 결과 quantity 축소 분기 — finalQuantity < t.quantity', () => {
      expect(SRC).toContain('exposureCap.applied && cappedQty < t.quantity');
      expect(SRC).toContain('t.quantity = cappedQty');
    });

    it('Telegram 알림 — 차단/축소 두 분기 모두 발송', () => {
      expect(SRC).toContain('[분할 매수 ${t.trancheNumber}차 취소]');
      expect(SRC).toContain('[분할 매수 ${t.trancheNumber}차 수량 축소]');
    });

    it('ADR-0166 §M2 추적 주석 존재', () => {
      expect(SRC).toMatch(/ADR-0166[^\n]*M2/);
    });

    it('audit-PR-520 추적 주석 존재', () => {
      expect(SRC).toMatch(/audit-PR-520/);
    });
  });

  describe('호출 위치 정합 — 승인 통과 후 LIVE 주문 직전', () => {
    it('applyExposureBudgetCap 가 requestBuyApproval 이후 호출', () => {
      const approvalIdx = SRC.indexOf('requestBuyApproval(');
      const capIdx = SRC.indexOf('applyExposureBudgetCap(');
      expect(approvalIdx).toBeGreaterThan(0);
      expect(capIdx).toBeGreaterThan(approvalIdx);
    });

    it('applyExposureBudgetCap 가 LIVE kisPost 직전 호출 (`if (isLive)` 분기 진입 전)', () => {
      const capIdx = SRC.indexOf('applyExposureBudgetCap(');
      // checkPendingTranches 안에는 두 isLive 사용처 (조기 잔고 분기 + LIVE 주문 분기) 가 있다.
      // 두 번째 사용처 (LIVE 주문) 직전에 cap 호출이 와야 한다.
      const livePostIdx = SRC.lastIndexOf('if (isLive) {');
      expect(capIdx).toBeGreaterThan(0);
      expect(livePostIdx).toBeGreaterThan(capIdx);
    });

    it('cap 결과 t.quantity 변경 시 LIVE 주문이 변경된 quantity 사용 (submitBuyOrder quantity: t.quantity)', () => {
      // LIVE 주문 placement 가 inline kisPost(ORD_QTY: t.quantity.toString()) 에서
      // submitBuyOrder({ ..., quantity: t.quantity }) 헬퍼(kisClient 단일 통로)로 이관됨.
      // cap mutation(t.quantity = cappedQty) 이 submitBuyOrder 호출보다 앞서므로
      // 변경된 t.quantity 가 LIVE 주문 수량으로 자연 반영된다 — intent 동일.
      const capMutationIdx = SRC.indexOf('t.quantity = cappedQty;');
      const submitIdx = SRC.indexOf('submitBuyOrder({');
      expect(capMutationIdx).toBeGreaterThan(0);
      expect(submitIdx).toBeGreaterThan(capMutationIdx);
      expect(SRC).toMatch(/submitBuyOrder\(\{[\s\S]*?quantity:\s*t\.quantity/);
    });
  });
});
