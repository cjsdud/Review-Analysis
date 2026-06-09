import { describe, it, expect } from 'vitest';
import { normalizeUsageSummary, formatUsageLine, usageStatusLabel } from './usage.js';

describe('normalizeUsageSummary', () => {
  it('returns null when no input', () => {
    expect(normalizeUsageSummary(null)).toBeNull();
  });

  it('falls back to Free when subscription missing', () => {
    const out = normalizeUsageSummary({});
    expect(out.plan).toBe('Free');
    expect(out.planCode).toBe('free');
    expect(out.items).toHaveLength(3);
    // 모든 항목이 limit 없음(hasLimit=false) 상태에서도 깨지지 않음
    out.items.forEach((i) => expect(i).toHaveProperty('status'));
  });

  it('marks status warning at ≥80%', () => {
    const out = normalizeUsageSummary({
      subscription: { planCode: 'starter', planLabel: 'Starter' },
      usage: {
        monthlyAnalysisUsed: 8,
        monthlyAnalysisLimit: 10, // 80%
        monthlyFileUsed: 5,
        monthlyFileLimit: 10,
        monthlyCsReplyUsed: 0,
        monthlyCsReplyLimit: 100,
      },
    });
    const analysis = out.items.find((i) => i.key === 'monthlyAnalysis');
    expect(analysis.status).toBe('warning');
    const file = out.items.find((i) => i.key === 'monthlyFile');
    expect(file.status).toBe('normal');
  });

  it('marks status danger at ≥100% and clamps remaining to 0', () => {
    const out = normalizeUsageSummary({
      subscription: { planCode: 'pro', planLabel: 'Pro' },
      usage: {
        monthlyAnalysisUsed: 50,
        monthlyAnalysisLimit: 50,
        monthlyFileUsed: 12,
        monthlyFileLimit: 10, // over limit
        monthlyCsReplyUsed: 0,
        monthlyCsReplyLimit: 100,
      },
    });
    const file = out.items.find((i) => i.key === 'monthlyFile');
    expect(file.status).toBe('danger');
    expect(file.remaining).toBe(0);
    expect(out.overallStatus).toBe('danger');
  });

  it('treats null limit as hasLimit=false (제한 없음 표시)', () => {
    const out = normalizeUsageSummary({
      subscription: { planCode: 'business' },
      usage: { monthlyAnalysisUsed: 999, monthlyAnalysisLimit: null },
    });
    const analysis = out.items.find((i) => i.key === 'monthlyAnalysis');
    expect(analysis.hasLimit).toBe(false);
    expect(analysis.status).toBe('normal');
  });
});

describe('formatUsageLine', () => {
  it('shows used / limit when limit exists', () => {
    expect(formatUsageLine({ used: 1200, limit: 3000, unit: '회', hasLimit: true })).toBe('1,200 / 3,000회');
  });
  it('shows just used when no limit', () => {
    expect(formatUsageLine({ used: 100, limit: null, unit: '건', hasLimit: false })).toBe('100건');
  });
  it('handles missing input', () => {
    expect(formatUsageLine(null)).toBe('');
  });
});

describe('usageStatusLabel', () => {
  it('returns Korean status label or null', () => {
    expect(usageStatusLabel('warning')).toBe('한도 임박');
    expect(usageStatusLabel('danger')).toBe('한도 도달');
    expect(usageStatusLabel('normal')).toBeNull();
  });
});
