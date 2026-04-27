# ADR-0076 — FOMC vs Regime Kelly 결합 SSOT (옵션 C: FOMC 우선 + R6 보호)

## Status
Accepted (2026-04-27)

## Context

사용자 운영 보고 (2026-04-27):

> "FOMC 와 기본 Kelly 레짐이 개념이 중복됨 (오버랩). FOMC 기간에는 기본 Kelly 레짐보다 FOMC 원칙을 우선."

### 기존 결합 (3 호출 지점 동일)

`signalScanner.ts:381` + `preflight.ts:329` + `dryRunScanner.ts:122`:

```typescript
rawKelly = regimeConfig.kellyMultiplier  // R1~R6: 1.0/0.8/0.7/0.5/0.3/0
        × vixGating.kellyMultiplier      // VIX 게이트
        × fomcProximity.kellyMultiplier  // FOMC PHASE: 0.75/0.75/0.75/0/1.30/1.15
        × ipsKelly                       // IPS 변곡점
        × exceptionKellyFactor           // SELL_ONLY 예외
        × accountKellyMultiplier;        // 계좌 위험 가드
```

### 문제

`regimeConfig.kellyMultiplier` 와 `fomcProximity.kellyMultiplier` 가 *같은 차원* (Kelly 사이즈 보수성) 의 정책. 곱셈 결합 시 두 번 적용되어 보수성 누적:

| 시나리오 | 기존 곱셈 | 사용자 의도 |
|---------|----------:|-----------:|
| FOMC PRE_1 (0.75) × R2_BULL (0.8) | 0.60 | **0.75** |
| FOMC PRE_1 (0.75) × R5_CAUTION (0.3) | 0.225 | 0.75 |
| FOMC POST_1 (1.30) × R2_BULL (0.8) | 1.04 | 1.30 |

→ FOMC PRE_1 시 사용자가 *75% 사이즈* 만 의도했는데 실제로는 60% 까지 압축. POST_1 부스트도 동일하게 희석.

## Decision Options

### 옵션 A — FOMC 활성 시 regime 완전 무시
- ❌ R6_DEFENSE 무력화 위험 (kelly 0 → 0.75 표기)

### 옵션 B — min (더 보수적인 게 이김)
- ❌ "FOMC 우선" 사용자 명시 어김 (FOMC 가 더 보수일 때만 우선)
- ❌ POST 부스트 미적용 (POST_1 + R2 = 0.80, 부스트 효과 0)

### 옵션 C — FOMC 우선 + R6 보호 ⭐ **채택**
- ✅ "FOMC 원칙 우선" 사용자 명시 충족
- ✅ R6_DEFENSE (시장 전체 붕괴) 만 절대 차단 보호 (allowedSignals=[] 와 정합)
- ⚠️ R5_CAUTION 약세 + FOMC POST_1 부스트 1.30 — 운영자 인지 필요
- 사용자 채택 (2026-04-27 옵션 선택)

### 옵션 D — 부스트는 곱셈, 보수는 FOMC 우선
- ❌ 복잡도 ↑

## Decision

**옵션 C 채택** — `combineRegimeAndFomcKelly()` SSOT 모듈 신설:

```typescript
function combineRegimeAndFomcKelly(
  regimeKelly: number,
  fomcKelly: number,
  fomcPhase: FomcPhase,
  regime: RegimeLevel,
): RegimeFomcResult {
  // ENV 롤백
  if (process.env.FOMC_REGIME_OVERRIDE_DISABLED === 'true') {
    return { value: regimeKelly * fomcKelly, source: 'LEGACY_PRODUCT', ... };
  }
  // R6_DEFENSE: 시장 전체 붕괴 — 절대 우선
  if (regime === 'R6_DEFENSE') return { value: 0, source: 'R6_OVERRIDE', ... };
  // FOMC NORMAL: regime 만
  if (fomcPhase === 'NORMAL') return { value: regimeKelly, source: 'REGIME', ... };
  // FOMC 활성: FOMC 우선 (regime 무시)
  return { value: fomcKelly, source: 'FOMC', ... };
}
```

### 결과 매트릭스

| 시나리오 | 기존 곱셈 | **신규 (옵션 C)** | 채택 source |
|---------|----------:|-----------------:|:-----------|
| NORMAL + R1_TURBO (1.0) | 1.00 | **1.00** | REGIME |
| NORMAL + R2_BULL (0.8) | 0.80 | **0.80** | REGIME |
| PRE_3 (0.75) + R2_BULL (0.8) | 0.60 | **0.75** | FOMC |
| PRE_2 (0.75) + R2_BULL (0.8) | 0.60 | **0.75** | FOMC |
| PRE_1 (0.75) + R2_BULL (0.8) | 0.60 | **0.75** | FOMC |
| PRE_1 (0.75) + R5_CAUTION (0.3) | 0.225 | **0.75** ⚠️ | FOMC |
| DAY (0) + R2_BULL (0.8) | 0 | **0** | FOMC |
| POST_1 (1.30) + R2_BULL (0.8) | 1.04 | **1.30** | FOMC |
| POST_1 (1.30) + R5_CAUTION (0.3) | 0.39 | **1.30** ⚠️ | FOMC |
| PRE_1 (0.75) + R6_DEFENSE (0) | 0 | **0** | R6_OVERRIDE |

⚠️ = R5_CAUTION 약세 시 FOMC POST_1 부스트 그대로 적용 — 운영자 인지 필요. 향후 데이터 축적 후 옵션 D (부스트는 곱셈, 보수는 FOMC 우선) 로 격상 검토 가능.

## Wiring

3 호출 지점 모두 wiring (byte-equivalent 외 곱셈 분리):

1. `signalScanner.ts:381`: `rawKelly = regimeFomcCombined.value × vixGating × ipsKelly × ...`
2. `signalScanner/preflight.ts:329`: 동일 패턴
3. `dryRunScanner.ts:122`: `kellyMultiplier = min(1.5, regimeFomcCombined.value × vixGating)`

진단 로그 보강:
```
[AutoTrade] [Kelly 결합] FOMC PRE_1 ×0.75 우선 (R2_BULL ×0.80 무시) → ×0.75 ×
            VIX(×1.00) × IPS(×1.00) × 계좌(×1.00) = raw ×0.750 → 유효 ×0.75
```

## Effects

### Positive
- **사용자 운영 의도 정확 반영**: FOMC PRE_1 시 정확히 75% 사이즈 (기존 60%)
- **POST 부스트 효과 회복**: POST_1 시 1.30 부스트 (기존 1.04 — 30% 부스트 효과 희석)
- **단일 SSOT**: `combineRegimeAndFomcKelly()` 한 함수가 결합 정책 결정 — drift 차단
- **진단 로그 향상**: `[Kelly 결합] FOMC PRE_1 ×0.75 우선 (R2_BULL ×0.80 무시)` 로 운영자가 어느 정책이 적용됐는지 즉시 인지

### Negative
- **R5_CAUTION + FOMC POST 부스트 위험**: 약세 시장에 부스트 1.30 적용 — 운영 데이터 누적 후 옵션 D 격상 검토
- **R5_CAUTION + FOMC PRE 보수 무력화**: 0.3 → 0.75 — R5 의 약세 신호가 FOMC 0.75 보수성에 흡수됨 (사용자 의도)

### Neutral
- ENV 롤백 `FOMC_REGIME_OVERRIDE_DISABLED=true` — 기존 곱셈 패턴 즉시 복원
- LIVE 매매 본체: 3 호출 지점에 `combineRegimeAndFomcKelly()` 1줄 + 곱셈 분리 변경 (~20줄)
- KIS/KRX quota: 0 침범 (계산 로직만 변경)

## References

- 사용자 운영 보고 (2026-04-27): "FOMC vs regime Kelly 개념 중복, FOMC 우선"
- ADR-0061: FOMC DAY 자동 청산 (FOMC PHASE 정책 SSOT)
- ADR-0073: 레짐 holding 단축 (regime 정책)
- ADR-0008: kellyHalfLife wiring (시간 감쇠 — 다른 차원, 별도 곱셈 유지)
