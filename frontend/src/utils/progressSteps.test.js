import { describe, it, expect } from 'vitest';
import { progressStepLabel, progressMetaText, PROGRESS_STEP_LABELS } from './progressSteps.js';

describe('progressStepLabel', () => {
  it('returns Korean labels for known steps', () => {
    expect(progressStepLabel('classifying_reviews')).toBe('리뷰 반응을 분류하고 있어요');
    expect(progressStepLabel('completed')).toBe('분석이 완료됐어요');
  });
  it('returns null for unknown/empty step', () => {
    expect(progressStepLabel('')).toBeNull();
    expect(progressStepLabel(undefined)).toBeNull();
    expect(progressStepLabel('bogus_step_name')).toBeNull();
  });
  it('all internal LLM-related steps are user-friendly (no token/LLM/API expressions)', () => {
    for (const label of Object.values(PROGRESS_STEP_LABELS)) {
      expect(label).not.toMatch(/token/i);
      expect(label).not.toMatch(/LLM/i);
      expect(label).not.toMatch(/\bAPI\b/);
    }
  });
});

describe('progressMetaText', () => {
  it('prefers reviews when both present', () => {
    expect(progressMetaText({ processedReviews: 240, totalReviews: 500 }))
      .toBe('240 / 500개 리뷰 처리 중');
  });
  it('falls back to products when reviews missing', () => {
    expect(progressMetaText({ processedProducts: 3, totalProducts: 10 }))
      .toBe('3 / 10개 상품 완료');
  });
  it('returns null when nothing useful', () => {
    expect(progressMetaText({})).toBeNull();
    expect(progressMetaText(null)).toBeNull();
  });
});
