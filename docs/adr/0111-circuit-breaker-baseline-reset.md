# ADR-0111 — Circuit Breaker baseline reset hotfix

## Status
Accepted (2026-04-30)

> **번호 재할당 노트** (2026-04-30): main #436 (DataQualityBadge wiring) 가
> ADR-0109 + main #437 (GateStatusCard wiring) 가 ADR-0110 을 먼저 사용 → 본
> ADR 0109 → 0111 로 재할당. 코드 주석·테스트 어구 모두 0111 갱신.

## Context

사용자 4/30 보고 (베이징 10:33):
- 4/30 KST 11:30 KST 부근에 `🛑 [서킷브레이커 발동] 연속손절 3건` 자동 발동
- 사용자 `/reset` 입력 → `🟢 비상 정지 해제` 응답 ✅
- **다음 5분 cron tick (10:30:09 베이징 = 11:30:09 KST) 에 즉시 재발동** ❌
- 사용자 다시 `/reset` 시도 → 동일 결함 반복

근본 원인 (`shadowResolverJob.ts:30-39`):

```ts
function countRecentConsecutiveLosses(shadows: ShadowTrade[]): number {
  const recentClosed = shadows
    .filter((s) => s.exitTime && Date.now() - new Date(s.exitTime).getTime() < FOUR_H_MS)
    ...
}
```

`/reset` 의 `clearCircuitBreaker()` 가 `circuitBreakerTrippedAt` 만 null 로
바꾸고, *과거 4시간 안 손절은 그대로 카운트* → 다음 cron 에서 `consecLoss>=3 &&
!getCircuitBreakerTrippedAt()` 통과 → 재 trip.

## Decision

### Track 1 — `circuitBreakerClearedAt` baseline 영속

`server/learning/learningState.ts` `LearningState` 인터페이스에 옵셔널 필드 추가:

```ts
circuitBreakerClearedAt: string | null;
```

`clearCircuitBreaker()` 호출 시 baseline 시각 영속:

```ts
export function clearCircuitBreaker(): void {
  const state = loadState();
  state.circuitBreakerTrippedAt = null;
  state.circuitBreakerClearedAt = new Date().toISOString();  // ADR-0111
  saveState(state);
}

export function getCircuitBreakerClearedAt(): string | null {
  return loadState().circuitBreakerClearedAt;
}
```

### Track 2 — `countRecentConsecutiveLosses` baseline 적용

`shadowResolverJob.ts` 의 시간 윈도우 lower bound 를 *4시간 전* 과 *baseline*
중 더 *최근* 값으로 설정:

```ts
export function countRecentConsecutiveLosses(shadows: ShadowTrade[]): number {
  const clearedAt = getCircuitBreakerClearedAt();
  const clearedMs = clearedAt ? new Date(clearedAt).getTime() : 0;
  const cutoffMs = Math.max(Date.now() - FOUR_H_MS, clearedMs);
  const recentClosed = shadows
    .filter((s) => s.exitTime && new Date(s.exitTime).getTime() > cutoffMs)
    ...
}
```

- `clearedAt` 부재 시 기존 4시간 윈도우 유지 (회귀 차단)
- `clearedAt` 이 4시간 전보다 최근이면 그 시각이 baseline
- `/reset` 직후 → baseline = now → 카운트 = 0 → 즉시 재발동 차단
- `/reset` 후 *새* 손절 발생 → baseline 이후 손절만 카운트 → 정상 발동 보존

### Track 3 — `reset.cmd` 응답 메시지 안내 추가

```
🟢 비상 정지 해제 — 자동매매 재개 (서킷브레이커/다운그레이드 해제)
⏱️ 손절 카운터 baseline 리셋 (ADR-0111) — *이전* 손절은 무시, *이후* 손절만 카운트
```

운영자가 *왜* 즉시 재발동 안 되는지 인지.

## Consequences

### 즉시 효과 (배포 후)

- 사용자 `/reset` 입력 → 다음 cron 사이클 재발동 차단 → 자동매매 정상 재개
- 4시간 안에도 *새* 손절 3건 누적 시 정상 발동 (안전성 유지)

### 회귀 위험

- 기존 영속 데이터 호환 (`circuitBreakerClearedAt` 부재 시 기존 4시간 윈도우)
- LIVE 매매 본체 0줄 변경 — `learningState.ts` 옵셔널 필드 + `shadowResolverJob.ts`
  카운터 함수 1개 + reset.cmd 메시지 1줄

### 회귀 테스트 9 신규

`circuitBreakerBaseline.test.ts`:
- baseline 영속 3 (clearCircuitBreaker → ISO / trippedAt 동시 null / 두 번째 호출 갱신)
- countRecentConsecutiveLosses baseline 5 (사용자 4/30 시나리오 / 이후만 카운트 /
  clearedAt 부재 회귀 / 4시간 윈도우 유지 / HIT_TARGET 끊김)
- reset.cmd 메시지 1 (baseline 안내 텍스트 포함)

## References

- 사용자 보고 (2026-04-30 베이징 10:33) — `/reset` 후 즉시 재발동 이미지
- ADR-0104 — FOMC DAY 14:30 청산 영속화 hotfix (본 결함의 *상위 원인* — 청산
  안 된 포지션이 다음날 hardStop 누적 → 본 결함 트리거)
