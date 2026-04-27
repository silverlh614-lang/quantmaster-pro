// @responsibility silentKnowledgeDistillation 학습 엔진 모듈
/**
 * silentKnowledgeDistillation.ts — Silent Knowledge Distillation (#7).
 *
 * 매주 일요일 저녁 18:00 (KST). 지난 7일 반성 리포트 → Gemini → "이번 주 1줄 교훈" 추출.
 * data/knowledge/distilled-weekly.txt 에 append. RAG 빌드 시 자동 편입.
 *
 * 4주면 4개, 1년이면 ~52개의 본인 데이터로 훈련된 지혜 문구 축적.
 * 외부 교과서가 아닌 "참뮌의 교과서".
 *
 * 호출: cron (reflectionJobs 에서 등록) 매주 일요일 KST 18:00 (UTC 09:00).
 * 예산: Budget Governor SILENT 모드 아닐 때만. 1주 1회 — 비용 부담 미미.
 */

import fs from 'fs';
import { callReflectionGemini } from './reflectionModules/reflectionGemini.js';
import { loadRecentReflections } from '../persistence/reflectionRepo.js';
import { DISTILLED_WEEKLY_FILE, ensureKnowledgeDir } from '../persistence/paths.js';
import type { ReflectionReport } from './reflectionTypes.js';

const MAX_INPUT_SIZE = 6000; // 프롬프트 상한 (토큰 절감)

function summarizeReport(r: ReflectionReport): string {
  const lessons = (r.keyLessons ?? []).slice(0, 2).map((c) => c.text).join(' ');
  const adj     = (r.tomorrowAdjustments ?? []).slice(0, 1).map((c) => c.text).join(' ');
  return `[${r.date} ${r.dailyVerdict}] ${lessons}${adj ? ' · 조정: ' + adj : ''}`;
}

export interface DistillResult {
  executed: boolean;
  skipped?: 'INSUFFICIENT_REPORTS' | 'GEMINI_NULL';
  lesson?: string;
}

/**
 * 지난 7일 반성 리포트를 Gemini 에 주입하여 1줄 교훈을 추출·저장한다.
 */
export async function distillWeeklyKnowledge(): Promise<DistillResult> {
  const reports = loadRecentReflections(7);
  if (reports.length < 3) {
    // 3일 미만이면 의미 있는 축약 불가
    return { executed: false, skipped: 'INSUFFICIENT_REPORTS' };
  }

  const digest = reports.map(summarizeReport).join('\n').slice(0, MAX_INPUT_SIZE);
  const prompt = [
    '너는 한국 주식 트레이더의 주간 축약 큐레이터이다.',
    '지난 7일의 매일 반성 리포트 요약이 주어진다. 가장 중요한 교훈 1개를 1문장(100자 이내)으로 뽑아라.',
    '원칙: 추상적 격언 금지. 오직 주어진 입력에 기반한 구체 명제여야 한다.',
    '',
    '입력:',
    digest,
    '',
    '출력: 딱 1문장. 따옴표/머리표/번호 금지.',
  ].join('\n');

  const raw = await callReflectionGemini(prompt, 'silentKnowledgeDistillation');
  if (!raw || raw.trim().length < 10) {
    return { executed: false, skipped: 'GEMINI_NULL' };
  }

  // 깨끗한 한 줄로 정리
  const lesson = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)[0]
    ?.replace(/^["'「]/, '')
    .replace(/["'」]$/, '')
    .trim();

  if (!lesson || lesson.length < 10) {
    return { executed: false, skipped: 'GEMINI_NULL' };
  }

  // append 파일 생성·기록
  ensureKnowledgeDir();
  const today = new Date().toISOString().slice(0, 10);
  const line = `[${today}] ${lesson}\n`;
  fs.appendFileSync(DISTILLED_WEEKLY_FILE, line);

  return { executed: true, lesson };
}
