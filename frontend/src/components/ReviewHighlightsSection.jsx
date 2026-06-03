import { useState } from 'react';
import ReviewExplorerModal from './ReviewExplorerModal.jsx';

// 대시보드 "리뷰 내용 요약" — 긍정/부정/중립 3개 카드.
// summary.reviewHighlights 구조를 그대로 받아 카드별 themes + topReviews 미리보기를 보여준다.
// "전체 보기" 클릭 시 ReviewExplorerModal 을 sentiment 필터와 함께 연다.
//
// props:
//   highlights: summary.reviewHighlights ({ positive, negative, neutral })
//   analysisId: string
//
// 디자인 톤:
//   - 흰색 카드 + 연한 블루/그레이 border
//   - 긍정은 emerald-tint accent, 부정은 부드러운 warning, 중립은 슬레이트
//   - 너무 자극적인 색 사용 금지

const CARDS = [
  {
    key: 'positive',
    title: '긍정 리뷰에서 많이 나온 내용',
    cta: '긍정 리뷰 전체 보기',
    accent: 'positive',
    countLabel: '긍정 리뷰',
    themeIntro: '셀러가 마케팅·상세페이지에 그대로 활용할 수 있는 표현입니다.',
    emptyTitle: '아직 긍정 리뷰가 충분하지 않습니다.',
    emptyDesc: '리뷰가 더 쌓이면 자주 나오는 칭찬 포인트가 표시됩니다.',
  },
  {
    key: 'negative',
    title: '부정 리뷰에서 많이 나온 내용',
    cta: '부정 리뷰 전체 보기',
    accent: 'negative',
    countLabel: '부정 리뷰',
    themeIntro: '먼저 점검하면 좋을 불편 포인트와 대표 사례입니다.',
    emptyTitle: '부정 리뷰가 거의 없어요.',
    emptyDesc: '특별히 반복되는 불만 사항이 없는 상태입니다.',
  },
  {
    key: 'neutral',
    title: '중립·혼합 리뷰에서 보이는 내용',
    cta: '중립 리뷰 전체 보기',
    accent: 'neutral',
    countLabel: '중립 리뷰',
    themeIntro: '장점과 아쉬움이 함께 나오는 리뷰의 맥락입니다.',
    emptyTitle: '중립/혼합 리뷰가 적어요.',
    emptyDesc: '분명한 긍정 또는 부정 리뷰가 대다수입니다.',
  },
];

function pct(n) { return `${Math.round((n || 0) * 100)}%`; }

function HighlightCard({ data, meta, onOpen }) {
  const themes = (data?.themes || []).slice(0, 5);
  const topReviews = (data?.topReviews || []).slice(0, 3);
  const isEmpty = (data?.total || 0) === 0;

  return (
    <section className={`rh-card rh-card--${meta.accent}`}>
      <header className="rh-card__head">
        <h3 className="rh-card__title">{meta.title}</h3>
        <div className="rh-card__count">
          <span className="rh-card__count-num">{data?.total ?? 0}</span>
          <span className="rh-card__count-label muted">{meta.countLabel} · {pct(data?.ratio)}</span>
        </div>
      </header>

      {isEmpty ? (
        <div className="rh-card__empty">
          <div className="rh-card__empty-title">{meta.emptyTitle}</div>
          <div className="rh-card__empty-desc muted">{meta.emptyDesc}</div>
        </div>
      ) : (
        <>
          <div className="rh-card__theme-section">
            <div className="rh-card__theme-intro muted">{meta.themeIntro}</div>
            {themes.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>대표적인 주제를 아직 추출할 수 없습니다.</div>
            ) : (
              <ul className="rh-card__themes">
                {themes.map((t) => (
                  <li key={t.label} className="rh-card__theme">
                    <span className={`rh-card__theme-chip rh-card__theme-chip--${meta.accent}`}>{t.label}</span>
                    <span className="rh-card__theme-count">{t.count}건</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {topReviews.length > 0 && (
            <div className="rh-card__reviews">
              <div className="rh-card__reviews-label">대표 리뷰</div>
              <ul className="rh-card__review-list">
                {topReviews.map((r) => (
                  <li key={r.id} className="rh-card__review">
                    <div className="rh-card__review-meta">
                      {r.rating != null && <span className="rh-card__review-rating">★ {r.rating}</span>}
                      <span className="rh-card__review-product">{r.productName}</span>
                      {r.createdAt && <span className="muted">· {String(r.createdAt).slice(0, 10)}</span>}
                    </div>
                    <div className="rh-card__review-content">{r.content}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <footer className="rh-card__foot">
        <button
          type="button"
          className="btn btn--ghost btn--sm rh-card__cta"
          onClick={onOpen}
          disabled={isEmpty}
        >
          {meta.cta}
        </button>
      </footer>
    </section>
  );
}

// initialProductName 이 주어지면 모달이 자동으로 그 상품만 필터해서 보여준다 — 상품 상세에서 사용.
// onOpenSentiment 가 주어지면 내부 모달 대신 그 콜백을 호출 — /demo/sample-report 처럼
// 실제 분석 API 를 호출하면 안 되는 공개 미리보기 페이지에서 사용한다.
export default function ReviewHighlightsSection({
  highlights,
  analysisId,
  initialProductName = '',
  onOpenSentiment,
}) {
  const [openSentiment, setOpenSentiment] = useState(null);

  if (!highlights) return null;
  const useExternalOpen = typeof onOpenSentiment === 'function';

  return (
    <>
      <div className="rh-grid">
        {CARDS.map((meta) => (
          <HighlightCard
            key={meta.key}
            data={highlights[meta.key]}
            meta={meta}
            onOpen={() => (useExternalOpen ? onOpenSentiment(meta.key) : setOpenSentiment(meta.key))}
          />
        ))}
      </div>

      {!useExternalOpen && (
        // key=openSentiment — 다른 감성을 다시 클릭할 때마다 모달이 깨끗한 state 로
        // remount 된다. 이전 필터/페이지 잔재 + setState/loadPage 레이스 차단.
        <ReviewExplorerModal
          key={openSentiment || 'closed'}
          open={openSentiment !== null}
          onClose={() => setOpenSentiment(null)}
          analysisId={analysisId}
          initialSentiment={openSentiment || 'all'}
          initialProductName={initialProductName}
        />
      )}
    </>
  );
}
