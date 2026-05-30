import { useEffect, useState } from 'react';
import { adminApi } from '../../api/adminApi.js';
import LoadingState from '../../components/LoadingState.jsx';

const ACTION_TYPES = [
  'USER_ROLE_UPDATED',
  'USER_PLAN_UPDATED',
  'USER_DISCOUNT_CREATED',
  'USER_DISCOUNT_UPDATED',
  'SETTING_UPDATED',
  'ANNOUNCEMENT_CREATED',
  'ANNOUNCEMENT_UPDATED',
  'ANNOUNCEMENT_DELETED',
];

export default function AdminActionLogsPage() {
  const [items, setItems] = useState([]);
  const [actionType, setActionType] = useState('');
  const [targetType, setTargetType] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const params = { limit: 100 };
      if (actionType) params.actionType = actionType;
      if (targetType) params.targetType = targetType;
      setItems(await adminApi.actionLogs(params));
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [actionType, targetType]);

  return (
    <div className="admin-page">
      <h2>관리자 액션 로그</h2>
      <div className="admin-toolbar">
        <select className="admin-input" value={actionType} onChange={(e) => setActionType(e.target.value)}>
          <option value="">전체 actionType</option>
          {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="admin-input" value={targetType} onChange={(e) => setTargetType(e.target.value)}>
          <option value="">전체 targetType</option>
          <option value="user">user</option>
          <option value="user_discount">user_discount</option>
          <option value="setting">setting</option>
          <option value="announcement">announcement</option>
        </select>
      </div>
      {err && <div className="error-banner">{err}</div>}
      {loading ? <LoadingState /> : items.length === 0 ? (
        <div className="muted">기록된 액션이 없습니다.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>시각</th><th>관리자</th><th>유형</th><th>대상</th><th>이전→이후</th><th>사유</th></tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <td className="muted" style={{ fontSize: 12 }}>{l.createdAt}</td>
                <td>{l.adminEmail || l.adminUserId}</td>
                <td><code>{l.actionType}</code></td>
                <td>{l.targetType ? `${l.targetType}:${(l.targetId || '').slice(0, 24)}` : '-'}</td>
                <td className="muted" style={{ fontSize: 12, maxWidth: 320, wordBreak: 'break-all' }}>
                  {l.before ? `${l.before} → ${l.after}` : (l.after || '-')}
                </td>
                <td>{l.reason || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
