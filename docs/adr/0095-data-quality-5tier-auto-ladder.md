# ADR-0095 — DataQualityBadge 5-tier 자동 사다리 격상 (UI Phase A-2)

**상태**: Accepted (PR-Z8 / Phase A-2)
**작성일**: 2026-04-29
**관련**: ADR-0028 (UI 재설계 P0 — DataQualityBadge 도입), ADR-0029 (Condition Source Tier 메타),
ADR-0094 (UI Language SSOT — Phase A 게이트키퍼)

## 배경

ADR-0028 PR-A 가 도입한 `DataQualityBadge` 가 27 조건의 데이터 출처를 *3-tier* (computed/api/aiInferred)
로 분류해 종목 카드에 노출. ADR-0029 PR-B 가 `conditionSourceTiers` 메타 필드를 추가해 휴리스틱
fallback → 메타 우선 분기 격상.

그러나 사용자 분석 (12 아이디어 #3) 의 갭:

> *"현재 컴포넌트는 3-tier(computed/api/aiInferred)인데 SSOT는 5-tier(VERIFIED/EXTERNAL/DELAYED/
> ESTIMATED/MANUAL). 이 갭은 백엔드의 dataSourceType 메타가 도착하면 자연스럽게 해소되어야
> 합니다."*

ADR-0094 가 도입한 UI_LANG.tier SSOT 는 5-tier (VERIFIED/EXTERNAL/DELAYED/ESTIMATED/MANUAL) —
DataQualityBadge 의 3-tier 와 *시멘틱 갭*. 사용자 #3 핵심 통찰:

> *"휴리스틱 fallback 이 항상 작동하되, 서버 메타가 도착하면 자동으로 더 정확한 분류로 승격"*

ADR-0028 의 sourceMetaAvailable 플래그 철학을 **5-tier 로 확장** + **휴리스틱도 자동 사다리** 적용.

## 결정

3 단계 격상 (Phase A-2 단독 PR, 후방호환 의무):

### Layer 1 — `ConditionSourceTier` 5값 union 확장 (옵셔널)

```typescript
// 기존 (PR-A/B)
export type ConditionSourceTier = 'COMPUTED' | 'API' | 'AI_INFERRED';

// 신규 (PR-Phase-A-2, 후방호환)
export type ConditionSourceTier = 'COMPUTED' | 'API' | 'AI_INFERRED' | 'DELAYED' | 'MANUAL';
```

기존 3 값 보존 → 호출자 무수정. 신규 2 값 (DELAYED/MANUAL) 은 서버 메타가 명시 시에만 사용.

5-tier ↔ UI_LANG.tier 매핑 (ADR-0094 SSOT 정합):
- `COMPUTED` → `UI_LANG.tier.VERIFIED` (실측)
- `API` → `UI_LANG.tier.EXTERNAL` (API 수신)
- `AI_INFERRED` → `UI_LANG.tier.ESTIMATED` (AI 추정)
- `DELAYED` → `UI_LANG.tier.DELAYED` (지연 데이터)
- `MANUAL` → `UI_LANG.tier.MANUAL` (수동 입력)

### Layer 2 — `DataQualityCount` 옵셔널 카운트 2 추가

```typescript
export interface DataQualityCount {
  // 기존 3 카운트 (보존)
  computed: number;
  api: number;
  aiInferred: number;
  // 신규 2 카운트 (옵셔널 — 후방호환)
  delayed?: number;
  manual?: number;
  total: number;
  tier: DataQualityTier;
  sourceMetaAvailable: boolean;
}
```

옵셔널 필드라 기존 호출자 (WatchlistCard 등) 는 변경 없이 작동. 신규 5-tier 호출자는
`delayed ?? 0` 패턴으로 안전 접근.

### Layer 3 — `classifyDataQuality` 5-tier 자동 사다리

```typescript
// 가격 출처 분기 (자동 사다리)
const dataSourceType = stock.dataSourceType;
if (dataSourceType === 'REALTIME') computed += 1;       // VERIFIED
else if (dataSourceType === 'YAHOO') api += 1;          // EXTERNAL
else if (dataSourceType === 'STALE') delayed += 1;      // DELAYED — 신규!
else aiInferred += 1;                                    // AI / undefined → ESTIMATED (보수적)
```

**핵심 철학**:
- **휴리스틱 모드**: STALE 가격 출처는 자동 DELAYED 카운트로 분리 (이전엔 aiInferred 흡수).
  나머지 27 조건은 결정적 입력 부재로 DELAYED/MANUAL 추론 불가능 — 메타 모드 전용.
- **메타 모드**: 5-tier 메타 ('DELAYED' / 'MANUAL' 포함) 도착 시 자동 격상.
- **자동 사다리**: 사용자 #3 아이디어 — *"서버 메타가 도착하면 자동으로 더 정확한 분류로 승격"*.
  메타 일부만 도착해도 즉시 활용 (sourceMetaAvailable=false 여도).

### Layer 4 — `DataQualityBadge` 5-tier 라벨 (useUILang SSOT 사용)

```tsx
const t = useUILang();
const labels = {
  verified: t.tier('VERIFIED'),
  external: t.tier('EXTERNAL'),
  delayed: t.tier('DELAYED'),
  estimated: t.tier('ESTIMATED'),
  manual: t.tier('MANUAL'),
};
```

UI 표시:
- **compact 모드**: "🟢 N 🟡 N 🔴 N" 기본 (후방호환). delayed > 0 시 "⏳ N" 추가, manual > 0
  시 "✏️ N" 추가. 카운트 0 시 자동 생략 — UI 간결성 보존.
- **!compact 모드**: 5 줄 풀 표시 + tier 색상 띠. delayed/manual 이 있을 때만 해당 줄 노출.

`useUILang()` 훅 사용으로 ADR-0094 SSOT 정합 — 향후 KO/EN 토글 시 라벨 자동 격상.

## 회귀 테스트

**4 파일 갱신**:

1. `src/utils/dataQualityClassifier.test.ts` — 기존 STALE 케이스 정정 (aiInferred → delayed)
   + 5-tier 자동 사다리 신규 4 케이스 추가
2. `src/utils/dataQualityClassifier.metaMode.test.ts` — 기존 STALE 케이스 정정 + 5-tier
   메타 신규 3 케이스 (DELAYED 5건 + MANUAL 3건 + 5-tier 혼재)
3. `src/components/common/DataQualityBadge.test.tsx` (신규) — jsdom 컴포넌트 회귀 13 케이스:
   3-tier 후방호환 / delayed > 0 ⏳ / manual > 0 ✏️ / 둘 다 0 자동 생략 / 5 모두 표시 /
   ? 아이콘 분기 / !compact 5-tier 라벨 / aria-label 5-tier 정합
4. `src/types/ui.ts` — TypeScript 타입 확장 (회귀 테스트 자체 부재, lint 가 정합 검증)

총 신규 약 20 케이스 + 정정 2 케이스.

## 비결과 (out-of-scope)

본 PR 은 **클라이언트 5-tier 격상** — 이하 항목은 후속 PR 분리:

- **백엔드 5-tier 메타 wiring**: `aiUniverseService` / `enrichment.ts` 가 DELAYED/MANUAL
  메타를 실제로 부여하는 로직은 후속 PR. 본 PR 은 *클라이언트 fallback* 만 격상.
- **MANUAL 입력 wiring**: TradeRecordModal 의 사용자 수동 입력 필드를 `conditionSourceTiers`
  에 매핑하는 로직은 후속 PR.
- **종합 등급 5-tier 산출**: 현재 `tier` (HIGH/MEDIUM/LOW) 는 computed/total 비율 기반 —
  5-tier 가중 계산 (delayed/manual 영향) 은 후속 PR (DataQualityRibbon 도입 시).
- **WatchlistCard 마이그레이션**: useUILang 도입은 본 PR 의 DataQualityBadge 만 — 50+
  컴포넌트 점진 마이그레이션은 별도 PR.
- **#2 `--discover` 모드**: 신규 표현 자동 큐레이션은 운영 1~2 주 누적 후 별도 PR.

## 운영 효과

- **사용자 가시화**: stale 데이터 종목이 ⏳ 아이콘으로 즉시 인지 가능 — 이전엔 AI 추정
  카운트로 흡수되어 sources 모호.
- **자동 사다리 작동**: STALE dataSourceType 종목은 휴리스틱 모드에서도 DELAYED 분류.
  서버 메타 도착 시 27 조건도 5-tier 정확 분류.
- **후방호환 의무 충족**: 기존 50+ 호출자 무수정 — 옵셔널 카운트 패턴.
- **UI_LANG SSOT 정합**: 향후 KO/EN 토글 시 5-tier 라벨 자동 격상.
- **Phase B 진입 준비**: IDontKnow 4-variant 컴포넌트 (DELAYED/INSUFFICIENT/STALE/CONFLICTED) 가
  본 PR 의 DELAYED 카운트 위에 자연 매핑.

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — UI 인프라만 격상 (절대 규칙 #2/#3/#4 미위반)
- **기존 호출자 무수정** — 옵셔널 카운트 + ConditionSourceTier 후방호환 union
- **KIS/KRX/Yahoo 호출 0건** — 클라이언트 분류기 + UI 컴포넌트만
- **회귀 가드** — 신규 13 jsdom 컴포넌트 케이스 + 8 classifier 케이스 + lint TypeScript
  union 호환 검증
- **롤백 안전** — 신규 옵셔널 필드 / 신규 라벨만 도입, ConditionSourceTier 5값 union 은
  superset 이므로 type narrow 영향 없음

## 후속 PR 후보

- **PR-Phase-A-3**: check_ui_language.js `--discover` 모드 (#2 신규 표현 자동 큐레이션)
- **PR-Phase-A-4**: 백엔드 5-tier 메타 wiring (`enrichment.ts` 가 DELAYED/MANUAL 부여)
- **PR-Phase-B**: IDontKnow 4-variant + DataQualityRibbon (#4, #5 — 본 PR 의 5-tier 위에 자연 확장)
- **PR-Phase-C**: V-E-R Card + Stop-loss First (#6, #7, #8)
- **PR-Phase-D**: ConfluenceMeter 4축 (#9, #10)
- **PR-Migration**: WatchlistCard / 50+ 컴포넌트 useUILang 점진 마이그레이션
