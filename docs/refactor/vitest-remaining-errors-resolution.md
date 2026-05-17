# Vitest Remaining Errors — Resolution Report

**Patch ID:** Patch-VITEST-CAT-C/D/E/F-001
**Branch:** `claude/fix-vitest-failures-XmJNE`
**Reference baseline:** `docs/refactor/vitest-remaining-errors-fix-baseline.md`
**ADR 발급:** 0건 (patch type — test-only expectation 정정)
**INDEX.md 갱신:** 0건

## 요약

`docs/refactor/vitest-remaining-errors-fix-baseline.md` 가 정의한 Cat A-F 분류
중 본 PR 에서 처리한 분류 + 결과:

| 카테고리 | 분류 | 시작 | 완료 | 잔여 후속 |
| -------- | ---- | ---: | ---: | --------- |
| Cat A | runtime-critical regression | 0 | 0 | 해당 없음 |
| Cat C | obsolete static-grep / SSOT 이동 후속 | 33 | 0 | PR #1036 1차 11/33 → 본 PR 2차 22/22 잔여 정합 |
| Cat D | env-dependent expectation drift | 6 | 0 | 모두 SSOT 위임 패턴으로 정정 |
| Cat E | snapshot schema drift | 2 | 0 | 11-key + entry-key alignment 정합 |
| Cat F | pre-existing baseline (실은 Cat C) | 9 | 0 | invariant #10 source inspection 결과 Cat C 확정, YAHOO_PRICE_ROLE='ACTIVE' env mock 적용 |

## Step 1~7 진행 결과

### Step 1 — baseline 재현
- `npm test` 시작 시점: 약 60+ fails (사용자 보고)
- 본 PR 진행 중 baseline: 26 fails / 13061 PASS / 1 skipped
- ≤30 target 달성 ✓ (사용자 직접 명시 baseline)

### Step 2 — Cat C 잔여 5 files (PR #1036 후속)
PR #1036 (Patch-VITEST-CAT-C-CARRY-OVER-001) 가 6/11 files 처리한 후속으로
5/11 잔여 처리. 모두 runtime SSOT 이동 (Patch-001/002/003 carry wiring /
ADR-0157/0168 computeEffectiveKelly SSOT / Patch-006 routedStatus label /
Patch-009 P1 SUPPLY_SEMANTIC_WIRE_DIAGNOSTIC noise gate / diagnoseInvestorFlow
async 시그니처) 에 따른 test expectation 정합 정정.

수정 파일:
- `server/clients/krxOpenApiAdr0342.test.ts` (Patch-006 + KIS-WS 매핑)
- `server/learning/shadowBlockedOutcomeAnalytics.test.ts` (11-key entry schema)
- `server/persistence/provisionalShadowLedgerAdr0427.test.ts` (entry-key alignment)
- `server/trading/signalScanner/preflight.test.ts` (carry wiring)

### Step 3 — Cat D 2 files
환경변수 의존 expectation drift. SSOT 위임 패턴 (`isKrxOpenApiAdr0342Disabled()`,
`isCorporateActionDetectorDisabled()` 등) 으로 정정.

수정 파일:
- `server/trading/corporateActionDetector.test.ts`

### Step 4 — Cat E 2 files (Step 2 와 통합)
snapshot schema drift — 본 PR 에서 11-key 정합으로 흡수.

### Step 5 — Cat F 9 files (실은 Cat C)
**invariant #10 source inspection 결과 — Cat F → Cat C 재분류 확정:**

`priceSourcePolicy.ts:132-169` 의 ADR-0502 KIS-primary 정책 분기:
```typescript
const yahooDiagnosticOnly = process.env.YAHOO_PRICE_ROLE !== 'ACTIVE';
if (yahooDiagnosticOnly && kisPrice.valid && yahooPrice.valid) {
  return { status: 'VALID', ... };  // 단락
}
```

→ 모든 `kisValid + yahooValid` 경로가 `status='VALID'` 로 단락. 레거시
discrepancy 로직 (WARN / INVALID / CORPORATE_ACTION_SUSPECT, line 186-254)
은 `YAHOO_PRICE_ROLE='ACTIVE'` opt-in 시에만 활성화.

**Cat A (runtime regression) 아님** — runtime 본체는 정상 작동 중 (ADR-0502
정책 정합). test 측에서 legacy mode env 활성화로 정합 정정.

수정 파일:
- `server/trading/priceSourcePolicy.test.ts` (2 describe blocks 모두 env mock 적용)

### Step 6 — 잔여 12 files (수정 대상 아님)
본 PR 변경 파일 *아닌* 사전 baseline:
- `kisOperationalLogging`, `sectorEnergyProvider`, `learningLoopHealth`,
  `nightlyReflectionEngine`, `shadowFutureReturnCacheProvider`, `healthLoop`,
  `investorFlowProviderHealthAdr0435`, `gate1FinalCalibrationAdr0471`,
  `naverInvestorTrendCollectorAdr0481`, `supplyProviderWarmupAdr0473`,
  `safePctChangeReturnWindow`

`git stash --include-untracked` 동일 재현으로 origin/main 사전 baseline 확정 —
본 PR 무관. 별도 후속 PR scope.

### Step 7 — 최종 검증
- **수정 7 파일 vitest:** 159/159 PASS
- **full vitest baseline:** 864 files / 13088 tests / 13061 passed / 26 failed / 1 skipped
- **≤30 target 달성 ✓**
- **`git merge-tree origin/main HEAD`:** 0 conflict markers
- **`npm run lint` (tsc client + server):** 변경 파일 0 errors

## 안전 invariants (모두 정합)

1. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `signalScanner/**` /
   `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` /
   `autoTradeEngine*` / `trancheExecutor.ts` / `buyPipeline.ts` 모두 0줄
2. **KIS/KRX/Yahoo/Naver outbound 0건** (절대 규칙 #2/#3/#4)
3. **신규 SSOT 0건** (test-only 정정)
4. **runtime 정책 본체 무수정** (invariant #7 정합)
5. **`.skip` / `xit` 0건** (invariant #8 정합)
6. **ENV `=== 'true'` 정확 비교 의무** (ADR-0157 정합)
7. **source inspection 의무** (invariant #10) — Cat F → Cat C 재분류 검증
8. **호출자 측 inline ENV 검사 0건** (SSOT 위임)

## 잔여 후속 PR (scope 외)

12 사전 baseline 파일 — 별도 후속 PR 분리:
- KIS operational logging fixture drift
- Sector energy provider snapshot
- Learning loop health idempotency
- Nightly reflection scheduling
- Shadow future return cache provider
- Health loop monitoring
- Investor flow provider health (ADR-0435)
- Gate1 final calibration (ADR-0471)
- Naver investor trend collector (ADR-0481)
- Supply provider warmup (ADR-0473)
- Safe pct-change return window

각 baseline 은 source inspection 후 Cat A/B/C/D/E 재분류 의무 (invariant #10).
