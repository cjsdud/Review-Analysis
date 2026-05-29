import { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { FASHION_CATEGORIES } from '../constants.js';

function SentimentTag({ sentiment }) {
  if (sentiment === 'positive') return <span className="tag tag--success">긍정</span>;
  if (sentiment === 'negative') return <span className="tag tag--danger">부정</span>;
  return <span className="tag tag--neutral">중립</span>;
}

function ReviewCard({ review, defaultExpanded }) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  const [contentExpanded, setContentExpanded] = useState(false);
  const content = review.content || '';
  const longContent = content.length > 150;
  const detected = review.detectedIssues || [];
  return (
    <li className="review-card">
      <div className="review-card__head">
        <div className="review-card__head-left">
          {review.rating != null && (
            <span className="review-card__rating">★ {review.rating}</span>
          )}
          <SentimentTag sentiment={review.sentiment} />
          {review.optionName && (
            <span className="muted review-card__option">옵션: {review.optionName}</span>
          )}
        </div>
        {review.createdAt && <div className="review-card__date muted">{review.createdAt}</div>}
      </div>

      {review.title && <div className="review-card__title">{review.title}</div>}

      <div className={`review-card__content${contentExpanded ? ' is-expanded' : ''}`}>
        {content}
      </div>
      {longContent && (
        <button
          type="button"
          className="review-card__more"
          onClick={() => setContentExpanded((v) => !v)}
        >
          {contentExpanded ? '접기' : '더 보기'}
        </button>
      )}

      <div className="review-card__issues">
        {detected.length === 0 ? (
          <span className="muted" style={{ fontSize: 12 }}>감지된 개선 이슈 없음</span>
        ) : (
          detected
            .filter((d) => d.isActionableIssue !== false)
            .map((d, i) => (
              <span key={i} className="tag tag--neutral">
                {d.category} · {d.issue || '관련 의견'}
              </span>
            ))
        )}
      </div>

      <div className="review-card__actions">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '상세 닫기' : '상세 보기'}
        </button>
      </div>

      {expanded && (
        <dl className="review-card__detail">
          <dt>상품명</dt><dd>{review.productName || '—'}</dd>
          {review.optionName && (<><dt>옵션명</dt><dd>{review.optionName}</dd></>)}
          {review.rating != null && (<><dt>별점</dt><dd>{review.rating}</dd></>)}
          {review.title && (<><dt>제목</dt><dd>{review.title}</dd></>)}
          <dt>내용</dt><dd>{content || '—'}</dd>
          {review.createdAt && (<><dt>작성일</dt><dd>{review.createdAt}</dd></>)}
          {review.replyText && (<><dt>판매자 답글</dt><dd>{review.replyText}</dd></>)}
          {review.reviewId && (<><dt>리뷰 ID</dt><dd>{review.reviewId}</dd></>)}
          {review.source && (<><dt>데이터 출처</dt><dd>{review.source}</dd></>)}
        </dl>
      )}
    </li>
  );
}

// CSV escape (RFC 4180 minimal)
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadReviewsCsv(reviews, productName) {
  const headers = ['상품명', '옵션', '별점', '제목', '리뷰내용', '작성일', '감성', '감지된 이슈'];
  const lines = [headers.join(',')];
  for (const r of reviews) {
    const issues = (r.detectedIssues || [])
      .filter((d) => d.isActionableIssue !== false && d.issue)
      .map((d) => `${d.category}: ${d.issue}`)
      .join(' | ');
    lines.push([
      csvCell(r.productName),
      csvCell(r.optionName || ''),
      csvCell(r.rating ?? ''),
      csvCell(r.title || ''),
      csvCell(r.content || ''),
      csvCell(r.createdAt || ''),
      csvCell(r.sentiment || ''),
      csvCell(issues),
    ].join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${productName || 'product'}-reviews.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// 입력: open, onClose, reviews(상품의 마스킹된 리뷰 배열), initialIssueFilter (관련 리뷰만 보기 진입 시)
export default function ReviewsModal({ open, onClose, reviews = [], productName, initialIssueFilter }) {
  const [sentimentFilter, setSentimentFilter] = useState('all'); // all|positive|neutral|negative|hasIssue|noIssue
  const [categoryFilter, setCategoryFilter] = useState('전체');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [sortBy, setSortBy] = useState('createdDesc');
  const [search, setSearch] = useState('');
  // 특정 이슈로 들어왔을 때 라벨 필터
  const issueLabelFilter = initialIssueFilter?.issueLabel || null;

  const filtered = useMemo(() => {
    let list = reviews;
    if (issueLabelFilter) {
      list = list.filter((r) =>
        (r.detectedIssues || []).some(
          (d) => d.issue === issueLabelFilter && d.isActionableIssue !== false,
        ),
      );
    }
    if (sentimentFilter === 'positive') list = list.filter((r) => r.sentiment === 'positive');
    else if (sentimentFilter === 'neutral') list = list.filter((r) => r.sentiment === 'neutral');
    else if (sentimentFilter === 'negative') list = list.filter((r) => r.sentiment === 'negative');
    else if (sentimentFilter === 'hasIssue') list = list.filter((r) => (r.detectedIssues || []).some((d) => d.isActionableIssue !== false && d.issue));
    else if (sentimentFilter === 'noIssue') list = list.filter((r) => !(r.detectedIssues || []).some((d) => d.isActionableIssue !== false && d.issue));
    if (categoryFilter !== '전체') {
      list = list.filter((r) =>
        (r.detectedIssues || []).some(
          (d) => d.category === categoryFilter && d.isActionableIssue !== false,
        ),
      );
    }
    if (ratingFilter !== 'all') {
      const target = Number(ratingFilter);
      list = list.filter((r) => Math.round(r.rating) === target);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          (r.content || '').toLowerCase().includes(q) ||
          (r.title || '').toLowerCase().includes(q) ||
          (r.optionName || '').toLowerCase().includes(q),
      );
    }
    list = [...list];
    if (sortBy === 'createdAsc') {
      list.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    } else if (sortBy === 'ratingLow') {
      list.sort((a, b) => (a.rating ?? 99) - (b.rating ?? 99));
    } else if (sortBy === 'ratingHigh') {
      list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    } else if (sortBy === 'mostIssues') {
      list.sort(
        (a, b) =>
          (b.detectedIssues?.filter((d) => d.isActionableIssue !== false).length || 0) -
          (a.detectedIssues?.filter((d) => d.isActionableIssue !== false).length || 0),
      );
    } else {
      list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }
    return list;
  }, [reviews, sentimentFilter, categoryFilter, ratingFilter, sortBy, search, issueLabelFilter]);

  const description = issueLabelFilter
    ? `"${issueLabelFilter}" 이슈가 감지된 리뷰만 보고 있습니다.`
    : '이 상품의 분석에 사용된 마스킹된 리뷰 데이터입니다.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="리뷰 데이터"
      description={description}
      size="lg"
      footer={
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => downloadReviewsCsv(filtered, productName)}
          disabled={filtered.length === 0}
        >
          📥 현재 리뷰 목록 CSV 다운로드
        </button>
      }
    >
      <div className="modal-toolbar">
        <input
          type="search"
          className="modal-toolbar__search"
          placeholder="리뷰 내용/옵션 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="modal-toolbar">
        <div className="modal-toolbar__chips" role="group" aria-label="감성 필터">
          {[
            ['all', '전체'],
            ['positive', '긍정'],
            ['neutral', '중립'],
            ['negative', '부정'],
            ['hasIssue', '개선 이슈 있음'],
            ['noIssue', '개선 이슈 없음'],
          ].map(([v, lbl]) => (
            <button
              key={v}
              type="button"
              className={`chip${sentimentFilter === v ? ' is-active' : ''}`}
              onClick={() => setSentimentFilter(v)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>
      <div className="modal-toolbar">
        <label className="modal-toolbar__sort">
          카테고리
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="전체">전체</option>
            {FASHION_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="modal-toolbar__sort">
          별점
          <select value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)}>
            <option value="all">전체</option>
            <option value="1">1점</option>
            <option value="2">2점</option>
            <option value="3">3점</option>
            <option value="4">4점</option>
            <option value="5">5점</option>
          </select>
        </label>
        <label className="modal-toolbar__sort">
          정렬
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="createdDesc">최신순</option>
            <option value="createdAsc">오래된순</option>
            <option value="ratingLow">별점 낮은순</option>
            <option value="ratingHigh">별점 높은순</option>
            <option value="mostIssues">이슈 많은 순</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="muted" style={{ padding: 16 }}>
          {reviews.length === 0
            ? '이 상품의 리뷰 원본 데이터를 불러올 수 없습니다.'
            : '조건에 맞는 리뷰가 없습니다.'}
        </div>
      ) : (
        <ul className="review-list">
          {filtered.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </ul>
      )}
    </Modal>
  );
}
