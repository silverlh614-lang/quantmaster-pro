# ADR-0388: ConditionEvalStatus 6값 확장 + ERROR 카운터 분리 + 방어 헬퍼

**Status**: Accepted (ADR-0387 직접 확장)
**Date**: 2026-05-06

## 배경

ADR-0387 이 4 status (`FIRED`/`DATA_UNAVAILABLE`/`THRESHOLD_NOT_MET`/`SANITY_REJECTED`) 도입 + `unavailable` 카운터 분리. 사용자 명시 추가 결함:

> **`ERROR`(evaluator 깨짐) 를 `failed`(정상 평가 후 임계 미달) 와 같은 카운트에 섞으면 진단 오염 재발**
>
> ERROR = "평가기가 깨져서 판단 불가" / THRESHOLD_NOT_MET = "정상 평가 결과 조건 미달" — 둘은 의미가 근본적으로 다름.

또한 ADR-0387 의 `null → THRESHOLD_NOT_MET` 단순 추론도 위험 — 일부 evaluator 가 `null` 을 "데이터 없음" 으로 사용하던 관례 시 오염원.

## 결정

### P1 — status union 6 → 7 값 확장 (`PROVIDER_DEGRADED` + `SKIPPED_BY_POLICY` + `ERROR` 추가)

```typescript
export type ConditionEvalStatus =
  | 'FIRED'
  | 'THRESHOLD_NOT_MET'      // 정상 평가 + 임계 미달
  | 'DATA_UNAVAILABLE'       // 입력 데이터 부재 (PER 없음, KIS 500)
  | 'PROVIDER_DEGRADED'      // 데이터 신뢰성 손상 (Yahoo stale, KRX indexCode 누락 — layer 3·9·10)
  | 'SKIPPED_BY_POLICY'      // 정책상 평가 생략 (Volume Clock, R6 차단)
  | 'SANITY_REJECTED'        // 데이터 비정상 (drift 데드존 — layer 8)
  | 'ERROR';                 // evaluator 예외 — failed 와 분리 의무
```

### P2 — `error` 카운터 별도 신설

```typescript
interface GateConditionStats {
  passed: number;
  failed: number;        // 정상 평가 후 임계 미달
  unavailable?: number;  // DATA_UNAVAILABLE/PROVIDER_DEGRADED/SKIPPED_BY_POLICY/SANITY_REJECTED
  error?: number;        // ERROR — ADR-0388 신규 (failed 와 분리 의무)
}
```

`recordGateAuditByStatus` switch 분기:
```
FIRED              → passed++
THRESHOLD_NOT_MET  → failed++
DATA_UNAVAILABLE   |
PROVIDER_DEGRADED  | → unavailable++
SKIPPED_BY_POLICY  |
SANITY_REJECTED    |
ERROR              → error++  (별도)
```

### P3 — `inferStatusFromLegacyResult` 방어 헬퍼

null 추론을 `context` 옵셔널로 확장 — 향후 호출자가 상황 정보 제공 가능:

```typescript
function inferStatusFromLegacyResult(result, context?: {
  evaluatorKey?: string;
  hadRequiredData?: boolean;
  skippedByPolicy?: boolean;
}): ConditionEvalStatus {
  if (context?.skippedByPolicy) return 'SKIPPED_BY_POLICY';
  if (result === null) {
    if (context?.hadRequiredData === false) return 'DATA_UNAVAILABLE';
    return 'THRESHOLD_NOT_MET';  // legacy 기본 가정
  }
  if (result.status) return result.status;
  if (result.score > 0) return 'FIRED';
  return 'THRESHOLD_NOT_MET';
}
```

`recordGateAuditByStatus` 가 outputs 의 `context?` 옵셔널 받아 헬퍼에 위임.

### P4 — registry.run try/catch (ERROR 자동 발화)

```typescript
for (const ev of this.evaluators.values()) {
  let out: ConditionEvalOutput | null = null;
  try {
    out = ev.evaluate(ctx);
  } catch (err) {
    if (process.env.CONDITION_REGISTRY_THROW_DISABLED === 'true') throw err;
    out = {
      score: 0,
      conditionKey: ev.key,
      detail: `evaluator 예외: ${err.message}`,
      status: 'ERROR',
    };
    console.warn(`[ConditionRegistry] ${ev.key} 예외 → ERROR (ADR-0388)`);
  }
  outputs.push({ key: ev.key, output: out });
  if (!out) continue;
  if (out.status === 'ERROR') continue; // ERROR 는 totalScore/details/conditionKeys 미합산
  totalScore += out.score;
  // ...
}
```

ENV `CONDITION_REGISTRY_THROW_DISABLED=true` (default OFF — try/catch 활성) 1줄 즉시 legacy 동작 복원.

### P5 — emptyScanPostmortem `topErrorCondition` + `topBlockerErrorRate`

`PostmortemReport` 옵셔널 신규:
- `topBlockerErrorRate?: number`
- `topErrorCondition?: string | null`

reason 메시지 errorRate ≥ 10% 시 `❌ evaluator 결함 의심: ... — patch 또는 provider parsing 결함 가능` 마커.

## 사용자 명시 핵심 시나리오 (구분 정확도)

### Case A — 데이터 커버리지 결함 (정확)
```
PER passed: 4 / failed: 4 / unavailable: 232 / error: 0
→ "PER 조건이 엄격한 문제가 아니라 데이터 커버리지/어댑터 문제"
```

### Case B — evaluator 런타임 결함 (정확)
```
PER passed: 4 / failed: 4 / unavailable: 12 / error: 220
→ "데이터 부재가 아니라 evaluator 런타임 결함 — patch 또는 provider parsing 결함"
```

ADR-0387 만으로는 Case B 가 `unavailable=232` 같이 보여 잘못된 진단 유도. ADR-0388 의 `error` 분리가 차단.

## 안전 invariant

- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4)
- LIVE 매매 본체 — registry try/catch 추가 (예외 발생 시 evaluator 1개 ERROR 변환, run 차단 안 함)
- 13 다른 evaluator 무수정 (status 옵셔널 자동 fallback + try/catch 자동 보호)
- 기존 영속 파일 `error` 부재 → `??= 0` 자동 채움
- ENV 1줄 즉시 롤백 — `CONDITION_REGISTRY_THROW_DISABLED=true` (try/catch 우회)
- ERROR status 자체는 totalScore / conditionKeys 미합산 — 정상 통과 영향 0

## 잘못된 해결 방법 영구 차단

1. **ERROR 를 failed 에 합산** — 사용자 명시 핵심 결함, 진단 오염 재발.
2. **ERROR 를 unavailable 에 합산** — 데이터 부재와 evaluator 결함은 다른 운영 액션 (provider 점검 vs patch 수정).
3. **registry try/catch 본체 변경 (default ON ERROR 폴백 부재)** — evaluator 1개 throw 가 14개 평가 차단 → run 자체 실패. ADR-0388 default 가 try/catch 활성.
4. **`null → DATA_UNAVAILABLE` 강제 매핑** — 일부 evaluator 가 null 을 "조건 미달" 로 사용하는 관례 손상. context 옵션으로 호출자 책임 분배.
5. **inferStatusFromLegacyResult 의 context 인자 필수화** — 후방호환 손상. 옵셔널 확장.

## 회귀 테스트

`registryAdr0388.test.ts` — 6+1 status union SSOT 1 + Registry try/catch 5 (default 동작 + legacy ENV + ENV 정확 비교 + only throw + non-Error throw) + inferStatusFromLegacyResult 8 (skippedByPolicy / hadRequiredData / null + context / status 명시 / score 분기 / 우선순위) + recordGateAuditByStatus 14 (7 status 분기 + ERROR 핵심 분리 + context 전달 + legacy 영속 후방호환 2 + 사용자 명시 시나리오 2) = **28 케이스**

총 +28 회귀 (ADR-0387 +34 누적 → ADR-0388 합산 +62).

## 후속 PR

- **다른 evaluator 점진 적용** — vcp/momentum/volume_surge 우선 (PROVIDER_DEGRADED + SKIPPED_BY_POLICY 명시)
- **호출자 측 context 전달** — perSymbolEvaluation 가 hadRequiredData/skippedByPolicy 정보를 context 로 propagate
- **/gate_audit 텔레그램 명령 출력 확장** — error 컬럼 추가
