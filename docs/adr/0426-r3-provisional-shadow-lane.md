# ADR-0426: R3_EARLY Provisional Leader Shadow Lane

- **Status**: Accepted
- **Date**: 2026-05-07
- **PR**: TBD (claude/adr-0426-r3-provisional-shadow-lane)
- **Context**: ADR-0420 (Gate1 fresh attribution) + ADR-0422 (Gate2 fresh attribution) + ADR-0423 (SectorEnergy data-truth) + ADR-0424 (SectorEnergy backfill) + ADR-0425 (Gate Decision Router)

## 결정

ADR-0425 Gate Decision Router 위에 stack — **R3_EARLY** 시점 + **Gate1 생존자** 가 데이터 부재 / 섹터 DEGRADED 때문에 Gate2 를 통과하지 못한 후보를 *실매수 차단 유지하면서* **provisional Shadow lane** 으로 학습 샘플 보존.

## 동기

운영 관찰 (2026-05-07):

- regime=R3_EARLY / candidates=50 / gate1Pass=9~10 / gate2Pass=0 / entries=0
- SectorEnergy dataQuality=DEGRADED 또는 STALE / indexCodeCoverage 일부 회복 (예: 18.7%) / leadershipConfidence=BLOCKED
- earnings_quality / per / supply_confluence unavailable
- trend_acceleration / vcp 일부 failed
- **실제 매수뿐 아니라 Shadow buy 도 0에 가까움**

**결함**: Shadow 가 학습용인데도 실제 매수 Gate 와 너무 강하게 결합. R3_EARLY 에서 Gate1 통과한 *초기 주도주 후보* 가 Gate2 완전 통과 전 단계에서 모두 사라져 학습 샘플이 쌓이지 않음.

## 7-단계 결정 트리 SSOT (사용자 §C 정합, 절대 변경 금지)

```typescript
deriveR3ProvisionalShadowCandidate(input): ProvisionalShadowCandidate | null
```

| 우선순위 | 조건 | 결과 |
|---------|------|------|
| 1 | `regime !== 'R3_EARLY'` | null |
| 2 | `emergencyStop / sellOnly / r6Defense` | null (HARD_BLOCK) |
| 3 | `liquidityBlock / rrrBlock` | null (HARD_BLOCK) |
| 4 | `technicalBreakdown` | null (학습 표본 오염 차단) |
| 5 | `router.severity === 'HARD_BLOCK'` | null |
| 6 | `router.severity === 'TRUE_WEAKNESS'` | null (Shadow 도 차단) |
| 7 | `!gate1Passed` | null |
| 8 | `gate2Passed === true` | null (정상 통과 경로) |
| 9 | `router.shadowAllowed === false` | null (방어, ADR-0425 결정 존중) |
| 10 | 그 외 (SOFT_DEGRADE / WATCH_ONLY + Gate1 생존) | **provisional 후보 생성** |

## Schema (사용자 §B 정합)

```typescript
type ProvisionalShadowLabel =
  | 'R3_PROVISIONAL_LEADER_DATA_DEGRADED'      // sector / data unavailable 우세
  | 'R3_PROVISIONAL_LEADER_PRE_BREAKOUT'       // pre-breakout WAIT
  | 'R3_PROVISIONAL_LEADER_GATE2_NOT_CONFIRMED'; // 단순 Gate2 미완

type ProvisionalShadowReason =
  | 'R3_EARLY' | 'GATE1_SURVIVOR' | 'NO_HARD_RISK'
  | 'SOFT_DEGRADE_DATA' | 'SECTOR_DATA_DEGRADED' | 'SECTOR_DATA_STALE'
  | 'DATA_UNAVAILABLE' | 'GATE2_NOT_CONFIRMED' | 'PRE_BREAKOUT_WAIT';

interface ProvisionalShadowCandidate {
  symbol: string;
  name?: string;
  label: ProvisionalShadowLabel;
  reasons: ProvisionalShadowReason[];
  liveAllowed: false;       // ← literal type, 정적 가드 (LIVE 차단 절대 보장)
  shadowAllowed: true;      // ← literal type
  source: 'ADR-0426';       // ← 일반 Shadow buy 와 구분
  regime: 'R3_EARLY';
  gate1Passed: boolean;
  gate2Passed: boolean;
  routerSeverity?: string;
  createdAtKst?: string;
}
```

## label 결정 우선순위 (사용자 §C)

1. `sectorDegraded || sectorStale || dataUnavailable` → **R3_PROVISIONAL_LEADER_DATA_DEGRADED**
2. `blockReasons.preBreakoutWait` → **R3_PROVISIONAL_LEADER_PRE_BREAKOUT**
3. 그 외 (단순 Gate2 미완) → **R3_PROVISIONAL_LEADER_GATE2_NOT_CONFIRMED**

## 핵심 불변식 (사용자 명시 §"절대 하지 말 것" 정합)

1. **LIVE 매수 차단** — `liveAllowed: false` literal type (TypeScript 강제)
2. **KIS 주문 경로 0줄 변경** — KIS 주문 함수 5종 import 0건 (정적 grep 가드)
3. **Gate threshold 변경 0** — Router 호출만, threshold 무관
4. **Gate2 통과 기준 완화 0** — provisional 은 *Gate2 미통과* 후보만 대상
5. **HARD_BLOCK 은 Shadow 도 차단** — emergencyStop/sellOnly/r6Defense 시 null
6. **SOFT_DEGRADE 만 후보 가능** — Router severity 검증
7. **provisional label 별도 분리** — `source: 'ADR-0426'` literal + 3-value label union
8. **학습 샘플 생성 PR** — 매매 정책 완화 아님

## 출력 예시 (`/scan_blockers`)

### eligible > 0 (사용자 보고 시나리오)
```
🌱 R3 Provisional Shadow Lane (ADR-0426)
  • eligible: 3
  • created: 3
  • lanes: live=❌ shadow=✅ watch=✅
  • label: R3_PROVISIONAL_LEADER_DATA_DEGRADED
  • top reasons:
    1. SECTOR_DATA_DEGRADED
    2. DATA_UNAVAILABLE
    3. GATE2_NOT_CONFIRMED
  • provisional 라벨로 일반 Shadow buy 와 분리 영속 — LIVE 매매 영향 0, 학습 샘플 보존 (ADR-0425 SOFT_DEGRADE 위에 stack).
```

### eligible = 0
```
🌱 R3 Provisional Shadow Lane (ADR-0426)
  • eligible: 0
  • created: 0
  • lanes: live=❌ shadow=✅ watch=✅
  • reason: HARD_BLOCK / no Gate1 survivor / true technical breakdown
```

## 본 PR 범위

- `server/trading/signalScanner/provisionalShadowLane.ts` SSOT 신설 (~300 LoC)
- `scanDiagnostics.ts` `ScanSummary.provisionalShadowLane?` 옵셔널 schema + `formatScanBlockersMessage` section 추가
- 회귀 테스트 30 신규 (사용자 §G 12 + 보너스 18)
- LIVE 매매 본체 0줄 변경

## scope 외 (후속 PR)

- **호출자 wiring** — signalScanner 가 종목별 후보 평가 결과를 `summarizeProvisionalShadowCandidates` 로 합성하여 ScanSummary 에 전달 (본 PR 은 SSOT + formatter 만)
- **shadow ledger 실제 entry 영속** — virtual account / shadow buy repo 에 provisional metadata (source/label/reasons) 저장 wiring (사용자 §D — *최소 변경* 정책, 별도 PR 분리 회귀 위험 격리)
- **provisional 성과 리포트** — 주간/월간 provisional shadow 적중률 집계
- **provisional → normal shadow 승격 조건** — Gate2 후속 통과 시 자동 격상 정책 (별도 ADR)
- **provisional → live 전환** — 별도 ADR (현재 절대 금지)
- **/gate_audit 또는 daily summary 분리 카운트** — `shadowProvisional=N` / `liveBuy=0` / `ghost=N` 별도 표시 (사용자 §F)

## 참고 문헌

- ADR-0420 (Fresh Scan Blocker Attribution)
- ADR-0422 (Gate2 / NO_LEADERSHIP fresh attribution)
- ADR-0423 (SectorEnergy data-truth diagnostic)
- ADR-0424 (SectorEnergy indexCode provider repair)
- ADR-0425 (Gate Decision Router — hard block vs soft degrade separation)
