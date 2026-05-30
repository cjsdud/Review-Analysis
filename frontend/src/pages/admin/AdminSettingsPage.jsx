import { useEffect, useState } from 'react';
import { adminApi } from '../../api/adminApi.js';
import LoadingState from '../../components/LoadingState.jsx';

export default function AdminSettingsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const data = await adminApi.listSettings();
      setItems(data);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <LoadingState />;
  if (err) return <div className="error-banner">{err}</div>;

  // 카테고리별 그룹
  const groups = items.reduce((acc, it) => {
    (acc[it.category] = acc[it.category] || []).push(it);
    return acc;
  }, {});

  return (
    <div className="admin-page">
      <h2>운영 설정</h2>
      <p className="muted">
        값 수정은 즉시 적용됩니다. 모든 변경은 액션 로그에 기록되니, 가능하면 사유를 함께 남겨 주세요.
        API KEY 같은 민감 키는 환경변수로만 관리됩니다.
      </p>

      {Object.entries(groups).map(([cat, list]) => (
        <section key={cat} className="admin-settings-group">
          <h3>{cat}</h3>
          <div className="admin-settings-list">
            {list.map((it) => (
              <SettingRow key={it.key} item={it} onSaved={load} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SettingRow({ item, onSaved }) {
  const [value, setValue] = useState(item.value);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    let nextValue = value;
    if (item.valueType === 'boolean') nextValue = value === true || value === 'true';
    if (item.valueType === 'number')  nextValue = Number(value);
    try {
      await adminApi.patchSetting(item.key, { value: nextValue, reason: reason || undefined });
      setMsg('저장됨');
      setReason('');
      onSaved?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="admin-setting-row">
      <div className="admin-setting-row__head">
        <div>
          <code className="admin-setting-row__key">{item.key}</code>
          {item.label && <span style={{ marginLeft: 8 }}>{item.label}</span>}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{item.valueType}</span>
      </div>
      {item.description && <div className="muted" style={{ fontSize: 12 }}>{item.description}</div>}
      <div className="admin-setting-row__edit">
        {item.valueType === 'boolean' ? (
          <select value={String(value === true || value === 'true')} onChange={(e) => setValue(e.target.value === 'true')}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : item.valueType === 'json' ? (
          <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <input value={value ?? ''} onChange={(e) => setValue(e.target.value)} />
        )}
        <input
          placeholder="변경 사유 (선택)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button className="btn btn--primary btn--sm" onClick={save} disabled={busy}>저장</button>
      </div>
      {msg && <div className="muted" style={{ fontSize: 12, color: 'var(--c-success, #047857)' }}>{msg}</div>}
      {err && <div className="error-banner" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}
