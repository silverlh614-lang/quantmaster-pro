/**
 * regimePlaybook.ts — 레짐별 구체 행동 가이드 (IDEA 5)
 *
 * 레짐 전환 Telegram 알림에 Do / Caution / Don't 3줄 체크리스트 블록을 주입한다.
 * 알림 자체는 regimeBridge.checkAndNotifyRegimeChange() 가 기존처럼 발송하며,
 * 이 모듈은 playbook 블록만 제공한다 (기능 분리 → 포맷 변경 시 1곳만 수정).
 */
import type { RegimeLevel } from '../../src/types/core.js';

interface RegimePlaybook {
  /** 이번 레짐에서 허용되는 행동 (✅) */
  allow: string[];
  /** 조건부 허용/주의 (⚠️) */
  caution: string[];
  /** 금지 (❌) */
  forbid: string[];
  /** 과거 유사 국면 평균 지속 기간 — 사용자 기대 관리용 */
  expectedDuration: string;
}

const PLAYBOOKS: Record<RegimeLevel, RegimePlaybook> = {
  R1_TURBO: {
    allow: [
      '포지션 비중 MAX (Kelly 100%)',
      'STRONG_BUY · EARLY_ENTRY 풀 포지션 가능',
      '주도주 집중 8종 보유 허용',
    ],
    caution: [
      'VKOSPI 20 이상이면 분할 진입 유지',
      '일일 손실 5% 초과 시 레짐 재평가',
    ],
    forbid: [
      '신용/레버리지 사용 금지',
      '역추세 매수 금지',
    ],
    expectedDuration: '2~6주',
  },
  R2_BULL: {
    allow: [
      '포지션 비중 확대 (Kelly 80%)',
      'STRONG_BUY 시 풀 포지션 가능',
      '조방원(조선·방산·원자력) 등 주도 섹터 집중 유효',
    ],
    caution: [
      'VKOSPI 20 이상 시 분할 진입 유지',
      'RRR 2.0 미만 신호는 건너뛴다',
    ],
    forbid: [
      '신용/레버리지 사용 금지',
      '하락 추세 종목 낙폭 매수 금지',
    ],
    expectedDuration: '4~8주',
  },
  R3_EARLY: {
    allow: [
      '선행 지표 종목 소규모 선취매 (Kelly 70%)',
      '1차 30% 선진입, R2 확인 후 70% 증액',
      '외국인 Passive 전환 종목 우선 편입',
    ],
    caution: [
      '지수 60일선 회복 전 — 전량 진입은 대기',
      'R2 전환 실패 시 즉시 축소',
    ],
    forbid: [
      '풀 포지션 금지',
      '저유동성 소형주 무리한 진입 금지',
    ],
    expectedDuration: '2~4주',
  },
  R4_NEUTRAL: {
    allow: [
      'CONFIRMED_STRONG_BUY · STRONG_BUY 선택적 진입 (Kelly 50%)',
      '분할 3회 균등 진입 (33/33/33)',
      '신고가 섹터 RS 상위만 제한 편입',
    ],
    caution: [
      '추세 미확정 — 손절 타이트 유지',
      '최대 포지션 6개 초과 금지',
    ],
    forbid: [
      '미확인 BUY 신호 진입 금지',
      '모멘텀 꺾인 섹터 추격 금지',
    ],
    expectedDuration: '수 주 — 방향성 대기 구간',
  },
  R5_CAUTION: {
    allow: [
      'CONFIRMED_STRONG_BUY 한정 진입 (Kelly 30%)',
      '초단기 익절 우선 (1~3일)',
      '기존 포지션 손절선 상향 정비',
    ],
    caution: [
      '최대 2종목 보유 — 분산 금지',
      '포지션 단일 진입, 추가매수 금지',
    ],
    forbid: [
      '신규 스윙 진입 금지',
      '저점 매수 시도 금지',
    ],
    expectedDuration: '1~3주',
  },
  R6_DEFENSE: {
    allow: [
      '현금 보유 우선',
      '핵심 포지션 방어 점검',
    ],
    caution: [
      '모든 신규 진입 중단',
      '손절선 접근 종목 선제 청산 검토',
    ],
    forbid: [
      '신규 매수 전면 금지',
      '물타기·역추세 매수 금지',
      '신용/레버리지 전면 금지',
    ],
    expectedDuration: '블랙스완 해소까지',
  },
};

/**
 * 레짐 playbook HTML 블록.
 * regimeBridge 의 기존 알림 메시지 꼬리에 이어 붙이는 용도.
 */
export function renderPlaybook(regime: RegimeLevel): string {
  const book = PLAYBOOKS[regime];
  if (!book) return '';

  const lines: string[] = [];
  lines.push(`\n<b>📋 ${regime} 전략 가이드</b>`);

  for (const item of book.allow)   lines.push(`  ✅ ${item}`);
  for (const item of book.caution) lines.push(`  ⚠️ ${item}`);
  for (const item of book.forbid)  lines.push(`  ❌ ${item}`);

  lines.push(`\n<i>예상 지속 기간: ${book.expectedDuration}</i>`);
  return lines.join('\n');
}
