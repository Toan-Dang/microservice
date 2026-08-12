import { MAX_RETRIES } from '../messaging.constants';

/**
 * Còn được retry không? `retries` = số lần ĐÃ requeue trước đó.
 * retries=0,1,2 -> còn retry (requeue tối đa 3 lần); retries>=3 -> hết, đẩy DLQ.
 */
export function shouldRetry(retries: number, max: number = MAX_RETRIES): boolean {
  return retries < max;
}

/** Đọc số lần retry từ header message, mặc định 0 nếu chưa có/không hợp lệ. */
export function readRetryCount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
