// src/services/quant/evolutionEngine.ts
import { ConditionId, SellCondition } from '../../types/quant';

// ─── 27개 마스터 조건 정의 ────────────────────────────────────────────────────

export const ALL_CONDITIONS: Record<ConditionId, { name: string; baseWeight: number; description: string }> = {
  1: { name: '주도주 사이클', baseWeight: 3.0, description: '현재 시장의 주도 섹터 및 사이클 부합 여부' },
  2: { name: '모멘텀', baseWeight: 2.5, description: '업종 내 상대적 강도 및 모멘텀 상위권' },
  3: { name: 'ROE 유형 3', baseWeight: 2.0, description: '자산회전율과 마진이 동반 상승하는 성장성' },
  4: { name: '수급 질', baseWeight: 2.0, description: '기관/외인의 질적인 수급 유입 및 매집 흔적' },
  5: { name: '시장 환경 Risk-On', baseWeight: 2.0, description: '매크로 및 시장 지표가 투자 적기임을 시사' },
  6: { name: '일목균형표', baseWeight: 1.5, description: '구름대 상단 안착 및 후행스팬 역전 여부' },
  7: { name: '기계적 손절 설정', baseWeight: 2.0, description: '명확한 손절 라인 및 리스크 관리 계획 수립' },
  8: { name: '경제적 해자', baseWeight: 1.5, description: '독점적 지위 및 높은 진입 장벽 보유' },
  9: { name: '신규 주도주 여부', baseWeight: 2.0, description: '새로운 사이클의 주인공으로 부상 중인지 확인' },
  10: { name: '기술적 정배열', baseWeight: 1.5, description: '이동평균선이 정배열 상태로 우상향 중' },
  11: { name: '거래량', baseWeight: 1.5, description: '돌파 시 거래량 동반 및 매집 거래량 확인' },
  12: { name: '기관/외인 수급', baseWeight: 1.5, description: '메이저 수급의 지속적인 유입 확인' },
  13: { name: '목표가 여력', baseWeight: 1.5, description: '상승 여력이 충분한 목표가 설정 가능' },
  14: { name: '실적 서프라이즈', baseWeight: 1.5, description: '컨센서스를 상회하는 실적 발표 및 전망' },
  15: { name: '실체적 펀더멘털', baseWeight: 1.5, description: '재무제표상 실질적인 이익 성장 확인' },
  16: { name: '정책/매크로', baseWeight: 1.5, description: '정부 정책 및 거시 경제 환경의 수혜' },
  17: { name: '심리적 객관성', baseWeight: 1.0, description: '공포와 탐욕에 휘둘리지 않는 객관적 분석' },
  18: { name: '터틀 돌파', baseWeight: 1.0, description: '20일/55일 고가 돌파 시스템 적용' },
  19: { name: '피보나치', baseWeight: 1.0, description: '주요 되돌림 및 확장 레벨에서의 지지/저항' },
  20: { name: '엘리엇 파동', baseWeight: 1.0, description: '현재 파동의 위치 및 진행 단계 분석' },
  21: { name: '이익의 질 OCF', baseWeight: 1.5, description: '영업활동현금흐름이 당기순이익을 상회' },
  22: { name: '마진 가속도', baseWeight: 1.0, description: '영업이익률 개선 속도가 매출 성장보다 빠름' },
  23: { name: '재무 방어력 ICR', baseWeight: 1.0, description: '이자보상배율이 높아 금리 인상에 강함' },
  24: { name: '상대강도 RS', baseWeight: 1.5, description: '지수 대비 주가 상승률이 월등히 높음' },
  25: { name: 'VCP', baseWeight: 1.0, description: '변동성 축소 패턴 및 에너지 응축 확인' },
  26: { name: '다이버전스', baseWeight: 1.0, description: '주가와 지표 간의 역전 현상 발생 여부' },
  27: { name: '촉매제', baseWeight: 1.0, description: '주가를 끌어올릴 명확한 재료 및 일정' },
};

// ─── 매도 체크리스트 ──────────────────────────────────────────────────────────

export const SELL_CHECKLIST: Record<number, SellCondition> = {
  1: { id: 1, name: '주도주 이탈', description: '섹터 내 대장주 지위 상실', trigger: '상대강도(RS) 급락' },
  2: { id: 2, name: 'ROE 훼손', description: '이익률 하락 및 자산 효율성 저하', trigger: '영업이익률 2분기 연속 하락' },
  3: { id: 3, name: '데드크로스', description: '주요 이평선 역배열 전환', trigger: '50일선 200일선 하향 돌파' },
  4: { id: 4, name: '수급 이탈', description: '기관/외인 대량 매도', trigger: '5거래일 연속 순매도' },
  5: { id: 5, name: '목표가 도달', description: '산정된 적정 가치 도달', trigger: '목표가 95% 이상 도달' },
  6: { id: 6, name: '손절가 터치', description: '기계적 리스크 관리', trigger: '매수가 대비 -8%~-15% 도달' },
  7: { id: 7, name: '유포리아 발생', description: '과도한 낙관론 및 과열', trigger: 'RSI 80 이상 및 거래량 폭증' },
  8: { id: 8, name: '촉매 소멸', description: '기대했던 재료 노출 및 소멸', trigger: '뉴스 발표 후 음봉 발생' },
  9: { id: 9, name: '추세 붕괴', description: '상승 추세선 하향 이탈', trigger: '추세선 이탈 후 리테스트 실패' },
  10: { id: 10, name: '거래량 실린 음봉', description: '고점에서 대량 거래 동반 하락', trigger: '평균 거래량 3배 이상 음봉' },
};

// ─── 조건별 데이터 출처 분류 ──────────────────────────────────────────────────

// 실계산 기반 조건 ID (가격/지표 데이터로 직접 계산 가능)
// 2=모멘텀RS, 6=일목균형표, 7=손절가(사용자설정), 10=기술적정배열, 11=거래량, 18=터틀돌파, 19=피보나치, 24=상대강도RS, 25=VCP
export const REAL_DATA_CONDITIONS: ConditionId[] = [2, 6, 7, 10, 11, 18, 19, 24, 25];

// AI 추정 기반 조건 ID (재무/섹터/거시 해석 필요 — AI가 점수 부여)
export const AI_ESTIMATE_CONDITIONS: ConditionId[] = [1, 3, 4, 5, 8, 9, 12, 13, 14, 15, 16, 17, 20, 21, 22, 23, 26, 27];

/**
 * 27개 조건별 데이터 출처 분류 맵
 * 'COMPUTED' = 가격/지표 기반 실계산 (KIS실시간 / DART / 차트)
 * 'AI'       = AI 추정값 (Gemini 해석 기반)
 */
export const CONDITION_SOURCE_MAP: Record<ConditionId, 'COMPUTED' | 'AI'> = Object.fromEntries([
  ...REAL_DATA_CONDITIONS.map(id => [id, 'COMPUTED' as const]),
  ...AI_ESTIMATE_CONDITIONS.map(id => [id, 'AI' as const]),
]) as Record<ConditionId, 'COMPUTED' | 'AI'>;

// ─── 실전 성과 기반 동적 EVOLUTION_WEIGHTS ────────────────────────────────────

const EVOLUTION_WEIGHTS_KEY = 'k-stock-evolution-weights';

/**
 * localStorage에서 실전 데이터 기반 가중치를 읽어옵니다.
 * TradeJournal의 computeConditionPerformance()가 계산한 결과를
 * saveEvolutionWeights()로 저장하면 다음 evaluateStock() 호출 시 반영.
 */
export function getEvolutionWeightsFromPerformance(): Record<number, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(EVOLUTION_WEIGHTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    // string key → number key 변환
    const result: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const numKey = parseInt(k, 10);
      if (!isNaN(numKey) && typeof v === 'number' && v >= 0.5 && v <= 1.5) {
        result[numKey] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * 실전 성과 데이터에서 계산된 가중치를 localStorage에 저장합니다.
 * TradeJournal에서 매매 종료 시 호출됩니다.
 */
export function saveEvolutionWeights(weights: Record<number, number>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(EVOLUTION_WEIGHTS_KEY, JSON.stringify(weights));
  } catch (e) {
    console.error('Failed to save evolution weights:', e);
  }
}
