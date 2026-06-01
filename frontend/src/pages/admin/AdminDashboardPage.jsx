import { useEffect, useState } from 'react';
import { adminApi } from '../../api/adminApi.js';
import LoadingState from '../../components/LoadingState.jsx';

function StatCard({ label, value, sub }) {
  return (
    <div className="admin-stat">
      <div className="admin-stat__label">{label}</div>
      <div className="admin-stat__value">{value ?? '—'}</div>
      {sub && <div className="admin-stat__sub muted">{sub}</div>}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [demo, setDemo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, l, d] = await Promise.all([
          adminApi.summary(),
          adminApi.actionLogs({ limit: 10 }),
          adminApi.demoViews().catch(() => null), // 실패해도 나머지 표시
        ]);
        setData(s);
        setLogs(l);
        setDemo(d);
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingState title="관리자 요약을 불러오는 중..." />;
  if (err) return <div className="error-banner">{err}</div>;
  if (!data) return null;

  return (
    <div className="admin-page">
      <h2>운영 요약</h2>
      <div className="admin-stat-grid">
        <StatCard label="전체 사용자" value={data.users.total} sub={`관리자 ${data.users.adminCount}명`} />
        <StatCard label="오늘 가입" value={data.users.newToday} />
        <StatCard label="이번 달 가입" value={data.users.newThisMonth} />
        <StatCard label="오늘 분석" value={data.analyses.today} />
        <StatCard label="이번 주 분석" value={data.analyses.thisWeek} />
        <StatCard label="이번 달 분석" value={data.analyses.thisMonth} />
        <StatCard label="총 분석 리뷰" value={data.usage.totalReviewsAnalyzed?.toLocaleString('ko-KR')} sub={`분석당 평균 ${data.usage.averageReviewsPerAnalysis}`} />
        <StatCard label="이번 달 활성 사용자" value={data.usage.activeUsersThisMonth} />
        <StatCard label="실패 분석" value={data.analyses.failedCount} />
      </div>

      {demo && (
        <>
          <h3 style={{ marginTop: 24 }}>샘플 리포트 조회 (가입 전 체험)</h3>
          <div className="admin-stat-grid admin-stat-grid--3">
            <StatCard label="전체 조회 수" value={demo.totalDemoViews?.toLocaleString('ko-KR')} />
            <StatCard label="오늘 조회 수" value={demo.todayDemoViews?.toLocaleString('ko-KR')} />
            <StatCard label="최근 7일 조회 수" value={demo.last7DaysDemoViews?.toLocaleString('ko-KR')} />
          </div>
        </>
      )}

      <h3 style={{ marginTop: 24 }}>플랜별 사용자</h3>
      <div className="admin-stat-grid admin-stat-grid--3">
        <StatCard label="Free" value={data.plans.free} />
        <StatCard label="Starter" value={data.plans.starter} />
        <StatCard label="Pro" value={data.plans.pro} />
      </div>

      <h3 style={{ marginTop: 24 }}>최근 관리자 액션 (최근 10건)</h3>
      {logs.length === 0 ? (
        <div className="muted">아직 기록된 관리자 액션이 없습니다.</div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>시각</th>
              <th>관리자</th>
              <th>유형</th>
              <th>대상</th>
              <th>사유</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{l.createdAt}</td>
                <td>{l.adminEmail || l.adminUserId}</td>
                <td><code>{l.actionType}</code></td>
                <td>{l.targetType ? `${l.targetType}:${l.targetId}` : '-'}</td>
                <td>{l.reason || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
