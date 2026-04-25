# ADR-0013: Multi-Source Stock Master with Shadow DB and Health Score

- **Status**: Accepted
- **Date**: 2026-04-25
- **Branch**: `claude/multi-source-stock-master-M43Jp`
- **Supersedes**: extends ADR-0011 (`aiUniverseService` 단일 통로)

## Context

PR-25-A 가 도입한 `krxStockMasterRepo` 는 KRX MDCSTAT01901 단일 출처에 100% 의존한다.
이 단일 출처는 다음의 실패 모드를 갖는다:

| 실패 모드 | 빈도 | 현재 동작 |
|----------|------|-----------|
| KRX fileDn `OTP` 빈 응답 (헤더/세션 거부) | 평일 간헐 | 빈 마스터 → AI 추천 NO_MATCHES (PR-30) |
| KRX HTML 오류 페이지 반환 (`<!DOCTYPE`) | 점검 시간대 | CSV 파서가 0건으로 처리, 기존 캐시는 안전하지만 진단 부재 |
| 종목수 < 2,000 (예상 ~2,700) | 부분 fetch 실패 | 정상 응답으로 오인 → 기존 캐시 덮어쓰기 |
| KRX 도메인 다운 | 드뭄 | 부팅 시 fail → 디스크 캐시로 fallback (24h 이내면 OK) |

운영자는 다음 정보가 없다:
1. 현재 어떤 소스에서 마스터가 왔는가? (KRX live? cache? seed?)
2. 각 소스의 신뢰도(최근 성공률)는?
3. 다음 fallback 은 무엇인가?

## Decision

종목 마스터를 **4-tier multi-source orchestrator** 로 재설계한다.

```
[Refresh Request]
    │
    ▼
┌───────────────────────────────────┐
│ Tier 1: KRX_CSV    (~2,700 ticker)│ ← Primary, 24h TTL
└──────────┬────────────────────────┘
           │ 검증 실패
           ▼
┌───────────────────────────────────┐
│ Tier 2: NAVER_LIST (~200 ticker)  │ ← KOSPI/KOSDAQ 시총 상위
└──────────┬────────────────────────┘
           │ 실패
           ▼
┌───────────────────────────────────┐
│ Tier 3: SHADOW_DB  (last-known-good)│ ← 마지막 검증 통과 스냅샷
└──────────┬────────────────────────┘
           │ 부재
           ▼
┌───────────────────────────────────┐
│ Tier 4: STATIC_SEED (~250 ticker) │ ← 코드에 박제, 절대 0 보장
└───────────────────────────────────┘
```

### 검증 규칙 (`validateMasterPayload`)

응답이 다음 중 하나라도 위반하면 `INVALID` 로 분류 후 다음 tier 로 폴백:

1. **HTML 응답 감지**: payload 의 첫 200 byte 가 `<!DOCTYPE`, `<html`, `<HTML` 로 시작하면 즉시 거부
2. **종목수 임계**: `entries.length < MIN_VALID_ENTRIES` (기본 2,000)
3. **코드 형식**: `/^\d{6}$/` 매치율 < 95%
4. **시장 분류**: KOSPI + KOSDAQ 비율 < 80% (KONEX/OTHER 만 받으면 비정상)

검증 실패 시 **기존 마스터/Shadow DB 를 절대 덮어쓰지 않는다**.

### Shadow DB 분리 정책

- `krx-master.json` (현재 active 마스터, source 표시 포함)
- `stock-master-shadow.json` (last-known-good, **검증 통과한 응답만** 저장)
- Shadow 는 Tier 1 또는 Tier 2 검증 통과 시점에만 갱신
- Tier 3 (Shadow 자체) 또는 Tier 4 (Seed) 는 Shadow 를 갱신하지 않음

### Health Score (0-100) per source

Source 별 rolling stats 를 영속화 (`stock-master-health.json`):

- `successCount` / `failureCount` (전체 누적)
- `consecutiveFailures` (현재 연속 실패)
- `lastSuccessAt` / `lastFailureAt` / `lastFailureReason`
- `recentRuns` (최근 20건 ring buffer: `{ ts, ok, reason? }`)

```
health = 100
  - 5  × consecutiveFailures      (clamp 0~50)
  - 30 × (1 if (now - lastSuccessAt) > 7d else 0)
  - 20 × (1 if recent failure rate > 50% else 0)
```

Floor 0, ceiling 100. Boot 직후(아직 데이터 없음)는 50 (UNKNOWN).

### API 실패 감지

기존 `[KrxMaster:diag]` 로그(PR-30) 를 유지하되, 다음 시점에 텔레그램 경보:

- Tier 1 (KRX) 가 24h 내 3회 연속 실패 → CRITICAL
- 어떤 source 도 검증 통과하지 못해 SEED 로 떨어짐 → CRITICAL
- HTTP 400 / HTML 응답 감지 → WARN

dedupe key: `master_source_alert:{source}:{date}` (1일 1회)

### Universe 이중화

`server/data/stockMasterSeed.ts` 에 KOSPI 200 + KOSDAQ 100 leader ~250건을 박제.
이 파일은 **수동 큐레이션** 이며 분기마다 검토. AI/스크래퍼가 자동 갱신하지 않는다.

## Module Boundaries

| Module | Single Responsibility |
|--------|------------------------|
| `server/data/stockMasterSeed.ts` | KOSPI/KOSDAQ leader 정적 seed (수동 큐레이션) |
| `server/persistence/stockMasterHealthRepo.ts` | Source 별 health score (0-100) + rolling stats 영속 |
| `server/persistence/shadowMasterDb.ts` | Last-known-good 스냅샷 — 검증 통과한 응답만 저장 |
| `server/clients/naverStockListClient.ts` | Naver 모바일 시총 상위 fetch (Tier 2 fallback, AI 추천 quota 별도) |
| `server/services/multiSourceStockMaster.ts` | 4-tier 폴백 orchestrator + 검증 + 경보 |

## Boundary Rules

- **multiSourceStockMaster boundary**: Tier 1~4 fallback 의 단일 진입점. AI 추천(`aiUniverseService`) 은 본 모듈을 통해서만 마스터를 갱신한다.
- **자동매매 분리**: 자동매매(signalScanner 등) 는 본 변경의 영향을 받지 않는다 — `kisClient` 단일 통로 규칙(절대 규칙 #2) 그대로.
- **Shadow 갱신 제약**: Tier 1/2 검증 통과 시에만 shadow 갱신. Tier 3 자체 또는 Tier 4 seed 는 shadow 를 절대 갱신하지 않음 (오염 방지).

## Consequences

### Positive
- KRX 단일 실패점 제거 — Naver/Shadow/Seed 3중 안전망
- 운영자 가시성: `/api/ai-universe/health` (후속 PR) 또는 텔레그램으로 source 별 health 조회
- 검증 임계가 0건 응답을 막아 PR-30 주말 단락과 합쳐 false-empty 가능성 0
- Universe 절대 0 건 보장 (최악 경우 seed 250건 lock-in)

### Negative
- 코드 복잡도 증가 — 5개 신규 파일 (~700 LoC)
- Static seed 의 분기별 수동 갱신 부담 — README 또는 incident-playbook 에 운영 task 등록 필요
- Naver 모바일 list endpoint 의 비공식성 — 깨질 수 있음 (그래서 Tier 2 인 이유)

### Mitigation
- Static seed 는 최소 코어 30건 + 시총 상위 ~220건 양분. 코어 30건은 1년 단위 변동만, 나머지는 분기 갱신.
- Naver list endpoint 가 401/410 반환하면 health=0 으로 떨어져 Tier 3/4 자동 사용.

## Phase 2 (Future)

본 ADR 는 인프라만 정의. 후속 PR:
- `/api/ai-universe/master/health` 운영자 endpoint
- Telegram `/master` 명령으로 source 별 health 조회
- Static seed 갱신 자동화 (월 1회 KRX 시총 top 250 으로 PR 자동 생성)
