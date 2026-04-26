// @responsibility toast UI 프리미티브 컴포넌트
/**
 * toast — Sonner 기반 토스트 헬퍼.
 *
 * 프로젝트 전역에서 일관된 톤앤매너로 알림을 띄우기 위한 얇은 래퍼.
 * 기본 `toast` 는 그대로 재-export 하여 단순 메시지 호출이 가능하고,
 * undo / progress 같은 재사용 패턴은 네이밍된 헬퍼로 제공한다.
 */
import { toast as sonner } from 'sonner';

/** 기본 sonner toast 를 그대로 노출 — 단순 정보/성공/오류 메시지용. */
export const toast = sonner;

/**
 * toastProgress — 장시간 작업에 대한 "진행 중 → 완료/실패" 토스트 전환.
 *
 * ```ts
 * const done = toastProgress('주문 전송 중…');
 * try { await send(); done.success('전송 완료'); }
 * catch (e) { done.error('전송 실패'); }
 * ```
 */
export function toastProgress(loadingMessage: string) {
  const id = sonner.loading(loadingMessage);
  return {
    id,
    success(message: string, description?: string) {
      sonner.success(message, { id, description });
    },
    error(message: string, description?: string) {
      sonner.error(message, { id, description });
    },
    info(message: string, description?: string) {
      sonner(message, { id, description });
    },
    dismiss() {
      sonner.dismiss(id);
    },
  };
}

/**
 * toastUndo — 되돌릴 수 있는 액션 직후 "방금 X 했습니다 — 실행취소" 패턴.
 *
 * ```ts
 * removeItem(id);
 * toastUndo('관심종목에서 삭제됨', () => restoreItem(id));
 * ```
 */
export function toastUndo(
  message: string,
  onUndo: () => void,
  opts?: { description?: string; duration?: number },
) {
  sonner(message, {
    description: opts?.description,
    duration: opts?.duration ?? 6000,
    action: {
      label: '실행취소',
      onClick: onUndo,
    },
  });
}

/**
 * toastPromise — Promise 기반 작업의 상태 전환을 한 번에 관리.
 *  - sonner.promise 의 얇은 래퍼 + 한국어 기본 메시지.
 */
export function toastPromise<T>(
  promise: Promise<T>,
  messages: {
    loading: string;
    success: string | ((data: T) => string);
    error?: string | ((err: unknown) => string);
  },
) {
  return sonner.promise(promise, {
    loading: messages.loading,
    success: messages.success,
    error: messages.error ?? '작업에 실패했습니다',
  });
}
