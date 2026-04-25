/**
 * @responsibility PR-42 M2 — kisProxyPolicy 화이트리스트/블랙리스트 회귀 테스트
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateProxyPolicy,
  ALLOWED_PROXY_PATHS,
  FORBIDDEN_PROXY_PATHS,
  FORBIDDEN_TR_IDS,
} from './kisProxyPolicy.js';

describe('kisProxyPolicy — PR-42 M2', () => {
  describe('allow', () => {
    it('GET inquire-price + FHKST01010100 (priceSync.ts 실제 호출)', () => {
      expect(evaluateProxyPolicy({
        method: 'GET',
        path: '/uapi/domestic-stock/v1/quotations/inquire-price',
        trId: 'FHKST01010100',
      })).toEqual({ action: 'allow' });
    });

    it('POST inquire-balance + VTTC8434R (모의 잔고 조회)', () => {
      expect(evaluateProxyPolicy({
        method: 'POST',
        path: '/uapi/domestic-stock/v1/trading/inquire-balance',
        trId: 'VTTC8434R',
      })).toEqual({ action: 'allow' });
    });

    it('GET inquire-daily-ccld + TTTC8001R (체결 조회)', () => {
      expect(evaluateProxyPolicy({
        method: 'GET',
        path: '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
        trId: 'TTTC8001R',
      })).toEqual({ action: 'allow' });
    });

    it('method 소문자도 정규화되어 통과', () => {
      expect(evaluateProxyPolicy({
        method: 'get',
        path: '/uapi/domestic-stock/v1/quotations/inquire-price',
        trId: 'FHKST01010100',
      })).toEqual({ action: 'allow' });
    });
  });

  describe('reject — 자동매매 단일 통로 보호 (절대 규칙 #4)', () => {
    it('order-cash 경로 → 403 (FORBIDDEN_PROXY_PATHS)', () => {
      const r = evaluateProxyPolicy({
        method: 'POST',
        path: '/uapi/domestic-stock/v1/trading/order-cash',
        trId: 'TTTC0802U',
      });
      expect(r.action).toBe('reject');
      expect(r.httpStatus).toBe(403);
      expect(r.reason).toContain('자동매매 전용');
    });

    it('order-rvsecncl 경로 → 403', () => {
      const r = evaluateProxyPolicy({
        method: 'POST',
        path: '/uapi/domestic-stock/v1/trading/order-rvsecncl',
        trId: 'TTTC0803U',
      });
      expect(r.action).toBe('reject');
      expect(r.httpStatus).toBe(403);
    });

    it('TTTC0802U (실계좌 매수) → 403 — 화이트리스트 누락 안전망', () => {
      // 매수 TR 을 read-only 경로에 끼워넣은 우회 시도
      const r = evaluateProxyPolicy({
        method: 'POST',
        path: '/uapi/domestic-stock/v1/trading/inquire-balance',
        trId: 'TTTC0802U',
      });
      expect(r.action).toBe('reject');
      expect(r.httpStatus).toBe(403);
      expect(r.reason).toContain('주문/취소');
    });

    it('VTTC0801U (모의 매도) 도 차단', () => {
      const r = evaluateProxyPolicy({
        method: 'POST',
        path: '/uapi/domestic-stock/v1/trading/inquire-balance',
        trId: 'VTTC0801U',
      });
      expect(r.action).toBe('reject');
      expect(r.httpStatus).toBe(403);
    });
  });

  describe('reject — 입력 검증', () => {
    it('PUT/DELETE 등 미지원 method → 405', () => {
      expect(evaluateProxyPolicy({ method: 'PUT', path: '/uapi/x', trId: 'X' }).httpStatus).toBe(405);
      expect(evaluateProxyPolicy({ method: 'DELETE', path: '/uapi/x', trId: 'X' }).httpStatus).toBe(405);
    });

    it('path 미지정 → 400', () => {
      expect(evaluateProxyPolicy({ method: 'GET', path: undefined, trId: 'X' }).httpStatus).toBe(400);
    });

    it('path 가 /uapi/ 로 시작하지 않으면 → 400', () => {
      expect(evaluateProxyPolicy({ method: 'GET', path: '/api/foo', trId: 'X' }).httpStatus).toBe(400);
    });

    it('화이트리스트 미등록 경로 → 403', () => {
      const r = evaluateProxyPolicy({
        method: 'GET',
        path: '/uapi/domestic-stock/v1/quotations/some-other-endpoint',
        trId: 'FHKST00000000',
      });
      expect(r.action).toBe('reject');
      expect(r.httpStatus).toBe(403);
      expect(r.reason).toContain('화이트리스트');
    });

    it('tr_id 누락 → 400', () => {
      const r = evaluateProxyPolicy({
        method: 'GET',
        path: '/uapi/domestic-stock/v1/quotations/inquire-price',
        trId: '',
      });
      expect(r.action).toBe('reject');
      expect(r.httpStatus).toBe(400);
      expect(r.reason).toContain('tr_id');
    });
  });

  describe('상수 무결성', () => {
    it('FORBIDDEN_TR_IDS 에 매수/매도/취소 6 종 모두 등재', () => {
      const expected = ['TTTC0802U', 'VTTC0802U', 'TTTC0801U', 'VTTC0801U', 'TTTC0803U', 'VTTC0803U'];
      for (const tr of expected) expect(FORBIDDEN_TR_IDS.has(tr)).toBe(true);
    });

    it('FORBIDDEN_PROXY_PATHS 와 ALLOWED_PROXY_PATHS 교집합 0', () => {
      for (const p of FORBIDDEN_PROXY_PATHS) {
        expect(ALLOWED_PROXY_PATHS.has(p)).toBe(false);
      }
    });
  });
});
