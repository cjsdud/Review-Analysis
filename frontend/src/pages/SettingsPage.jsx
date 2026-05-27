import { useEffect, useState } from 'react';
import LoadingState from '../components/LoadingState.jsx';
import EmptyState from '../components/EmptyState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { getMappingTemplates } from '../api/uploadApi.js';
import { FASHION_CATEGORIES } from '../constants.js';

export default function SettingsPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

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
    </div>
  );
}
