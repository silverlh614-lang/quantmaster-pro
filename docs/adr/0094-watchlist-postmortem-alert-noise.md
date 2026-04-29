# ADR-0094 — Watchlist 포화 + 빈스캔 포스트모템 알림 noise 차단

**상태**: Accepted (PR-Z7)
**작성일**: 2026-04-29
**관련**: ADR-0093 (FOMC/VIX 게이팅 dedupe), ADR-0028 §모순9 (Watchlist 캡 정책)

## 배경

사용자 보고 (4/29 09:30~09:35 짧은 시간): 매매 봇 채널에 3종 알림이 도배.

```
✂️ [Watchlist Auto-Trim] 섹션 상한 자동 정리 — 총 1개 ...
📊 [Watchlist 포화] MOMENTUM 섹션: 40개 (alert 30 / soft 40 / hard 50)
   ℹ️ alert 임계 초과지만 soft cap 미달 — 능동 정리 미발동
   ℹ️ AUTO 비중 높음 — autoPopulate 빈도/Gate 임계 검토 권고
🔬 [빈스캔 포스트모템] PATHOLOGICAL_BLOCK 레짐: R4_NEUTRAL ...
```

3 종 모두 *action 없는 noise* 패턴 — 운영자 액션이 불필요하거나 이미 자동 처리됨에도
30분~1시간 단위로 반복 발송.

## 근본 원인

### 1. `[빈스캔 포스트모템]` (`adaptiveScanScheduler.ts:301-313`)

`sendTelegramAlert(...)` 호출에 **`dedupeKey` 부재**. PR-Z6 의 FOMC/VIX 게이팅과
동일 결함 — 시장 빈곤기에 매 3회 빈 스캔마다 발송 도배.

### 2. `[Watchlist 포화]` (`watchlistRepo.ts:401`)

```ts
if (momentumCount > MOMENTUM_ALERT_THRESHOLD) {
  // alert(30) < count(40) <= softCap(40) → "능동 정리 미발동" 분기
  // → 운영자 액션 불필요한 정보성 메시지 30분마다 반복
}
```

`enforceSectionCaps` 가 `arr.length > softMax && <= hardMax` 시 자동 soft 정리 →
trimmed length 는 항상 ≤ softMax. 결과적으로 알림이 발송되는 *유일한 케이스*:

- 입력 > hardCap → hard 강제 정리 → trimmed = hardCap (≥ 50, > softCap=40)
- 그 외: trimmed ≤ softCap → 알림 발송 *조건 자체 만족 안 함*

기존 `count > MOMENTUM_ALERT_THRESHOLD` (30) 비교는 trimmed 가 alert 와 softCap
사이일 때 발송 → **운영자 액션 불필요한 noise**.

### 3. `[Watchlist Auto-Trim]` 

dedupeKey + 15분 cooldown 이미 사용 중. 본 PR 변경 없음 (다른 두 종 해소만으로 사용자
보고 핵심 noise 차단).

## 결정

### 옵션 A — 빈스캔 포스트모템 dedupeKey 추가

```ts
const kstDateStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
sendTelegramAlert(
  `🔬 <b>[빈스캔 포스트모템] PATHOLOGICAL_BLOCK</b>\n...`,
  {
    dedupeKey: `empty_scan_pathological:${kstDateStr}:${postmortem.regime}`,
    cooldownMs: 4 * 60 * 60 * 1000,
  },
);
```

- KST 일자 + 레짐 기반 키 — 레짐 전환 시 (예: R4_NEUTRAL → R6_DEFENSE) 즉시 재알림
- 4h cooldown — 운영자가 *진짜 신호* 에 집중. PATHOLOGICAL_BLOCK 패턴은 통상 수
  시간 내 변하지 않음.

### 옵션 B — Watchlist 포화 alert<count≤softCap 분기 발송 차단

기존:
```ts
if (momentumCount > MOMENTUM_ALERT_THRESHOLD) { /* 알림 발송 */ }
```

변경:
```ts
if (momentumCount > soft.MOMENTUM) { /* 알림 발송 */ }
```

진짜 행동 필요한 두 케이스만 발송:
- (a) `count > softCap` → soft cap 능동 정리 진행 중 (실제로는 enforceSectionCaps 가
  trim 하므로 *사실상 hard cap 도달* 시점에서만 성립)
- (b) `count >= hardCap` → hard cap 강제 정리 발동

`buildWatchlistOverflowAlert` 빌더 자체는 후방호환 — 3 분기 모두 보존 (테스트 /
진단 명령용 호출 가능).

## 회귀 테스트

`watchlistOverflowGate.test.ts` 9 케이스 — saveWatchlist 통합 검증:

| 입력 | trimmed | momentumCount | 알림 |
|------|---------|---------------|------|
| 29 | 29 | 29 | 미발송 (alert 미달) |
| 30 (alert 정확) | 30 | 30 | 미발송 |
| 31 (alert + 1) | 31 | 31 | **미발송 ← 사용자 noise 핵심 차단** |
| 40 (사용자 보고) | 40 | 40 | **미발송 ← 사용자 noise 핵심 차단** |
| 41 (softCap + 1) | 40 (soft 정리) | 40 | 미발송 (Auto-Trim 알림은 별도 발송) |
| 50 (hardCap 정확) | 40 (soft 정리) | 40 | 미발송 |
| 51 (hardCap + 1) | 50 (hard 강제) | 50 | **발송 ← 행동 필요 시점** |
| 60 | 50 (hard 강제) | 50 | **발송** |

`emptyScanDedupe.test.ts` 4 케이스 — 정적 grep 패턴 검증:
- 빈스캔 포스트모템 알림 dedupeKey + 4h cooldown 의무
- 회귀 차단 가드 (.catch 사이 dedupeKey)
- Watchlist 포화 게이팅 패턴 (`momentumCount > soft.MOMENTUM`)
- buildWatchlistOverflowAlert 빌더 후방호환 (3 분기 보존)

## 비결과 (out-of-scope)

- **Watchlist Auto-Trim cooldown 연장**: 사용자 보고 핵심은 옵션 A + B 였음. Auto-Trim
  은 *완료된 정리* 알림이라 의미 있는 정보 — 15분 cooldown 유지.
- **R6_DEFENSE 게이팅 dedupeKey**: PR-Z6 의 후속 PR 후보로 명시됨. 본 PR scope 밖.
- **데이터 빈곤 게이트 cooldown 통일**: 현재 30분. PR-Z6 후속 PR 후보.
- **포스트모템 reset / restart 정책**: postmortem 결과가 의미 있게 변할 때 (다른
  topBlockerCondition 등) 재발송 정책 — 현재는 KST 일자 + 레짐 만 키 — 후속 PR.

## 운영 효과

배포 후 사용자 보고 시나리오:

| 알림 | 기존 (도배) | 본 PR 후 |
|------|-------------|----------|
| 빈스캔 포스트모템 | 매 3회 빈 스캔 (수십회/일) | 4h 1회 (레짐 전환 시 재알림) |
| Watchlist 포화 (alert<count≤softCap) | 30분마다 반복 | **미발송** |
| Watchlist 포화 (count > softCap) | 30분마다 | 30분 cooldown 유지 (행동 필요 시점만) |

채팅창 도배 영구 차단 — 운영자가 *진짜 행동 필요한 신호* (hard cap 도달 / 레짐 전환
시 새 PATHOLOGICAL_BLOCK 등) 에 집중.

## 회귀 위험 평가

- **LIVE 매매 본체 0줄 변경** — 게이팅 결정 / KIS 호출 / fills SSOT 모두 무수정.
- **알림 빈도만 변경** — *내용* 동일.
- **buildWatchlistOverflowAlert 빌더 후방호환** — 호출자가 어떤 분기든 호출 가능,
  본 PR 은 *호출자 결정* 만 변경.
- **회귀 테스트 13 케이스** — saveWatchlist 통합 9 + 정적 grep 패턴 4.

## 후속 PR 후보

- Watchlist Auto-Trim 정리 N개 임계 (1~2개 시 알림 미발송)
- 일일 운영 다이제스트 (3 종 통합)
- 포스트모템 다양화 (topBlocker 변경 시 재발송)
