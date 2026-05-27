import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import FileUploader from '../components/FileUploader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Stepper from '../components/Stepper.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import { uploadFile, uploadSample } from '../api/uploadApi.js';

const SOURCES = [
  { value: 'smartstore', label: '스마트스토어' },
  { value: 'cafe24', label: '카페24' },
  { value: 'coupang', label: '쿠팡' },
  { value: 'custom', label: '자사몰/기타' },
];

export default function UploadPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [source, setSource] = useState('smartstore');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleUpload(file) {
    setError('');
    setLoading(true);
    try {
      const res = await uploadFile(file, source);
      navigate(`/mapping/${res.uploadId}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSample() {
    setError('');
    setLoading(true);
    try {
      const res = await uploadSample();
      navigate(`/mapping/${res.uploadId}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // 랜딩에서 "샘플로 체험하기"로 진입한 경우 자동 실행
  useEffect(() => {
    if (params.get('sample') === '1') handleSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader title="리뷰 파일 업로드" subtitle="CSV / XLSX 파일을 올리면 다음 단계에서 컬럼을 자동으로 매핑해 드립니다." />
      <Stepper current={1} />

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingState title="파일을 분석하고 있어요" desc="컬럼을 자동으로 매핑하는 중입니다..." />
      ) : (
        <>
          <SectionCard
            title="어디서 받은 리뷰인가요?"
            subtitle="플랫폼마다 컬럼명이 달라도 괜찮아요. 전화번호·이메일·주문번호 등 개인정보는 업로드 즉시 자동으로 가려집니다."
            className="upload-source"
          >
            <div className="page-actions">
              {SOURCES.map((s) => (
                <button
                  key={s.value}
                  className={`btn btn--sm ${source === s.value ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setSource(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </SectionCard>

          <div style={{ marginTop: 16 }}>
            <FileUploader onFile={handleUpload} disabled={loading} />
          </div>

          <div style={{ textAlign: 'center', marginTop: 22 }}>
            <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>아직 파일이 없으신가요?</p>
            <button className="btn btn--subtle" onClick={handleSample}>
              📊 샘플 데이터로 체험하기
            </button>
          </div>
        </>
      )}
    </div>
  );
}
