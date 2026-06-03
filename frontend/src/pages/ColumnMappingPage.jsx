import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ColumnMappingTable from '../components/ColumnMappingTable.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Stepper from '../components/Stepper.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import SheetSelector from '../components/SheetSelector.jsx';
import { getUpload, saveMapping, reparseUpload } from '../api/uploadApi.js';
import { runAnalysis } from '../api/analysisApi.js';
import AnalysisModeSelector from '../components/AnalysisModeSelector.jsx';
import { defaultAnalysisModeFor } from '../constants/analysisModes.js';
import { useAuth } from '../auth/AuthContext.jsx';

const SOURCE_LABELS = {
  smartstore: '스마트스토어',
  cafe24: '카페24',
  coupang: '쿠팡',
};

export default function ColumnMappingPage() {
  const { uploadId } = useParams();
  const navigate = useNavigate();

  const [upload, setUpload] = useState(null);
  const [mapping, setMapping] = useState({});
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [error, setError] = useState('');
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  // 분석 방식 선택 — 사용자 플랜 기본값으로 초기화. AuthContext 의 subscription.planCode 사용.
  const { subscription } = useAuth();
  const userPlan = subscription?.planCode || 'free';
  const [analysisMode, setAnalysisMode] = useState(() => defaultAnalysisModeFor(userPlan));

  function applyUpload(data) {
    setUpload(data);
    const initial = {};
    for (const field of data.fields) {
      initial[field] = data.mappingSuggestion?.[field]?.column || '';
    }
    setMapping(initial);
  }

  useEffect(() => {
    (async () => {
      try {
        const data = await getUpload(uploadId);
        applyUpload(data);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [uploadId]);

  async function handleSheetChange(sheetName) {
    if (!sheetName || sheetName === upload.selectedSheetName) return;
    setReparsing(true);
    setError('');
    try {
      const data = await reparseUpload(uploadId, { sheetName });
      applyUpload(data);
    } catch (e) {
      setError(`시트 변경 실패: ${e.message}`);
    } finally {
      setReparsing(false);
    }
  }

  async function handleHeaderRowChange(headerRowIndex) {
    if (headerRowIndex === upload.selectedHeaderRowIndex) return;
    setReparsing(true);
    setError('');
    try {
      const data = await reparseUpload(uploadId, { headerRowIndex });
      applyUpload(data);
    } catch (e) {
      setError(`헤더 행 변경 실패: ${e.message}`);
    } finally {
      setReparsing(false);
    }
  }

  function handleChange(field, value) {
    setMapping((prev) => ({ ...prev, [field]: value }));
  }

  async function handleConfirm() {
    setError('');
    // 필수 필드: 리뷰 내용 + 별점. 둘 중 하나라도 빠지면 분석 품질이 떨어지므로 차단.
    const missing = [];
    if (!mapping.content) missing.push('리뷰 내용');
    if (!mapping.rating) missing.push('별점');
    if (missing.length) {
      setError(`${missing.join('과 ')} 컬럼은 반드시 선택해야 합니다.`);
      return;
    }
    setAnalyzing(true);
    try {
      await saveMapping(uploadId, mapping, { saveAsTemplate: saveTemplate, templateName });
      // 분석은 백그라운드로 시작됨 — 응답에는 analysisId 만 들어 있고 상태는 processing.
      // 대시보드 대신 히스토리로 보내서 사용자가 진행률을 보고 완료 후 리포트로 이동하게 함.
      const res = await runAnalysis(uploadId, { analysisMode });
      navigate(`/history?highlight=${encodeURIComponent(res.analysisId)}`);
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

  const hasMultipleSheets = (upload.sheets || []).length >= 2;
  const productNameMissing = !mapping.productName;
  const sourceLabel = SOURCE_LABELS[upload.source] || null;

  return (
    <div>
      <PageHeader
        title="리뷰 파일의 컬럼을 확인해주세요"
        subtitle={`${upload.originalName} · 총 ${upload.rowCount}개 리뷰를 읽었습니다.`}
      />
      <Stepper current={2} />

      {error && <div className="error-banner">{error}</div>}

      {productNameMissing && (
        <div className="warn-banner" role="alert">
          <div className="warn-banner__title">⚠ 상품명 컬럼이 선택되지 않았습니다.</div>
          <div className="warn-banner__desc">
            상품별 리포트를 보려면 상품명 컬럼을 선택하는 것을 권장합니다.
            상품명 없이 진행하면 모든 리뷰가 ‘미지정 상품’으로 묶일 수 있습니다.
          </div>
        </div>
      )}

      {sourceLabel && (
        <div className="hint-banner">
          <strong>{sourceLabel}</strong> 양식을 기준으로 컬럼을 자동 추정했습니다.
          실제 엑셀 양식은 판매자센터 설정이나 다운로드 방식에 따라 달라질 수 있으니
          분석 전 꼭 확인해 주세요.
        </div>
      )}

      {hasMultipleSheets && (
        <SectionCard
          title="엑셀 파일의 시트 선택"
          subtitle="엑셀 파일에 여러 시트가 있습니다. 리뷰 데이터가 들어 있는 시트를 선택해주세요."
        >
          <SheetSelector
            sheets={upload.sheets}
            selectedSheetName={upload.selectedSheetName}
            selectedHeaderRowIndex={upload.selectedHeaderRowIndex}
            disabled={reparsing}
            onSheetChange={handleSheetChange}
            onHeaderRowChange={handleHeaderRowChange}
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            컬럼명이 실제와 다르면 ‘컬럼명으로 사용할 행’을 바꿔주세요.
          </p>
        </SectionCard>
      )}

      <SectionCard
        title="자동으로 컬럼을 추정했어요"
        subtitle={
          hasMultipleSheets
            ? '자동으로 리뷰 데이터 시트와 컬럼명 행을 추정했습니다. 다른 시트에 리뷰가 있다면 위에서 변경할 수 있습니다.'
            : "틀린 항목이 있으면 직접 바꿔주세요. '필수' 표시 항목은 반드시 선택해야 합니다."
        }
      >
        {reparsing ? (
          <LoadingState title="시트를 다시 읽는 중..." />
        ) : (
          <ColumnMappingTable
            fields={upload.fields}
            headers={upload.headers}
            mapping={mapping}
            suggestion={upload.mappingSuggestion}
            sampleRows={upload.sampleRows}
            onChange={handleChange}
          />
        )}

        <AnalysisModeSelector
          value={analysisMode}
          onChange={setAnalysisMode}
          userPlan={userPlan}
          totalReviews={upload.rowCount || 0}
        />

        <div className="mapping-footer">
          <label className="mapping-footer__save">
            <input type="checkbox" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} />
            이 매핑을 다음에도 쓰게 저장
            {saveTemplate && (
              <input
                type="text"
                placeholder="템플릿 이름 (예: 스마트스토어 기본)"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
            )}
          </label>
          <div className="page-actions">
            <button className="btn btn--ghost" onClick={() => navigate('/upload')}>
              다시 업로드
            </button>
            <button className="btn btn--primary" onClick={handleConfirm} disabled={reparsing}>
              이대로 분석하기 →
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
