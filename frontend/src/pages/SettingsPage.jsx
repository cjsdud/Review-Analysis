import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { getMappingTemplates } from '../api/uploadApi.js';
import { deleteAccount } from '../api/authApi.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { FASHION_CATEGORIES } from '../constants.js';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function onDeleteAccount() {
    if (deleting) return;
    if (confirmText.trim() !== '삭제') {
      setDeleteError('확인을 위해 “삭제” 를 정확히 입력해 주세요.');
      return;
    }
    const ok = window.confirm(
      '계정을 삭제하면 업로드한 리뷰 데이터, 분석 리포트, CS 답글 기록이 삭제되며 복구할 수 없습니다.\n진행할까요?',
    );
    if (!ok) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount();
      // 백엔드가 쿠키 만료까지 처리 — AuthContext 의 me 도 무효화.
      await refresh();
      navigate('/', { replace: true });
    } catch (e) {
      setDeleteError(e?.message || '계정 삭제 중 일시적인 문제가 있었어요. 잠시 후 다시 시도해 주세요.');
      setDeleting(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setTemplates(await getMappingTemplates());
      } catch {
        setTemplates([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <PageHeader title="매핑 템플릿" subtitle="저장한 컬럼 매핑과 분석 카테고리를 확인합니다." />
      <div className="card mb-5">
        <div className="section-title">저장된 컬럼 매핑 템플릿</div>
        {loading ? (
          <LoadingState title="불러오는 중..." />
        ) : templates.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="저장된 템플릿이 없습니다"
            desc="컬럼 매핑 화면에서 '템플릿으로 저장'을 체크하면 다음 업로드 때 재사용할 수 있습니다."
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>템플릿 이름</th>
                <th>출처</th>
                <th>매핑 필드</th>
                <th>생성일</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={{ cursor: 'default' }}>
                  <td style={{ fontWeight: 600 }}>{t.templateName || '(이름 없음)'}</td>
                  <td>
                    <span className="tag tag--neutral">{t.source}</span>
                  </td>
                  <td className="muted">{Object.keys(t.mapping).join(', ')}</td>
                  <td className="muted">{t.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="section-title">분석 카테고리 (패션 전용)</div>
        <p className="muted" style={{ marginTop: -8, marginBottom: 12, fontSize: 13 }}>
          상위 카테고리는 고정이며, 세부 이슈는 리뷰에서 자동으로 발견됩니다.
        </p>
        <div className="page-actions">
          {FASHION_CATEGORIES.map((c) => (
            <span key={c} className="tag">
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* 계정 탈퇴 — 본인 user_id 데이터 일괄 삭제. 마지막 admin 은 백엔드가 차단(409). */}
      {user && (
        <div className="card account-delete-card">
          <div className="section-title">계정 탈퇴</div>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
            계정을 삭제하면 업로드한 리뷰 데이터, 분석 리포트, CS 답글 기록이 함께 삭제되며
            복구할 수 없어요. 진행하려면 아래 입력란에 “<b>삭제</b>” 를 입력한 뒤 버튼을 눌러주세요.
          </p>
          <div className="account-delete-card__row">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => { setConfirmText(e.target.value); setDeleteError(''); }}
              placeholder='삭제를 진행하려면 "삭제" 라고 입력'
              aria-label="삭제 확인 입력"
              disabled={deleting}
            />
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={onDeleteAccount}
              disabled={deleting || confirmText.trim() !== '삭제'}
            >
              {deleting ? '삭제 중…' : '계정 삭제'}
            </button>
          </div>
          {deleteError && (
            <div className="error-banner" style={{ marginTop: 10 }}>{deleteError}</div>
          )}
        </div>
      )}
    </div>
  );
}
