import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { getAnalyses, deleteAnalysis } from '../api/analysisApi.js';
import { progressStepLabel, progressMetaText } from '../utils/progressSteps.js';
import { useAuth } from '../auth/AuthContext.jsx';

function formatDate(s) {
  if (!s) return '—';
  return String(s).replace('T', ' ').slice(0, 16);
}

function isSampleHistory(it) {
  if (!it) return false;
  if (typeof it.isSample === 'boolean') return it.isSample;
  return it.source === 'sample';
}

// 상태별 라벨/톤. 'done'(legacy) 도 'completed' 와 동일 표시.
const MODE_LABEL = {
  quick: '빠른 분석',
  standard: '기본 분석',
  precision: '정밀 분석',
  advanced: '고급 분석',
  batch: '대량 배치 분석',
};

const STATUS_META = {
  pending:    { label: '대기 중',  tone: 'tag--neutral' },
  processing: { label: '분석 중',  tone: 'tag--neutral' },
  completed:  { label: '완료',     tone: 'tag--success' },
  done:       { label: '완료',     tone: 'tag--success' },
  failed:     { label: '실패',     tone: 'tag--danger'  },
  error:      { label: '실패',     tone: 'tag--danger'  },
};

function StatusBadge({ status, progress }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  const isRunning = status === 'pending' || status === 'processing';
  return (
    <span className={`tag ${meta.tone}`} title={isRunning ? `${progress ?? 0}% 진행` : undefined}>
      {meta.label}
      {isRunning && typeof progress === 'number' && progress > 0 ? ` ${progress}%` : ''}
    </span>
  );
}

export default function AnalysisHistoryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pollRef = useRef(null);
  const [deletingId, setDeletingId] = useState('');
  const { refresh: refreshAuth } = useAuth();
  // 진행 중 → 완료 전이 시점에 1회만 사용량 chip 갱신.
  const wasRunningRef = useRef(false);

  // 분석 결과 삭제 — confirm 후 본인 분석만. processing/pending 은 백엔드가 409 로 차단.
  async function onDelete(it) {
    if (deletingId) return;
    const ok = window.confirm('이 분석 결과를 삭제할까요? 삭제 후에는 복구할 수 없습니다.');
    if (!ok) return;
    setDeletingId(it.id);
    try {
      await deleteAnalysis(it.id);
      setItems((prev) => prev.filter((x) => x.id !== it.id));
    } catch (e) {
      const msg = e?.message || '삭제 중 일시적인 문제가 있었어요. 잠시 후 다시 시도해 주세요.';
      window.alert(msg);
    } finally {
      setDeletingId('');
    }
  }

  // 첫 로드 + 진행 중 row 가 있으면 5초마다 폴링 — 완료/실패가 자연스럽게 갱신.
  async function load() {
    try {
      const data = await getAnalyses(50);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const hasRunning = useMemo(
    () => items.some((it) => it.status === 'pending' || it.status === 'processing'),
    [items],
  );

  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (hasRunning) pollRef.current = setInterval(load, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hasRunning]);

  // hasRunning 이 true → false 로 바뀌는 순간(= 진행 중 분석이 모두 완료/실패) 사용량 chip 갱신.
  useEffect(() => {
    if (wasRunningRef.current && !hasRunning) {
      // 분석 완료 시 usage_events 가 증가했을 가능성 — /api/me refresh.
      refreshAuth?.().catch(() => {});
    }
    wasRunningRef.current = hasRunning;
  }, [hasRunning, refreshAuth]);

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

      <div className="beta-notice" role="note">
        <span className="beta-notice__ico" aria-hidden="true">🧪</span>
        <div className="beta-notice__body">
          <b>무료 베타 기간</b>에는 서버 점검·재배포 과정에서 이전 분석 히스토리가 초기화될 수
          있습니다. 필요한 리포트는 상품 상세에서 CSV 로 저장하거나 화면을 캡처해 두세요.
        </div>
      </div>

      {hasRunning && (
        <div className="hint-banner" role="status">
          리뷰 분석을 진행 중입니다. 리뷰 수에 따라 시간이 걸릴 수 있어요. 완료되면 자동으로 ‘리포트 보기’ 버튼이 활성화됩니다.
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <SectionCard
        title="최근 분석"
        subtitle="완료된 분석을 선택하면 대시보드로 이동합니다."
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
            {items.map((it) => {
              const isReady = it.status === 'completed' || it.status === 'done';
              const isFailed = it.status === 'failed' || it.status === 'error';
              const isRunning = it.status === 'pending' || it.status === 'processing';
              const highlight = highlightId === it.id;
              return (
                <li
                  key={it.id}
                  className={`history-card${highlight ? ' is-highlight' : ''}`}
                  role={isReady ? 'button' : undefined}
                  tabIndex={isReady ? 0 : undefined}
                  onClick={isReady ? () => navigate(`/dashboard/${it.id}`) : undefined}
                  onKeyDown={isReady ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') navigate(`/dashboard/${it.id}`);
                  } : undefined}
                >
                  <div className="history-card__main">
                    <div className="history-card__name">
                      {isSampleHistory(it) ? '샘플 리포트' : (it.originalName || '(파일명 없음)')}
                      {isSampleHistory(it) && (
                        <span className="tag tag--sample history-card__sample">샘플 데이터</span>
                      )}
                    </div>
                    <div className="history-card__meta muted">
                      {formatDate(it.createdAt)}
                      {it.source ? ` · ${it.source}` : ''}
                    </div>
                    {/* 진행 중 카드 — 단계 문구 + 처리 카운트 보조 표시 (LLM/API 같은 내부 표현은 사용 안 함) */}
                    {isRunning && (() => {
                      const stepLabel = progressStepLabel(it.progressStep);
                      const metaText = progressMetaText(it.progressMeta);
                      if (!stepLabel && !metaText) return null;
                      return (
                        <div className="history-card__progress-step muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {stepLabel}
                          {metaText ? ` · ${metaText}` : ''}
                        </div>
                      );
                    })()}
                    {isFailed && it.errorMessage && (
                      <div className="muted" style={{ fontSize: 12, color: '#b91c1c' }}>
                        실패 사유: {it.errorMessage}
                      </div>
                    )}
                  </div>
                  <div className="history-card__stats">
                    <span className="tag tag--neutral">리뷰 {it.totalReviews ?? '—'}건</span>
                    <span className="tag tag--neutral">상품 {it.productCount ?? '—'}개</span>
                    {it.analysisMode && (
                      <span className="tag tag--neutral">{MODE_LABEL[it.analysisMode] || it.analysisMode}</span>
                    )}
                    <StatusBadge status={it.status} progress={it.progress} />
                  </div>
                  <div className="history-card__actions">
                    {isReady ? (
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/${it.id}`); }}
                      >
                        리포트 보기 →
                      </button>
                    ) : isFailed ? (
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={(e) => { e.stopPropagation(); navigate('/upload'); }}
                      >
                        다시 분석
                      </button>
                    ) : (
                      <button className="btn btn--ghost btn--sm" disabled>
                        분석 중…
                      </button>
                    )}
                    {/* 삭제 — 본인 분석만 동작. 진행 중이면 백엔드가 409 로 차단해 alert 로 안내. */}
                    {!isRunning && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm history-card__delete"
                        onClick={(e) => { e.stopPropagation(); onDelete(it); }}
                        disabled={deletingId === it.id}
                        title="이 분석 결과 삭제"
                      >
                        {deletingId === it.id ? '삭제 중…' : '삭제'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
