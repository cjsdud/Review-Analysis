// 관리자 콘솔 — AI 분석 로그 / LLM 사용량.
// admin only. 일반 사용자 화면에는 절대 노출되지 않는다.
//
// - 상단: 요약 카드 (오늘/이번 달 token, 예상 비용, OpenAI 호출, cache hit, fallback)
// - 하단: 필터 + 로그 테이블 + 페이지네이션. 상세는 같은 화면에 펼침/접힘.
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../api/adminApi.js';
import LoadingState from '../../components/LoadingState.jsx';

const PROVIDER_TONE = {
  openai: 'is-good',
  gemini: 'is-good',
  claude: 'is-good',
  cache: 'is-info',
  rule: 'is-neutral',
  mock: 'is-warn',
};

const REQ_TYPE_LABEL = {
  review_analysis: '리뷰 분석',
  review_reanalysis: '리뷰 재분석',
  report_summary: '리포트 요약',
  cs_reply: 'CS 답글',
  advanced_report: '고급 리포트',
  analysis_summary: '분석 요약',
};

function SummaryCard({ label, value, sub }) {
  return (
    <div className="admin-stat">
      <div className="admin-stat__label">{label}</div>
      <div className="admin-stat__value">{value ?? '—'}</div>
      {sub && <div className="admin-stat__sub muted">{sub}</div>}
    </div>
  );
}

function formatNumber(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('ko-KR');
}

function formatCost(n) {
  if (n == null) return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (num <= 0) return '$0.0000';
  // 매우 작은 비용($0.0000 으로 반올림되는 값) 은 명시적으로 표시 — "기록은 됐는데
  // 0 처럼 보임" 오해 방지.
  if (num < 0.0001) return '< $0.0001';
  return `$${num.toFixed(4)}`;
}

function formatDate(s) {
  if (!s) return '—';
  return String(s).slice(0, 19).replace('T', ' ');
}

export default function AdminLlmLogsPage() {
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    provider: '', model: '', requestType: '', userId: '', analysisId: '',
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState(null);

  async function loadAll() {
    setLoading(true); setErr('');
    try {
      const cleanFilters = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v && String(v).trim()),
      );
      const [s, l] = await Promise.all([
        adminApi.llmLogSummary(),
        adminApi.llmLogs({ ...cleanFilters, page, limit: 20 }),
      ]);
      setSummary(s.summary);
      setData(l);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, [page]);

  const totalPages = useMemo(() => {
    if (!data?.pagination) return 1;
    return Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit));
  }, [data]);

  function applyFilters(e) {
    e?.preventDefault();
    setPage(1);
    loadAll();
  }

  return (
    <div className="admin-page">
      <h2>AI 분석 로그</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        provider/모델/토큰/예상 비용을 한 곳에서 확인합니다. 일반 사용자에게는 노출되지 않습니다.
      </p>

      {err && <div className="error-banner">{err}</div>}

      <h3>LLM 사용량 요약</h3>
      <div className="admin-stat-grid">
        <SummaryCard label="오늘 예상 비용" value={formatCost(summary?.todayEstimatedCostUsd)} sub={`token ${formatNumber(summary?.todayTotalTokens)}`} />
        <SummaryCard label="이번 달 예상 비용" value={formatCost(summary?.monthEstimatedCostUsd)} sub={`token ${formatNumber(summary?.monthTotalTokens)}`} />
        <SummaryCard label="OpenAI 호출 (이번 달)" value={formatNumber(summary?.openaiCallCount)} />
        <SummaryCard label="캐시 사용 (이번 달)" value={formatNumber(summary?.cacheHitCount)} />
        <SummaryCard label="Fallback 발생 (이번 달)" value={formatNumber(summary?.fallbackCount)} />
      </div>

      <h3 style={{ marginTop: 24 }}>호출 로그</h3>
      <form className="admin-form admin-form--inline" onSubmit={applyFilters} style={{ marginBottom: 12 }}>
        <label>Provider
          <select value={filters.provider} onChange={(e) => setFilters({ ...filters, provider: e.target.value })}>
            <option value="">전체</option>
            <option value="openai">openai</option>
            <option value="gemini">gemini</option>
            <option value="claude">claude</option>
            <option value="mock">mock</option>
            <option value="rule">rule</option>
            <option value="cache">cache</option>
          </select>
        </label>
        <label>Request Type
          <select value={filters.requestType} onChange={(e) => setFilters({ ...filters, requestType: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(REQ_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label>Model
          <input value={filters.model} onChange={(e) => setFilters({ ...filters, model: e.target.value })} placeholder="예: gpt-5.4-nano" />
        </label>
        <label>User ID
          <input value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })} />
        </label>
        <label>Analysis ID
          <input value={filters.analysisId} onChange={(e) => setFilters({ ...filters, analysisId: e.target.value })} />
        </label>
        <button className="btn btn--primary btn--sm" type="submit">필터 적용</button>
      </form>

      {loading ? (
        <LoadingState title="로그를 불러오는 중..." />
      ) : !data?.logs?.length ? (
        <div className="muted">조건에 맞는 로그가 없습니다.</div>
      ) : (
        <>
        {/* 데스크톱: 13컬럼 풀 테이블 (≥769px) — 모바일에서는 CSS 로 숨김 */}
        <div className="admin-llm__desktop table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>시간</th>
              <th>사용자</th>
              <th>Analysis</th>
              <th>Provider</th>
              <th>Model</th>
              <th>요청</th>
              <th>Input</th>
              <th>Output</th>
              <th>Total</th>
              <th>예상 비용</th>
              <th>OpenAI</th>
              <th>Cache / Fallback</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.logs.map((l) => (
              <>
                <tr key={l.id}>
                  <td>{formatDate(l.createdAt)}</td>
                  <td>{l.userEmail || l.userId || '—'}</td>
                  <td><code style={{ fontSize: 11 }}>{l.analysisId || '—'}</code></td>
                  <td>
                    <span className={`status-badge ${PROVIDER_TONE[l.provider] || 'is-neutral'}`}>
                      {l.provider}
                    </span>
                  </td>
                  <td>{l.model || '—'}</td>
                  <td>{REQ_TYPE_LABEL[l.requestType] || l.requestType}</td>
                  <td>{formatNumber(l.inputTokens)}</td>
                  <td>{formatNumber(l.outputTokens)}</td>
                  <td>{formatNumber(l.totalTokens)}</td>
                  <td>{formatCost(l.estimatedCostUsd)}</td>
                  <td>{l.openaiCalled ? '✓' : '—'}</td>
                  <td>
                    {l.cacheHitCount > 0 && <span className="tag tag--neutral">cache {l.cacheHitCount}</span>}
                    {l.fallbackUsed && <span className="tag tag--danger">fallback{l.fallbackProvider ? `(${l.fallbackProvider})` : ''}</span>}
                  </td>
                  <td>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpenId(openId === l.id ? null : l.id)}>
                      {openId === l.id ? '닫기' : '상세'}
                    </button>
                  </td>
                </tr>
                {openId === l.id && (
                  <tr key={`${l.id}-detail`}>
                    <td colSpan={13} className="muted">
                      <div style={{ fontSize: 12, padding: 8, lineHeight: 1.6 }}>
                        <div>promptVersion: <code>{l.promptVersion || '—'}</code> · analysisVersion: <code>{l.analysisVersion || '—'}</code></div>
                        <div>reviewCount: {formatNumber(l.reviewCount)} · miniReanalysis: {formatNumber(l.miniReanalysisCount)} · cacheMiss: {formatNumber(l.cacheMissCount)}</div>
                        <div>status: <strong>{l.status}</strong></div>
                        {l.errorMessage && (
                          <div style={{ color: '#b91c1c' }}>
                            <strong>오류:</strong> <code>{l.errorMessage}</code>
                            {' '}— OpenAI 가 실제 호출되지 않고 mock 응답으로 떨어졌습니다.
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        </div>

        {/* 모바일(≤768px): 카드 reflow — 데스크톱 테이블은 CSS 로 숨김.
            가장 자주 보는 필드(시간/사용자/요청/비용/토큰/cache/fallback) 를 상단에,
            나머지 진단 정보는 "상세" 토글 펼침. */}
        <ul className="admin-llm__mobile">
          {data.logs.map((l) => (
            <li key={`m-${l.id}`} className="admin-llm-card">
              <div className="admin-llm-card__head">
                <span className="admin-llm-card__time">{formatDate(l.createdAt)}</span>
                <span className={`status-badge ${PROVIDER_TONE[l.provider] || 'is-neutral'}`}>
                  {l.provider}
                </span>
              </div>
              <div className="admin-llm-card__user muted">
                {l.userEmail || l.userId || '—'}
              </div>
              <div className="admin-llm-card__row">
                <span className="admin-llm-card__label">요청</span>
                <span>{REQ_TYPE_LABEL[l.requestType] || l.requestType}</span>
              </div>
              <div className="admin-llm-card__row">
                <span className="admin-llm-card__label">Model</span>
                <span className="admin-llm-card__mono">{l.model || '—'}</span>
              </div>
              <div className="admin-llm-card__metrics">
                <div>
                  <div className="admin-llm-card__metric-label">토큰</div>
                  <div className="admin-llm-card__metric-value">{formatNumber(l.totalTokens)}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    in {formatNumber(l.inputTokens)} / out {formatNumber(l.outputTokens)}
                  </div>
                </div>
                <div>
                  <div className="admin-llm-card__metric-label">예상 비용</div>
                  <div className="admin-llm-card__metric-value">{formatCost(l.estimatedCostUsd)}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {l.openaiCalled ? 'OpenAI 호출' : '미호출'}
                  </div>
                </div>
              </div>
              <div className="admin-llm-card__tags">
                {l.cacheHitCount > 0 && <span className="tag tag--neutral">cache {l.cacheHitCount}</span>}
                {l.fallbackUsed && (
                  <span className="tag tag--danger">
                    fallback{l.fallbackProvider ? `(${l.fallbackProvider})` : ''}
                  </span>
                )}
                {!l.cacheHitCount && !l.fallbackUsed && (
                  <span className="muted" style={{ fontSize: 11 }}>—</span>
                )}
              </div>
              {l.analysisId && (
                <div className="admin-llm-card__row">
                  <span className="admin-llm-card__label">Analysis</span>
                  <code style={{ fontSize: 11 }}>{l.analysisId}</code>
                </div>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--sm admin-llm-card__toggle"
                onClick={() => setOpenId(openId === l.id ? null : l.id)}
              >
                {openId === l.id ? '상세 닫기' : '상세 보기'}
              </button>
              {openId === l.id && (
                <div className="admin-llm-card__detail muted">
                  <div>promptVersion: <code>{l.promptVersion || '—'}</code></div>
                  <div>analysisVersion: <code>{l.analysisVersion || '—'}</code></div>
                  <div>리뷰 수: {formatNumber(l.reviewCount)}</div>
                  <div>mini 재분석: {formatNumber(l.miniReanalysisCount)} · cacheMiss: {formatNumber(l.cacheMissCount)}</div>
                  <div>status: <strong>{l.status}</strong></div>
                  {l.errorMessage && (
                    <div style={{ color: '#b91c1c', marginTop: 6 }}>
                      <strong>오류:</strong> <code>{l.errorMessage}</code>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        </>
      )}

      {totalPages > 1 && (
        <div className="page-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</button>
          <span className="muted" style={{ padding: '0 12px' }}>{page} / {totalPages}</span>
          <button className="btn btn--ghost btn--sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>다음</button>
        </div>
      )}
    </div>
  );
}
