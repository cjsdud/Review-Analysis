import { describe, it, expect } from 'vitest';
import {
  REPLY_TONES,
  REPLY_TONE_SHORT_LABEL,
  REPLY_TONE_FULL_LABEL,
  DEFAULT_REPLY_TONE,
  isValidReplyTone,
} from './replyTones.js';

describe('REPLY_TONES', () => {
  it('has 5 tones in canonical order', () => {
    expect(REPLY_TONES).toEqual(['polite', 'friendly', 'concise', 'empathetic', 'professional']);
  });

  it('has Korean short labels for all tones', () => {
    for (const t of REPLY_TONES) {
      expect(REPLY_TONE_SHORT_LABEL[t]).toMatch(/[가-힣]/);
    }
  });

  it('has Korean full labels ending in 말투', () => {
    for (const t of REPLY_TONES) {
      expect(REPLY_TONE_FULL_LABEL[t]).toMatch(/말투$/);
    }
  });

  it('DEFAULT_REPLY_TONE is polite', () => {
    expect(DEFAULT_REPLY_TONE).toBe('polite');
  });
});

describe('isValidReplyTone', () => {
  it('accepts all 5 canonical tones', () => {
    REPLY_TONES.forEach((t) => expect(isValidReplyTone(t)).toBe(true));
  });
  it('rejects invalid / case variations / unknown', () => {
    expect(isValidReplyTone('POLITE')).toBe(false);
    expect(isValidReplyTone('정중')).toBe(false);
    expect(isValidReplyTone('')).toBe(false);
    expect(isValidReplyTone(null)).toBe(false);
    expect(isValidReplyTone('unknown')).toBe(false);
  });
});
