// @responsibility conditionBoostHints 학습 엔진 모듈
/**
 * conditionBoostHints.ts — 아이디어 1: Gemini 프롬프트 boost 힌트 빌더.
 *
 * 클라이언트 전용 21개 조건은 condition-weights.json 경로가 없으므로
 * signalCalibrator가 저장한 promptBoost 맵을 Gemini 분석 프롬프트에 삽입해
 * 소프트 가중을 적용한다. 1.0 초과는 "중요도 상승", 미만은 "중요도 하락".
 *
 * 사용처: entryEngine.ts Pre-Mortem, qualityScorecard, reportGenerator 등.
 */

import { loadPromptBoosts } from '../persistence/promptBoostRepo.js';
import { CONDITION_NAMES, serverConditionKey } from './attributionAnalyzer.js';

const EMPHASIS_THRESHOLD = 1.15; // 이 이상 = 강조
const DEEMPHASIS_THRESHOLD = 0.85; // 이 이하 = 약세

/**
 * 현재 저장된 promptBoost 맵을 "최근 학습 결과 요약" 형식의 한글 텍스트로 렌더링.
 * 서버 매핑 조건(6개)은 이미 weights로 반영되므로 제외 — 클라이언트 전용 조건만 표시.
 * 변경된 조건이 없으면 빈 문자열 반환.
 */
export function buildConditionBoostHint(): string {
  const boosts = loadPromptBoosts();
  const emphasized: string[] = [];
  const deemphasized: string[] = [];

  for (const [idStr, boost] of Object.entries(boosts)) {
    const id = Number(idStr);
    if (serverConditionKey(id) !== null) continue; // 서버 매핑 조건은 hard weight 경로
    const name = CONDITION_NAMES[id] ?? `조건${id}`;
    if (boost >= EMPHASIS_THRESHOLD) {
      emphasized.push(`${name}(×${boost.toFixed(2)})`);
    } else if (boost <= DEEMPHASIS_THRESHOLD) {
      deemphasized.push(`${name}(×${boost.toFixed(2)})`);
    }
  }

  if (emphasized.length === 0 && deemphasized.length === 0) return '';

  const lines: string[] = ['[최근 자기학습 결과 — 조건 중요도 소프트 가중]'];
  if (emphasized.length > 0) {
    lines.push(`- 강조(최근 WIN률↑): ${emphasized.slice(0, 5).join(', ')}`);
  }
  if (deemphasized.length > 0) {
    lines.push(`- 약세(최근 WIN률↓): ${deemphasized.slice(0, 5).join(', ')}`);
  }
  lines.push('분석 시 강조 조건의 언급 비중을 높이고, 약세 조건은 참고 수준으로 축소하라.');
  return lines.join('\n');
}
