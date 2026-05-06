// @responsibility ADR-0415 STALE + PARTIAL_VOLUME STRONG_BUY 차단 동작 + union 격상 회귀 가드
/**
 * sectorEnergyStrongBuyGateAdr0415.test.ts (ADR-0415)
 *
 * ADR-0398 evaluator 의 4 조건 OR (confidence<0.6 / DEGRADED / FAILED / YAHOO_ETF) 에
 * STALE 누락 결함 차단 + PARTIAL_VOLUME 신규 조건 추가 검증.
 *
 * 사용자 명시 정책 (절대 변경 금지):
 *   - OK / PARTIAL → STRONG_BUY 허용 (forbidStrongBuy=false)
 *   - PARTIAL_VOLUME → STRONG_BUY 차단 + 일반 BUY 통과 (BUY 까지만, ADR-0415)
 *   - STALE → STRONG_BUY 차단 (ADR-0398 누락 결함 차단, ADR-0415)
 *   - DEGRADED → STRONG_BUY 차단 (ADR-0398 기존)
 *   - FAILED → STRONG_BUY 차단 (ADR-0398 기존)
 *   - YAHOO_ETF → STRONG_BUY 차단 (ADR-0398 기존)
 *
 * 안전 invariant (절대 원칙):
 *   - 일반 BUY 차단 금지 (절대 원칙 #1) — evaluator 시그니처에 forbidBuy 필드 부재
 *   - reasons 카탈로그에 사유 영속 (운영자 추적성)
 *   - SectorEnergyDataQuality5 union 6단계 (PARTIAL_VOLUME 추가, ADR-0396 호환 보존)
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  evaluateSectorEnergyStrongBuyGate,
  CONFIDENCE_GATE_THRESHOLD,
  type StrongBuyGateInput,
} from './sectorEnergyStrongBuyGate.js';
import {
  isSectorEnergyDataQuality5,
  type SectorEnergyDataQuality5,
} from '../clients/sectorEnergyDataQuality.js';

// 정상 confidence (ADR-0398 임계 0.6 통과) + KRX_CODE 출처 (YAHOO_ETF 조건 회피).
function buildHealthyInput(
  dataQuality: SectorEnergyDataQuality5,
): StrongBuyGateInput {
  return {
    confidence: 0.85,
    dataQuality,
    sourceTier: 'KRX_CODE',
  };
}

afterEach(() => {
  delete process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED;
});

describe('ADR-0415 STALE + PARTIAL_VOLUME STRONG_BUY 차단 (ADR-0398 격상)', () => {
  describe('SectorEnergyDataQuality5 union 6단계 격상', () => {
    it('PARTIAL_VOLUME 이 type guard 통과 (ADR-0415 신규)', () => {
      expect(isSectorEnergyDataQuality5('PARTIAL_VOLUME')).toBe(true);
    });

    it('기존 5단계 모두 type guard 통과 (ADR-0396 호환 보존)', () => {
      expect(isSectorEnergyDataQuality5('OK')).toBe(true);
      expect(isSectorEnergyDataQuality5('PARTIAL')).toBe(true);
      expect(isSectorEnergyDataQuality5('STALE')).toBe(true);
      expect(isSectorEnergyDataQuality5('DEGRADED')).toBe(true);
      expect(isSectorEnergyDataQuality5('FAILED')).toBe(true);
    });

    it('알 수 없는 값 type guard 차단', () => {
      expect(isSectorEnergyDataQuality5('UNKNOWN')).toBe(false);
      expect(isSectorEnergyDataQuality5('')).toBe(false);
      expect(isSectorEnergyDataQuality5(null)).toBe(false);
      expect(isSectorEnergyDataQuality5(undefined)).toBe(false);
    });
  });

  describe('STALE STRONG_BUY 차단 (ADR-0398 누락 결함 차단)', () => {
    it('STALE → forbidStrongBuy=true + reasons 에 STALE 명시', () => {
      const result = evaluateSectorEnergyStrongBuyGate(buildHealthyInput('STALE'));
      expect(result.forbidStrongBuy).toBe(true);
      expect(result.reasons.some((r) => r.includes('STALE'))).toBe(true);
    });

    it('STALE 단독 차단 — confidence 0.85 + KRX_CODE 충분 신뢰여도 STALE 만으로 차단', () => {
      const input: StrongBuyGateInput = {
        confidence: 0.85, // 임계 0.6 통과
        dataQuality: 'STALE',
        sourceTier: 'KRX_CODE', // YAHOO_ETF 조건 회피
      };
      const result = evaluateSectorEnergyStrongBuyGate(input);
      expect(result.forbidStrongBuy).toBe(true);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toMatch(/STALE/);
    });
  });

  describe('PARTIAL_VOLUME STRONG_BUY 차단 (BUY 까지만 정책)', () => {
    it('PARTIAL_VOLUME → forbidStrongBuy=true + reasons 에 PARTIAL_VOLUME 명시', () => {
      const result = evaluateSectorEnergyStrongBuyGate(
        buildHealthyInput('PARTIAL_VOLUME'),
      );
      expect(result.forbidStrongBuy).toBe(true);
      expect(result.reasons.some((r) => r.includes('PARTIAL_VOLUME'))).toBe(true);
    });

    it('PARTIAL_VOLUME 단독 차단 — confidence 충분여도 PARTIAL_VOLUME 만으로 차단', () => {
      const input: StrongBuyGateInput = {
        confidence: 0.85,
        dataQuality: 'PARTIAL_VOLUME',
        sourceTier: 'KRX_CODE',
      };
      const result = evaluateSectorEnergyStrongBuyGate(input);
      expect(result.forbidStrongBuy).toBe(true);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toMatch(/PARTIAL_VOLUME/);
    });

    it('PARTIAL_VOLUME 사유에 "BUY 까지만" 정책 안내 포함 (운영자 추적성)', () => {
      const result = evaluateSectorEnergyStrongBuyGate(
        buildHealthyInput('PARTIAL_VOLUME'),
      );
      const reason = result.reasons.find((r) => r.includes('PARTIAL_VOLUME'));
      expect(reason).toBeDefined();
      // "BUY 까지만" 명시 — 사용자 명시 정책 정합 (UI 안내 격상)
      expect(reason).toMatch(/BUY 까지만|거래량.*누락/);
    });
  });

  describe('OK / PARTIAL → STRONG_BUY 허용 (회귀 차단)', () => {
    it('OK + 정상 confidence + KRX_CODE → forbidStrongBuy=false', () => {
      const result = evaluateSectorEnergyStrongBuyGate(buildHealthyInput('OK'));
      expect(result.forbidStrongBuy).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('PARTIAL + 정상 confidence + KRX_CODE → forbidStrongBuy=false', () => {
      const result = evaluateSectorEnergyStrongBuyGate(buildHealthyInput('PARTIAL'));
      expect(result.forbidStrongBuy).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });
  });

  describe('기존 ADR-0398 4 조건 회귀 보존 (DEGRADED / FAILED / YAHOO_ETF / 저신뢰)', () => {
    it('DEGRADED → 기존 차단 동작 유지', () => {
      const result = evaluateSectorEnergyStrongBuyGate(buildHealthyInput('DEGRADED'));
      expect(result.forbidStrongBuy).toBe(true);
      expect(result.reasons.some((r) => r.includes('DEGRADED'))).toBe(true);
    });

    it('FAILED → 기존 차단 동작 유지', () => {
      const result = evaluateSectorEnergyStrongBuyGate(buildHealthyInput('FAILED'));
      expect(result.forbidStrongBuy).toBe(true);
      expect(result.reasons.some((r) => r.includes('FAILED'))).toBe(true);
    });

    it('YAHOO_ETF source → 기존 차단 동작 유지', () => {
      const result = evaluateSectorEnergyStrongBuyGate({
        confidence: 0.85,
        dataQuality: 'OK',
        sourceTier: 'YAHOO_ETF',
      });
      expect(result.forbidStrongBuy).toBe(true);
      expect(result.reasons.some((r) => r.includes('YAHOO_ETF'))).toBe(true);
    });

    it('confidence < 0.6 → 기존 차단 동작 유지', () => {
      const result = evaluateSectorEnergyStrongBuyGate({
        confidence: 0.5,
        dataQuality: 'OK',
        sourceTier: 'KRX_CODE',
      });
      expect(result.forbidStrongBuy).toBe(true);
      expect(
        result.reasons.some((r) => r.includes(`< ${CONFIDENCE_GATE_THRESHOLD}`)),
      ).toBe(true);
    });
  });

  describe('다중 조건 충돌 — 모두 reasons 에 포함', () => {
    it('STALE + YAHOO_ETF + 저신뢰 → 3 사유 모두 reasons', () => {
      const result = evaluateSectorEnergyStrongBuyGate({
        confidence: 0.4,
        dataQuality: 'STALE',
        sourceTier: 'YAHOO_ETF',
      });
      expect(result.forbidStrongBuy).toBe(true);
      expect(result.reasons.some((r) => r.includes('STALE'))).toBe(true);
      expect(result.reasons.some((r) => r.includes('YAHOO_ETF'))).toBe(true);
      expect(
        result.reasons.some((r) => r.includes(`< ${CONFIDENCE_GATE_THRESHOLD}`)),
      ).toBe(true);
    });

    it('PARTIAL_VOLUME + DEGRADED 동시 (이론적 — schema 상 단일 dataQuality 라 실제 발생 0)', () => {
      // dataQuality 는 단일 union value 이므로 PARTIAL_VOLUME 만 체크.
      // 본 케이스는 PARTIAL_VOLUME 단독 시 reasons 카운트 검증.
      const result = evaluateSectorEnergyStrongBuyGate(
        buildHealthyInput('PARTIAL_VOLUME'),
      );
      expect(result.forbidStrongBuy).toBe(true);
      // PARTIAL_VOLUME 만 매칭되므로 reasons 1건
      expect(result.reasons.length).toBe(1);
    });
  });

  describe('ENV 우회 — STRONG_BUY 게이트 비활성화', () => {
    it('SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true → STALE 도 통과 (ADR-0397 동작 복원)', () => {
      process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = 'true';
      const result = evaluateSectorEnergyStrongBuyGate(buildHealthyInput('STALE'));
      expect(result.forbidStrongBuy).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true → PARTIAL_VOLUME 도 통과', () => {
      process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = 'true';
      const result = evaluateSectorEnergyStrongBuyGate(
        buildHealthyInput('PARTIAL_VOLUME'),
      );
      expect(result.forbidStrongBuy).toBe(false);
    });
  });

  describe('절대 원칙 — 일반 BUY 차단 금지 (사용자 명시 정책 #1)', () => {
    it('StrongBuyGateResult 시그니처에 forbidBuy 필드 부재 (정적 가드)', () => {
      const result = evaluateSectorEnergyStrongBuyGate(buildHealthyInput('STALE'));
      // 절대 원칙: BUY 차단 의사결정은 본 evaluator 의 책임 외. forbidBuy 필드가
      // 추가되면 회귀 — STRONG_BUY 차단 정책이 일반 BUY 차단으로 잘못 격상될 위험.
      expect(Object.keys(result)).toEqual(['forbidStrongBuy', 'reasons']);
      expect((result as { forbidBuy?: boolean }).forbidBuy).toBeUndefined();
    });

    it('STALE / PARTIAL_VOLUME / DEGRADED / FAILED 모두 forbidStrongBuy 만 true (BUY 영향 0)', () => {
      const blockedQualities: SectorEnergyDataQuality5[] = [
        'STALE',
        'PARTIAL_VOLUME',
        'DEGRADED',
        'FAILED',
      ];
      for (const q of blockedQualities) {
        const result = evaluateSectorEnergyStrongBuyGate(buildHealthyInput(q));
        expect(result.forbidStrongBuy).toBe(true);
        // 일반 BUY 차단 필드 0건 — 절대 원칙 #1 정합
        expect((result as { forbidBuy?: boolean }).forbidBuy).toBeUndefined();
        expect((result as { blocked?: boolean }).blocked).toBeUndefined();
      }
    });
  });
});
