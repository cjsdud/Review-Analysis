import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ColumnMappingTable from '../components/ColumnMappingTable.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Stepper from '../components/Stepper.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import { getUpload, saveMapping } from '../api/uploadApi.js';
import { runAnalysis } from '../api/analysisApi.js';

export default function ColumnMappingPage() {
  const { uploadId } = useParams();
  const navigate = useNavigate();

  const [upload, setUpload] = useState(null);
  const [mapping, setMapping] = useState({});
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await getUpload(uploadId);
        setUpload(data);
        const initial = {};
        for (const field of data.fields) {
          initial[field] = data.mappingSuggestion?.[field]?.column || '';
        }
        setMapping(initial);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [uploadId]);

  function handleChange(field, value) {
    setMapping((prev) => ({ ...prev, [field]: value }));
  }

  async function handleConfirm() {
    setError('');
    if (!mapping.content) {
      setError('리뷰 내용(content) 컬럼은 반드시 선택해야 합니다.');
      return;
    }
    setAnalyzing(true);
    try {
      await saveMapping(uploadId, mapping, { saveAsTemplate: saveTemplate, templateName });
      const res = await runAnalysis(uploadId);
      navigate(`/dashboard/${res.analysisId}`);
    } catch (e) {
      setError(e.message);
      setAnalyzing(false);
    }
  }

  if (loading) return <LoadingState title="업로드 정보를 불러오는 중..." />;
  if (error && !upload) return <div className="error-banner">{error}</div>;
  if (analyzing)
    return (
      <LoadingState
        title="리뷰를 분석하고 있어요"
        desc="상품별 불만을 분류하고 상세페이지 수정안을 만드는 중입니다. 잠시만 기다려 주세요."
      />
    );

  return (
    <div>
      <PageHeader
        title="컬럼 매핑 확인"
        subtitle={`${upload.originalName} · 총 ${upload.rowCount}개 행을 읽었습니다. 자동 매핑 결과를 확인하고 필요하면 수정하세요.`}
      />
      <Stepper current={2} />

      {error && <div className="error-banner">{error}</div>}

      <SectionCard
        title="컬럼이 올바르게 인식됐는지 확인하세요"
        subtitle="* 표시는 필수 항목입니다. 매칭 신뢰도가 낮으면 직접 골라주세요."
      >
        <ColumnMappingTable
          fields={upload.fields}
          headers={upload.headers}
          mapping={mapping}
          suggestion={upload.mappingSuggestion}
          sampleRows={upload.sampleRows}
          onChange={handleChange}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 18,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} />
            이 매핑을 템플릿으로 저장
            {saveTemplate && (
              <input
                type="text"
                placeholder="템플릿 이름 (예: 스마트스토어 기본)"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #d7dded', borderRadius: 7, fontSize: 13 }}
              />
            )}
          </label>
          <div className="page-actions">
            <button className="btn btn--ghost" onClick={() => navigate('/upload')}>
              다시 업로드
            </button>
            <button className="btn btn--primary" onClick={handleConfirm}>
              이 매핑으로 분석하기 →
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
