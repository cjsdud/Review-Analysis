import { useEffect, useState } from 'react';
import { adminApi } from '../../api/adminApi.js';
import LoadingState from '../../components/LoadingState.jsx';

const PLAN_OPTIONS = ['free', 'starter', 'pro'];
const STATUS_OPTIONS = ['active', 'trialing', 'past_due', 'canceled', 'expired'];

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null); // user detail

  async function refresh() {
    setErr('');
    try {
      const data = await adminApi.listUsers({
        search: search || undefined,
        role: roleFilter || undefined,
        plan: planFilter || undefined,
        limit: 50,
      });
      setUsers(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="admin-page">
      <h2>사용자 관리</h2>
      <div className="admin-toolbar">
        <input
          type="search"
          className="admin-input"
          placeholder="이메일/이름 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') refresh(); }}
        />
        <select className="admin-input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">전체 role</option>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <select className="admin-input" value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
          <option value="">전체 plan</option>
          {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn--primary btn--sm" onClick={refresh}>검색</button>
      </div>
      {err && <div className="error-banner">{err}</div>}
      {loading ? <LoadingState /> : (
        <div className="admin-users-grid">
          <UsersTable users={users} onSelect={setSelected} />
          {selected && (
            <UserDetail userId={selected} onClose={() => setSelected(null)} onUpdated={refresh} />
          )}
        </div>
      )}
    </div>
  );
}

function UsersTable({ users, onSelect }) {
  if (!users.length) return <div className="muted">사용자가 없습니다.</div>;
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>이메일</th>
          <th>이름</th>
          <th>role</th>
          <th>plan</th>
          <th>구독</th>
          <th>이번달 사용</th>
          <th>가입일</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id}>
            <td><code>{u.email}</code></td>
            <td>{u.name || '-'}</td>
            <td><span className={`tag tag--${u.role === 'admin' ? 'success' : 'neutral'}`}>{u.role}</span></td>
            <td>{u.planCode}</td>
            <td>{u.subscriptionStatus || '-'}</td>
            <td>{u.monthlyAnalysisUsed}</td>
            <td className="muted">{(u.createdAt || '').slice(0, 10)}</td>
            <td><button className="btn btn--ghost btn--sm" onClick={() => onSelect(u.id)}>관리</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UserDetail({ userId, onClose, onUpdated }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    const d = await adminApi.getUser(userId);
    setData(d);
    setDraft({
      role: d.user.role,
      planCode: d.subscription?.plan_code || 'free',
      subscriptionStatus: d.subscription?.status || 'active',
      name: d.user.name || '',
    });
  }
  useEffect(() => { load(); }, [userId]);

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const body = { ...draft, reason };
      if (body.name === '') delete body.name;
      await adminApi.patchUser(userId, body);
      setMsg('저장 완료');
      onUpdated?.();
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addDiscount() {
    const value = prompt('할인 값 (숫자, 예: 30)');
    if (!value) return;
    const type = prompt('할인 타입 (percent|fixed_krw|free_months|custom)', 'percent');
    if (!type) return;
    try {
      await adminApi.addDiscount(userId, { discountType: type, discountValue: Number(value), reason: reason || '관리자 등록' });
      setMsg('할인 추가됨');
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  if (!data) return <div className="muted">불러오는 중…</div>;
  return (
    <div className="admin-detail">
      <div className="admin-detail__head">
        <h3>{data.user.email}</h3>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>닫기</button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        가입 {(data.user.created_at || '').slice(0, 10)} · 이번 달 분석 {data.usage.monthlyAnalysisUsed}회
      </p>
      {err && <div className="error-banner">{err}</div>}
      {msg && <div className="muted" style={{ color: 'var(--c-success, #047857)' }}>{msg}</div>}

      <div className="admin-form">
        <label>이름
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>role
          <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label>plan
          <select value={draft.planCode} onChange={(e) => setDraft({ ...draft, planCode: e.target.value })}>
            {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label>구독 상태
          <select value={draft.subscriptionStatus} onChange={(e) => setDraft({ ...draft, subscriptionStatus: e.target.value })}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>변경 사유 (감사 로그에 기록됩니다)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 이벤트 대상 / 운영팀 합류" />
        </label>
        <div className="page-actions">
          <button className="btn btn--primary" onClick={save} disabled={busy}>저장</button>
          <button className="btn btn--ghost" onClick={addDiscount}>할인 추가</button>
        </div>
      </div>

      <h4>최근 분석</h4>
      {data.recentAnalyses.length === 0 ? (
        <div className="muted">최근 분석이 없습니다.</div>
      ) : (
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
          {data.recentAnalyses.map((a) => (
            <li key={a.id}><code>{a.id}</code> — {a.status} — {a.created_at}</li>
          ))}
        </ul>
      )}

      <h4>할인</h4>
      {data.discounts.length === 0 ? (
        <div className="muted">등록된 할인이 없습니다.</div>
      ) : (
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
          {data.discounts.map((d) => (
            <li key={d.id}>
              {d.discount_type} {d.discount_value} · {d.reason || '-'} · {d.is_active ? '활성' : '비활성'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
