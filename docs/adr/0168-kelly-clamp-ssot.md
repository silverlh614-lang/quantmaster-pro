# ADR-0168 — Kelly Clamp 수치 정책 SSOT

**상태**: Accepted (audit-PR-520 §M3 직접 수리 — Kelly clamp drift 차단)
**날짜**: 2026-05-02
**관련 PR**: PR-Kelly-Clamp-SSOT
**의존성**: ADR-0076 (regime + FOMC 결합 SSOT), audit-PR-520 §M3
**Audit-PR-520 §M3 추적성**: 본 PR 이 audit-PR-520 의 M3 (`Math.min(1.5, Math.max(KELLY_FLOOR, rawKelly))` 매직 넘버 + 두 위치 inline 중복) 직속 수리

## 1. 문제

`server/trading/signalScanner.ts:413` + `server/trading/signalScanner/preflight.ts:357` 두 위치에 byte-equivalent 패턴:

```typescript
const KELLY_FLOOR = 0.15;            // inline 상수
// ... 6-multiplier 곱셈 체인
const rawKelly = regimeFomcCombined.value * vixGating.kellyMultiplier * ipsKelly
                 * exceptionKellyFactor * accountKellyMultiplier * biasMultiplier;
const kellyMultiplier = Math.min(
  1.5,                                // ← 매직 넘버 (의미 미명시)
  Math.max(KELLY_FLOOR, rawKelly),
);
```

audit-PR-520 §M3 결함:
- `1.5` 매직 넘버 — 의미 (POST 부스트 상한) 미명시 + 두 위치 변경 시 *한쪽만 수정* 위험
- `KELLY_FLOOR=0.15` inline 상수 — 두 위치 모두 정의 + 정책 변경 시 동기화 의무
- 정책 변경 비용 ↑ (예: KELLY_CAP 1.5 → 1.3 보수화 시 두 파일 동시 수정)

## 2. 결정

### 2.1 신규 SSOT — `server/trading/sizing/kellyClamp.ts`

3 export:
- **`KELLY_CAP = 1.5`** — POST 부스트 상한 (의미 명시)
- **`KELLY_FLOOR = 0.15`** — 누적 패널티 하한선 (의미 명시)
- **`applyKellyClamp(rawKelly): number`** — clamp 정책 단일 진입점

```typescript
export const KELLY_CAP = 1.5;
export const KELLY_FLOOR = 0.15;

export function applyKellyClamp(rawKelly: number): number {
  if (!Number.isFinite(rawKelly)) {
    return KELLY_FLOOR;  // NaN/Infinity 안전 fallback
  }
  return Math.min(KELLY_CAP, Math.max(KELLY_FLOOR, rawKelly));
}
```

### 2.2 호출자 책임 분리 (LIVE 매매 본체 byte-equivalent)

호출자 (`signalScanner.ts` + `preflight.ts`) 는 다음만 유지:
- 6-multiplier 곱셈 체인 (regimeFomcCombined.value × vixGating.kellyMultiplier × ipsKelly × exceptionKellyFactor × accountKellyMultiplier × biasMultiplier)
- 진단 로그 형식 (`raw ×N → floor ×0.15 → 유효 ×N`) — `KELLY_FLOOR` import 로 일관 유지
- clamp 호출 1줄: `const kellyMultiplier = applyKellyClamp(rawKelly);`

### 2.3 정책 변경 비용 ↓

운영 데이터 누적 후 KELLY_CAP 또는 KELLY_FLOOR 재조정 필요 시:
- **본 PR 이전**: 두 파일 inline 상수 + 매직 넘버 4 위치 동시 정정 (drift 위험)
- **본 PR 이후**: `kellyClamp.ts` 1 위치 변경 → 두 호출자 자동 정합

## 3. NaN/Infinity 안전 fallback

기존 inline 패턴은 NaN 입력 시 `Math.max(0.15, NaN) = NaN` → `Math.min(1.5, NaN) = NaN` (두 함수 모두 NaN 전파). 본 SSOT 가 `Number.isFinite` 검증 + KELLY_FLOOR fallback 추가 — 6-multiplier 체인 중 한 값이 NaN 일 때 `kellyMultiplier=NaN` 으로 후속 사이징 식 전파되던 잠재 결함 영구 차단.

기존 동작 호환성: 정상 입력 (양수 finite) 에서는 byte-equivalent 결과. NaN/Infinity 만 fallback 변화.

## 4. LIVE 매매 영향 0 (5 보호층)

본 PR 은 *명명 정리만* — clamp 결과는 byte-equivalent:
1. `KELLY_CAP` 의미 명명 (1.5 매직 넘버 → 의미 상수)
2. `KELLY_FLOOR` SSOT 통합 (두 inline → 단일 export)
3. `applyKellyClamp` 함수 위임 (Math.min/max 패턴 캡슐화)
4. NaN/Infinity 안전 fallback (잠재 결함 차단)
5. drift 정적 회귀 가드 (12 정적 케이스로 향후 결함 영구 차단)

## 5. 회귀 테스트

`kellyClamp.test.ts` 29 케이스:
- 상수 SSOT 3 (KELLY_CAP=1.5 / KELLY_FLOOR=0.15 / FLOOR<CAP)
- applyKellyClamp 분기 14 (정상 2 + 상한 3 + 하한 3 + 0/음수/NaN/Infinity 4 + byte-equivalent 정합 1 + 1줄)
- 호출자 정합 정적 가드 12 (signalScanner+preflight × import/사용/매직 넘버 부재/inline 부재/진단 로그 보존/ADR 주석 6쌍)

## 6. 잘못된 해결 방법 (영구 차단)

- ❌ `1.5` 매직 넘버 inline 유지 — 의미 미명시 + drift 위험. **반드시 `KELLY_CAP` import 사용**.
- ❌ `KELLY_FLOOR=0.15` 두 위치 inline 정의 — 정책 변경 시 한쪽만 수정 위험. **단일 SSOT export**.
- ❌ NaN 안전 fallback 미적용 — 6-multiplier 체인 NaN 전파로 잠재 결함. **`Number.isFinite` 검증 의무**.
- ❌ 호출자에서 `applyKellyClamp` 우회 (직접 Math.min/max) — drift 위험. **함수 위임 강제**.

## 7. audit-PR-520 §M3 추적성 (audit 학습 데이터)

audit-PR-520 §M3 (Kelly clamp 매직 넘버 + 두 위치 inline 중복) → **본 PR 으로 수리 완료**. 다음 audit (PR #530 예정) 시 본 M3 항목이 *수리 완료* 로 추적 가능.

ADR-0146 §"audit findings 가 학습 데이터" 정합 — audit → 수리 PR 사이클 두 번째 사례 (첫 번째: ADR-0167 §M1 currentEquityExposureAmount).
