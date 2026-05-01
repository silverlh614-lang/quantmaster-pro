# ADR-0150: Phase 1 DART 펀더멘털 4 → 5 키 격상 (performanceReality + economicMoatVerified)

**날짜**: 2026-05-01
**상태**: 채택
**관련 PR**: PR-Phase1-DartFinalize (PR-Phase0-Audit `_workspace/audit-pr-phase0/findings.md` §B 후속)
**관련 ADR**:
- ADR-0149 (PR-Phase0-MappingFix) — 27 조건 SSOT mismatch 수리, 본 PR 의 *전제 조건*
- ADR-0029 (PR-B 조건 출처 Tier) — `buildConditionSourceTiers` 도입
- ADR-0011 (AI 추천 KIS/KRX 분리) — DART 단일 통로 정책

## 문제

PR-Phase0-Audit 검증 결과, DART 가 산출하는 6 필드 (`roe / debtRatio / interestCoverageRatio / netProfitMargin / epsGrowth / ocfGreaterThanNetIncome`) 중 *3개* 만 27 조건 checklist 에 격상 매핑되어 있고, *2개 (debtRatio + epsGrowth)* 는 `valuation` 객체에만 저장되어 학습/추천 게이트 입력으로 사용 안 됨. `netProfitMargin` 은 dartDataFetcher 산출만 되고 호출자 0건 (사실상 dead).

```
DART 6 필드 → 27 조건 격상 현황 (PR-Phase0 audit):
  roe                       → roeType3 (#3)              ✅ 격상 완료
  debtRatio                 → valuation.debtRatio          ❌ checklist 미매핑
  interestCoverageRatio    → interestCoverage (#23)      ✅ 격상 완료
  netProfitMargin          → (사용처 0건)                  ❌ dead code
  epsGrowth                → valuation.epsGrowth           ❌ checklist 미매핑
  ocfGreaterThanNetIncome  → ocfQuality (#21)             ✅ 격상 완료
```

audit findings 권장: `performanceReality` (#15) ← `epsGrowth > 0` (~4 줄) + `economicMoatVerified` (#8) ← `debtRatio + netProfitMargin` 합성 (~10 줄). 추정 ~30~50 LoC.

외부 지침서가 가정한 *Phase 1 ~150 LoC* 는 audit 결과 *3/4 이미 완료* 상태로 잘못된 추정 — 실제는 *마무리 작업 ~50 LoC*.

## 결정

### 1. `performanceReality` (#15) ← `epsGrowth > 0`

**의미**: 실체적 펀더멘털 — 전년 대비 당기순이익 성장 검증.

**임계**: `dartFinancials?.epsGrowth ?? 0 > 0` → 1, 그 외 0 (또는 기존 stock.checklist 값 보존).

**공식**: `dartDataFetcher.ts:75-77` 의 EPS 성장률 = `(netIncome - priorNetIncome) / |priorNetIncome| × 100`. 양수면 성장, 0/음수는 감소. `priorNetIncome=0` 시 0 fallback (ZeroDivision 회피).

**DART 한계**: 정확한 EPS 가 아닌 *당기순이익 성장률* (주식수 변동 없는 가정 하에 EPS 의 프록시). `dartDataFetcher.ts:74` 주석 명시. 더 정확한 EPS 는 외부 컨센서스 source 필요 (Phase 4 BLOCKED).

### 2. `economicMoatVerified` (#8) ← `debtRatio < 50% AND netProfitMargin > 5%`

**의미**: 경제적 해자 — 낮은 부채 + 높은 자산 대비 순이익률 (ROA-like 지표) 합성.

**임계**:
- `debtRatio < 50%` (자기자본 기준 부채비율 50% 미만 — 보수적 재무 구조)
- `netProfitMargin > 5%` (자산 대비 순이익률 5% 초과 — 건전한 수익성)
- 두 조건 *AND* 충족 시 1, 그 외 기존 stock.checklist 값 보존.

**왜 50% / 5%**:
- `debtRatio < 50%`: 한국 우량주 보수 임계 (코스피 평균 ~80% 대비 50% 미만은 상대적 우량)
- `netProfitMargin > 5%`: 한국 시총 상위 평균 영업이익률 (ROA) ~5% 부근. 일관 흑자 + 양호 수익성 검증.
- 임계값은 후속 PR 에서 데이터 기반 재조정 가능 (ENV 우회 미도입 — 정책 SSOT 단일 출처).

**격상 불가능 기준 명시**: 진정한 해자 (브랜드 / 네트워크 효과 / 전환 비용 / 비용 우위 / 무형자산) 는 정성 분석 영역. DART 정량 임계는 *대리 지표* 만. AI 추정 (`stock.checklist.economicMoatVerified`) 보존이 fallback.

### 3. `buildConditionSourceTiers` 'API' 분류 격상 (3 → 5 키)

ADR-0029 패턴 정합. `hasDartFinancials=true` 시:
```typescript
meta.roeType3 = 'API';
meta.ocfQuality = 'API';
meta.interestCoverage = 'API';
meta.performanceReality = 'API';     // 신규 (ADR-0150)
meta.economicMoatVerified = 'API';   // 신규 (ADR-0150)
```

UI DataQualityBadge 가 격상된 5 키를 'API' tier 로 표시 → 'AI_INFERRED' 카운트 21 → 19 감소 (audit findings §A 정합).

### 4. main path + aiFallback 두 path 동시 격상

`enrichment.ts` 의 두 경로 모두 동일 임계 적용:
- **main path** (라인 459-464): Yahoo OHLCV + DART + KIS supply 가용
- **aiFallback path** (라인 337-339): Yahoo 부재 시 DART + Naver snapshot 만 가용

aiFallback 경로 격상 누락 시 *Yahoo 일시 장애* 시점에 펀더멘털 게이트가 닫히는 문제 발생. ADR-0029 PR-B 패턴 그대로 — 두 경로 정합.

## 영향

### 27 조건 격상 진행도 (audit findings §E 정합)

| Phase | 누적 격상 % | 격상 항목 |
|---|---|---|
| 이전 (PR-Phase0 시점) | 44% (12개) | REAL_DATA 9 + DART 3 |
| **본 PR (Phase 1)** | **52% (14개)** | **+ #15 performanceReality, #8 economicMoatVerified** |
| Phase 2 (KIS supply) | 59% (16개) | + #4 supplyInflow, #12 institutionalBuying |
| Phase 3 (globalIntel 합성) | 70% (19개) | + #5 riskOnEnvironment, #1 cycleVerified, #16 policyAlignment |
| Phase 4 (외부 컨센서스, BLOCKED) | 78% (21개) | + #14 earningsSurprise, #13 consensusTarget |
| 격상 불가능 (정성, DECIDED_NOT_WIRING) | 100% | 22% (5개) — #9/13/17/20/26 |

### 학습 가중치 입력

`buildEntryConditionScores` (ADR-0149 정합) — 매수 시점 영속 시 격상된 #8/#15 점수가 정확한 ID 위치에 누적. attribution 분석이 신규 매수부터 정합 가중치 입력 사용.

### LIVE 매매 영향

- 신규 매수 candidate 평가 시 `economicMoatVerified=1` (재무 우량) 종목 자연 우대.
- `performanceReality=1` (성장 검증) 종목도 동일 우대.
- 기존 stock.checklist (Gemini AI 추정) fallback 보존 — DART 부재 시 회귀 0.

## 회귀 테스트

`src/services/stock/__tests__/enrichmentDartFinalize.test.ts` 신규 (또는 기존 enrichment 테스트 확장):

1. **performanceReality 임계 분기** — epsGrowth=10 → 1 / epsGrowth=0 → 0 / epsGrowth=-5 → 0 / epsGrowth=undefined → 0
2. **economicMoatVerified 합성 분기** — debtRatio=30+netProfitMargin=8 → 1 / debtRatio=60+netProfitMargin=8 → fallback / debtRatio=30+netProfitMargin=3 → fallback / 둘 다 부재 → fallback
3. **stock.checklist fallback 보존** — DART 부재 시 economicMoatVerified 가 기존 AI 추정 그대로
4. **buildConditionSourceTiers 'API' 5 키** — hasDartFinancials=true 시 #3/#8/#15/#21/#23 모두 'API'
5. **main + aiFallback 동일 임계** — 두 경로 동일 입력 → 동일 결과 (정합 회귀)

## ENV 우회

본 PR 미도입. 임계값 (50% / 5%) 은 정책 SSOT — 변경 시 ADR 갱신 + 회귀 테스트 자동 fail 로 drift 차단.

향후 데이터 기반 재조정 시 본 ADR 갱신 + ENV 우회 추가 검토 가능 (예: `MOAT_DEBT_RATIO_THRESHOLD` / `MOAT_NPM_THRESHOLD`).

## 잔여 (PR-Phase1-DartFinalize scope 외)

- **Phase 2 KIS supply wiring** (`supplyInflow` #4 + `institutionalBuying` #12) — ADR-0137/0138 인프라 위, 추정 ~80 LoC.
- **Phase 3 globalIntel 합성** (#5/#1/#16) — 추정 ~150~200 LoC.
- **Phase 4 외부 컨센서스** (#14/#13) — 외부 source 도입 필요, 별도 ADR.
- **임계값 데이터 검증** — 1~2 주 운영 데이터 누적 후 50% / 5% 임계 정합성 평가.
