import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { getAnalyses } from '../api/analysisApi.js';

function formatDate(s) {
  if (!s) return '—';
  // SQLite 의 datetime('now') 는 UTC. 표시용으로 그대로 사용(YYYY-MM-DD HH:MM).
  return String(s).replace('T', ' ').slice(0, 16);
}

export default function AnalysisHistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await getAnalyses(50);
        setItems(Array.isArray(data) ? data : []);
      } catch (e) {
        // 401 은 ProtectedRoute 가 /login 으로 보내므로 여기에 도달하지 않음.
        // 다른 에러만 표시.
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingState title="분석 히스토리를 불러오는 중..." />;

  return (
    <div>
      <PageHeader
        title="분석 히스토리"
        subtitle="현재 서버에 저장된 최근 분석 결과입니다. 로그인 기능 도입 후에는 본인 분석만 표시됩니다."
      />

      {error && <div className="error-banner">{error}</div>}

      <SectionCard
        title="최근 분석"
        subtitle="분석을 선택하면 대시보드로 이동합니다."
      >
        {items.length === 0 ? (
          <EmptyState
            title="아직 저장된 분석이 없어요"
            desc="리뷰 파일을 업로드하고 분석을 실행하면 여기에 히스토리가 쌓입니다."
            actionLabel="리뷰 업로드하기"
            actionTo="/upload"
          />
        ) : (
          <ul className="history-list">
            {items.map((it) => (
              <li
                key={it.id}
                className="history-card"
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/dashboard/${it.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') navigate(`/dashboard/${it.id}`);
                }}
              >
                <div className="history-card__main">
                  <div className="history-card__name">
                    {it.originalName || '(파일명 없음)'}
                  </div>
                  <div className="history-card__meta muted">
                    {formatDate(it.createdAt)}
                    {it.source ? ` · ${it.source}` : ''}
                  </div>
                </div>
                <div className="history-card__stats">
                  <span className="tag tag--neutral">리뷰 {it.totalReviews ?? '—'}건</span>
                  <span className="tag tag--neutral">상품 {it.productCount ?? '—'}개</span>
                  <span className={`tag ${it.status === 'done' ? 'tag--success' : 'tag--neutral'}`}>
                    {it.status === 'done' ? '완료' : it.status}
                  </span>
                </div>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/dashboard/${it.id}`);
                  }}
                >
                  열기 →
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="ops-note">
        <span className="ops-note__ico">ℹ️</span>
        <div>
          현재는 로그인 기능이 없어 서버에 저장된 모든 분석이 표시됩니다. 실제 운영 환경에서는
          로그인 후 본인 분석만 보이도록 제한하고, 보관 기간·삭제 기능을 함께 제공해야 합니다.
        </div>
      </div>
    </div>
  );
}
