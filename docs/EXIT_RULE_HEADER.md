# Exit Rule Header Schema (ADR-0036 / PR-R)

**Status**: Accepted (2026-04-26)
**Scope**: 매도 규칙 카탈로그 자동 생성 — 헤더 표준 + 빌드 타임 추출.

---

## 목적

매도 규칙(R6 긴급 청산 / HIT_STOP / HIT_TARGET / TRAILING_STOP / R3 부분익절 등) 의 메타데이터를
JSDoc 표준 헤더로 명시하면, 빌드 타임 스크립트가 `docs/exit-rules-catalog.md` 를 자동 생성해
"현재 시스템에 매도 규칙이 몇 개이고 우선순위는 어떻게 되는지" 의 SSOT 문서를 유지한다.

회고/감사/리팩토링 시 시간을 절감 — 코드와 문서가 자동 동기화.

---

## 표준 schema

각 매도 규칙 함수 또는 인라인 블록 위에 다음 헤더를 부착한다:

```typescript
/**
 * @rule R6_EMERGENCY_EXIT
 * @priority 1
 * @action PARTIAL_SELL
 * @ratio 0.30
 * @trigger regime === 'R6_DEFENSE' && !shadow.r6EmergencyExitDone
 * @rationale 블랙스완 진입 시 보유 포지션 30% 즉시 시장가 청산 (1회 한정)
 */
```

### 필드 정의

| 필드 | 필수 | 형식 | 설명 |
|---|---|---|---|
| `@rule` | ✅ | UPPER_SNAKE | 규칙 식별자 (Telegram 로그·attribution 키와 일치) |
| `@priority` | ✅ | 정수 1~99 | 평가 순서 (낮을수록 먼저 평가) |
| `@action` | ✅ | enum | `FULL_SELL` / `PARTIAL_SELL` / `TRAILING_STOP` / `NO_OP` |
| `@ratio` | 옵션 | 0~1 실수 | PARTIAL_SELL 시 매도 비율 (FULL_SELL 은 1.0 암시) |
| `@trigger` | ✅ | TS 표현식 | 발동 조건 (사람이 읽을 수 있는 식) |
| `@rationale` | ✅ | 한국어 1~3문장 | 사유 — 회고 시 의사결정 컨텍스트 |
| `@regime` | 옵션 | RegimeLevel | 특정 레짐에서만 발동 시 명시 |
| `@minHoldingDays` | 옵션 | 정수 | 최소 보유 기간 (회피용) |

### 예시 (R6 긴급 청산 — 인라인)

`server/trading/exitEngine.ts` 의 R6_DEFENSE 분기:

```typescript
/**
 * @rule R6_EMERGENCY_EXIT
 * @priority 1
 * @action PARTIAL_SELL
 * @ratio 0.30
 * @trigger currentRegime === 'R6_DEFENSE' && !shadow.r6EmergencySold && shadow.quantity > 0
 * @regime R6_DEFENSE
 * @rationale 블랙스완 (시장 -3% 이상 하락 또는 VKOSPI 35+) 진입 시 보유 포지션 30% 즉시 시장가 청산. 1회 한정 (재발 방지).
 */
if (currentRegime === 'R6_DEFENSE' && !shadow.r6EmergencySold && shadow.quantity > 0) {
  // …
}
```

### 예시 (HIT_TARGET — 함수 추출형)

`server/trading/rules/hitTarget.ts` (미래 분해 후):

```typescript
/**
 * @rule HIT_TARGET
 * @priority 5
 * @action FULL_SELL
 * @ratio 1.00
 * @trigger currentPrice >= shadow.targetPrice
 * @rationale 1차 목표가 도달 시 전량 청산. SHADOW/LIVE 공통 적용.
 */
export function checkHitTarget(shadow: ShadowTrade, currentPrice: number): ExitDecision | null {
  // …
}
```

---

## 자동 카탈로그 생성

스크립트: `scripts/generate_exit_rules_catalog.js`

```bash
npm run build:exit-catalog
# → docs/exit-rules-catalog.md 생성/갱신
```

스크립트는 다음 파일에서 `@rule` 헤더를 추출:
- `server/trading/exitEngine.ts` — 인라인 규칙
- `server/trading/rules/*.ts` — 분해 후 별도 규칙 파일 (미래)

추출 결과는 `priority` 오름차순으로 정렬된 표 형식으로 출력.

---

## 운영 정책

- **신규 규칙 추가**: 헤더 표준에 맞춰 작성 → 빌드 시 카탈로그 자동 갱신
- **기존 규칙 수정**: trigger / rationale 갱신 → 카탈로그 자동 동기화
- **규칙 폐기**: `@deprecated` 필드 추가 → 카탈로그에서 회색 처리 (향후 확장)
- **CI 통합**: `npm run build:exit-catalog` 를 precommit 또는 PR 검증에 통합 권고 (본 PR scope 밖)

---

## 후속 PR (out of scope)

- exitEngine.ts 안 인라인 규칙 → `rules/*.ts` 별도 파일 추출 (분해)
- ExitDecision attribution 강제 (PR-S — 아이디어 7)
- `@deprecated` / `@experimental` 라이프사이클 필드
- 카탈로그 ↔ runtime 검증 (런타임에 카탈로그에 없는 규칙 발동 시 경고)
