/**
 * @responsibility PR-X3 ADR-0039 callsite 마이그레이션 + sendPickChannelAlert 삭제 회귀 테스트
 *
 * 검증:
 *   - sendPickChannelAlert 함수 삭제 (telegramClient 에서 export 아닔)
 *   - 9 호출자 파일이 sendTelegramBroadcast import 하지 않음
 *   - 9 호출자 파일이 적절한 카테고리 (SIGNAL/REGIME/JOURNAL/sendPrivateAlert) 사용
 *   - ChannelBoundary 화이트리스트에 telegramClient.ts 없음
 *   - stockPickReporter 이중 발송 제거 (sendPickChannelAlert 제거)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = process.cwd();

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

describe('PR-X3 sendPickChannelAlert 삭제', () => {
  const clientSrc = readSource('server/alerts/telegramClient.ts');

  it('telegramClient 에서 sendPickChannelAlert 함수 삭제됨', () => {
    expect(clientSrc).not.toMatch(/export\s+async\s+function\s+sendPickChannelAlert\s*\(/);
  });

  it('telegramClient 에 process\\.env\\.TELEGRAM_PICK_CHANNEL_ID 직접 접근 없음', () => {
    expect(clientSrc).not.toMatch(/process\.env\.TELEGRAM_PICK_CHANNEL_ID/);
  });

  it('ADR-0039 수정 메모 주석 포함 (삭제 의도 명시)', () => {
    expect(clientSrc).toMatch(/ADR-0039.*sendPickChannelAlert/);
  });
});

describe('PR-X3 9 callsite 마이그레이션 결과', () => {
  const SIGNAL_FILES = [
    'server/alerts/newHighMomentumScanner.ts',
    'server/alerts/stockPickReporter.ts',
  ];
  const REGIME_FILES = [
    'server/alerts/supplyChainAgent.ts',
    'server/alerts/sectorCycleDashboard.ts',
    'server/alerts/foreignFlowLeadingAlert.ts',
  ];
  const JOURNAL_FILES = [
    'server/alerts/weeklyConditionScorecard.ts',
    'server/alerts/weeklyQuantInsight.ts',
    'server/alerts/scanReviewReport.ts',
    'server/alerts/stopLossTransparencyReport.ts',
    'server/alerts/weeklyDeepAnalysis.ts',
  ];
  const PRIVATE_DM_FILES = [
    'server/alerts/positionMorningCard.ts',
  ];

  function stripComments(s: string): string {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  it.each(SIGNAL_FILES)('%s 가 ChannelSemantic.SIGNAL 로 발송', (file) => {
    const src = readSource(file);
    const code = stripComments(src);
    expect(src).toMatch(/dispatchAlert\s*\(\s*ChannelSemantic\.SIGNAL/);
    expect(code).not.toMatch(/sendTelegramBroadcast/);
    expect(code).not.toMatch(/sendPickChannelAlert\s*\(/);
  });

  it.each(REGIME_FILES)('%s 가 ChannelSemantic.REGIME 로 발송', (file) => {
    const src = readSource(file);
    const code = stripComments(src);
    expect(src).toMatch(/dispatchAlert\s*\(\s*[\s\S]*?ChannelSemantic\.REGIME/);
    expect(code).not.toMatch(/sendTelegramBroadcast/);
  });

  it.each(JOURNAL_FILES)('%s 가 ChannelSemantic.JOURNAL 로 발송', (file) => {
    const src = readSource(file);
    const code = stripComments(src);
    expect(src).toMatch(/dispatchAlert\s*\(\s*ChannelSemantic\.JOURNAL/);
    expect(code).not.toMatch(/sendTelegramBroadcast/);
    expect(code).not.toMatch(/sendPickChannelAlert\s*\(/);
  });

  it.each(PRIVATE_DM_FILES)('%s 가 sendPrivateAlert 로 발송 (개인 자산 정보)', (file) => {
    const src = readSource(file);
    const code = stripComments(src);
    expect(src).toMatch(/sendPrivateAlert/);
    expect(code).not.toMatch(/sendTelegramBroadcast/);
  });
});

describe('PR-X3 stockPickReporter 이중 발송 제거', () => {
  const src = readSource('server/alerts/stockPickReporter.ts');

  it('sendPickChannelAlert 호출 제거됨 (주석 제외)', () => {
    // 주석 제거 후 실제 호출 컴퓨터 조각
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(stripped).not.toMatch(/sendPickChannelAlert\s*\(/);
  });

  it('AlertCategory.ANALYSIS 호출이 ChannelSemantic.SIGNAL 로 대체', () => {
    expect(src).not.toMatch(/dispatchAlert\s*\(\s*AlertCategory\.ANALYSIS/);
    expect(src).toMatch(/ChannelSemantic\.SIGNAL/);
  });

  it('AlertCategory import 제거됨 (ChannelSemantic 만 사용)', () => {
    expect(src).not.toMatch(/import\s+\{[^}]*\bAlertCategory\b[^}]*\}\s+from\s+['"]\.\/alertCategories\.js['"]/);
  });
});

describe('PR-X3 ChannelBoundary 화이트리스트 축소', () => {
  const src = readSource('scripts/check_channel_boundary.js');

  it('telegramClient.ts 가 ALLOWED_FILES 에서 제거됨', () => {
    // ALLOWED_FILES 배열 안에 telegramClient.ts 가 없어야 함
    const allowedBlock = src.match(/const\s+ALLOWED_FILES\s*=\s*\[([\s\S]*?)\]/);
    expect(allowedBlock).not.toBeNull();
    expect(allowedBlock![1]).not.toMatch(/telegramClient\.ts/);
  });

  it('alertRouter.ts + alertCategories.ts + check_channel_boundary.js 3파일만 허용', () => {
    const allowedBlock = src.match(/const\s+ALLOWED_FILES\s*=\s*\[([\s\S]*?)\]/);
    expect(allowedBlock![1]).toMatch(/alertRouter\.ts/);
    expect(allowedBlock![1]).toMatch(/alertCategories\.ts/);
    expect(allowedBlock![1]).toMatch(/check_channel_boundary\.js/);
  });
});
