# ADR-0140: Naver 외인 보유율 5d/20d 추세 영속 인프라 (사용자 P2)

## 상태

채택 (2026-05-01)

## 배경

사용자 5/1 audit 12 아이디어 중 #8 — *"Naver Finance 외국인 보유율 변화 추적.
naverFinanceClient.ts:59 이미 foreignerOwnRatio 필드 가져옴. 그런데 추세
(5일/20일 변화율)로 전환하는 가공이 안 되어 있을 가능성 큼. 변화율 = 외인의
구조적 진입/이탈 시그널 (당일 순매수보다 유효)."*.

코드베이스 audit 결과:

- `naverFinanceClient.fetchNaverStockSnapshot(code)` — `foreignerOwnRatio` 단일
  스냅샷 fetch (라인 123)
- `enrichment.ts` + `quantScreener.ts` + `aiUniverseRouter.ts` 모두 *현재값* 만
  사용. **시계열 영속 + 추세 가공 부재**.
- 외인 *순매수 (당일)* vs *보유율 변화 (구조적)* 두 신호 의미 다름:
  - 당일 순매수: 단발성 (시장 노이즈 포함)
  - 보유율 5d 변화율: 외인의 *구조적 진입/이탈* (장기 추세)

## 결정

### Track 1 — `ForeignerRatioRepo` 시계열 영속 (종목별)

**`server/persistence/foreignerRatioRepo.ts` 신규**:

```typescript
export interface ForeignerRatioRow {
  date: string;       // YYYY-MM-DD
  ratio: number;      // 외인 보유율 (%)
}

export interface ForeignerRatioTrend {
  current: number;        // 가장 최신 보유율
  changePct5d: number | null;   // 5영업일 변화 (현재 - 5일 전, %p)
  changePct20d: number | null;  // 20영업일 변화 (%p)
  sampleSize: number;
  latestDate: string;
}

export function appendForeignerRatio(code: string, row: ForeignerRatioRow): void;
export function loadForeignerRatioSeries(code: string): ForeignerRatioRow[];
export function computeForeignerRatioTrend(code: string): ForeignerRatioTrend | null;
```

영속 정책:
- 종목별 파일: `data/foreigner-ratio/{code}.json`
- 일자별 1개 row (같은 날짜 중복 → 마지막 값으로 덮어쓰기)
- 30영업일 보관 (FIFO trim)
- atomic write (tmp → rename)
- 손상 JSON → 빈 배열 fallback

### Track 2 — `computeForeignerRatioTrend(code)` SSOT

```typescript
export function computeForeignerRatioTrend(code: string): ForeignerRatioTrend | null {
  const series = loadForeignerRatioSeries(code);
  if (series.length === 0) return null;

  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const current = sorted[sorted.length - 1].ratio;
  const latestDate = sorted[sorted.length - 1].date;

  // 5일 변화 (%p, 절대 차이 — *비율* 변화율 아님, 보유율 자체가 % 단위라 %p 정합)
  const changePct5d = sorted.length >= 6
    ? parseFloat((current - sorted[sorted.length - 1 - 5].ratio).toFixed(2))
    : null;
  const changePct20d = sorted.length >= 21
    ? parseFloat((current - sorted[sorted.length - 1 - 20].ratio).toFixed(2))
    : null;

  return { current, changePct5d, changePct20d, sampleSize: sorted.length, latestDate };
}
```

**중요 — `%p` (퍼센트 포인트) vs `%` 변화율**:
- `foreignerOwnRatio` 자체가 % 단위 (예: 51.23%)
- 5d 변화 *2.5%p* = 외인 보유율이 51.23% → 53.73% 로 +2.5 %p 증가
- *5d 변화율 +5%* (51.23 × 1.05 = 53.79) 같은 *비율 변화율* 아님 — 의미 정합

### Track 3 — Naver fetch 호출자 wiring

**`aiUniverseService.ts`** + **`aiUniverseRouter.ts`** + **`enrichment.ts`** 가
이미 `fetchNaverStockSnapshot` 호출 중. 본 PR 은 호출 *직후* `appendForeignerRatio`
호출 추가 (try/catch 격리).

```typescript
const snap = await fetchNaverStockSnapshot(code);
if (snap && snap.foreignerOwnRatio > 0) {
  try {
    appendForeignerRatio(code, {
      date: nowKstYyyyMmDd(),
      ratio: snap.foreignerOwnRatio,
    });
  } catch (e) {
    console.warn(`[ForeignerRatio] append failed ${code}:`, e);
  }
}
```

본 PR scope 는 `aiUniverseService.fetchAiUniverseSnapshot` 만 wiring (단일
진입점) — `aiUniverseRouter.ts` 는 사용자 명령 1회 호출이라 시계열 누적
부담 미미하지만 본 PR scope 밖 (회귀 위험 격리).

### Track 4 — `/foreigner_trend <code>` 텔레그램 진단 명령

**`server/telegram/commands/system/foreignerTrend.cmd.ts` 신규**:

- name: `/foreigner_trend`, alias `/ft` `/fr`
- category: `SYS`, riskLevel: 0, visibility: `ADMIN`
- usage: `/foreigner_trend <6자리 코드>` (예: `/foreigner_trend 005930`)
- 출력:
  - 현재 보유율 + 최신 일자
  - 5d 변화 +N.NN%p (양수=구조적 매수 / 음수=구조적 이탈)
  - 20d 변화 (있다면)
  - 표본 부족 시 *수집 중* 안내 (≥6일 누적 필요)
  - 영속 부재 시 운영자 안내 (cron 미실행 / Naver 미연동)

## 결과

### 운영 효과 (배포 후)

1. 페르소나 자료 #6 *외인 구조적 진입/이탈* 시그널 데이터 입력 처음 마련.
2. 6영업일 누적 후 `/foreigner_trend <code>` 즉시 5d 변화 확인.
3. 21영업일 누적 후 20d 추세도 활성화 — 외인 장기 진입/이탈 확인.
4. 후속 PR (enrichment 시그널 / signalScanner 가중치 / enemyChecklist 외인
   이탈 플래그) 의 데이터 입력 인프라.

### 외부 호출 quota 영향

- Naver Finance 호출 빈도 증가 0건 — *기존 호출* 직후 영속 호출만 추가.
- 디스크 I/O: 종목별 1 파일, 30 row 영속, atomic write tmp→rename.

### 절대 규칙 정합

- **#2 kisClient 단일 통로**: KIS 미사용 — 영향 없음
- **#3 stockService 단일 통로**: aiUniverseService 단일 진입점 wiring
- **#4 autoTradeEngine 단일 통로**: 매매 결정 변경 0줄
- **LIVE 매매 본체 0줄 변경** — 영속 layer + 진단 명령

## 회귀 테스트

- `foreignerRatioRepo.test.ts`:
  - 빈 series → null 반환
  - 단일 row → trend.current = ratio, 5d/20d = null (표본 부족)
  - 6 rows → 5d 활성, 20d null
  - 21 rows → 둘 다 활성
  - 30 row 초과 → FIFO trim
  - 같은 날짜 중복 → 덮어쓰기
  - 잘못된 date 형식 → skip
  - atomic write (tmp 파일 잔존 안 함)
  - 손상 JSON → 빈 배열 fallback
- `aiUniverseServiceForeignerRatio.test.ts` — wiring 정적 grep:
  - `appendForeignerRatio` import 존재
  - try/catch 격리
  - foreignerOwnRatio > 0 가드
- `foreignerTrend.cmd.test.ts`:
  - 잘못된 코드 → 사용법 안내
  - 영속 부재 → 운영자 안내
  - 표본 5 → 수집 중 안내 (5d 미활성)
  - 표본 6 → 5d 활성 + 양수/음수 분기
  - 표본 21+ → 5d + 20d 둘 다
  - throw graceful

## 잔여 후속 PR (scope 외)

1. **wiring 확장**: `aiUniverseRouter.ts` + `enrichment.ts` 도 동일 패턴 (회귀 위험 격리).
2. **enrichment 시그널**: `foreignerRatioTrend` 결과를 stock 카드 + signalScanner
   가중치 입력으로 연결 (별도 ADR).
3. **enemyChecklist**: 외인 이탈 (5d 변화 ≤ -1%p) 플래그 추가 검토.
4. **dual-source**: KRX 외인 보유율 vs Naver cross-validation (ADR-0071 패턴).
