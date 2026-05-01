# ADR-0145: /supply_health 공매도 카드 — macroState 직접 진단

## 상태

채택 (2026-05-01)

## 배경

`/supply_health` (`/sh`) 의 5번 카드 "공매도/대차잔고" 가 도입 시점부터 *하드코드
N/A* 로 고정. `MacroState.shortSelling{Ratio,Source,FetchedAt}` 필드는 이미
`fetchKrxShortSelling` 의 3단 폴백 (`KRX_DIRECT` → `KRX_OTP` → `KIS_ESTIMATE`)
결과로 채워지고 있으나, 진단 카드는 그 데이터를 읽지 않고 매번 ⚪ N/A 로 표시.

문제:
- 운영자가 `/sh` 만으로는 *macroState 결손* 과 *기능 미구현* 을 구분 불가.
- KRX 직접 호출 차단 / KRX_OTP fallback / KIS_ESTIMATE 격하 같은 시나리오
  차이가 보이지 않음.
- 카드 자체가 항상 ⚪ 라 위험 TOP 3 로직에서도 사실상 dead weight.

## 결정

### Track 1 — `diagnoseShort(macro, nowMs)` 4-way 분기

```typescript
function diagnoseShort(macro: MacroState | null, nowMs: number): ChannelStatus {
  if (!macro?.shortSellingSource || macro.shortSellingRatio === undefined) {
    return { marker: 'MISSING', /* macroState 결손 */ };
  }

  const age = elapsedMs(macro.shortSellingFetchedAt, nowMs);
  const ageStale    = age !== null && age > SHORT_STALE_DAYS * DAY_MS;
  const sourceStale = macro.shortSellingSource === 'KIS_ESTIMATE';
  const stale       = ageStale || sourceStale;

  return {
    marker: stale ? 'STALE' : 'OK',
    /* source / ratio / updated 노출 */
  };
}
```

분기 규칙:

| 조건 | 마커 | 사유 |
|---|---|---|
| `shortSellingSource` 또는 `shortSellingRatio` 부재 | 🔴 MISSING | macroState 결손 — fetchKrxShortSelling 호출 부재 |
| `source = 'KIS_ESTIMATE'` | 🟡 STALE | KRX 두 경로 모두 실패한 fallback — 정확도 ↓ |
| `fetchedAt` 가 2일 초과 | 🟡 STALE | cron 미동작 또는 KRX 데이터 정체 |
| 그 외 | 🟢 OK | KRX_DIRECT 또는 KRX_OTP 로 정상 갱신 |

### Track 2 — `SHORT_STALE_DAYS = 2`

KRX 일별 공매도 데이터는 영업일 1회 갱신. 주말 + 익일 공시 정체를 고려해 2일을
임계로 설정 (`FSS_STALE_DAYS = 4` 와 동일 패턴).

### Track 3 — read-only 보장 유지

- `macroState` 갱신 없음 (`saveMacroState` / `appendXxx` / `refreshXxx` 호출 0)
- `fetchKrxShortSelling` 호출 없음 — 진단 카드는 *이미 적재된* 데이터만 가시화
- 외부 fetch 폭발 위험 없음 — KIS rate limiter 영향 0

## 회귀 영향

- 기존 테스트 `공매도/대차잔고는 전용 health 미구현이면 N/A로 표시` 는 N/A 가
  더 이상 발생하지 않으므로 4 분기 신규 케이스 (MISSING / OK / KIS_ESTIMATE
  STALE / age STALE) 로 교체.
- 기존 마커 가정 테스트 2건 (`OK / STALE / MISSING / N/A 마커 ...`,
  `하단 상세는 7채널 고정 순서로 출력`) 은 ⚪ → 🔴 (macroState 결손 시 MISSING)
  으로 갱신.
- read-only 검증 테스트는 패턴 검사만 하므로 영향 없음.

## 검증 시나리오

1. macroState 에 `shortSellingSource` 가 없으면 🔴 MISSING + "macroState 결손"
   메시지 표시.
2. KRX_DIRECT 로 갱신된 직후 `/sh` 호출 → 🟢 OK + ratio 표시.
3. KRX 두 경로 모두 실패 후 KIS_ESTIMATE 로 fallback → 🟡 STALE + "KRX 폴백
   실패" 사유.
4. 3일 이상 cron 미동작 → 🟡 STALE + age 사유.

## 후속 작업

- `/short_status` 전용 명령 신설 (현재는 `상세: /short_status 예정` placeholder).
- `marketDataRefresh` cron 의 `fetchKrxShortSelling` 실패율 모니터링 — 본 진단
  카드의 STALE 빈도가 ECOS/KRX 안정성 지표로 활용 가능.
