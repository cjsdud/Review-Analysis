import { useState } from 'react';
import EvidenceReviewList from './EvidenceReviewList.jsx';
import { FASHION_CATEGORIES } from '../constants.js';
import { saveCorrection } from '../api/analysisApi.js';

function SourceTag({ source }) {
  if (source === 'user') return <span className="tag tag--success">수정됨</span>;
  if (source === 'llm') return <span className="tag">AI 생성</span>;
  if (source === 'rule') return <span className="tag tag--neutral">규칙 기반</span>;
  return <span className="tag tag--neutral">자동 묶음</span>;
}

export default function IssueCard({ issue, analysisId, productKey }) {
  // 표시용 로컬 상태 (수정 시 즉시 반영)
  const [current, setCurrent] = useState({
    category: issue.category,
    issueLabel: issue.issueLabel,
    source: issue.source,
  });
  const [editing, setEditing] = useState(false);
  const [draftCategory, setDraftCategory] = useState(current.category);
  const [draftLabel, setDraftLabel] = useState(current.issueLabel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function openEdit() {
    setDraftCategory(current.category);
    setDraftLabel(current.issueLabel);
    setError('');
    setEditing(true);
  }

  async function handleSave() {
    if (!draftLabel.trim()) {
      setError('세부 이슈 라벨을 입력하세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveCorrection(analysisId, {
        productKey,
        category: current.category,
        issueLabel: current.issueLabel,
        newCategory: draftCategory,
        newIssueLabel: draftLabel.trim(),
      });
      setCurrent({ category: draftCategory, issueLabel: draftLabel.trim(), source: 'user' });
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const ratio = issue.ratio || 0;
  const sev = ratio >= 0.2 ? 'is-high' : ratio >= 0.1 ? 'is-mid' : 'is-low';

  return (
    <div className={`issue-card ${sev}`}>
      <div className="issue-card__head">
        <div>
          <span className="tag tag--danger" style={{ marginRight: 8 }}>
            {current.category}
          </span>
          <span className="issue-card__label">{current.issueLabel}</span>
        </div>
        <div className="issue-card__meta">
          <SourceTag source={current.source} />
          <span className="tag tag--neutral">
            {issue.count}건 · {Math.round(ratio * 100)}%
          </span>
          {!editing && (
            <button className="btn btn--ghost btn--sm" onClick={openEdit}>
              분류 수정
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="issue-edit">
          <div className="issue-edit__row">
            <label>
              카테고리
              <select value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)}>
                {FASHION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: 1 }}>
              세부 이슈
              <input
                type="text"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                placeholder="예: 허리가 작게 나옴"
              />
            </label>
          </div>
          {error && <div className="error-banner" style={{ margin: '8px 0' }}>{error}</div>}
          <div className="page-actions" style={{ marginTop: 8 }}>
            <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : '저장'}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setEditing(false)} disabled={saving}>
              취소
            </button>
          </div>
        </div>
      )}

      <div className="muted" style={{ fontSize: 12, margin: '6px 0 4px' }}>
        근거 리뷰
      </div>
      <EvidenceReviewList reviews={issue.evidenceReviews} />

      {issue.recommendedAction && (
        <div className="issue-card__action">
          <strong>👉 추천 조치: </strong>
          {issue.recommendedAction}
        </div>
      )}
    </div>
  );
}
