import { useCallback, useEffect, useState } from 'react';
import LoadingState from '../../components/LoadingState.jsx';
import { sharedReportAdminApi } from '../../api/shareApi.js';

// 관리자 — 베타 샘플 분석 공유 코드 관리.
// 라우팅: /admin/shares (AdminRoute + AdminLayout)
//
// 가능한 작업:
//   - 새 공유 코드 생성 (analysis_id 입력 + 기본 30일 만료)
//   - 코드/공유 링크 복사
//   - 만료일 변경 (30/60/90일 / 무기한 / 즉시 만료)
//   - 회수 (revoke)
//   - 조회 횟수 / 마지막 조회 시간 확인
function shareLinkFor(code) {
  if (typeof window === 'undefined') return `/share/${code}`;
  return `${window.location.origin}/share/${code}`;
}

function formatDateTime(iso) {
  if (!iso) return '–';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('ko-KR', { hour12: false });
  } catch { return iso; }
}

function statusLabel(s) {
  if (s.isRevoked) return { label: '회수됨', cls: 'is-revoked' };
  if (s.isExpired) return { label: '만료', cls: 'is-expired' };
  return { label: '활성', cls: 'is-active' };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}

export default function AdminSharesPage() {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [analysisId, setAnalysisId] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [reason, setReason] = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [toast, setToast] = useState('');

  const reload = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const data = await sharedReportAdminApi.listAll();
      setShares(data.shares || []);
    } catch (e) {
      setErr(e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function onCreate(e) {
    e.preventDefault();
    if (!analysisId.trim()) { setCreateErr('분석 ID 를 입력해 주세요.'); return; }
    setCreating(true); setCreateErr('');
    try {
      await sharedReportAdminApi.create(analysisId.trim(), {
        expiresInDays: Number(expiresInDays),
        reason: reason || undefined,
      });
      setAnalysisId(''); setReason('');
      setToast('공유 코드를 생성했습니다.');
      await reload();
    } catch (e) {
      setCreateErr(e.message || '공유 코드 생성에 실패했습니다.');
    } finally { setCreating(false); }
  }

  async function onCopy(text, label) {
    const ok = await copyText(text);
    setToast(ok ? `${label}을(를) 복사했어요.` : '복사에 실패했습니다.');
  }

  async function onChangeExpiry(shareId, days) {
    try {
      await sharedReportAdminApi.patch(shareId, { expiresInDays: days });
      setToast('만료일을 변경했습니다.');
      await reload();
    } catch (e) {
      setToast(e.message || '만료일 변경에 실패했습니다.');
    }
  }

  async function onRevoke(shareId) {
    if (!confirm('이 공유 코드를 회수하시겠어요? 회수하면 외부 셀러가 더 이상 결과를 볼 수 없습니다.')) return;
    try {
      await sharedReportAdminApi.revoke(shareId, { reason: '관리자 회수' });
      setToast('공유 코드를 회수했습니다.');
      await reload();
    } catch (e) {
      setToast(e.message || '회수에 실패했습니다.');
    }
  }

  // 토스트 자동 사라짐
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="admin-page">
      <h2>공유 코드 관리</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 16, fontSize: 13 }}>
        외부 셀러에게 분석 결과를 보여주기 위한 읽기 전용 공유 코드를 만들고 관리합니다.
        모든 작업은 액션 로그에 기록됩니다.
      </p>

      {/* 생성 폼 */}
      <form onSubmit={onCreate} className="admin-toolbar" style={{ alignItems: 'flex-end' }}>
        <label style={{ flex: '1 1 240px' }}>
          분석 ID
          <input
            className="admin-input"
            value={analysisId}
            onChange={(e) => setAnalysisId(e.target.value)}
            placeholder="예: AbCdEf12_..."
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          만료 기간
          <select
            className="admin-input"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(Number(e.target.value))}
          >
            <option value={7}>7일</option>
            <option value={30}>30일 (기본)</option>
            <option value={60}>60일</option>
            <option value={90}>90일</option>
          </select>
        </label>
        <label style={{ flex: '1 1 200px' }}>
          사유 (선택)
          <input
            className="admin-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 인스타 DM 셀러 A"
            maxLength={200}
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={creating}>
          {creating ? '생성 중…' : '공유 코드 생성'}
        </button>
      </form>
      {createErr && <div className="error-banner" style={{ marginTop: 8 }}>{createErr}</div>}

      {toast && <div className="hint-banner" role="status" style={{ marginTop: 12 }}>{toast}</div>}

      <h3 style={{ marginTop: 24 }}>발급된 공유 코드</h3>
      {loading ? (
        <LoadingState />
      ) : err ? (
        <div className="error-banner">{err}</div>
      ) : shares.length === 0 ? (
        <div className="muted">아직 발급된 공유 코드가 없습니다.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>코드</th>
              <th>분석 / 원본</th>
              <th>상태</th>
              <th>만료일</th>
              <th>조회</th>
              <th>마지막 조회</th>
              <th>발급자</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {shares.map((s) => {
              const st = statusLabel(s);
              const link = shareLinkFor(s.code);
              const disabled = s.isRevoked;
              return (
                <tr key={s.id}>
                  <td>
                    <span className="admin-share-code">{s.code}</span>
                  </td>
                  <td>
                    <div style={{ fontSize: 13 }}>{s.originalName || <span className="muted">파일명 없음</span>}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      <code>{s.analysisId}</code>
                    </div>
                  </td>
                  <td><span className={`admin-share-status ${st.cls}`}>{st.label}</span></td>
                  <td>{formatDateTime(s.expiresAt)}</td>
                  <td>{s.viewCount}</td>
                  <td>{formatDateTime(s.lastViewedAt)}</td>
                  <td>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {s.createdByEmail || s.createdBy}
                    </span>
                  </td>
                  <td>
                    <div className="admin-share-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => onCopy(s.code, '공유 코드')}
                        disabled={disabled}
                      >
                        코드 복사
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => onCopy(link, '공유 링크')}
                        disabled={disabled}
                      >
                        링크 복사
                      </button>
                      <select
                        className="admin-input"
                        defaultValue=""
                        onChange={(e) => {
                          const v = e.target.value;
                          e.target.value = '';
                          if (v === '') return;
                          if (v === 'revoke') return onRevoke(s.id);
                          onChangeExpiry(s.id, Number(v));
                        }}
                        disabled={disabled}
                        aria-label="만료일 변경"
                      >
                        <option value="">만료일…</option>
                        <option value={7}>7일 후로 연장</option>
                        <option value={30}>30일 후로 연장</option>
                        <option value={60}>60일 후로 연장</option>
                        <option value={90}>90일 후로 연장</option>
                        <option value={0}>즉시 만료</option>
                        {!s.isRevoked && <option value="revoke">회수(비활성화)</option>}
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
