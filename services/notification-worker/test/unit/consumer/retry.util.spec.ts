import { readRetryCount, shouldRetry } from '../../../src/consumer/retry.util';
import { MAX_RETRIES } from '../../../src/messaging.constants';

describe('shouldRetry', () => {
  it('còn retry khi số lần đã thử < MAX_RETRIES', () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(MAX_RETRIES - 1)).toBe(true);
  });

  it('hết retry khi đạt/ vượt MAX_RETRIES -> đẩy DLQ', () => {
    expect(shouldRetry(MAX_RETRIES)).toBe(false);
    expect(shouldRetry(MAX_RETRIES + 1)).toBe(false);
  });

  it('requeue đúng tối đa 3 lần (0->1->2->3 thì dừng)', () => {
    const attempts: number[] = [];
    let retries = 0;
    while (shouldRetry(retries)) {
      attempts.push(retries + 1);
      retries += 1;
    }
    expect(attempts).toEqual([1, 2, 3]);
  });
});

describe('readRetryCount', () => {
  it('mặc định 0 khi header thiếu/không hợp lệ', () => {
    expect(readRetryCount(undefined)).toBe(0);
    expect(readRetryCount(null)).toBe(0);
    expect(readRetryCount('abc')).toBe(0);
    expect(readRetryCount(-5)).toBe(0);
  });

  it('đọc đúng số nguyên từ header', () => {
    expect(readRetryCount(2)).toBe(2);
    expect(readRetryCount('3')).toBe(3);
  });
});
