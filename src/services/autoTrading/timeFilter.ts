// @responsibility timeFilter 서비스 모듈
/**
 * timeFilter.ts — 장중 타임 필터 + 주문 큐 (아이디어 7)
 *
 * 한국 장 최적 매수 시간대(10:00~11:30, 13:00~14:00)를 확인하고,
 * 비유효 시간대에는 주문을 큐에 보관했다가 유효 시간대에 일괄 처리합니다.
 */

import type { KISOrderParams, PendingOrder } from '../../types/quant';
import { debugLog } from '../../utils/debug';
import { clientWarn } from '../../utils/clientWarn';
import { placeKISOrder } from './orderExecution';
/** 세션 내 미실행 주문 큐 (메모리, 앱 새로고침 시 초기화) */
const pendingOrderQueue: PendingOrder[] = [];
