/**
 * conditionAuditor.ts — 아이디어 5: 조건 폐기 & 신규 조건 후보 감지
 *
 * 역할 A — 조건 감사 (Condition Audit):
 *   매월 전체 추천 이력을 기반으로 조건별 성과를 평가하고
 *   ACTIVE → PROBATION → SUSPENDED 상태를 관리한다.
 *
 *   ACTIVE    : 정상 운용
 *   PROBATION : 1개월 이상 저성과 (WR < 35% 또는 Sharpe < 0.2)
 *   SUSPENDED : 3개월 이상 연속 저성과 → 가중치를 0.1로 사실상 비활성화
 *               성과 회복 시 자동으로 ACTIVE로 복구 + 가중치 1.0 복원
 *
 * 역할 B — 신규 조건 후보 발굴:
 *   수익 상위 WIN 거래들에서 공통 패턴을 Gemini로 분석,
 *   현재 8개 조건에 없는 새로운 조건 후보를 텔레그램으로 제안.
 */

import fs from 'fs';
import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import { loadConditionWeights, saveConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { callGemini } from '../clients/geminiClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { calcConditionSharpe, timeWeight } from './signalCalibrator.js';
import { CONDITION_AUDIT_FILE, ensureDataDir } from '../persistence/paths.js';
import type { ConditionWeights } from '../quantFilter.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import {
  appendExperimentalCondition,
  type ExperimentalCondition,
} from '../persistence/experimentalConditionRepo.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

type AuditStatus = 'ACTIVE' | 'PROBATION' | 'SUSPENDED';

interface ConditionAudit {
  conditionKey: string;
  status: AuditStatus;
  /** 연속 저성과 월 수 (0이면 정상, 회복 시 리셋) */
  badMonths: number;
  /** 마지막 업데이트 월 (YYYY-MM) — 월중 중복 실행 방지 */
  lastUpdated: string;
  /** 마지막 평가 시점의 시간 가중 WIN률 (0~100, %) */
  winRate: number;
  /** 마지막 평가 시점의 Sharpe */
  sharpe: number;
  totalTrades: number;
}

type AuditStore = Record<string, ConditionAudit>;

// ── 저성과 판단 임계값 ────────────────────────────────────────────────────────

const LOW_WIN_RATE = 0.35; // 35% 미만 → 저성과
const LOW_SHARPE   = 0.20; // 0.2 미만 → 저성과
const SUSPEND_MONTHS  = 3; // 3개월 연속 저성과 → SUSPENDED
const PROBATION_MONTHS = 1; // 1개월 저성과 → PROBATION
const SUSPENDED_WEIGHT = 0.1; // SUSPENDED 조건 가중치
const RECOVERED_WEIGHT = 1.0; // 회복 시 가중치

// ── 상태 I/O ──────────────────────────────────────────────────────────────────

function loadAuditStore(): AuditStore {
  ensureDataDir();
  if (!fs.existsSync(CONDITION_AUDIT_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONDITION_AUDIT_FILE, 'utf-8')) as AuditStore;
  } catch {
    return {};
  }
}

function saveAuditStore(store: AuditStore): void {
  ensureDataDir();
  fs.writeFileSync(CONDITION_AUDIT_FILE, JSON.stringify(store, null, 2));
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 조건 감사를 실행하고 Gemini로 신규 조건 후보를 제안한다.
 * calibrateSignalWeights() / calibrateByRegime() 이후 호출 권장.
 */
export async function runConditionAudit(): Promise<void> {
  const allRecs = getRecommendations().filter(
    (r) => r.status !== 'PENDING' && r.conditionKeys && r.conditionKeys.length > 0,
  );

  if (allRecs.length < 10) {
    console.log('[ConditionAuditor] 데이터 부족 — 감사 건너뜀');
    return;
  }

  const month = new Date().toISOString().slice(0, 7);

  // 조건별 시간 가중 집계 (전체 이력)
  const condStats: Record<
    string,
    { wWins: number; wTotal: number; returns: number[]; total: number }
  > = {};

  // 아이디어 4 (Phase 2): 현재 라이브 레짐의 반감기로 감사 전체를 감쇠.
  // rec 각자의 entryRegime 이 아닌 "지금 시점의 학습 속도"로 일관 처리한다.
  const liveRegime = getLiveRegime(loadMacroState());

  for (const rec of allRecs) {
    const tw = timeWeight(rec.signalTime, liveRegime);
    for (const key of rec.conditionKeys ?? []) {
      if (!condStats[key]) condStats[key] = { wWins: 0, wTotal: 0, returns: [], total: 0 };
      condStats[key].wTotal += tw;
      condStats[key].total++;
      if (rec.status === 'WIN') condStats[key].wWins += tw;
      if (rec.actualReturn !== undefined) condStats[key].returns.push(rec.actualReturn);
    }
  }

  const store   = loadAuditStore();
  const weights = loadConditionWeights();
  const weightsDirty: boolean[] = [false]; // ref trick for mutation flag

  const statusChanges: string[] = [];
  const suspendedKeys: string[]  = [];
  const recoveredKeys: string[]  = [];

  for (const [key, stat] of Object.entries(condStats)) {
    const winRate  = stat.wTotal > 0 ? stat.wWins / stat.wTotal : 0;
    const sharpe   = calcConditionSharpe(stat.returns);
    const isLowPerf = winRate < LOW_WIN_RATE || sharpe < LOW_SHARPE;

    const prev: ConditionAudit = store[key] ?? {
      conditionKey: key,
      status: 'ACTIVE',
      badMonths: 0,
      lastUpdated: '',
      winRate: 0,
      sharpe: 0,
      totalTrades: 0,
    };

    // 월중 중복 실행 방지: 같은 달이면 badMonths를 다시 증가시키지 않음
    const isNewMonth = prev.lastUpdated !== month;
    const newBadMonths = isNewMonth
      ? (isLowPerf ? prev.badMonths + 1 : 0) // 회복 시 연속 저성과 리셋
      : prev.badMonths;

    const newStatus: AuditStatus =
      newBadMonths >= SUSPEND_MONTHS  ? 'SUSPENDED' :
      newBadMonths >= PROBATION_MONTHS ? 'PROBATION' :
      'ACTIVE';

    // 상태 변화 기록
    if (newStatus !== prev.status) {
      statusChanges.push(
        `${key}: ${prev.status} → ${newStatus}` +
        ` (저성과 ${newBadMonths}개월, WR:${(winRate * 100).toFixed(0)}% SR:${sharpe.toFixed(2)})`,
      );
    }

    // 가중치 조작: SUSPENDED 진입
    if (newStatus === 'SUSPENDED' && prev.status !== 'SUSPENDED') {
      (weights as Record<string, number>)[key] = SUSPENDED_WEIGHT;
      weightsDirty[0] = true;
      suspendedKeys.push(key);
    }

    // 가중치 조작: SUSPENDED에서 복구
    if (prev.status === 'SUSPENDED' && newStatus !== 'SUSPENDED') {
      (weights as Record<string, number>)[key] = RECOVERED_WEIGHT;
      weightsDirty[0] = true;
      recoveredKeys.push(key);
    }

    store[key] = {
      conditionKey: key,
      status: newStatus,
      badMonths: newBadMonths,
      lastUpdated: month,
      winRate: parseFloat((winRate * 100).toFixed(1)),
      sharpe: parseFloat(sharpe.toFixed(2)),
      totalTrades: stat.total,
    };
  }

  saveAuditStore(store);
  if (weightsDirty[0]) saveConditionWeights(weights as ConditionWeights);

  // 텔레그램 알림
  if (statusChanges.length > 0 || suspendedKeys.length > 0 || recoveredKeys.length > 0) {
    const lines: string[] = [`🔍 <b>[Condition Auditor] ${month} 조건 상태 변경</b>\n`];
    if (statusChanges.length > 0) lines.push(...statusChanges.map((s) => `• ${s}`));
    if (suspendedKeys.length > 0)  lines.push(`\n🔕 비활성화 (→${SUSPENDED_WEIGHT}): ${suspendedKeys.join(', ')}`);
    if (recoveredKeys.length > 0)  lines.push(`\n♻️  복구 (→${RECOVERED_WEIGHT}): ${recoveredKeys.join(', ')}`);

    await sendTelegramAlert(lines.join('\n')).catch(console.error);
    console.log(`[ConditionAuditor] 상태 변경: ${statusChanges.join(' | ')}`);
  } else {
    console.log('[ConditionAuditor] 상태 변경 없음');
  }

  // ── 신규 조건 후보 발굴 ───────────────────────────────────────────────────────
  const winTrades = allRecs
    .filter((r) => r.status === 'WIN')
    .sort((a, b) => (b.actualReturn ?? 0) - (a.actualReturn ?? 0))
    .slice(0, 20);
  // 아이디어 6 (Phase 3): LOSS/EXPIRED 대조군도 함께 제공 → Gemini 가 패턴 차이 학습.
  const lossTrades = allRecs
    .filter((r) => r.status === 'LOSS' || r.status === 'EXPIRED')
    .sort((a, b) => (a.actualReturn ?? 0) - (b.actualReturn ?? 0))
    .slice(0, 20);

  if (winTrades.length >= 5) {
    await proposeNewConditions(winTrades, lossTrades);
  }
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

/**
 * Gemini 자유 서술 응답에서 JSON 블록 추출.
 * 응답이 ```json ... ``` 코드펜스 혹은 plain JSON 모두 대응.
 */
function extractJsonBlock(raw: string): string | null {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) return fence[1].trim();
  // 첫 '{' 부터 마지막 '}' 까지
  const first = raw.indexOf('{');
  const last  = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return null;
}

interface GeminiCandidate {
  name?: string;
  dataSource?: string;
  threshold?: number;
  formula?: string;
  rationale?: string;
  passingWinCodes?: string[];
  passingLossCodes?: string[];
}

interface GeminiProposalResponse {
  candidates?: GeminiCandidate[];
  narrative?: string;
}

/**
 * 아이디어 6 (Phase 3) — Gemini 제안 조건 후보를 JSON 으로 받아
 * experimental-conditions.json 에 PROPOSED 상태로 등록.
 *
 * 전달 데이터:
 *   - 수익 상위 WIN trades (최대 20)
 *   - 실패 LOSS/EXPIRED trades (최대 20) — 대조군
 *
 * 요청 포맷(JSON):
 *   {
 *     "candidates": [
 *       {
 *         "name": "...", "dataSource": "YAHOO|KIS|DART",
 *         "threshold": <number?>, "formula": "<expr>",
 *         "rationale": "...",
 *         "passingWinCodes": ["..."],
 *         "passingLossCodes": ["..."]
 *       }
 *     ],
 *     "narrative": "<공통 패턴 요약>"
 *   }
 */
async function proposeNewConditions(
  winTrades: RecommendationRecord[],
  lossTrades: RecommendationRecord[] = [],
): Promise<void> {
  const toSummary = (r: RecommendationRecord) => ({
    code:       r.stockCode,
    return:     `${(r.actualReturn ?? 0).toFixed(1)}%`,
    conditions: (r.conditionKeys ?? []).join(', '),
    regime:     r.entryRegime ?? '미기록',
    signalType: r.signalType,
  });
  const winSummary  = winTrades.map(toSummary);
  const lossSummary = lossTrades.map(toSummary);

  const prompt = [
    '당신은 한국 주식 퀀트 시스템의 시그널 발굴 AI입니다.',
    '아래 두 그룹(WIN / LOSS)을 비교하여 WIN 에만 공통되는 새로운 조건 후보를 제안하세요.',
    '',
    '현재 시스템이 평가하는 조건 8가지:',
    '  momentum, ma_alignment, volume_breakout, per, turtle_high,',
    '  relative_strength, vcp, volume_surge',
    '',
    '=== 수익 상위 WIN 거래 ===',
    JSON.stringify(winSummary, null, 2),
    '',
    '=== 실패 LOSS/EXPIRED 거래 ===',
    JSON.stringify(lossSummary, null, 2),
    '',
    '요청: 아래 JSON 형식으로만 응답하세요. 마크다운/자유 텍스트 금지.',
    '{',
    '  "candidates": [',
    '    {',
    '      "name": "<영문식별자, snake_case>",',
    '      "dataSource": "YAHOO | KIS | DART",',
    '      "threshold": <숫자 또는 생략>,',
    '      "formula": "<조건식 설명, 예: OCF/NetIncome > 1.2>",',
    '      "rationale": "<한국어 2~3줄 근거>",',
    '      "passingWinCodes": ["<WIN 중 이 조건에 부합한다고 판단한 stockCode들>"],',
    '      "passingLossCodes": ["<LOSS 중 이 조건에 부합한다고 판단한 stockCode들>"]',
    '    }',
    '  ],',
    '  "narrative": "<전체 패턴 2~3줄 요약>"',
    '}',
    '',
    '- candidates 는 1~2개만 제안. 현재 8개 조건과 중복되면 안 됩니다.',
    '- passingWinCodes / passingLossCodes 는 반드시 위에 제공된 stockCode 문자열만 사용.',
    '- 외부 검색 불필요. 제공된 데이터만 분석하세요.',
  ].join('\n');

  const raw = await callGemini(prompt, 'condition-auditor');
  if (!raw) return;

  const jsonText = extractJsonBlock(raw);
  if (!jsonText) {
    console.warn('[ConditionAuditor] Gemini 응답에서 JSON 추출 실패 — 자유 서술로 폴백 알림');
    await sendTelegramAlert(
      `💡 <b>[Condition Auditor] 신규 조건 후보 제안 (파싱 실패)</b>\n\n${raw.slice(0, 1500)}`,
    ).catch(console.error);
    return;
  }

  let parsed: GeminiProposalResponse;
  try {
    parsed = JSON.parse(jsonText) as GeminiProposalResponse;
  } catch (e) {
    console.warn('[ConditionAuditor] JSON 파싱 실패:', e instanceof Error ? e.message : e);
    await sendTelegramAlert(
      `💡 <b>[Condition Auditor] 신규 조건 후보 제안 (JSON 오류)</b>\n\n${raw.slice(0, 1500)}`,
    ).catch(console.error);
    return;
  }

  const candidates = (parsed.candidates ?? []).filter(
    (c) => typeof c.name === 'string' && c.name.length > 0,
  );
  if (candidates.length === 0) {
    console.log('[ConditionAuditor] Gemini 제안 후보 0건');
    return;
  }

  const now = new Date().toISOString();
  const savedNames: string[] = [];

  for (const cand of candidates) {
    const entry: ExperimentalCondition = {
      id:              `exp-${Date.now()}-${cand.name!.replace(/[^a-zA-Z0-9_]/g, '_')}`,
      name:            cand.name!,
      dataSource:      cand.dataSource ?? 'UNKNOWN',
      threshold:       typeof cand.threshold === 'number' ? cand.threshold : undefined,
      formula:         cand.formula,
      rationale:       cand.rationale ?? '',
      proposedAt:      now,
      status:          'PROPOSED',
      passingWinCodes:  Array.isArray(cand.passingWinCodes)
        ? cand.passingWinCodes.filter((c) => typeof c === 'string')
        : undefined,
      passingLossCodes: Array.isArray(cand.passingLossCodes)
        ? cand.passingLossCodes.filter((c) => typeof c === 'string')
        : undefined,
    };
    appendExperimentalCondition(entry);
    savedNames.push(entry.name);
  }

  await sendTelegramAlert(
    `💡 <b>[Condition Auditor] 신규 조건 후보 ${savedNames.length}건 등록</b>\n\n` +
    savedNames.map((n) => `• ${n}`).join('\n') +
    (parsed.narrative ? `\n\n📝 <i>${parsed.narrative}</i>` : '') +
    `\n\n다음 L4 사이클의 experimental backtest 단계에서 lift 기준(≥1.15) 통과 시 ` +
    `BACKTESTED_PASSED 로 전이됩니다.`,
  ).catch(console.error);

  console.log(`[ConditionAuditor] 신규 조건 후보 ${savedNames.length}건 PROPOSED 등록: ${savedNames.join(', ')}`);
}
