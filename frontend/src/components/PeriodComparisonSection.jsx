// 기간별 리뷰 반응 변화 섹션.
//
// 상태 분기:
//   1) locked === true  → Free/Starter 잠금 카드 + Pro 업그레이드 CTA.
//   2) available === false 이면서 reason === 'missing_review_dates' → 작성일 안내 빈 상태.
//   3) available === true → 비교 카드 4개 + 이슈/상품 리스트 + 추이 차트 + 모드 토글.
//
// 사용자 노출 문구는 항상 "줄어든 것으로 보입니다 / 늘어난 것으로 보입니다" 톤.
// LLM/token 같은 내부 표현은 노출하지 않는다.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SectionCard from './SectionCard.jsx';
import { getPeriodComparison } from '../api/analysisApi.js';

// ECharts 는 무거우므로 lazy.
const PeriodTrendChart = lazy(() => import('./PeriodTrendChart.jsx'));
const PeriodIssueChangeChart = lazy(() => import('./PeriodIssueChangeChart.jsx'));

const MODES = [
  { id: 'recent_30_vs_previous_30', label: '최근 30일 vs 이전 30일' },
  { id: 'recent_90_vs_previous_90', label: '최근 90일 vs 이전 90일' },
  { id: 'custom',          label: '직접 기간 비교' },
  { id: 'monthly_trend',   label: '월별 추이' },
  { id: 'weekly_trend',    label: '주별 추이' },
];

function pctLabel(r) {
  if (r == null) return '—';
  return `${Math.round(Number(r) * 100)}%`;
}
function pctPointLabel(d) {
  if (d == null || !Number.isFinite(Number(d))) return '0%p';
  const n = Math.round(Number(d) * 100);
  if (n === 0) return '0%p';
  return `${n > 0 ? '+' : ''}${n}%p`;
}

export default function PeriodComparisonSection({
  analysisId,
  initial,
  productKey,
  title,
  subtitle,
  sectionId = 'sec-period-comparison',
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState(initial?.requestedMode || 'recent_30_vs_previous_30');
  const [data, setData] = useState(initial || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // custom 모드 입력값 — 처음에는 비어 있고, 사용자가 직접 선택해야 fetch.
  const [customForm, setCustomForm] = useState({
    currentStart: '', currentEnd: '', previousStart: '', previousEnd: '',
  });
  const [customApplied, setCustomApplied] = useState(false);

  // 모드 변경 시 다시 fetch. custom 은 사용자가 명시적으로 "적용" 한 경우에만.
  useEffect(() => {
    let cancelled = false;
    async function load(query) {
      setLoading(true);
      setError('');
      try {
        const res = await getPeriodComparison(analysisId, query);
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e.message || '기간별 변화 분석을 불러오지 못했어요.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    // productKey 가 주어지면 모든 요청에 함께 보낸다 — 상품 상세에서 해당 상품 데이터만.
    const productScope = productKey ? { productKey } : {};
    if (mode === 'custom') {
      if (!customApplied) return;
      const q = { mode, ...customForm, ...productScope };
      load(q);
    } else {
      load({ mode, ...productScope });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, customApplied, analysisId, productKey]);

  // 잠금 (Free/Starter).
  if (data?.locked) {
    return (
      <SectionCard
        id={sectionId}
        title={title || '기간별 리뷰 반응 변화'}
        subtitle={subtitle || '리뷰가 시간이 지나며 어떻게 달라졌는지 확인해 보세요.'}
      >
        <div className="period-locked">
          <div className="period-locked__icon" aria-hidden="true">🔒</div>
          <div className="period-locked__title">기간별 리뷰 변화 분석은 Pro 이상에서 사용할 수 있어요.</div>
          <ul className="period-locked__list">
            <li>긍정/부정 비율 변화</li>
            <li>개선된 이슈와 새로 늘어난 이슈</li>
            <li>상품별 개선/악화 흐름</li>
            <li>월별/주별 리뷰 변화</li>
          </ul>
          <button className="btn btn--primary btn--sm" onClick={() => navigate('/pricing')}>
            Pro로 업그레이드
          </button>
        </div>
      </SectionCard>
    );
  }

  // 작성일 데이터 없음.
  if (data && !data.available && data.reason === 'missing_review_dates') {
    return (
      <SectionCard
        id={sectionId}
        title={title || '기간별 리뷰 반응 변화'}
        subtitle={subtitle || '작성일이 있는 리뷰를 기준으로 기간별 반응 변화를 비교합니다.'}
      >
        <div className="period-empty">
          <div className="period-empty__icon" aria-hidden="true">🗓️</div>
          <div className="period-empty__title">작성일 컬럼을 매핑하면 기간별 리뷰 변화를 확인할 수 있어요.</div>
          <div className="period-empty__desc muted">
            다음 업로드에서 작성일 컬럼을 매핑하면 기간별 리뷰 변화와 개선 추이를 확인할 수 있습니다.
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      id="sec-period-comparison"
      title="기간별 리뷰 반응 변화"
      subtitle={subtitle || '작성일이 있는 리뷰를 기준으로 최근 기간과 이전 기간의 반응 변화를 비교합니다.'}
    >
      <div className="period-mode-toggle" role="tablist" aria-label="기간 비교 방식">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={`period-mode-toggle__btn${mode === m.id ? ' is-active' : ''}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'custom' && (
        <CustomRangePanel
          form={customForm}
          onChange={setCustomForm}
          onApply={() => setCustomApplied(true)}
        />
      )}

      {loading && <div className="muted" style={{ padding: 20 }}>기간별 변화를 계산하고 있어요…</div>}
      {error && <div className="error-banner">{error}</div>}

      {data && data.available && (
        <PeriodComparisonBody data={data} mode={mode} />
      )}

      {data && !data.available && data.reason === 'invalid_custom_range' && (
        <div className="period-empty">
          <div className="period-empty__title">{data.message}</div>
        </div>
      )}
    </SectionCard>
  );
}

function PeriodComparisonBody({ data, mode }) {
  const cur = data.currentPeriod || {};
  const prev = data.previousPeriod || {};
  const d = data.deltas || {};

  // 가장 줄어든 / 새로 늘어난 이슈 (요약 카드용)
  const topImproved = data.improvedIssues?.[0] || null;
  const topWorsened = data.worsenedIssues?.[0] || null;

  return (
    <>
      {/* 요약 문장 */}
      {data.summary && (
        <div className="period-summary">
          <span className="period-summary__ico" aria-hidden="true">📌</span>
          <div className="period-summary__text">{data.summary}</div>
        </div>
      )}

      {/* 4 카드 */}
      <div className="period-cards">
        <SummaryCard
          title="긍정 비율 변화"
          line1={`${pctLabel(prev.sentimentRatios?.positive)} → ${pctLabel(cur.sentimentRatios?.positive)}`}
          delta={d.positiveRatioDelta}
          deltaIsGood={(d.positiveRatioDelta || 0) > 0}
        />
        <SummaryCard
          title="부정 비율 변화"
          line1={`${pctLabel(prev.sentimentRatios?.negative)} → ${pctLabel(cur.sentimentRatios?.negative)}`}
          delta={d.negativeRatioDelta}
          deltaIsGood={(d.negativeRatioDelta || 0) < 0}
        />
        <SummaryCard
          title="가장 줄어든 이슈"
          line1={topImproved?.categoryLabel || '두드러진 변화 없음'}
          line2={topImproved
            ? `${topImproved.previousCount}건 → ${topImproved.currentCount}건`
            : '두 기간 차이가 크지 않습니다.'}
          deltaCount={topImproved?.countDelta}
          deltaIsGood={topImproved ? (topImproved.countDelta < 0) : true}
        />
        <SummaryCard
          title="새로 늘어난 이슈"
          line1={topWorsened?.categoryLabel || '두드러진 변화 없음'}
          line2={topWorsened
            ? `${topWorsened.previousCount}건 → ${topWorsened.currentCount}건`
            : '두 기간 차이가 크지 않습니다.'}
          deltaCount={topWorsened?.countDelta}
          deltaIsGood={topWorsened ? (topWorsened.countDelta < 0) : true}
        />
      </div>

      {/* 데이터 품질 caution */}
      {data.dataQuality?.cautionMessage && (
        <div className="period-caution">
          <span className="period-caution__ico" aria-hidden="true">ℹ️</span>
          <div>{data.dataQuality.cautionMessage}</div>
        </div>
      )}

      {/* 이슈 변화 한눈에 보기 — 양방향 horizontal bar */}
      <div className="period-issue-chart">
        <div className="period-issue-chart__title">이슈 변화 한눈에 보기</div>
        <div className="period-issue-chart__subtitle muted">
          이전 기간과 비교해 어떤 개선 이슈가 늘거나 줄었는지 확인할 수 있습니다.
        </div>
        <Suspense fallback={<div className="muted" style={{ padding: 30, textAlign: 'center' }}>차트를 불러오고 있어요…</div>}>
          <PeriodIssueChangeChart data={data.issueChangeChartData} />
        </Suspense>
      </div>

      {/* 이슈 변화 리스트 */}
      <div className="period-grid">
        <IssueList title="줄어든 이슈" rows={data.improvedIssues} kind="improved" emptyText="두드러지게 줄어든 이슈가 없습니다." />
        <IssueList title="새로 늘어난 이슈" rows={data.worsenedIssues} kind="worsened" emptyText="두드러지게 늘어난 이슈가 없습니다." />
      </div>
      <div className="period-grid">
        <ProductList title="개선 흐름이 보이는 상품" rows={data.improvedProducts} kind="improved" emptyText="두드러지게 좋아진 상품이 없습니다." />
        <ProductList title="주의가 필요한 상품" rows={data.worsenedProducts} kind="worsened" emptyText="두드러지게 나빠진 상품이 없습니다." />
      </div>

      {/* 추이 차트 */}
      <div className="period-trend">
        <div className="period-trend__title">
          {mode === 'weekly_trend' ? '주별 추이' : '월별 추이'}
        </div>
        <Suspense fallback={<div className="muted" style={{ padding: 30 }}>차트를 불러오고 있어요…</div>}>
          <PeriodTrendChart
            trend={mode === 'weekly_trend' ? data.trend?.weekly : data.trend?.monthly}
          />
        </Suspense>
      </div>
    </>
  );
}

function SummaryCard({ title, line1, line2, delta, deltaCount, deltaIsGood }) {
  let deltaText = '';
  let deltaClass = 'is-neutral';
  if (delta != null && Number.isFinite(Number(delta))) {
    deltaText = pctPointLabel(delta);
    if (Math.abs(Number(delta)) >= 0.005) {
      deltaClass = deltaIsGood ? 'is-good' : 'is-warn';
    }
  } else if (deltaCount != null && Number.isFinite(Number(deltaCount))) {
    const n = Number(deltaCount);
    deltaText = `${n > 0 ? '+' : ''}${n}건`;
    if (n !== 0) deltaClass = deltaIsGood ? 'is-good' : 'is-warn';
  }
  return (
    <div className="period-card">
      <div className="period-card__title">{title}</div>
      <div className="period-card__primary">{line1}</div>
      {line2 && <div className="period-card__secondary">{line2}</div>}
      {deltaText && (
        <div className={`period-card__delta ${deltaClass}`}>{deltaText}</div>
      )}
    </div>
  );
}

function IssueList({ title, rows, kind, emptyText }) {
  return (
    <div className="period-list">
      <div className="period-list__title">{title}</div>
      {rows && rows.length > 0 ? (
        <ul>
          {rows.slice(0, 5).map((r) => (
            <li key={r.category} className={`period-list__row period-list__row--${kind}`}>
              <span className="period-list__label">{r.categoryLabel}</span>
              <span className="period-list__meta muted">{r.previousCount}건 → {r.currentCount}건</span>
              <span className={`period-list__delta ${kind === 'improved' ? 'is-good' : 'is-warn'}`}>
                {r.countDelta > 0 ? '+' : ''}{r.countDelta}건
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="period-list__empty muted">{emptyText}</div>
      )}
    </div>
  );
}

function ProductList({ title, rows, kind, emptyText }) {
  return (
    <div className="period-list">
      <div className="period-list__title">{title}</div>
      {rows && rows.length > 0 ? (
        <ul>
          {rows.slice(0, 5).map((r) => (
            <li key={r.productKey} className={`period-list__row period-list__row--${kind}`}>
              <span className="period-list__label" title={r.productName}>{r.productName}</span>
              <span className="period-list__meta muted">
                부정 {pctLabel(r.previousNegativeRatio)} → {pctLabel(r.currentNegativeRatio)}
              </span>
              <span className={`period-list__delta ${kind === 'improved' ? 'is-good' : 'is-warn'}`}>
                {pctPointLabel(r.negativeRatioDelta)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="period-list__empty muted">{emptyText}</div>
      )}
    </div>
  );
}

function CustomRangePanel({ form, onChange, onApply }) {
  const valid = useMemo(() => {
    const f = form;
    if (!f.currentStart || !f.currentEnd || !f.previousStart || !f.previousEnd) return false;
    if (f.currentStart > f.currentEnd) return false;
    if (f.previousStart > f.previousEnd) return false;
    return true;
  }, [form]);
  return (
    <div className="period-custom">
      <div className="period-custom__row">
        <label>
          <span>현재 기간 시작일</span>
          <input type="date" value={form.currentStart} onChange={(e) => onChange({ ...form, currentStart: e.target.value })} />
        </label>
        <label>
          <span>현재 기간 종료일</span>
          <input type="date" value={form.currentEnd} onChange={(e) => onChange({ ...form, currentEnd: e.target.value })} />
        </label>
      </div>
      <div className="period-custom__row">
        <label>
          <span>비교 기간 시작일</span>
          <input type="date" value={form.previousStart} onChange={(e) => onChange({ ...form, previousStart: e.target.value })} />
        </label>
        <label>
          <span>비교 기간 종료일</span>
          <input type="date" value={form.previousEnd} onChange={(e) => onChange({ ...form, previousEnd: e.target.value })} />
        </label>
      </div>
      <div className="period-custom__actions">
        <button className="btn btn--primary btn--sm" disabled={!valid} onClick={onApply}>
          기간 적용
        </button>
        {!valid && (
          <span className="muted" style={{ fontSize: 12 }}>
            네 칸을 모두 입력하고 시작일이 종료일보다 이전이어야 합니다.
          </span>
        )}
      </div>
    </div>
  );
}
