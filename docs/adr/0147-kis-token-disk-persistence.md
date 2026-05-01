# ADR-0147: KIS 토큰 디스크 영속 — 재부팅 시 OAuth2 갱신 차단

**Status**: Accepted
**Date**: 2026-05-01
**Related**: ADR-0135 (kisClient 분해), 절대 규칙 #2 (kisClient 단일 통로)
**Author**: claude
**Trigger**: 사용자 명시 *"재부팅할때마다 kis토큰 갱신 안받도록 패치 (정해진 시간에 자동으로 갱신하게)"*

## Context

`server/clients/kisClient/auth.ts` 의 토큰 캐시 (`cachedToken` / `cachedRealDataToken`) 가 *메모리 only* 였고, `server/index.ts:427-430` 부팅 시 무조건 `forceRefreshKisTokens()` 호출:

```ts
// 부팅 직후 무조건 OAuth2 호출 — 재배포 시마다 토큰 갱신
import('./clients/kisClient.js')
  .then(({ forceRefreshKisTokens }) => forceRefreshKisTokens())
  .then((r) => console.log(`[KIS] 기동 시 토큰 선행 갱신 — main=${r.main}, realData=${r.realData}`))
  .catch(...);
```

**결함**:

1. **재부팅 = OAuth2 호출** — Railway 자동 재배포 / 컨테이너 재시작 / 사용자 수동 재기동 모두 매번 토큰 갱신.
2. **KIS OAuth2 일일 한도 소진 위험** — KIS Open API 의 토큰 발급 한도 (모의/실전 각 일별 N회 제한) 가 재배포 빈도가 높을수록 빨리 소진.
3. **이미 12h cron 으로 정기 갱신 중** — `server/scheduler/orchestratorJobs.ts:54-57` 에 KST 08:30 / 20:30 두 번 강제 갱신 cron 등록됨. 부팅 시 추가 호출은 *중복*.
4. **23h 캐시 TTL 안 재사용 불가** — 메모리 캐시라 프로세스 종료 시 사라짐.

## Decision

**KIS 토큰 디스크 영속화 + 부팅 시 hydrate** 정책 도입.

### 핵심 변경

1. **`server/persistence/kisTokenRepo.ts` 신규 SSOT** (절대 규칙 #2 준수 — `auth.ts` 단일 호출자)
   - `loadKisTokens(now)` — 만료된 토큰 자동 청소 후 반환 (schemaVersion=1 검증)
   - `saveKisTokens(bundle)` — atomic write (tmp → rename), 권한 0o600 best-effort
   - `persistKisToken(slot, token)` — 단일 슬롯 갱신 (다른 슬롯 보존)
   - `clearKisTokens()` — 강제 invalidate (파일 삭제)
   - `getPersistedTokenRemainingHours(slot, now)` — 진단용

2. **`server/clients/kisClient/auth.ts` hydrate + persist 통합**
   - 모듈 로드 시 1회 자동 `hydrateFromDisk()` — 재부팅 시 23h TTL 안이면 *OAuth2 호출 0건*
   - `refreshKisToken()` / `refreshRealDataToken()` 갱신 후 `persistTokenSafe(slot, token, expiry)` 자동 호출
   - `invalidateKisToken()` 시 `clearKisTokens()` 동시 호출 (메모리 + 디스크 정합)
   - `forceRefreshKisTokens()` 시 `clearKisTokens()` 후 재발급 (강제 갱신 의미 보존)

3. **`server/index.ts` 부팅 정책 전환**
   - 무조건 `forceRefreshKisTokens()` 호출 *제거*
   - default: hydrate 결과 진단 로그만 (`main=Nh 잔여, realData=Mh 잔여`)
   - opt-in: `KIS_TOKEN_BOOT_REFRESH=true` ENV 시에만 강제 갱신 (긴급 운영 / 토큰 파일 손실 시)

4. **영속 파일 경로** — `data/kis-tokens.json` (DATA_DIR 안)
   - `.gitignore` 의 `data/` 룰로 자동 차단 — 비밀 누출 방지
   - 권한 0o600 (소유자 read/write only) best-effort

### 정기 갱신 cron (이미 구현, 변경 없음)

- `server/scheduler/orchestratorJobs.ts:54-57`
- `30 23 * * *` (UTC) = **KST 08:30** — 장 전 갱신
- `30 11 * * *` (UTC) = **KST 20:30** — 장 후 갱신
- `ScheduleClass='ALWAYS_ON'` — 주말/공휴일 포함 (해외 뉴스/공급망 스캔이 KIS 데이터 토큰 사용)

본 ADR 후 cron 실행 시 갱신된 토큰이 *디스크 영속* → 다음 재부팅 시 hydrate 로 그대로 사용.

### ENV 우회 2종

| ENV | 값 | 효과 |
|-----|----|----|
| `KIS_TOKEN_PERSIST_DISABLED` | `true` | 영속 비활성, legacy 동작 (매 재부팅 OAuth2 호출). 디버깅·강제 동기화 시. |
| `KIS_TOKEN_BOOT_REFRESH` | `true` | hydrate 후 즉시 강제 갱신. 토큰 파일 손실·긴급 운영 시 1회 사용. |

default: 둘 다 미설정 → ADR-0147 정책 적용 (재부팅 시 OAuth2 0건).

## Consequences

### 긍정

- **재부팅 시 OAuth2 호출 0건** (default 동작) — Railway 자동 재배포 시마다 발생하던 토큰 갱신 영구 차단.
- **KIS OAuth2 일일 한도 보호** — 매 재배포 1회 → cron 2회만 (정기 갱신).
- **23h 캐시 TTL 완전 활용** — 메모리 + 디스크 양쪽 hydrate 로 process restart 후에도 재사용.
- **정합성 회복** — `invalidateKisToken()` 호출 시 메모리 + 디스크 모두 정리, 다음 호출 시 OAuth2 강제 재발급.
- **진단 가시성** — 부팅 로그에 `main=Nh 잔여, realData=Mh 잔여` 표시.

### 부정 / 비용

- **디스크 I/O 추가** — 토큰 갱신마다 atomic write 1회 + 부팅 시 read 1회. 부담 미미 (월 수백 회 미만).
- **토큰 파일 손실 위험** — Railway Volume 손실 시 다음 호출 시 lazy refresh 1회 발생. 정상 운영 시 무영향.
- **권한 0o600 best-effort** — 일부 OS / 컨테이너 환경에서 chmod 무시 가능. 단일 user 환경에서는 무관.

### 시나리오 검증

| 시나리오 | 부팅 직후 OAuth2 호출 |
|----------|----------------------|
| 정상 재배포 (토큰 만료 전) | 0회 (hydrate 사용) ✅ |
| 토큰 만료 후 첫 재배포 | 0회 (lazy refresh — 첫 KIS 호출 시) ✅ |
| 토큰 파일 손실 후 재배포 | 0회 + 첫 KIS 호출 시 lazy refresh ✅ |
| `KIS_TOKEN_BOOT_REFRESH=true` ENV | 1회 (운영자 명시 의도) ✅ |
| `KIS_TOKEN_PERSIST_DISABLED=true` ENV | 매 재부팅 1회 (legacy) — 의도된 fallback |

## Migration

### 즉시 적용

본 ADR 머지 시점부터 자동 적용. 다음 재배포부터 부팅 시 OAuth2 호출 0건.

기존 환경에서 토큰 파일 (`data/kis-tokens.json`) 부재 시:
- 부팅 시 hydrate 결과: 빈 번들
- 첫 KIS 호출 시 lazy refresh 1회 → 디스크 영속
- 다음 재부팅부터는 hydrate 로 OAuth2 호출 0건

### 운영자 액션 불필요

ENV 설정 변경 없음 (default 적용). `KIS_TOKEN_PERSIST_DISABLED=true` 같은 fallback 은 *긴급 동기화 / 디버깅* 시에만 사용.

## References

- 사용자 운영 보고 (2026-05-01): *"재부팅할때마다 kis토큰 갱신 안받도록 패치 (정해진 시간에 자동으로 갱신하게)"*
- ADR-0135 (kisClient 분해) — `auth.ts` 의 토큰 라이프사이클 격리. 본 ADR 은 그 위에 영속 layer 추가.
- 절대 규칙 #2 — kisClient 단일 통로. `kisTokenRepo` 는 `auth.ts` 에서만 import (외부 모듈 직접 호출 금지).
- `server/scheduler/orchestratorJobs.ts:54-57` — 정기 갱신 cron (KST 08:30/20:30, 이미 구현, 변경 없음).
