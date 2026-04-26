// @responsibility promptBoostRepo 영속화 저장소 모듈
/**
 * promptBoostRepo.ts — 아이디어 1: 클라이언트 조건(21개) 학습 커버리지 확장.
 *
 * 서버 ConditionKey(6개)로 매핑되지 않는 21개 조건(ROE 유형3, 일목균형표,
 * 이자보상배율 등)은 condition-weights.json 조정 경로가 없다. 이 파일은
 * 그 조건들의 WIN률·Sharpe 기반 "Gemini 프롬프트 boost 맵"을 저장하여
 * Pre-Mortem/스코어카드 등 LLM 분석 프롬프트의 해당 조건 언급 비중을
 * 소프트 가중으로 조정한다.
 *
 * boost 범위: 0.5 ~ 1.5 (기본 1.0). 1.0 초과는 "강조", 미만은 "약세".
 */

import fs from 'fs';
import { PROMPT_BOOSTS_FILE, ensureDataDir } from './paths.js';

/** conditionId (1~27) → boost (0.5~1.5) */
export type PromptConditionBoost = Record<number, number>;

const BOOST_MIN = 0.5;
const BOOST_MAX = 1.5;

export function clampBoost(v: number): number {
  if (!Number.isFinite(v)) return 1.0;
  return Math.max(BOOST_MIN, Math.min(BOOST_MAX, parseFloat(v.toFixed(2))));
}

export function loadPromptBoosts(): PromptConditionBoost {
  ensureDataDir();
  if (!fs.existsSync(PROMPT_BOOSTS_FILE)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(PROMPT_BOOSTS_FILE, 'utf-8')) as Record<string, number>;
    const out: PromptConditionBoost = {};
    for (const [k, v] of Object.entries(raw)) {
      const id = Number(k);
      if (!Number.isInteger(id) || id < 1 || id > 27) continue;
      out[id] = clampBoost(Number(v));
    }
    return out;
  } catch {
    return {};
  }
}

export function savePromptBoosts(boosts: PromptConditionBoost): void {
  ensureDataDir();
  fs.writeFileSync(PROMPT_BOOSTS_FILE, JSON.stringify(boosts, null, 2));
}

/** 특정 조건의 현재 boost 값 (없으면 1.0) */
export function getConditionBoost(conditionId: number): number {
  const boosts = loadPromptBoosts();
  return boosts[conditionId] ?? 1.0;
}
