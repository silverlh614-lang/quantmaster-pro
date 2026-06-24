/**
 * @responsibility leaderRefresh.cmd 회귀 — 등록/메타 · 갱신건수 출력 · 장외 경고 · injection OFF 경고 · 진단 프로브 verdict · 예외 격리
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderRankingProbe } from '../../../clients/kisRankingClient.js';

vi.mock('../../../state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../state.js')>();
  return { ...actual, getEmergencyStop: vi.fn() };
});

vi.mock('../../../screener/dynamicUniverseExpander.js', () => ({
  runLeaderUniverseDailyRefresh: vi.fn(),
  isLeaderUniverseDailyRefreshEnabled: vi.fn(),
  loadDynamicUniverse: vi.fn(),
}));

vi.mock('../../../screener/leaderUniverseInjectionAdr0617.js', () => ({
  isLeaderUniverseInjectionEnabled: vi.fn(),
}));

vi.mock('../../../clients/kisRankingClient.js', () => ({
  probeLeaderRanking: vi.fn(),
}));

vi.mock('../../../screener/shadowDataGate.js', () => ({
  isVtsOnly: vi.fn(),
}));

import { getEmergencyStop } from '../../../state.js';
import {
  runLeaderUniverseDailyRefresh,
  isLeaderUniverseDailyRefreshEnabled,
  loadDynamicUniverse,
} from '../../../screener/dynamicUniverseExpander.js';
import { isLeaderUniverseInjectionEnabled } from '../../../screener/leaderUniverseInjectionAdr0617.js';
import { probeLeaderRanking } from '../../../clients/kisRankingClient.js';
import { isVtsOnly } from '../../../screener/shadowDataGate.js';
import { commandRegistry } from '../../commandRegistry.js';
import './leaderRefresh.cmd.js';

/** 기본 = 장중·real-data ON·3종 정상 응답(healthy). 개별 테스트가 override. */
function healthyProbe(): LeaderRankingProbe {
  return {
    marketOpen: true,
    hasRealDataClient: true,
    kisIsReal: true,
    hasOverrides: false,
    rows: [
      { type: 'market-cap', trId: 'FHPST01720000', count: 20, circuitOpenForMs: 0 },
      { type: 'institutional-net-buy', trId: 'FHPST01600000', count: 18, circuitOpenForMs: 0 },
      { type: 'volume', trId: 'FHPST01710000', count: 22, circuitOpenForMs: 0 },
    ],
  };
}

beforeEach(() => {
  vi.mocked(getEmergencyStop).mockReturnValue(false);
  vi.mocked(runLeaderUniverseDailyRefresh).mockResolvedValue(5);
  vi.mocked(isLeaderUniverseDailyRefreshEnabled).mockReturnValue(true);
  vi.mocked(isLeaderUniverseInjectionEnabled).mockReturnValue(true);
  vi.mocked(loadDynamicUniverse).mockReturnValue([{ ticker: 'A' }, { ticker: 'B' }] as never);
  vi.mocked(probeLeaderRanking).mockResolvedValue(healthyProbe());
  vi.mocked(isVtsOnly).mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('/leader_refresh 등록·메타', () => {
  it('commandRegistry 에 /leader_refresh 등록 + alias /lr', () => {
    expect(commandRegistry.resolve('/leader_refresh')).toBeDefined();
    expect(commandRegistry.resolve('/lr')).toBeDefined();
  });

  it('/leader_refresh 와 /lr 동일 인스턴스', () => {
    expect(commandRegistry.resolve('/leader_refresh')).toBe(commandRegistry.resolve('/lr'));
  });

  it('name·category·riskLevel·visibility 메타 검증', () => {
    const cmd = commandRegistry.resolve('/leader_refresh');
    expect(cmd?.name).toBe('/leader_refresh');
    expect(cmd?.category).toBe('TRD');
    expect(cmd?.riskLevel).toBe(2);
    expect(cmd?.visibility).toBe('ADMIN');
  });
});

describe('/leader_refresh 동작', () => {
  it('비상정지 활성 시 차단 + refresh 미호출', async () => {
    vi.mocked(getEmergencyStop).mockReturnValue(true);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[0]).toContain('비상 정지');
    expect(runLeaderUniverseDailyRefresh).not.toHaveBeenCalled();
  });

  it('반환 > 0 → 갱신 건수 출력', async () => {
    vi.mocked(runLeaderUniverseDailyRefresh).mockResolvedValue(5);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(runLeaderUniverseDailyRefresh).toHaveBeenCalledOnce();
    expect(replies[1]).toContain('갱신 5건');
    // 갱신 > 0 → 0건 장외 경고는 미출력(진단 verdict 의 ADR-0009 참조와 별개).
    expect(replies[1]).not.toContain('장외이거나 변동 없음');
  });

  it('반환 0 → 장외 경고(ADR-0009) 출력', async () => {
    vi.mocked(runLeaderUniverseDailyRefresh).mockResolvedValue(0);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).toContain('갱신 0건');
    expect(replies[1]).toContain('ADR-0009');
    expect(replies[1]).toContain('09:00~15:30');
  });

  it('injection flag OFF → 풀 반영 경고 포함', async () => {
    vi.mocked(isLeaderUniverseInjectionEnabled).mockReturnValue(false);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).toContain('LEADER_UNIVERSE_INJECTION_ENABLED');
    expect(replies[1]).toContain('INJECTION flag: OFF');
  });

  it('injection flag ON → 풀 반영 경고 미포함', async () => {
    vi.mocked(isLeaderUniverseInjectionEnabled).mockReturnValue(true);
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).not.toContain('후보 풀 반영은 LEADER_UNIVERSE_INJECTION_ENABLED 의존');
  });

  it('진단 프로브: 정상 응답 → 진단 블록 + 정상 verdict 포함', async () => {
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(probeLeaderRanking).toHaveBeenCalledOnce();
    expect(replies[1]).toContain('진단 (bypassCache 강제)');
    expect(replies[1]).toContain('시총(FHPST01720000): 20');
    expect(replies[1]).toContain('랭킹 정상 응답');
  });

  it('진단 프로브: circuit OPEN → /reset_circuits 안내 verdict', async () => {
    vi.mocked(probeLeaderRanking).mockResolvedValue({
      marketOpen: true,
      hasRealDataClient: true,
      kisIsReal: true,
      hasOverrides: false,
      rows: [
        { type: 'market-cap', trId: 'FHPST01720000', count: 0, circuitOpenForMs: 42_000 },
        { type: 'institutional-net-buy', trId: 'FHPST01600000', count: 0, circuitOpenForMs: 0 },
        { type: 'volume', trId: 'FHPST01710000', count: 0, circuitOpenForMs: 0 },
      ],
    });
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).toContain('circuit OPEN');
    expect(replies[1]).toContain('/reset_circuits');
    expect(replies[1]).toContain('⛔circuit 42s');
  });

  it('진단 프로브: allZero + 403/AUTH_OR_TOKEN → 권한 verdict + last status 표시', async () => {
    vi.mocked(probeLeaderRanking).mockResolvedValue({
      marketOpen: true,
      hasRealDataClient: true,
      kisIsReal: true,
      hasOverrides: false,
      rows: [
        { type: 'market-cap', trId: 'FHPST01720000', count: 0, circuitOpenForMs: 0, lastErrorKind: 'AUTH_OR_TOKEN', lastHttpStatus: 403 },
        { type: 'institutional-net-buy', trId: 'FHPST01600000', count: 0, circuitOpenForMs: 0, lastErrorKind: 'AUTH_OR_TOKEN', lastHttpStatus: 403 },
        { type: 'volume', trId: 'FHPST01710000', count: 0, circuitOpenForMs: 0, lastErrorKind: 'AUTH_OR_TOKEN', lastHttpStatus: 403 },
      ],
    });
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).toContain('403/권한');
    expect(replies[1]).toContain('순위분석 TR 사용신청');
    expect(replies[1]).toContain('❌last 403/AUTH_OR_TOKEN');
    // 불변식 #6 — provider 장애는 약세 신호로 변환하지 않음.
    expect(replies[1]).toContain('marketSignal=false');
  });

  it('진단 프로브: allZero + 5xx/TRANSIENT_SERVER_500 → 일시장애 verdict(콘솔 조치 불필요)', async () => {
    vi.mocked(probeLeaderRanking).mockResolvedValue({
      marketOpen: true,
      hasRealDataClient: true,
      kisIsReal: true,
      hasOverrides: false,
      rows: [
        { type: 'market-cap', trId: 'FHPST01720000', count: 0, circuitOpenForMs: 0, lastErrorKind: 'TRANSIENT_SERVER_500', lastHttpStatus: 503 },
        { type: 'institutional-net-buy', trId: 'FHPST01600000', count: 0, circuitOpenForMs: 0, lastErrorKind: 'TRANSIENT_SERVER_500', lastHttpStatus: 500 },
        { type: 'volume', trId: 'FHPST01710000', count: 0, circuitOpenForMs: 0, lastErrorKind: 'TRANSIENT_SERVER_500', lastHttpStatus: 500 },
      ],
    });
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).toContain('일시장애');
    expect(replies[1]).toContain('콘솔 조치 불필요');
    expect(replies[1]).toContain('❌last 503/TRANSIENT_SERVER_500');
  });

  it('진단 프로브: allZero + 400/BAD_REQUEST_OR_SYMBOL → 파라미터 점검 verdict', async () => {
    vi.mocked(probeLeaderRanking).mockResolvedValue({
      marketOpen: true,
      hasRealDataClient: true,
      kisIsReal: true,
      hasOverrides: false,
      rows: [
        { type: 'market-cap', trId: 'FHPST01720000', count: 0, circuitOpenForMs: 0, lastErrorKind: 'BAD_REQUEST_OR_SYMBOL', lastHttpStatus: 400 },
        { type: 'institutional-net-buy', trId: 'FHPST01600000', count: 0, circuitOpenForMs: 0 },
        { type: 'volume', trId: 'FHPST01710000', count: 0, circuitOpenForMs: 0 },
      ],
    });
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).toContain('400/404 파라미터');
  });

  it('진단 프로브: allZero + lastError 없음 → 기존 "3종 모두 빈 응답" verdict 회귀 유지', async () => {
    vi.mocked(probeLeaderRanking).mockResolvedValue({
      marketOpen: true,
      hasRealDataClient: true,
      kisIsReal: true,
      hasOverrides: false,
      rows: [
        { type: 'market-cap', trId: 'FHPST01720000', count: 0, circuitOpenForMs: 0 },
        { type: 'institutional-net-buy', trId: 'FHPST01600000', count: 0, circuitOpenForMs: 0 },
        { type: 'volume', trId: 'FHPST01710000', count: 0, circuitOpenForMs: 0 },
      ],
    });
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).toContain('3종 모두 빈 응답');
    expect(replies[1]).not.toContain('403/권한');
  });

  it('진단 프로브: real-data 키 미설정·VTS-only → 키 설정 안내 verdict', async () => {
    vi.mocked(isVtsOnly).mockReturnValue(true);
    vi.mocked(probeLeaderRanking).mockResolvedValue({
      marketOpen: true,
      hasRealDataClient: false,
      kisIsReal: false,
      hasOverrides: false,
      rows: [
        { type: 'market-cap', trId: 'FHPST01720000', count: 0, circuitOpenForMs: 0 },
        { type: 'institutional-net-buy', trId: 'FHPST01600000', count: 0, circuitOpenForMs: 0 },
        { type: 'volume', trId: 'FHPST01710000', count: 0, circuitOpenForMs: 0 },
      ],
    });
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await cmd!.execute({ args: [], reply });

    expect(replies[1]).toContain('KIS_REAL_DATA_APP_KEY');
    expect(replies[1]).toContain('VTS-only: yes');
  });

  it('진단 프로브 throw → 격리(refresh 결과는 정상 출력)', async () => {
    vi.mocked(probeLeaderRanking).mockRejectedValue(new Error('probe boom'));
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await expect(cmd!.execute({ args: [], reply })).resolves.toBeUndefined();

    expect(replies[1]).toContain('갱신 5건');
    expect(replies[1]).toContain('진단 프로브 실패');
    expect(replies[1]).toContain('probe boom');
  });

  it('runLeaderUniverseDailyRefresh throw → ❌ 안전 메시지 + 미전파', async () => {
    vi.mocked(runLeaderUniverseDailyRefresh).mockRejectedValue(new Error('refresh boom'));
    const replies: string[] = [];
    const reply = async (m: string) => { replies.push(m); };

    const cmd = commandRegistry.resolve('/leader_refresh');
    await expect(cmd!.execute({ args: [], reply })).resolves.toBeUndefined();

    expect(replies.some((r) => r.includes('❌'))).toBe(true);
    expect(replies.some((r) => r.includes('refresh boom'))).toBe(true);
  });
});
