# ADR-0016: Weekend / Holiday AI Universe — 5-Tier Fallback Orchestration

- **Status**: Accepted
- **Date**: 2026-04-25
- **Branch**: `claude/weekend-stock-search-stability-JU9ZE`
- **Extends**: ADR-0011 (`aiUniverseService` 단일 통로), ADR-0013 (multiSourceStockMaster 4-tier)
- **Related**: PR-25-A/B/C, PR-29 (EgressGuard), PR-26/27 (SymbolMarketRegistry · marketGate), PR-32 (offhours snapshot)

## Context

PR-25-C 가 AI 추천 경로를 KIS/KRX 와 완전히 분리한 뒤 사용자 보고가 누적되었다.

| 증상 | 원인 |
|------|------|
| 주말·공휴일·점검 시간에 "추천 검색 안 됨" | `GOOGLE_SEARCH_API_KEY` 미설정 환경에서 `discoverUniverse` 가 baseline `SEED_UNIVERSE` 로 직행 |
| baseline 응답을 사용자 입장에서 "신뢰도 낮은 임시 추천"으로 인지 | UI 안내 문구가 "baseline 시총 상위" 로 노출되어 마치 cache miss 된 것처럼 보임 |
| `LIVE` 라벨이 장외/주말에도 표시 | UI 레이어에서 `marketMode` SSOT 미사용 — 시장 상태와 universe 출처가 따로 분리 |
| Yahoo OHLCV 기반 정량 폴백 부재 | Naver/KRX 캐시만으로 모멘텀 시그널을 재현할 수 없어 universe 가 정적 seed 로 고착 |

본 ADR 의 목적은 다음을 단일 SSOT 로 결정한다:

1. AI 추천 universe 가 **절대 "신호 없음"으로 비지 않도록** 5-tier 폴백 사슬 정의
2. `MarketDataMode` 5분류로 시장 상태 ↔ universe 출처 ↔ UI 안내 일치
3. 직전 정상 universe 디스크 스냅샷 + 만료 정책 + 갱신 거부 정책
4. baseline (Tier 5) 사용자 노출 문구를 "정량 캐시 기반 후보군" 으로 재정의 — "baseline 시총 상위" 표현 금지
5. KIS/KRX quota 침범 0건 (절대 규칙 #3) + Yahoo 호출은 EgressGuard·marketGate 통과 KR 심볼만

## Decision

### 1. 5-Tier Fallback Orchestration

```
[discoverUniverse(mode)]
        |
        v
   Tier 1: GOOGLE_OK
   ├─ google_search bucket 통과 + Google CSE 매칭 ≥ 3건
   ├─ KRX 마스터로 stock entry 보강
   ├─ Naver Finance enrichment (옵션)
   └─ ★ snapshot 디스크 갱신 (Tier 1 만 갱신 권한)
        |
        v (Tier 1 실패 / NOT_CONFIGURED / BUDGET_EXCEEDED / NO_MATCHES / ERROR)
        |
   Tier 2: FALLBACK_SNAPSHOT
   ├─ data/ai-universe-snapshot-{MODE}.json 로드
   ├─ snapshot.tradingDate 가 7일 이내 → 사용
   └─ snapshot 갱신 거부 (오염 방지)
        |
        v (snapshot 부재 / 만료 / 손상)
        |
   Tier 3: FALLBACK_QUANT
   ├─ Yahoo OHLCV 기반 정량 스크리너 (mode 별 임계)
   ├─ EgressGuard + marketGate 통과 KR 심볼만 outbound
   ├─ 시장 닫힘 → stale Yahoo 캐시 (PR-29 구조 활용)
   └─ snapshot 갱신 거부
        |
        v (Yahoo 차단 / 응답 비어있음 / 임계 미달)
        |
   Tier 4: FALLBACK_NAVER
   ├─ Naver Finance 모바일 endpoint 시총 상위 N
   ├─ 펀더멘털 (PER/PBR/시총) 만 보강 — 뉴스·촉매 정보 없음
   └─ snapshot 갱신 거부
        |
        v (Naver 차단 / 4xx negative cache 활성)
        |
   Tier 5: FALLBACK_SEED
   ├─ SEED_UNIVERSE (현 baseline) — 하드코딩 KOSPI/KOSDAQ leader ~24
   ├─ mode 별 태그 우선순위 (LARGE_MOMENTUM/DEFENSIVE/VALUE/GROWTH_MID)
   └─ ★ 사용자 노출 문구: "마지막 거래일 기준 정량 데이터(KIS/Yahoo/Naver/KRX 캐시)
       기반 후보군. 뉴스·촉매제 검색은 비활성화"
```

### 2. MarketDataMode 5분류 (SSOT)

| 모드 | 조건 | UI 영향 | universe 정책 |
|------|------|---------|--------------|
| `LIVE_TRADING_DAY` | `isMarketOpen()===true` | LIVE 배지 (주황 pulse) | Tier 1 정상 시도 |
| `AFTER_MARKET` | 평일 + 장 마감 후 ~ 다음날 09:00 | "장외" 배지 (파랑 정적) + 다음 개장 hover | Tier 1 시도, snapshot 활용 가능 |
| `WEEKEND_CACHE` | `isKstWeekend()===true` | "주말 — 직전 거래일 데이터" | Tier 2 우선, Tier 3~5 폴백 |
| `HOLIDAY_CACHE` | `DATA_FETCH_FORCE_OFF=true` 또는 향후 marketClock 휴일 확장 | "공휴일 — 캐시 데이터" | Tier 2 우선 |
| `DEGRADED` | Tier 1~2 모두 실패 + Tier 3+ 진입 | ⚠️ "외부 소스 다중 실패" 경고 배너 | Tier 3/4/5 어느 하나 |

`server/utils/marketClock.ts` 의 `isMarketOpen` / `isMarketDataPublished` / `isKstWeekend` 를 wrap 하여 단일 함수 `classifyMarketDataMode(now)` 로 노출한다 (engine-dev 가 다음 phase 에서 구현).

### 3. AiUniverseSnapshot 스키마

```ts
interface AiUniverseSnapshot {
  mode: AiUniverseMode;
  generatedAt: number;              // epoch ms — Tier 1 성공 시각
  tradingDate: string;              // YYYY-MM-DD KST — 정상 거래일 기준
  marketMode: MarketDataMode;       // 갱신 시점의 시장 모드
  sourceStatus: 'GOOGLE_OK';        // 갱신은 Tier 1 성공만
  candidates: Array<{
    code: string;
    name: string;
    market: 'KOSPI' | 'KOSDAQ';
    sources: string[];              // displayLink[] — discoveredFrom
    snapshot?: NaverStockSnapshot;  // 옵셔널 — enrichment 결과
  }>;
  diagnostics: AiUniverseDiagnostics;
}
```

영속 위치: `data/ai-universe-snapshot-{MODE}.json` (mode 별 별도 파일)
- MODE: `MOMENTUM` | `EARLY_DETECT` | `QUANT_SCREEN` | `BEAR_SCREEN` (+ 클라이언트 `SMALL_MID_CAP` 변형 허용)
- 함수형 path 헬퍼 `aiUniverseSnapshotFile(mode)` — `paths.ts` 에 추가

### 4. 갱신 정책 (오염 방지)

ADR-0013 와 동일한 패턴:

| Tier | snapshot 갱신 권한 |
|------|-------------------|
| Tier 1 GOOGLE_OK + candidates ≥ 3 | ✅ 갱신 |
| Tier 1 GOOGLE_OK + candidates < 3 | ❌ 거부 (불완전) |
| Tier 2 FALLBACK_SNAPSHOT | ❌ 자기 자신 (read-only) |
| Tier 3 FALLBACK_QUANT | ❌ 거부 (정량만이라 명시적 신호 부재) |
| Tier 4 FALLBACK_NAVER | ❌ 거부 (시총 상위에 가까움) |
| Tier 5 FALLBACK_SEED | ❌ 거부 (하드코딩) |

### 5. 만료 정책

snapshot.tradingDate 기준 (KST):
- ≤ 7일 묵음 → Tier 2 사용 가능
- > 7일 묵음 → expired 분류 → Tier 3 으로 진행
- 손상 (JSON parse 실패) → Tier 3 으로 진행 + telegram WARN

### 6. baseline (Tier 5) 사용자 노출 문구

**금지** 표현: "baseline 시총 상위", "임시 추천", "fallback seed"
**권장** 표현 (UI 배너 / Telegram 메시지 공통):
> 마지막 거래일 기준 정량 데이터(KIS/Yahoo/Naver/KRX 캐시)에서 추출한 후보군입니다.
> 뉴스·촉매제 검색은 일시적으로 비활성화 상태입니다.

이 문구는 dashboard-dev 가 `RecommendationWarningsBanner` (PR-31) 에 주입하고
`server/services/aiUniverseService.ts` 가 `diagnostics.userMessage` 로 동봉한다.

### 7. Health 노출 — `GET /api/health/ai-universe`

운영자가 학습 명령(`/learning_status` PR-36 패턴) 과 동일하게 텔레그램에서 즉시 확인 가능하도록 HTTP endpoint 신설:

```json
{
  "marketMode": "WEEKEND_CACHE",
  "snapshots": {
    "MOMENTUM":     { "tradingDate": "2026-04-24", "ageDays": 1, "sourceStatus": "GOOGLE_OK" },
    "QUANT_SCREEN": { "tradingDate": "2026-04-22", "ageDays": 3, "sourceStatus": "GOOGLE_OK" },
    "BEAR_SCREEN":  null,
    "EARLY_DETECT": null
  },
  "masterHealth": { "overall": 88, "krx": 95, "naver": 75, "shadow": 90, "seed": 100 },
  "sources": {
    "google":      "configured",
    "naver":       "active",
    "yahoo":       "gated_weekend"
  }
}
```

## Risks

1. **Yahoo 프록시 호출 quota** — Tier 3 진입은 GOOGLE_OK 실패 + snapshot expired 둘 다 만족할 때만. EgressGuard 가 시장시간 외 KR 심볼 차단하므로 주말 Tier 3 는 자동으로 stale 응답 사용 → 신규 outbound 0건.
2. **Naver Finance negative cache 충돌** — Tier 4 진입 시 PR-31 의 5분 negative cache 가 활성이면 직접 Tier 5 로 이동. negative cache 만료 후 다음 호출에서 회복.
3. **Snapshot 디스크 손상** — JSON parse 실패 시 Tier 3 으로 진행 + WARN 로그. 다음 Tier 1 성공 시 자동 복구.
4. **mode 키 변형 (SMALL_MID_CAP)** — 클라이언트 측 변형은 `aiUniverseSnapshotFile(mode)` 가 정규화 수용. 서버 측 정규 4-mode 와 분리.

## Rollback

환경변수 `AI_UNIVERSE_FALLBACK_DISABLED=true` 설정 시 `discoverUniverse` 가 ADR-0011 동작 (Tier 1 → Tier 5 즉시) 으로 복귀. snapshot 파일은 유지 (다음 활성화 시 재사용).

## Alternatives Considered

1. **Gemini grounding 으로 Google 대체** — 비용 + 응답 지연 + hallucination 위험으로 PR-25-A 단계에서 이미 기각.
2. **KRX 시총 정렬을 Tier 4 로 사용** — 절대 규칙 #3 (KIS/KRX 는 자동매매 전용) 위반.
3. **Snapshot 을 단일 파일에 mode 키로 저장** — 동시 갱신 race 가능성. mode 별 별도 파일이 atomic write 단순화.
4. **만료 임계 14일** — 시장 상황 변동 (실적 시즌·업종 사이클) 반영 늦음. 7일이 현실적 절충.

## References

- ADR-0011 — AI 추천 KIS/KRX 분리 (PR-25-A/B/C)
- ADR-0013 — multiSourceStockMaster 4-tier (PR-33)
- ADR-0009 — 외부 호출 예산 게이트 (PR-23)
- PR-29 — EgressGuard outbound 단일 관문
- PR-26/27 — SymbolMarketRegistry / marketGate 일반화
- PR-31 — Naver Finance negative cache + AI cache 자동 무효화
- PR-32 — offhours snapshot (`OFFHOURS_SNAPSHOT_FILE`)
- PR-36 — `/learning_status` 명령 패턴 (운영자 즉시 조회)
