import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import FileUploader from '../components/FileUploader.jsx';
import LoadingState from '../components/LoadingState.jsx';
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
      <div className="steps">
        <div className="steps__item active">
          <span className="steps__num">1</span> 업로드
        </div>
        <span className="steps__arrow">→</span>
        <div className="steps__item">
          <span className="steps__num">2</span> 컬럼 매핑
        </div>
        <span className="steps__arrow">→</span>
        <div className="steps__item">
          <span className="steps__num">3</span> 분석 결과
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingState title="파일을 분석하고 있어요" desc="컬럼을 자동으로 매핑하는 중입니다..." />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="section-title">어디서 받은 리뷰인가요?</div>
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
            <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
              플랫폼마다 컬럼명이 달라도 괜찮아요. 다음 단계에서 자동으로 매핑해 드립니다. 전화번호·이메일·주문번호
              등 개인정보는 자동으로 가려집니다.
            </p>
          </div>

          <FileUploader onFile={handleUpload} disabled={loading} />

          <div style={{ textAlign: 'center', marginTop: 22 }}>
            <p className="muted" style={{ fontSize: 13 }}>아직 파일이 없으신가요?</p>
            <button className="btn btn--ghost" onClick={handleSample}>
              📊 샘플 데이터로 체험하기
            </button>
          </div>
        </>
      )}
    </div>
  );
}
