# ADR-0184: Emergency Data Quality Guards Wiring — Phase A (scanner start + watchlist sanity)

## Status
Accepted (PR-B12-A)

## Context
ADR-0168b (별칭, `0168-emergency-data-quality-circuit-breaker.md`) 가 *모듈* (`server/dataQuality/emergencyDataQualityGuards.ts`) 을 신설했지만 §"Future wiring" 명시 4 boundary 의 *호출자 0건* dead code 상태. PENDING_WIRING.md B12 P1 SLA 만기 2026-06-19. PR-Governance-Recovery-505 (5/5) 가 거버넌스 정합 회복 후 첫 wiring PR.

audit 결과 4 boundary 매트릭스:
1. **scanner start** — `universeScanner.runStage1PreScreening / runStage2_3FinalScreening / runFullDiscoveryPipeline` 진입부에서 `productionMasterGuard.assertProductionMasterUsable('SCANNER')` 미경유 (cron 직접 호출 경로). `runGuardedFullDiscoveryPipeline` 만 wrap 되어 있고 cron 진입점 unwrapped.
2. **watchlist sanity** — `watchlistRepo.saveWatchlist` 가 `0070X0` 같은 잘못된 KRX code 영속 차단 안 함. 사용자 4/30 보고 시나리오.
3. **autotrade candidate generation** — `buyPipeline.createBuyTask` KRX code sanity 가드 부재.
4. **Stage1 strict reject** — `pipelineHelpers.evaluateStage1Filter` 가 `LOW_VOLUME` / `HIGH_PER` 와 `DATA_MISSING_*` 미분리.

scope 분할 정책 (ADR-0146 회귀 위험 격리 정합):
- **본 PR (B12-A, 본 ADR)**: site 1 + site 2 (scanner start + watchlist sanity) 2 wiring
- **후속 PR (B12-B, 별도 ADR)**: site 3 + site 4 (buyPipeline + Stage1 strict)

## Decision

### Site 1 — scanner start master guard (universeScanner.ts)

신규 헬퍼 `ensureScannerMasterUsable(jobLabel: string): Promise<boolean>` SSOT — 3 진입점 (`runFullDiscoveryPipeline` / `runStage1PreScreening` / `runStage2_3FinalScreening`) 진입부에서 호출.

- ENV `EMERGENCY_MASTER_GUARD_SCAN_ENABLED=true` 명시 시에만 wiring 활성 (default OFF).
- 활성 시 `assertProductionMasterUsable('SCANNER')` 호출 → master 결손 시 SCAN_ABORTED telegram + early return false.
- jobLabel 인자로 dedupeKey + 메시지 분기 — 3 함수 독립 dedupeKey (`scan_aborted_master_unusable:${jobLabel}`).
- try/catch 격리 — telegram throw 가 cron 흐름 차단 안 함.
- 호출자 측 inline ENV 검사 0건 (SSOT 위임).

ENV `EMERGENCY_MASTER_GUARD_SCAN_ENABLED` **default OFF** — productionMasterGuard SSOT 와의 일관성을 운영자가 검증한 후 ENV 활성화 결정. ADR-0173 Phase 3 패턴 정합.

### Site 2 — watchlist invalid KRX code filter (watchlistRepo.ts)

`saveWatchlist(list)` 진입부에서 `normalizeKrxCode(entry.code)` 호출 → null 반환 시 자동 필터링.

- ENV `EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED=true` 명시 시에만 legacy 동작 (default ON).
- 잘못된 code (예: `0070X0` / `XXXXXX` / 빈 문자열 / `.KS` / `.KQ` 접미사 외 알파벳) 자동 필터링.
- 진단 로그 — `console.warn('[Watchlist/CodeGuard] invalid KRX code 자동 필터링 — code="..." name="..." (ADR-0184)')`.
- 정상 6자리 numeric code 만 영속 → 향후 매매·진단 경로의 잘못된 code 영구 차단.

ENV `EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED` **default OFF** (즉 guard **활성**) — 사용자 4/30 보고 결함 (`0070X0` watchlist 영속) 영구 차단 안전.

### ENV 헬퍼 SSOT 2종 신규 (emergencyDataQualityGuards.ts)

```ts
export function isEmergencyMasterGuardScanEnabled(): boolean {
  return process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED === 'true';
}

export function isEmergencyWatchlistCodeGuardEnabled(): boolean {
  return process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED !== 'true';
}
```

호출자 0건 inline ENV 검사 → SSOT 위임으로 drift 차단. ADR-0157 (`evaluateFeedbackLoop` `now?: Date` 옵셔널 inject) 패턴 정합 — 정확 비교 (`=== 'true'`) 의무.

## Consequences

### LIVE 매매 영향

- **site 1 (default OFF)**: 본 PR 머지 직후 코드베이스 동작 100% 보존. 운영자 ENV 활성화 후 SHADOW 1주 검증 → LIVE 활성화 결정.
- **site 2 (default ON)**: `saveWatchlist` 호출 시점 잘못된 code entry 즉시 자동 필터링. 정상 6자리 numeric code 만 영속. 기존 watchlist 의 잘못된 code 는 *이미 영속*된 상태 — 다음 saveWatchlist 사이클에서 자연 정리.

### 후속 PR 의존

- B12-B (site 3 + site 4 별도 PR): `buyPipeline.createBuyTask` KRX code 가드 + `pipelineHelpers.evaluateStage1Filter` strict 분기. 본 ADR 의 ENV 헬퍼 패턴 차용.

### 운영자 활성화 절차

1. 본 PR 머지 후 ENV `EMERGENCY_MASTER_GUARD_SCAN_ENABLED=true` 운영 환경 설정.
2. 1주 SHADOW 검증 — `scan_aborted_master_unusable:*` telegram 빈도 + 차단 사유 분포 확인.
3. 만족 시 LIVE 활성화 (default OFF 그대로 유지하되 운영자가 ENV 명시 활성).
4. 문제 시 ENV `=false` 1줄 즉시 롤백.

## Rollback

ENV 우회 2종 — `EMERGENCY_MASTER_GUARD_SCAN_ENABLED=false` (default OFF) + `EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED=true` (legacy 동작). 둘 다 ENV 1줄 변경으로 즉시 롤백.

코드 레벨 롤백은 universeScanner.ts 의 `ensureScannerMasterUsable` 호출 3건 + watchlistRepo.ts 의 `if (isEmergencyWatchlistCodeGuardEnabled()) {...}` 블록 제거. additive 패턴.

## 잘못된 해결 방법 영구 차단

1. **호출자 측 inline ENV 검사** — drift 위험. 본 ADR 은 SSOT 헬퍼 2종 위임 의무.
2. **wiring 본 PR 통합 (site 3 + 4)** — 회귀 위험. B12-B 별도 PR.
3. **ENV default ON for master guard** — productionMasterGuard SSOT 와의 일관성 미검증. 운영자 결정 위임.
4. **ENV default OFF for watchlist code filter** — 잘못된 code (`0070X0`) 영구 차단 안전. 운영자 결정 불필요.
5. **호출자 측 master guard 직접 호출 (telegram + early return 인라인)** — 3 함수 drift 위험. `ensureScannerMasterUsable` SSOT 위임 의무.
6. **watchlist invalid code 발견 시 throw** — 호출자 (saveWatchlist) 흐름 차단. 자동 필터링 + 진단 로그가 안전.

## References

- ADR-0168b emergency-data-quality-circuit-breaker (모듈 신설)
- PR-Governance-Recovery-505 (B12 PENDING_WIRING 등재)
- ADR-0146 PR 자가 review 5 카테고리 정합
- ADR-0173 Phase 3 ENV gate 패턴
- ADR-0157 ENV `=== 'true'` 정확 비교 의무
