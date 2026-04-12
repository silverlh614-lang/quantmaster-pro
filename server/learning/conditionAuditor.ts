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

  for (const rec of allRecs) {
    const tw = timeWeight(rec.signalTime);
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

  if (winTrades.length >= 5) {
    await proposeNewConditions(winTrades);
  }
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

async function proposeNewConditions(winTrades: RecommendationRecord[]): Promise<void> {
  const summary = winTrades.map((r) => ({
    code:       r.stockCode,
    return:     `${(r.actualReturn ?? 0).toFixed(1)}%`,
    conditions: (r.conditionKeys ?? []).join(', '),
    regime:     r.entryRegime ?? '미기록',
    signalType: r.signalType,
  }));

  const prompt = [
    '당신은 한국 주식 퀀트 시스템의 시그널 발굴 AI입니다.',
    '아래는 최근 수익률이 가장 높았던 WIN 거래들의 통과 조건 목록입니다.',
    '',
    '현재 시스템이 평가하는 조건 8가지:',
    '  momentum(+2% 이상), ma_alignment(5일>20일>60일 정배열),',
    '  volume_breakout(5일평균 거래량 2배), per(PER<20),',
    '  turtle_high(20일 신고가), relative_strength(상대강도 +1.5%),',
    '  vcp(ATR 축소<평균70%), volume_surge(거래량3배+상승1%)',
    '',
    '=== 수익 상위 WIN 거래 (최대 20건) ===',
    JSON.stringify(summary, null, 2),
    '',
    '요청:',
    '1. 위 거래들에서 공통적으로 나타나는 패턴을 2~3가지 분석해주세요.',
    '2. 현재 8개 조건에 없는 새로운 조건 후보 1~2가지를 한국어로 제안해주세요.',
    '3. 각 후보 조건이 어떤 데이터(Yahoo Finance 또는 KIS API)로 측정 가능한지 설명해주세요.',
    '4. 각 후보 조건의 기대 승률 향상 근거를 간략히 제시해주세요.',
    '외부 검색 불필요. 제공된 데이터만 분석하세요.',
  ].join('\n');

  const suggestion = await callGemini(prompt, 'condition-auditor');
  if (suggestion) {
    await sendTelegramAlert(
      `💡 <b>[Condition Auditor] 신규 조건 후보 제안</b>\n\n${suggestion}`,
    ).catch(console.error);
    console.log('[ConditionAuditor] 신규 조건 후보 Gemini 분석 완료');
  }
}
