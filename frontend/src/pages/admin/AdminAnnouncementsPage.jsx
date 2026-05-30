import { useEffect, useState } from 'react';
import { adminApi } from '../../api/adminApi.js';
import LoadingState from '../../components/LoadingState.jsx';

const TYPES = [
  { value: 'info', label: '안내' },
  { value: 'warning', label: '경고' },
  { value: 'maintenance', label: '점검' },
  { value: 'promotion', label: '프로모션' },
];

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [draft, setDraft] = useState({ title: '', content: '', type: 'info', startsAt: '', endsAt: '' });
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true); setErr('');
    try { setItems(await adminApi.listAnnouncements()); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!draft.title || !draft.content) { setErr('제목과 내용을 입력하세요.'); return; }
    setCreating(true); setErr('');
    try {
      const body = { ...draft };
      if (!body.startsAt) delete body.startsAt;
      if (!body.endsAt) delete body.endsAt;
      await adminApi.createAnnouncement(body);
      setDraft({ title: '', content: '', type: 'info', startsAt: '', endsAt: '' });
      await load();
    } catch (e) { setErr(e.message); } finally { setCreating(false); }
  }

  async function toggle(it) {
    await adminApi.patchAnnouncement(it.id, { isActive: !it.is_active });
    await load();
  }
  async function remove(it) {
    if (!confirm('정말 비활성화하시겠습니까? 내역은 액션 로그에 남습니다.')) return;
    await adminApi.deleteAnnouncement(it.id);
    await load();
  }

  return (
    <div className="admin-page">
      <h2>공지/배너</h2>

      <section className="admin-card">
        <h3>새 공지 작성</h3>
        <div className="admin-form">
          <label>제목 <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>내용 <textarea rows={3} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></label>
          <label>타입
            <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label>시작일시 <input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></label>
          <label>종료일시 <input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} /></label>
          <div className="page-actions">
            <button className="btn btn--primary" onClick={create} disabled={creating}>등록</button>
          </div>
        </div>
        {err && <div className="error-banner">{err}</div>}
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>등록된 공지</h3>
        {loading ? <LoadingState /> : items.length === 0 ? (
          <div className="muted">등록된 공지가 없습니다.</div>
        ) : (
          <table className="admin-table">
            <thead><tr><th>제목</th><th>타입</th><th>활성</th><th>기간</th><th></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{it.title}</div>
                    <div className="muted" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{it.content}</div>
                  </td>
                  <td>{it.type}</td>
                  <td>{it.is_active ? '활성' : '비활성'}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {it.starts_at || '—'} ~ {it.ends_at || '—'}
                  </td>
                  <td>
                    <button className="btn btn--ghost btn--sm" onClick={() => toggle(it)}>
                      {it.is_active ? '비활성화' : '활성화'}
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => remove(it)} style={{ marginLeft: 4 }}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
