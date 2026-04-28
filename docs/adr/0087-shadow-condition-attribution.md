# ADR-0087 — Shadow → Condition Attribution 연결 (Over-Strict / Good Defense 분류)

**상태**: Accepted (2026-04-28)
**배경**: 사용자 분석 — Shadow 학습 다음 단계 #3 *"거절 종목이 나중에 급등했다면 어떤
조건 때문에 탈락했는가? 반대로 거절 후 폭락했다면 그 조건은 RISK_PROTECTOR 로 강화."*

## 문제

PR-L `rejectionShadowTracker` 가 Gate 14~17 near-miss 거절 종목 사후 추적 (5영업일
currentReturnPct) 인프라까지 도달. 그러나 *어떤 조건 때문에 탈락했는지* 의 메타 정보가
영속 안 되어 있어 분석 불가:

- 거절 후 +5% 이상 종목 → *어떤 조건이 미달이었나?* (Over-Strict 후보)
- 거절 후 -5% 이하 종목 → *어떤 조건이 미달이었나?* (Good Defense / RISK_PROTECTOR)

`RejectionShadowEntry.conditionScores` 가 옵셔널 필드로 추가되면 이 분석 가능.

## 결정

### Schema 확장 (옵셔널 — 기존 영속 호환)

```ts
interface RejectionShadowEntry {
  // 기존 필드...
  /** ADR-0087 — 거절 시점 27조건 점수 (1~27 → 0~10) */
  conditionScores?: Record<number, number>;
}

interface RejectionRecordInput {
  // 기존 필드...
  conditionScores?: Record<number, number>;
}
```

기존 영속 데이터 호환 — 옵셔널 필드. 분석 모듈이 graceful fallback (데이터 부재 시 제외).

### 분석 모듈 — `server/learning/conditionAttributionShadow.ts`

`analyzeShadowAttribution()` 27조건별 분류:

**알고리즘**:
1. 종결된 entry (`closed=true` + `conditionScores` 보유) 만 추출
2. 각 entry 의 `currentReturnPct` 분기:
   - `≥ +5%` → Over-Strict bucket
   - `≤ -5%` → Good Defense bucket
   - 그 외 → 무시 (boundary 영역)
3. 27조건별로:
   - **명시된** conditionScores[id] 만 사용 (`!(id in scores) → continue`, false positive 차단)
   - score `< 6` (LOW_SCORE_THRESHOLD, attributionAnalyzer 와 동일) → 해당 조건 미달
   - 미달 조건은 해당 entry 의 bucket 에 +1
4. 27조건별 빈도 + 평균 + ratio (overStrict / total) + classification 산출

**분류 결정 트리** (`ShadowConditionStat.classification`):
- `total < MIN_FREQUENCY=3` → `'insufficient'`
- `ratio ≥ 0.7` → `'over_strict_candidate'` (너무 엄격 — 완화 검토)
- `ratio ≤ 0.3` → `'good_defense_candidate'` (잘 막아줌 — RISK_PROTECTOR)
- 그 외 → `'normal'`

### 상수 SSOT — `SHADOW_ATTRIBUTION_CONSTANTS`

| 상수 | 값 | 의미 |
|------|----|------|
| `OVER_STRICT_RETURN_THRESHOLD_PCT` | 5 | 거절 후 ≥ 본 임계 % 시 Over-Strict 후보 |
| `GOOD_DEFENSE_RETURN_THRESHOLD_PCT` | -5 | 거절 후 ≤ 본 임계 % 시 Good Defense |
| `LOW_SCORE_THRESHOLD` | 6 | score < 본 임계 시 *해당 조건 미달* (attributionAnalyzer 정합) |
| `MIN_FREQUENCY` | 3 | 분류 후보 최소 빈도 |

### 텔레그램 명령 `/shadow_attribution` (alias `/sa`)

응답 형식:

```
🌑 Shadow → Condition Attribution — 거절 종목 사후 성과 분석

📊 요약: 종결 표본 50건 / 27 조건 분석
  • ⚠️ Over-Strict 후보: 2 (너무 엄격 — 완화 검토)
  • 🛡️ Good Defense 후보: 3 (잘 막아줌 — RISK_PROTECTOR)
  • ⏳ 표본 부족: 22
  • ✅ 균형: 0

⚠️ Over-Strict 후보 (거절했지만 +5% 이상 종목에서 자주 미달):
  • #25 VCP — over 8건 (avg +12.30%) / ratio 80%
  • ...

🛡️ Good Defense 후보 (거절 후 -5% 이하 종목에서 자주 미달):
  • #16 외인 수급 5일 누적 — defense 6건 (avg -8.20%) / ratio 20%
  • ...

📌 의사결정 안내:
   • Over-Strict 후보 → 조건 임계 완화 검토 (운영자 결정, 자동 조정 금지)
   • Good Defense 후보 → RISK_PROTECTOR 강화 검토
   • 빈도 ≥ 3 + ratio ≥ 0.7 (Over-Strict) 또는 ≤ 0.3 (Good Defense) 시 후보
```

### Endpoint — `GET /api/learning/condition-attribution-shadow`

`ShadowAttributionReport` 응답 (status / closedSampleSize / conditions[27] / summary).

## ENV 롤백

`SHADOW_CONDITION_ATTRIBUTION_DISABLED=true` → 빈 결과 (status='DISABLED') 반환.

## 본 PR scope (PR-F-1 인프라)

- ✅ Schema 확장 (옵셔널 conditionScores)
- ✅ 분석 모듈 + 결정 트리
- ✅ Endpoint
- ✅ 텔레그램 명령
- ✅ 회귀 테스트

## 본 PR 비-범위 (PR-F-2 후속)

- **호출자 wiring** — `signalScanner` / `perSymbolEvaluation` 의 거절 분기에서
  `conditionScores` 를 전달하는 wiring. **LIVE 매매 본체 변경** 이라 회귀 위험 있어
  운영 데이터 누적 + 사용자 결정 후 별도 PR.
- 자동 임계 완화 / RISK_PROTECTOR 강화 — *분석 결과 기반 자동 정책 변경 금지*. 운영자
  검토 필수.

## 회귀 테스트 ≥20 케이스 (실제 31)

- `conditionAttributionShadow.test.ts` 21 (상수 + ENV 2 + 결정 트리 분류 16 +
  schema 호환 1 + 산출 정합 2)
- `conditionAttributionShadow.cmd.test.ts` 10 (formatShadowAttributionMessage 6 +
  cmd execute 4)

## LIVE 영향

- 호출자 wiring 0 → LIVE 매매 본체 0줄 변경
- 분석 *전용* — 가중치 / freeze / sizing 정책 무영향
- KIS/KRX/Yahoo fetch 0건 (영속 RejectionShadow 만 사용)

## 참조

- ADR-0006 attributionRepo 복합키
- ADR-0086 shadowWalkForwardFramework (PR-D)
- PR-L rejectionShadowTracker (Gate 14~17 near-miss)
- 사용자 분석 (2026-04-28 Shadow 학습 다음 단계 #3)
