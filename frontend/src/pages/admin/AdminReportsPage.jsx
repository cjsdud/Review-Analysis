import { useEffect, useState } from 'react';
import { adminApi } from '../../api/adminApi.js';
import LoadingState from '../../components/LoadingState.jsx';

export default function AdminReportsPage() {
  const [range, setRange] = useState('30d');
  const [groupBy, setGroupBy] = useState('day');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true); setErr('');
    adminApi.reports({ range, groupBy })
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [range, groupBy]);

  return (
    <div className="admin-page">
      <h2>리포트 실행 추이</h2>
      <div className="admin-toolbar">
        <label>기간
          <select className="admin-input" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="7d">최근 7일</option>
            <option value="30d">최근 30일</option>
            <option value="90d">최근 90일</option>
          </select>
        </label>
        <label>그룹
          <select className="admin-input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="day">일별</option>
            <option value="week">주별</option>
            <option value="month">월별</option>
          </select>
        </label>
      </div>

      {loading ? <LoadingState /> : err ? <div className="error-banner">{err}</div> : data && (
        <>
          <h3>기간별 분석/리뷰 수</h3>
          {data.series.length === 0 ? (
            <div className="muted">이 기간에 분석이 없습니다.</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr><th>날짜</th><th>분석</th><th>리뷰</th><th>상품</th><th>활성 사용자</th><th>실패</th></tr>
              </thead>
              <tbody>
                {data.series.map((s) => (
                  <tr key={s.date}>
                    <td>{s.date}</td>
                    <td>{s.analysisCount}</td>
                    <td>{s.reviewCount.toLocaleString('ko-KR')}</td>
                    <td>{s.productCount}</td>
                    <td>{s.activeUserCount}</td>
                    <td>{s.failedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: 24 }}>상위 사용자</h3>
          {data.topUsers.length === 0 ? <div className="muted">데이터 없음</div> : (
            <table className="admin-table">
              <thead><tr><th>이메일</th><th>분석 수</th><th>리뷰 수</th></tr></thead>
              <tbody>{data.topUsers.map((u) => (
                <tr key={u.userId}><td><code>{u.email}</code></td><td>{u.analysisCount}</td><td>{u.reviewCount}</td></tr>
              ))}</tbody>
            </table>
          )}

          <h3 style={{ marginTop: 24 }}>플랫폼(source)별 분석</h3>
          {data.topSources.length === 0 ? <div className="muted">데이터 없음</div> : (
            <table className="admin-table">
              <thead><tr><th>source</th><th>분석 수</th></tr></thead>
              <tbody>{data.topSources.map((s) => (
                <tr key={s.source}><td>{s.source}</td><td>{s.analysisCount}</td></tr>
              ))}</tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
