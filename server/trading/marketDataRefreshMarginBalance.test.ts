// @responsibility marketDataRefresh 신용잔고 wiring 회귀 — ADR-0139.
// 정적 grep 가드.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.join(process.cwd(), 'server/trading/marketDataRefresh.ts');
// ADR-0595 분해: 신용잔고(⑥-b) 섹션은 marketDataRefresh/supplyCreditSections.ts 로 이동 —
// 서브모듈 + 본문(호출 순서 주석 잔존)을 함께 grep (ADR-0444 static-grep-guard 패턴).
const SUPPLY_PATH = path.join(process.cwd(), 'server/trading/marketDataRefresh/supplyCreditSections.ts');

describe('marketDataRefresh ADR-0139 wiring (정적 grep 가드)', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(SUPPLY_PATH, 'utf-8') + fs.readFileSync(SOURCE_PATH, 'utf-8');
  });

  it('fetchLatestMarginBalance5dChange import 존재', () => {
    expect(source).toMatch(/fetchLatestMarginBalance5dChange/);
  });

  it('ADR-0139 주석 + 신용공여잔액 섹션 존재', () => {
    expect(source).toContain('ADR-0139');
    expect(source).toMatch(/신용공여잔액/);
  });

  it('정상 응답 시 marginBalanceSource = ECOS_API 영속', () => {
    expect(source).toMatch(/computed\.marginBalanceSource\s*=\s*['"]ECOS_API['"]/);
  });

  it('실패 시 marginBalanceSource = NONE 영속', () => {
    expect(source).toMatch(/computed\.marginBalanceSource\s*=\s*['"]NONE['"]/);
  });

  it('정상 응답 시 3 필드 영속 (changePct/FetchedAt/Source)', () => {
    expect(source).toMatch(/computed\.marginBalance5dChange\s*=/);
    expect(source).toMatch(/computed\.marginBalanceFetchedAt\s*=/);
  });

  it('catch graceful (ECOS throw 가 cron 차단 안 함)', () => {
    expect(source).toMatch(/fetchLatestMarginBalance5dChange\(\)\.catch\(\(\)\s*=>\s*null\)/);
  });

  it('5% 임계 진단 로그 — 신용잔고 과열 마커', () => {
    expect(source).toMatch(/신용잔고 과열/);
  });

  it('⑥ KRX 공매도 다음, ⑧ FRED 이전 위치 (⑥-b)', () => {
    // ADR-0589 분해 후 섹션 헬퍼 정의가 본문 상단으로 추출됨 — 호출부(orchestration) 순서는
    // 마지막 출현 기준으로 검증한다.
    const shortIdx = source.lastIndexOf('⑥ KRX 공매도');
    const marginIdx = source.lastIndexOf('ADR-0139');
    const fredIdx = source.lastIndexOf('⑧ FRED');
    expect(shortIdx).toBeGreaterThan(0);
    expect(marginIdx).toBeGreaterThan(shortIdx);
    expect(fredIdx).toBeGreaterThan(marginIdx);
  });
});
