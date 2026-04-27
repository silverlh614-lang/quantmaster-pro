// @responsibility phaseMapCalibrator 학습 엔진 모듈
/**
 * phaseMapCalibrator.ts — 아이디어 9 (Phase 5): 조건별 시장 사이클 위상 맵.
 *
 * 각 조건의 WIN률이 레짐에 따라 크게 달라진다는 관찰에서 출발.
 * 예: momentum 조건이 R3_EARLY 에서 WIN률 70% 이지만 R1_TURBO(과열기)에서는
 *     40% 미만으로 급락하는 패턴이 있다면, 시스템이 R1_TURBO 에 있을 때는
 *     해당 조건의 가중치를 0.5 등으로 cap 하여 "이미 오른 종목을 추격매수"
 *     하는 함정을 차단한다. SYSTEMATIC ALPHA HUNTER 의 "직전 장세 주도주
 *     경계" 원칙을 조건 레벨로 실현.
 *
 * 판정 규칙:
 *   - 특정 레짐에서 조건의 winRate < 0.4 AND count ≥ 5 → 위험 레짐 등록
 *   - 해당 조건의 condition-weights-{위험레짐}.json 에 cap=0.5 적용
 *   - 정상 회복(winRate ≥ 0.5) 시 cap 해제
 *
 * L4 월간 진화 말미에서 호출. 결과는 data/condition-phase-map.json 으로
 * 영속화하여 대시보드에서 조회 가능.
 */

import fs from 'fs';
import { PHASE_MAP_FILE, ensureDataDir } from '../persistence/paths.js';
import {
  loadConditionWeightsByRegime,
  saveConditionWeightsByRegime,
} from '../persistence/conditionWeightsRepo.js';
import { loadAttributionRecords } from '../persistence/attributionRepo.js';
import {
  analyzeAttribution,
  serverConditionKey,
  CONDITION_NAMES,
} from './attributionAnalyzer.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

const DANGER_WR_THRESHOLD = 0.40;
const RECOVERY_WR_THRESHOLD = 0.50;
const MIN_REGIME_SAMPLES = 5;
const PHASE_CAP = 0.5;

export interface PhaseMapEntry {
  conditionId: number;
  conditionName: string;
  /** 위험 레짐 목록 (현재 cap 적용 중) */
  dangerRegimes: string[];
  /** 각 레짐에서의 WIN률 스냅샷 */
  regimeWinRates: Record<string, { winRate: number; count: number }>;
  updatedAt: string;
}

export interface PhaseMap {
  entries: Record<number, PhaseMapEntry>;
  updatedAt: string;
}

export function loadPhaseMap(): PhaseMap {
  ensureDataDir();
  if (!fs.existsSync(PHASE_MAP_FILE)) {
    return { entries: {}, updatedAt: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(PHASE_MAP_FILE, 'utf-8')) as PhaseMap;
  } catch {
    return { entries: {}, updatedAt: new Date().toISOString() };
  }
}

function savePhaseMap(map: PhaseMap): void {
  ensureDataDir();
  fs.writeFileSync(PHASE_MAP_FILE, JSON.stringify(map, null, 2));
}

/**
 * 조건별 레짐별 WIN률을 분석하여 위험 레짐을 식별하고
 * 해당 레짐의 가중치 파일에 cap(0.5)을 적용한다.
 *
 * @returns { dangerCount, recoveryCount } 신규 위험 등록/회복 건수
 */
export async function updatePhaseMapAndCaps(): Promise<{ dangerCount: number; recoveryCount: number }> {
  const records = loadAttributionRecords();
  if (records.length < 10) {
    console.log('[PhaseMap] 귀인 레코드 부족 — 건너뜀');
    return { dangerCount: 0, recoveryCount: 0 };
  }

  const analysis = analyzeAttribution(records);
  const prev = loadPhaseMap();
  const next: PhaseMap = { entries: {}, updatedAt: new Date().toISOString() };

  const newlyDangered: Array<{ conditionName: string; regime: string; wr: number }> = [];
  const newlyRecovered: Array<{ conditionName: string; regime: string; wr: number }> = [];

  // 서버 매핑 조건만 cap 적용 가능 (클라 전용은 boost 경로로 이미 처리)
  for (const attr of analysis) {
    const key = serverConditionKey(attr.conditionId);
    if (!key) continue;

    const regimeWinRates: PhaseMapEntry['regimeWinRates'] = {};
    const dangerRegimes: string[] = [];

    for (const [regime, stat] of Object.entries(attr.byRegime)) {
      regimeWinRates[regime] = { winRate: stat.winRate, count: stat.count };
      if (stat.count >= MIN_REGIME_SAMPLES && stat.winRate < DANGER_WR_THRESHOLD) {
        dangerRegimes.push(regime);
      }
    }

    next.entries[attr.conditionId] = {
      conditionId: attr.conditionId,
      conditionName: attr.conditionName,
      dangerRegimes,
      regimeWinRates,
      updatedAt: next.updatedAt,
    };

    const prevDanger = new Set(prev.entries[attr.conditionId]?.dangerRegimes ?? []);

    // 신규 위험 레짐 → cap 적용
    for (const regime of dangerRegimes) {
      if (prevDanger.has(regime)) continue;
      const weights = loadConditionWeightsByRegime(regime);
      const current = (weights as Record<string, number>)[key] ?? 1.0;
      if (current > PHASE_CAP) {
        (weights as Record<string, number>)[key] = PHASE_CAP;
        saveConditionWeightsByRegime(regime, weights);
        newlyDangered.push({ conditionName: attr.conditionName, regime, wr: regimeWinRates[regime].winRate });
      }
    }

    // 이전 위험 → 이제 안전(recovery) → cap 해제 (1.0 복원)
    for (const regime of prevDanger) {
      if (dangerRegimes.includes(regime)) continue;
      const rw = regimeWinRates[regime];
      if (!rw || rw.winRate < RECOVERY_WR_THRESHOLD) continue;
      const weights = loadConditionWeightsByRegime(regime);
      const current = (weights as Record<string, number>)[key] ?? 1.0;
      if (current <= PHASE_CAP + 0.01) {
        (weights as Record<string, number>)[key] = 1.0;
        saveConditionWeightsByRegime(regime, weights);
        newlyRecovered.push({ conditionName: attr.conditionName, regime, wr: rw.winRate });
      }
    }
  }

  savePhaseMap(next);

  if (newlyDangered.length > 0 || newlyRecovered.length > 0) {
    const lines: string[] = ['🌀 <b>[Phase Map 업데이트]</b>'];
    if (newlyDangered.length > 0) {
      lines.push(`\n🔒 위험 레짐 cap (×${PHASE_CAP}) 신규 적용 ${newlyDangered.length}건:`);
      for (const d of newlyDangered.slice(0, 8)) {
        lines.push(`  • [${d.regime}] ${d.conditionName}: WIN ${(d.wr * 100).toFixed(0)}%`);
      }
    }
    if (newlyRecovered.length > 0) {
      lines.push(`\n♻️ cap 해제 (1.0 복원) ${newlyRecovered.length}건:`);
      for (const r of newlyRecovered.slice(0, 8)) {
        lines.push(`  • [${r.regime}] ${r.conditionName}: WIN ${(r.wr * 100).toFixed(0)}%`);
      }
    }
    await sendTelegramAlert(lines.join('\n')).catch(console.error);
  }

  console.log(
    `[PhaseMap] 갱신 완료 — 신규 위험 ${newlyDangered.length}건 / 회복 ${newlyRecovered.length}건 / 조건 ${Object.keys(next.entries).length}`,
  );

  // 미사용 인자 회피용 참조
  void CONDITION_NAMES;
  return { dangerCount: newlyDangered.length, recoveryCount: newlyRecovered.length };
}
