# ADR-0136: FSS Records Age Diagnostic + passiveActiveBoth Null Branch (사용자 P0)

## 상태

채택 (2026-05-01)

## 배경

사용자 5/1 audit 보고 — *"공매도, 외인/기관 수급 정보가 제대로 불러오고 있는지
확인이 필요. 정상적으로 작동을 하고 있지 않은 상황"*. 12 아이디어 중 P0:

1. `/health` 또는 `/fss_status` 명령 추가 — `loadFssRecords()` 결과의 최신
   날짜 + 오늘과의 거리를 텔레그램 명령으로 즉시 확인 가능하게. silent
   degradation 을 깨뜨림.
2. `passiveActiveBoth=false` 가 *데이터 결손* 때문인지 *시그널 부재* 때문인지
   구분. 현재 false 한 값이 두 의미를 모두 담고 있음. STALE/MISSING 일 때
   `passiveActiveBoth = null` 로 전환 (평가 제외 vs 분명히 외인 합치 안 됨
   분리).

## 결함 진단

### 결함 #1 — silent degradation

`fssRepo.ts:11-14` `loadFssRecords()` 가 파일 부재 시 `[]` 반환,
`marketDataRefresh.ts:415-425` `computeFssVars()` 가 빈 배열 시 `passiveActiveBoth: false` 반환.

운영자가 *FSS 레코드가 영원히 비어있는지* / *최근 갱신은 언제인지* 인지할
경로 부재. `/health` 출력에도 노출 안 됨. 결과: 페르소나 의사결정 (regimeEngine
의 R3_EARLY/R2_BULL 분기) 이 *데이터 결손 = 시그널 부재* 로 잘못 해석.

### 결함 #2 — 의미 단절

`MacroState.passiveActiveBoth: boolean` (true/false) 가 두 의미 혼용:

- `true` = Passive + Active 두 신호 동시 양수 (5일 동안)
- `false` = ① 신호 평가 결과 미합치 / ② FSS 레코드 부재로 평가 자체 불가

페르소나 의사결정 (regimeEngine.ts:207 `!v.passiveActiveBoth` = R3_EARLY 트리거)
가 두 의미를 동일하게 처리 — 데이터 결손이 *Passive 전환 시작* 신호로 *오인* 가능.

## 결정

### Track 1 — `getFssRecordsAge()` SSOT 진단 헬퍼

**`server/persistence/fssRepo.ts` 확장**:

```typescript
export type FssRecordsAgeStatus = 'OK' | 'STALE' | 'MISSING';

export interface FssRecordsAgeInfo {
  status: FssRecordsAgeStatus;
  latestDate: string | null;       // 'YYYY-MM-DD' or null
  ageDays: number | null;          // 0 = 오늘, 1 = 어제, null = MISSING
  recordCount: number;             // 영속 레코드 수
}

export function getFssRecordsAge(now?: Date): FssRecordsAgeInfo;
```

**상태 분류 SSOT**:

| ageDays | recordCount | status | 의미                              |
|---------|-------------|--------|-----------------------------------|
| null    | 0           | MISSING| FSS 레코드 영속 파일 부재/빈 배열|
| 0~3     | ≥1          | OK     | 최근 영업일 갱신                  |
| 4+      | ≥1          | STALE  | 4영업일+ 미갱신                   |

ageDays 는 *KST 자정 기준* 일 단위 차이.

### Track 2 — `MacroState.fssRecordsAge` 옵셔널 영속

**`server/persistence/macroStateRepo.ts`**:

```typescript
export interface MacroState {
  // ...기존 필드
  fssRecordsAge?: FssRecordsAgeInfo;   // 신규: FSS 신선도 진단
  passiveActiveBoth?: boolean | null;  // 격상: null = 평가 제외 (STALE/MISSING)
}
```

`passiveActiveBoth` 가 *boolean* → *boolean | null* 로 격상.
`true`/`false` 의미는 그대로, 신규 `null` 의미: "평가 자체 불가 — STALE/MISSING".

### Track 3 — `computeFssVars()` 분기 격상

**`server/trading/marketDataRefresh.ts`**:

```typescript
function computeFssVars(): {
  foreignNetBuy5d: number;
  passiveActiveBoth: boolean | null;   // 격상
  fssRecordsAge: FssRecordsAgeInfo;    // 신규
  foreignContinuousBuyDays: number;
  foreignContinuousSellDays: number;
} {
  const records = loadFssRecords().sort(...);
  const fssRecordsAge = getFssRecordsAge();
  const last5 = records.slice(-5);

  if (fssRecordsAge.status !== 'OK' || last5.length < 3) {
    return {
      foreignNetBuy5d: 0,
      passiveActiveBoth: null,           // 평가 제외 명시
      fssRecordsAge,
      foreignContinuousBuyDays: 0,
      foreignContinuousSellDays: 0,
    };
  }

  // OK + 표본 ≥ 3 시 정상 평가
  const passiveActiveBoth = last5.every(r => r.passiveNetBuy > 0 && r.activeNetBuy > 0);
  // ...
}
```

**`refreshMarketRegimeVars()`** 가 `computed.fssRecordsAge = fssVars.fssRecordsAge`
영속.

### Track 4 — `regimeBridge.buildRegimeVars` 후방호환

**`RegimeVariables.passiveActiveBoth: boolean`** (src/types/core.ts) 시그니처는
*변경 없음* — 클라이언트와 공유 타입이라 계약 위반 위험.

`buildRegimeVars` 가 `null → false` 로 변환:

```typescript
passiveActiveBoth: macroState.passiveActiveBoth ?? false,
```

이미 `??` 패턴 사용 중 — null 도 자동 false fallback. **regimeEngine.ts:207
`!v.passiveActiveBoth` 본체 0줄 변경**.

**핵심 절차 정합** — 본 PR 은 *진단 가시화* 만, 페르소나 *의사결정 변경* 은
별도 PR. STALE/MISSING 시 R3_EARLY 트리거 보수화 (passiveActiveBoth=null →
"평가 제외" 처리) 는 후속 PR-1-B 로 분리 — 의사결정 변경은 회귀 위험.

### Track 5 — `/fss_status` 텔레그램 명령

**`server/telegram/commands/system/fssStatus.cmd.ts` 신규**:

- name: `/fss_status`, alias `/fss`
- category: `SYS`, riskLevel: 0 (read-only)
- visibility: `ADMIN`
- 출력:
  - status 이모지 (OK ✅ / STALE ⚠️ / MISSING ❌)
  - latestDate (KST)
  - ageDays (0 = 오늘 / 1 = 어제 / N+ = N영업일 전)
  - recordCount
  - last5 표본 카운트
  - passiveActiveBoth 현재 값 (true/false/null) + 설명
  - 결손 시 운영자 안내 (`POST /api/macro/fss-records` 영속 보강 또는 cron 점검)

### Track 6 — ENV 우회

`FSS_STATUS_DIAGNOSTIC_DISABLED=true` ENV 시 본 PR 의 모든 분기 우회 — 기존
`?? false` 동작 100% 복원 (ADR-0028 패턴 차용).

`getFssRecordsAge()` 는 항상 작동 (진단 헬퍼는 부작용 0 — ENV 무관).
`computeFssVars()` 의 null 분기 + macroState 영속만 ENV 로 제어.

## 결과

### 운영 효과 (배포 후)

1. 운영자가 `/fss_status` 한 번에 FSS 레코드 신선도 + passiveActiveBoth
   현재 의미 즉시 인지. silent degradation 영구 차단.
2. `MacroState.fssRecordsAge` 영속으로 후속 PR (의사결정 wiring / 텔레그램
   리포트 / UI 가시화) 의 데이터 시드 마련.
3. `passiveActiveBoth=null` 분리로 페르소나 의사결정의 *데이터 결손 vs 신호
   부재* 구분 가능 — 본 PR 은 분리만, 의사결정 wiring 후속 PR.

### 기존 호출자 영향

- `regimeEngine.ts` 본체 0줄 변경 (RegimeVariables 시그니처 보존).
- `regimeBridge.ts` 1줄 (`?? false` 패턴 보존).
- `marketDataRefresh.ts` `refreshMarketRegimeVars` computed 영속만 추가.
- `macroRouter.ts` macroState GET/POST 자동 호환 (옵셔널 필드).

## 회귀 테스트

- `fssRepo.test.ts` — getFssRecordsAge 5분기 (MISSING / OK 0일 / OK 1일 /
  STALE 4일+ / OK boundary 3일).
- `marketDataRefreshFssVars.test.ts` — computeFssVars 4분기 (MISSING null /
  STALE null / OK 5일 표본 / OK 3일 표본 boundary).
- `fssStatus.cmd.test.ts` — 메시지 포맷 4분기 (OK / STALE / MISSING / ENV 우회) +
  메타데이터 + execute throw graceful.
- `regimeBridgePassiveActive.test.ts` — null → false 변환 회귀 가드.

## 잔여 후속 PR (scope 외)

1. **PR-1-B** — `regimeEngine.ts` 가 `passiveActiveBoth: boolean | null` 직접
   수신 후 null 분기 처리 (R3_EARLY 트리거 보수화). RegimeVariables 시그니처
   변경 + 클라이언트 동기 사본 갱신 + 회귀 위험.
2. **PR-1-C** — `/health` 메시지에 FSS 라인 추가 (`/fss_status` 와 별도).
3. **PR-1-D** — UI MacroOverview 카드에 `fssRecordsAge` 신선도 마커.
