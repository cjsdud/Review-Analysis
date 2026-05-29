import { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import EvidenceReviewList from './EvidenceReviewList.jsx';
import { FASHION_CATEGORIES } from '../constants.js';

const SEV_RANK = { high: 3, medium: 2, low: 1 };

function SeverityBadge({ severity }) {
  const cls =
    severity === 'high' ? 'is-danger' : severity === 'medium' ? 'is-warn' : 'is-neutral';
  const label = severity === 'high' ? '심각도 높음' : severity === 'medium' ? '심각도 중간' : '심각도 낮음';
  return <span className={`status-badge ${cls}`}>{label}</span>;
}

// 전체 발견 이슈 모달.
// 입력: open, onClose, allIssues, onViewRelatedReviews(issue) — issue.id 또는 issueLabel 로 리뷰 모달 필터
export default function AllIssuesModal({ open, onClose, allIssues = [], onViewRelatedReviews }) {
  const [categoryFilter, setCategoryFilter] = useState('전체');
  const [sortBy, setSortBy] = useState('count'); // 'count' | 'severity' | 'category'

  const filtered = useMemo(() => {
    let list = allIssues;
    if (categoryFilter !== '전체') list = list.filter((i) => i.category === categoryFilter);
    list = [...list];
    if (sortBy === 'severity') {
      list.sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0) || b.count - a.count);
    } else if (sortBy === 'category') {
      list.sort((a, b) => a.category.localeCompare(b.category) || b.count - a.count);
    } else {
      list.sort((a, b) => b.count - a.count || (b.confidence || 0) - (a.confidence || 0));
    }
    return list;
  }, [allIssues, categoryFilter, sortBy]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="전체 발견 이슈"
      description="핵심 문제에 표시되지 않은 낮은 우선순위 이슈까지 함께 확인할 수 있습니다."
      size="lg"
    >
      <div className="modal-toolbar">
        <div className="modal-toolbar__chips" role="group" aria-label="카테고리 필터">
          {['전체', ...FASHION_CATEGORIES].map((c) => (
            <button
              key={c}
              type="button"
              className={`chip${categoryFilter === c ? ' is-active' : ''}`}
              onClick={() => setCategoryFilter(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <label className="modal-toolbar__sort">
          정렬
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="count">많이 나온 순</option>
            <option value="severity">심각도 높은 순</option>
            <option value="category">카테고리순</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="muted" style={{ padding: 16 }}>
          {allIssues.length === 0
            ? '아직 표시할 전체 이슈가 없습니다.'
            : '조건에 맞는 이슈가 없습니다.'}
        </div>
      ) : (
        <ul className="all-issues-list">
          {filtered.map((iss) => (
            <li key={iss.id} className="all-issue-card">
              <div className="all-issue-card__head">
                <div className="all-issue-card__title">
                  <span className="tag tag--neutral" style={{ marginRight: 6 }}>{iss.category}</span>
                  <span className="all-issue-card__label">{iss.issueLabel}</span>
                </div>
                <div className="all-issue-card__meta">
                  <SeverityBadge severity={iss.severity} />
                  <span className="tag tag--neutral">
                    {iss.count}건 · {Math.round((iss.ratio || 0) * 100)}%
                  </span>
                </div>
              </div>
              {iss.recommendedAction && (
                <div className="all-issue-card__action">
                  <strong>추천 조치: </strong>
                  {iss.recommendedAction}
                </div>
              )}
              {iss.evidenceReviews?.length > 0 && (
                <>
                  <div className="all-issue-card__evi-label">근거 리뷰</div>
                  <EvidenceReviewList reviews={iss.evidenceReviews.slice(0, 3)} />
                </>
              )}
              <div className="all-issue-card__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onViewRelatedReviews?.(iss)}
                >
                  관련 리뷰 보기 →
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
