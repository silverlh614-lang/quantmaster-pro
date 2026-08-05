// @responsibility counterfactual 보드에 outcome 소스별 성숙 분해를 덧붙이는 표시 브리지 (읽기 전용·보드 본체 무접촉).
/**
 * counterfactualOutcomeMaturityBridge.ts — "Mature D1/D3/D5/D10" 분모 정합 진단.
 *
 * 배경(2026-07-31 운영 실측): 보드가 `Total recorded: 1580 · Mature D1/D3/D5/D10:
 * 1143/863/632/0` 을 나란히 표시하는데, 두 수치의 **모집단이 다르다**.
 * 보드는 3 소스를 병합한다:
 *   - `GATE1_DRY_RUN_OBSERVATION` — forwardReturn1D/3D/5D/10D 를 실제로 싣는다
 *   - `COUNTERFACTUAL_LEDGER` / `LEGACY_COUNTERFACTUAL` — 매퍼가 returnD1~D10 을 전부
 *     `null` 로 고정한다(= outcome 미탑재). Total recorded 에는 잡히지만 성숙 카운트엔 0 기여.
 * 따라서 "1580 중 632 성숙(40%)" 처럼 읽으면 실제 성숙률을 과소평가하게 되고,
 * `D10=0` 이 "데이터 부족" 인지 "구조적 미탑재" 인지 구분되지 않는다.
 *
 * 본 모듈은 소스별로 (행 수 · outcome 보유 행 수 · 호라이즌별 성숙 수)를 분해해 그 구분을
 * 드러낸다. 판정은 **경험적** — 매퍼가 나중에 값을 싣기 시작하면 자동으로 반영된다
 * (하드코딩된 "이 소스는 outcome 없음" 가정을 두지 않는다).
 *
 * 안전: 표시 전용. 보드 산출·행 필터·Gate 판정 무접촉. executionImpact=NONE.
 * 보드 본체(`counterfactualOutcomeBoard.ts`, 1,499줄 한계 근접)는 수정하지 않는다
 * — `counterfactualGateEvidenceBridge` 와 동일한 append 패턴.
 */

/** 분해에 필요한 최소 구조 — 보드 행 타입을 import 하지 않는다(구조적 타이핑). */
export interface OutcomeMaturityInputRow {
  sourceType: string;
  returnD1: number | null;
  returnD3: number | null;
  returnD5: number | null;
  returnD10: number | null;
}

export interface OutcomeMaturityBySource {
  sourceType: string;
  rows: number;
  /** D1~D10 중 하나라도 값이 있는 행 수 — 0 이면 해당 소스는 outcome 을 싣지 않는다. */
  withAnyOutcome: number;
  maturedD1: number;
  maturedD3: number;
  maturedD5: number;
  maturedD10: number;
}

/** 표시 순서 고정 — 미지의 sourceType 은 뒤에 붙인다(은폐 금지). */
const KNOWN_SOURCE_ORDER = [
  'GATE1_DRY_RUN_OBSERVATION',
  'COUNTERFACTUAL_LEDGER',
  'LEGACY_COUNTERFACTUAL',
] as const;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 소스별 성숙 분해. 행이 0건인 소스는 결과에 포함하지 않는다. */
export function buildOutcomeMaturityBySource(
  rows: readonly OutcomeMaturityInputRow[],
): OutcomeMaturityBySource[] {
  const acc = new Map<string, OutcomeMaturityBySource>();
  for (const row of rows) {
    const key = typeof row.sourceType === 'string' && row.sourceType ? row.sourceType : 'UNKNOWN';
    let bucket = acc.get(key);
    if (!bucket) {
      bucket = { sourceType: key, rows: 0, withAnyOutcome: 0, maturedD1: 0, maturedD3: 0, maturedD5: 0, maturedD10: 0 };
      acc.set(key, bucket);
    }
    bucket.rows += 1;
    const d1 = finite(row.returnD1);
    const d3 = finite(row.returnD3);
    const d5 = finite(row.returnD5);
    const d10 = finite(row.returnD10);
    if (d1) bucket.maturedD1 += 1;
    if (d3) bucket.maturedD3 += 1;
    if (d5) bucket.maturedD5 += 1;
    if (d10) bucket.maturedD10 += 1;
    if (d1 || d3 || d5 || d10) bucket.withAnyOutcome += 1;
  }
  const ordered: OutcomeMaturityBySource[] = [];
  for (const key of KNOWN_SOURCE_ORDER) {
    const bucket = acc.get(key);
    if (bucket) { ordered.push(bucket); acc.delete(key); }
  }
  for (const bucket of acc.values()) ordered.push(bucket);
  return ordered;
}

/** 사람가독 렌더 — 표시 전용. */
export function formatOutcomeMaturityLines(
  breakdown: readonly OutcomeMaturityBySource[],
): string {
  const lines: string[] = ['[Outcome 소스 분해 — 성숙 분모 정합 진단]'];
  if (breakdown.length === 0) {
    lines.push('- (표시 창에 행 없음)');
    return lines.join('\n');
  }

  for (const b of breakdown) {
    if (b.withAnyOutcome === 0) {
      // 행은 Total recorded 에 잡히지만 성숙 카운트엔 기여하지 않는다 — 정직 표기.
      lines.push(`- ${b.sourceType}: n=${b.rows} · outcome 미탑재 (성숙 카운트 기여 0)`);
      continue;
    }
    lines.push(
      `- ${b.sourceType}: n=${b.rows} · outcome 보유 ${b.withAnyOutcome}` +
        ` · D1 ${b.maturedD1} / D3 ${b.maturedD3} / D5 ${b.maturedD5} / D10 ${b.maturedD10}`,
    );
  }

  const carriers = breakdown.filter((b) => b.withAnyOutcome > 0);
  const nonCarriers = breakdown.filter((b) => b.withAnyOutcome === 0);
  const totalRows = breakdown.reduce((sum, b) => sum + b.rows, 0);
  const carrierRows = carriers.reduce((sum, b) => sum + b.rows, 0);

  if (nonCarriers.length > 0) {
    lines.push(
      `※ 성숙 카운트 분모는 outcome 보유 소스 ${carrierRows}건이며 Total recorded ${totalRows}건과 다르다` +
        ` (미탑재 ${totalRows - carrierRows}건 제외).`,
    );
  }

  // D10 이 0 인 이유를 "데이터 부족" 과 "구조적 미탑재" 로 분리해 준다.
  const d10Total = carriers.reduce((sum, b) => sum + b.maturedD10, 0);
  const d5Total = carriers.reduce((sum, b) => sum + b.maturedD5, 0);
  if (d10Total === 0 && carrierRows > 0) {
    lines.push(
      d5Total > 0
        ? `※ D10=0 — D5 는 ${d5Total}건 성숙했으므로 소스 미탑재가 아니라 10영업일 성숙분 부재로 읽어야 한다.`
        : '※ D10=0 — D5 도 0 이라 아직 성숙 초기 단계.',
    );
  }
  return lines.join('\n');
}

/**
 * 보드 출력에 분해 진단을 덧붙인다. 실패해도 본문은 보존한다(표시 전용).
 * `counterfactualGateEvidenceBridge.appendGateEvidenceForMode` 와 동일 계약.
 */
export function appendOutcomeMaturityDiagnostic(
  baseText: string,
  rows: readonly OutcomeMaturityInputRow[],
): string {
  try {
    return `${baseText}\n${formatOutcomeMaturityLines(buildOutcomeMaturityBySource(rows))}`;
  } catch {
    return `${baseText}\n[OutcomeMaturityBridge] 분해 실패 — 표시 생략 (executionImpact=NONE)`;
  }
}
