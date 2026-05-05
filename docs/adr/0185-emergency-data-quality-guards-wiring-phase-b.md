# ADR-0185: Emergency Data Quality Guards Wiring — Phase B (autotrade candidate + Stage1 strict)

## Status
Accepted (PR-B12-B)

## Context
ADR-0184 (PR-B12-A) 가 ADR-0168b §"Future wiring" 4 boundary 중 site 1 (scanner start master guard) + site 2 (watchlist invalid code filter) 처리 후 site 3 + site 4 잔여를 본 PR-B12-B 별도 ADR 로 분리. PENDING_WIRING B12 PARTIAL → DECIDED_NOT_WIRING (4 boundary 모두 처리 완료) 격상.

## Decision

### Site 3 — buyPipeline.createBuyTask KRX code sanity (default ON)

`createBuyTask(p)` 진입부 (cooldown 가드보다 *먼저*) 에서 `normalizeKrxCode(p.stockCode)` null 시 즉시 SKIP 패턴.

- ENV `EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED=true` 명시 시 legacy 동작 (default ON).
- `throw` 가 아닌 *early SKIP* (REJECTED + onRejected) — 매수 흐름 차단 위험 격리.
- signalId 있을 시 `markBlocked({ id, gate: 'DATA', reason: 'INVALID_KRX_CODE: ...' })` (try/catch 격리, 영속 throw 가 매수 흐름 차단 안 함).
- 진단 로그 — `console.warn('[BuyPipeline/CodeGuard] invalid KRX code 자동 SKIP — code="..." name="..." (ADR-0185)')`.

site 2 (watchlist) 와 정합 — 잘못된 code 가 우회 경로로 buyPipeline 진입 시 추가 안전망. ENV default ON 으로 사용자 4/30 보고 결함 (`0070X0` 영속) 의 매수 진입 경로 차단.

### Site 4 — pipelineHelpers.evaluateStage1Filter strict 분기 (default OFF)

`evaluateStage1Filter(quote)` 진입부에서 `classifyStage1RejectStrict({ quote, fundamental })` 우선 호출 → `DATA_MISSING_*` 5종 (`QUOTE / PRICE / VOLUME / PER / RETURN`) 분리.

- ENV `EMERGENCY_STAGE1_STRICT_ENABLED=true` 명시 시 strict 분기 활성 (default OFF).
- legacy 동작: `quote.price < t.MIN_PRICE` 같은 비교에서 `NaN < N` → false (NaN comparison 결함) → 데이터 결손 종목이 `LOW_VOLUME` / `HIGH_PER` 같은 *real reject* 로 잘못 분류되어 Stage1 audit 통계 오염.
- strict 분기: `Number.isFinite()` 검증 우선 → `DATA_MISSING_*` 분리. legacy reject 사유와 의미 구분.
- `Stage1RejectionReason` union 5종 확장 + `EMPTY_REASON_COUNTS` SSOT 5건 추가.

ENV **default OFF** — Stage1 통계 분포 (`getStage1RejectionCounts`) 영향이 있어 운영자가 분포 변동 영향 검증 후 활성화 결정. ADR-0173 Phase 3 / ADR-0184 site 1 패턴 정합.

### ENV 헬퍼 SSOT 2종 신규 (emergencyDataQualityGuards.ts)

```ts
export function isEmergencyBuyPipelineCodeGuardEnabled(): boolean {
  return process.env.EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED !== 'true';
}

export function isEmergencyStage1StrictEnabled(): boolean {
  return process.env.EMERGENCY_STAGE1_STRICT_ENABLED === 'true';
}
```

호출자 0건 inline ENV 검사 → SSOT 위임으로 drift 차단. ADR-0157 정확 비교 (`=== 'true'` / `!== 'true'`) 의무 정합.

## Consequences

### LIVE 매매 영향

- **site 3 (default ON)**: 정상 6자리 KRX code 는 가드 통과 → 후속 흐름 변경 없음. 잘못된 code 만 즉시 SKIP. *우회 경로* 의 최후 안전망.
- **site 4 (default OFF)**: 본 PR 머지 직후 코드베이스 동작 100% 보존. 운영자 ENV 활성화 후 1주 검증 → Stage1 audit 통계 분포 격상.

### 후속 PR 의존

- B12-A site 1 + site 2 와 결합 — ADR-0168b §"Future wiring" 4 boundary 모두 처리 완료. PENDING_WIRING B12 PARTIAL → DECIDED_NOT_WIRING 격상 가능.

### 운영자 활성화 절차

1. 본 PR 머지 후 ENV `EMERGENCY_STAGE1_STRICT_ENABLED=true` 운영 환경 설정.
2. 1주 검증 — `/health` 또는 Stage1 audit 텔레그램에서 `DATA_MISSING_*` 분포 확인.
3. 만족 시 ENV 활성화 유지 (default OFF 그대로 유지하되 운영자가 ENV 명시 활성).
4. 문제 시 ENV `=false` 1줄 즉시 롤백.

## Rollback

ENV 우회 2종 — `EMERGENCY_BUY_PIPELINE_CODE_GUARD_DISABLED=true` (legacy 동작) + `EMERGENCY_STAGE1_STRICT_ENABLED=false` (default 그대로). 둘 다 ENV 1줄 변경으로 즉시 롤백.

코드 레벨 롤백은 buyPipeline.ts 의 KRX code guard 블록 제거 + pipelineHelpers.ts 의 strict 분기 + EMPTY_REASON_COUNTS 5건 추가 제거. additive 패턴.

## 잘못된 해결 방법 영구 차단

1. **site 3 normalizeKrxCode null 시 throw** — 매수 흐름 차단 위험. *early SKIP* (REJECTED + onRejected) 패턴 의무.
2. **site 4 strict 분기 default ON** — Stage1 audit 통계 분포 격상은 운영자 결정. default OFF 의무.
3. **호출자 측 inline ENV 검사** — drift 위험. SSOT 헬퍼 위임 의무.
4. **markBlocked throw 가 매수 흐름 차단** — try/catch 격리 의무 (ADR-0184 패턴 정합).
5. **DATA_MISSING_* 분기를 legacy reject 와 통합** — audit 통계 의미 손실. union 확장 + SSOT 분리 의무.
6. **classifyStage1RejectStrict 의 minPrice/minVolume/maxPer 임계 사용** — legacy 분기와 중복. strict 분기는 *DATA_MISSING_* 만 선별*, 임계 비교는 legacy 분기에 위임.

## References

- ADR-0168b emergency-data-quality-circuit-breaker (모듈 신설)
- ADR-0184 PR-B12-A (site 1 + site 2 wiring)
- PENDING_WIRING B12 P1 (SLA 만기 2026-06-19)
- ADR-0146 PR 자가 review 5 카테고리 정합
- ADR-0157 ENV `=== 'true'` 정확 비교 의무
