/**
 * QuantMaster Pro — UI Primitives Barrel
 *
 * ## 디자인 시스템 원칙 (Step 4 · 디자인 일관성)
 *
 *  1) **주 언어 = Glass + subtle depth**
 *     Card/Section 기본값(`variant="default"`) 을 우선 사용.
 *     Neo-Brutalism(`variant="neo"`) 은 Gate 스코어/KPI 스코어보드 등 "한 눈 파악"
 *     이 결정적인 곳에 한정 (금융 대시보드의 신뢰감 vs 임팩트 균형).
 *
 *  2) **형태(variant) × 시맨틱(tone) 분리**
 *     - `<Card variant="default" tone="success">` 처럼 "형태" 와 "의미" 를 조합.
 *     - Badge 도 동일한 tone(neutral/success/warning/danger/info/accent/violet) 사용.
 *
 *  3) **Size 매트릭스 일치**
 *     Button / Input(inputSize) / Badge 모두 sm / md / lg 3단계.
 *     - sm: compact UI (툴바, 탭 내부)
 *     - md: 본문 기본 (form 필드 · CTA)
 *     - lg: 모바일 CTA · 히어로 액션
 *
 *  4) **Spacing 토큰**
 *     컴포넌트별 임의 padding 대신 `--space-*` (4px 베이스) CSS 변수 활용.
 *     레이아웃은 `Stack` / `PageGrid` 로 감싸 gap 일관화.
 *
 *  5) **상태 UI 프리미티브**
 *     - 로딩 → `<LoadingState skeleton="..." />` (레이아웃 시프트 방지)
 *     - 비어있음 → `<EmptyState variant="inviting|error|minimal" cta={...} />`
 *     - 토스트 → `toast / toastProgress / toastUndo / toastPromise`
 *     - 폼 검증 → `<Input error={msg} />` + `<FieldError />`
 */
export { cn } from './cn';
export { Card, CardHeader, CardTitle } from './card';
export { Button } from './button';
export { Modal, ModalHeader, ModalBody, ModalFooter } from './modal';
export { Badge } from './badge';
export { Input } from './input';
export { PageHeader } from './page-header';
export { Section } from './section';
export { EmptyState } from './empty-state';
export { LoadingState } from './loading-state';
export { Spinner } from './spinner';
export { Tabs } from './tabs';
export { KpiStrip, KpiScoreboard } from './kpi-strip';
export type { KpiItem, KpiDetail, KpiStatus } from './kpi-strip';
export { ViewModeToggle } from './view-mode-toggle';
export {
  Skeleton,
  SkeletonCard,
  SkeletonKpiGrid,
  SkeletonList,
  SkeletonTable,
} from './skeleton';
export { FieldError } from './field-error';
export { toast, toastProgress, toastUndo, toastPromise } from './toast';
export { InfoTile } from './info-tile';
