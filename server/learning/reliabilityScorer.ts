/**
 * reliabilityScorer.ts — 데이터 신뢰도 스코어 계산
 *
 * 각 추천/종목에 대해 실데이터(Yahoo/KIS/DART) vs. AI 추정 비율을 계산.
 * 프론트엔드 및 Telegram 알림에서 신뢰도 배지로 표시.
 *
 * 예시: 🟢 85% (실데이터 80%, AI 20%)
 */

// ── 데이터 소스 플래그 ────────────────────────────────────────────────────────

export interface DataSources {
  // Yahoo Finance 실계산 (10개)
  rsi14:           boolean;  // RSI(14) Wilder 평활화
  macd:            boolean;  // MACD(12,26,9)
  maAlignment:     boolean;  // 5>20>60 정배열
  volumeBreakout:  boolean;  // 거래량 2배 돌파
  turtleHigh:      boolean;  // 20일 신고가
  vcp:             boolean;  // ATR 변동성 축소
  per:             boolean;  // Yahoo PER
  relStrength:     boolean;  // KOSPI 대비 실계산 상대강도
  volumeSurge:     boolean;  // 거래량 3배 급등
  atr:             boolean;  // ATR 계산 성공 여부
  // KIS 실데이터 (2개)
  foreignNetBuy:      boolean;  // 외국인 당일 순매수
  institutionalNetBuy: boolean; // 기관 당일 순매수
  // DART 실데이터 (4개)
  dartROE:       boolean;  // 자기자본이익률
  dartOPM:       boolean;  // 영업이익률
  dartDebtRatio: boolean;  // 부채비율
  dartOCFRatio:  boolean;  // 영업현금흐름/매출
  // AI 추정 (항상 사용 = true)
  aiProfile:    boolean;  // Gemini 품질 프로파일 (A/B/C/D)
  aiQualScore:  boolean;  // Gemini 질적 조건 평가
}

// ── 필드 분류 ──────────────────────────────────────────────────────────────────

const REAL_FIELDS: (keyof DataSources)[] = [
  'rsi14', 'macd', 'maAlignment', 'volumeBreakout', 'turtleHigh',
  'vcp', 'per', 'relStrength', 'volumeSurge', 'atr',
  'foreignNetBuy', 'institutionalNetBuy',
  'dartROE', 'dartOPM', 'dartDebtRatio', 'dartOCFRatio',
];

const AI_FIELDS: (keyof DataSources)[] = ['aiProfile', 'aiQualScore'];

const TOTAL_FIELDS = REAL_FIELDS.length + AI_FIELDS.length; // 18

// ── 신뢰도 결과 ────────────────────────────────────────────────────────────────

export interface ReliabilityScore {
  score:     number;  // 0~100
  realCount: number;  // 실데이터 필드 수
  aiCount:   number;  // AI/미수집 필드 수
  badge:     '🟢' | '🟡' | '🔴';
  label:     string;  // "실데이터 78%, AI 22%"
  detail: {
    yahoo: number;  // Yahoo 실계산 조건 수
    kis:   number;  // KIS 실데이터 조건 수
    dart:  number;  // DART 실데이터 조건 수
    ai:    number;  // AI 추정 조건 수
  };
}

// ── 계산 ──────────────────────────────────────────────────────────────────────

export function calcReliabilityScore(src: Partial<DataSources>): ReliabilityScore {
  const realCount = REAL_FIELDS.filter(f => src[f] === true).length;
  const aiCount   = TOTAL_FIELDS - realCount;

  const score = Math.round((realCount / TOTAL_FIELDS) * 100);

  const badge: ReliabilityScore['badge'] =
    score >= 70 ? '🟢' :
    score >= 45 ? '🟡' : '🔴';

  const realPct = score;
  const aiPct   = 100 - realPct;

  const yahooFields: (keyof DataSources)[] = [
    'rsi14', 'macd', 'maAlignment', 'volumeBreakout', 'turtleHigh',
    'vcp', 'per', 'relStrength', 'volumeSurge', 'atr',
  ];
  const kisFields: (keyof DataSources)[]  = ['foreignNetBuy', 'institutionalNetBuy'];
  const dartFields: (keyof DataSources)[] = ['dartROE', 'dartOPM', 'dartDebtRatio', 'dartOCFRatio'];

  return {
    score,
    realCount,
    aiCount,
    badge,
    label: `실데이터 ${realPct}%, AI ${aiPct}%`,
    detail: {
      yahoo: yahooFields.filter(f => src[f] === true).length,
      kis:   kisFields.filter(f   => src[f] === true).length,
      dart:  dartFields.filter(f  => src[f] === true).length,
      ai:    AI_FIELDS.filter(f   => src[f] === true).length,
    },
  };
}

/**
 * Gate conditionKeys 배열에서 DataSources 플래그 자동 추출.
 * evaluateServerGate()의 conditionKeys를 직접 변환.
 */
export function sourcesFromGateKeys(
  conditionKeys: string[],
  opts?: {
    hasForeignNetBuy?: boolean;
    hasInstitutionalNetBuy?: boolean;
    hasDartROE?: boolean;
    hasDartOPM?: boolean;
    hasDartDebtRatio?: boolean;
    hasDartOCFRatio?: boolean;
    hasGeminiProfile?: boolean;
    hasGeminiQual?: boolean;
  },
): Partial<DataSources> {
  const src: Partial<DataSources> = {
    rsi14:          conditionKeys.includes('rsi_zone'),
    macd:           conditionKeys.includes('macd_bull'),
    maAlignment:    conditionKeys.includes('ma_alignment'),
    volumeBreakout: conditionKeys.includes('volume_breakout'),
    turtleHigh:     conditionKeys.includes('turtle_high'),
    vcp:            conditionKeys.includes('vcp'),
    per:            conditionKeys.includes('per'),
    relStrength:    conditionKeys.includes('relative_strength'),
    volumeSurge:    conditionKeys.includes('volume_surge'),
    atr:            true,  // ATR는 항상 계산됨
    foreignNetBuy:      opts?.hasForeignNetBuy      ?? false,
    institutionalNetBuy: opts?.hasInstitutionalNetBuy ?? false,
    dartROE:       opts?.hasDartROE       ?? false,
    dartOPM:       opts?.hasDartOPM       ?? false,
    dartDebtRatio: opts?.hasDartDebtRatio ?? false,
    dartOCFRatio:  opts?.hasDartOCFRatio  ?? false,
    aiProfile:  opts?.hasGeminiProfile ?? true,
    aiQualScore: opts?.hasGeminiQual   ?? true,
  };
  return src;
}

/** Telegram/로그용 한 줄 포맷 */
export function formatReliabilityBadge(rel: ReliabilityScore): string {
  return `${rel.badge} ${rel.score}% (${rel.label})`;
}
