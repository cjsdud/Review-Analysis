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
        subtitle="이전에 분석한 리뷰 리포트를 다시 확인할 수 있어요."
        actions={
          <button className="btn btn--primary" onClick={() => navigate('/upload')}>
            새 리뷰 파일 업로드
          </button>
        }
      />

      {/* 무료 베타 안내 — 데이터 초기화 가능성 자연스럽게 전달 */}
      <div className="beta-notice" role="note">
        <span className="beta-notice__ico" aria-hidden="true">🧪</span>
        <div className="beta-notice__body">
          <b>무료 베타 기간</b>에는 서버 점검·재배포 과정에서 이전 분석 히스토리가 초기화될 수
          있습니다. 필요한 리포트는 상품 상세에서 CSV 로 저장하거나 화면을 캡처해 두세요.
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <SectionCard
        title="최근 분석"
        subtitle="분석을 선택하면 대시보드로 이동합니다."
      >
        {items.length === 0 ? (
          <EmptyState
            title="아직 분석한 리포트가 없어요"
            desc="리뷰 파일을 업로드하면 상품별 문제와 리뷰 반응을 정리해 드립니다. 처음이라면 샘플 데이터로 결과 화면을 먼저 살펴봐도 좋아요."
            actionLabel="리뷰 파일 업로드하기"
            actionTo="/upload"
            secondaryActionLabel="샘플 데이터로 먼저 체험하기"
            secondaryActionTo="/upload?sample=1"
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
    </div>
  );
}
