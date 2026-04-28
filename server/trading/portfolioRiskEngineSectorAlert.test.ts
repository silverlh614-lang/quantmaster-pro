// @responsibility Phase B 섹터 집중도 알림 빌더 단위 테스트 (ADR-0028 §Phase B)
import { describe, it, expect } from 'vitest';
import {
  buildSectorOverflowAlert,
  SECTOR_TIGHT_STOP_RATIO,
  type SectorTighteningMeta,
} from './portfolioRiskEngine.js';

describe('buildSectorOverflowAlert (ADR-0028 §Phase B)', () => {
  it('상수 SSOT — SECTOR_TIGHT_STOP_RATIO = 0.99 (현재가 -1%)', () => {
    expect(SECTOR_TIGHT_STOP_RATIO).toBe(0.99);
  });

  it('exitTarget=null (적용 가능한 최저수익 포지션 없음) → 자동 액션 라인 부재 + 수동 권고', () => {
    const msg = buildSectorOverflowAlert({
      sector: '화장품',
      weightPct: 37.4,
      limitPct: 30,
      posNames: '코스맥스, 한국콜마',
      exitTarget: null,
    });
    expect(msg).toContain('[섹터 집중도 초과 — 자동 대응]');
    expect(msg).toContain('화장품');
    expect(msg).toContain('37.4%');
    expect(msg).toContain('한도 30%');
    expect(msg).toContain('코스맥스, 한국콜마');
    expect(msg).toContain('적용 가능한 최저수익 포지션 없음');
    expect(msg).toContain('수동 청산 권고');
    // 단정적 표현 부재 — "다음 스캔에서 청산 예정" 회귀 차단
    expect(msg).not.toContain('다음 스캔에서 청산 예정');
  });

  it('수익권 포지션 (사용자 보고 시나리오) → 조건부 표현 + 거리 명시', () => {
    // 사용자 시나리오: 화장품 37.4%, 코스맥스 (수익 +2.3%), 한국콜마. 긴축선 32,500 / 현재 33,000
    const exitTarget: SectorTighteningMeta = {
      stockName: '코스맥스',
      stockCode: '192820',
      currentPrice: 33000,
      tightStop: 32500,
      pnlPct: 2.3,
    };
    const msg = buildSectorOverflowAlert({
      sector: '화장품',
      weightPct: 37.4,
      limitPct: 30,
      posNames: '코스맥스, 한국콜마',
      exitTarget,
    });
    // 조건부 표현 — "도달 시 청산" 명시
    expect(msg).toContain('도달 시 청산');
    expect(msg).not.toContain('다음 스캔에서 청산 예정');
    // 예상 청산 가격 노출
    expect(msg).toContain('32,500원');
    // 현재가 + 거리 노출
    expect(msg).toContain('33,000원');
    expect(msg).toMatch(/-1\.[5-6]%\s*거리/);
    // 현재 pnlPct 양수 노출 (+2.30%)
    expect(msg).toContain('+2.30%');
    // 미도달 시 미발동 안내
    expect(msg).toContain('가격 미도달 시 미발동');
    expect(msg).toContain('수동 청산 또는 다음 점검에서 재평가');
    // 종목명 + 코드
    expect(msg).toContain('코스맥스');
    expect(msg).toContain('192820');
  });

  it('손실권 포지션 → pnlPct 음수 부호 표시', () => {
    const exitTarget: SectorTighteningMeta = {
      stockName: '코스맥스',
      stockCode: '192820',
      currentPrice: 28000,
      tightStop: 27720,
      pnlPct: -3.5,
    };
    const msg = buildSectorOverflowAlert({
      sector: '화장품',
      weightPct: 35,
      limitPct: 30,
      posNames: '코스맥스',
      exitTarget,
    });
    expect(msg).toContain('-3.50%');
    expect(msg).toContain('27,720원');
  });

  it('"LIVE 전환 전 섹터 분산 필수!" 푸터 보존', () => {
    const msg = buildSectorOverflowAlert({
      sector: '반도체',
      weightPct: 32,
      limitPct: 30,
      posNames: '삼성전자',
      exitTarget: null,
    });
    expect(msg).toContain('LIVE 전환 전 섹터 분산 필수!');
  });

  it('exitTarget.currentPrice=0 (이상 케이스) → dropPct=0% 안전 fallback', () => {
    const exitTarget: SectorTighteningMeta = {
      stockName: 'TEST',
      stockCode: '000000',
      currentPrice: 0,
      tightStop: 100,
      pnlPct: 0,
    };
    const msg = buildSectorOverflowAlert({
      sector: '기타',
      weightPct: 35,
      limitPct: 30,
      posNames: 'TEST',
      exitTarget,
    });
    expect(msg).toContain('-0.0% 거리');
  });

  it('weightPct/limitPct 소수점 정확히 1자리/0자리 표기', () => {
    const msg = buildSectorOverflowAlert({
      sector: '화장품',
      weightPct: 37.456,
      limitPct: 30,
      posNames: 'A',
      exitTarget: null,
    });
    expect(msg).toContain('37.5%'); // 1자리 반올림
    expect(msg).toContain('한도 30%'); // 정수
  });

  it('자동 액션 라인이 *조건부* 표현 — 단정적 동사 사용 차단', () => {
    const exitTarget: SectorTighteningMeta = {
      stockName: 'A', stockCode: '000', currentPrice: 100, tightStop: 99, pnlPct: 1,
    };
    const msg = buildSectorOverflowAlert({
      sector: 'X', weightPct: 35, limitPct: 30, posNames: 'A', exitTarget,
    });
    // *발동 조건* 명시되어야 함
    expect(msg).toContain('도달 시 청산');
    // *완료 단정* 부재
    expect(msg).not.toMatch(/청산\s*예정/);
    expect(msg).not.toMatch(/곧\s*청산/);
  });
});
