import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import FileUploader from '../components/FileUploader.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Stepper from '../components/Stepper.jsx';
import PageHeader from '../components/PageHeader.jsx';
import SectionCard from '../components/SectionCard.jsx';
import { uploadFile, uploadSample } from '../api/uploadApi.js';

const SOURCES = [
  { value: 'smartstore', label: '스마트스토어', icon: '🟢' },
  { value: 'cafe24', label: '카페24', icon: '🟠' },
  { value: 'coupang', label: '쿠팡', icon: '🟣' },
  { value: 'custom', label: '자사몰/기타', icon: '🛒' },
];

const REQUIRED_COLUMNS = [
  { name: '상품명', req: '필수', desc: '어떤 상품의 리뷰인지 구분합니다.' },
  { name: '리뷰 내용', req: '필수', desc: '고객이 작성한 실제 리뷰 본문입니다.' },
  { name: '별점', req: '권장', desc: '부정/긍정을 구분하는 데 사용합니다.' },
  { name: '작성일', req: '선택', desc: '월간 트렌드 분석에 사용합니다.' },
  { name: '옵션명', req: '선택', desc: '사이즈·색상 옵션별 이슈 분석에 사용합니다.' },
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

  useEffect(() => {
    if (params.get('sample') === '1') handleSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader
        title="리뷰 파일 업로드"
        subtitle="CSV 또는 XLSX 파일을 올리면 다음 단계에서 컬럼을 자동으로 매핑해 드립니다."
      />
      <Stepper current={1} />

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingState title="파일을 읽고 있어요" desc="컬럼을 자동으로 인식하는 중입니다…" />
      ) : (
        <>
          {/* 빠른 체험 CTA (상단) */}
          <div className="sample-cta">
            <div className="sample-cta__hint">처음이신가요? 샘플 데이터로 어떤 결과가 나오는지 먼저 보세요.</div>
            <button className="btn btn--subtle" onClick={handleSample}>
              📊 샘플 데이터로 체험하기
            </button>
          </div>

          {/* 안내 패널 */}
          <div className="upload-hint">
            <div className="upload-hint__title">어떤 파일을 올리면 되나요?</div>
            <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 14 }}>
              지원 형식: <b>CSV · XLSX</b> (최대 10MB). 아래 컬럼이 포함되어 있으면 자동으로 인식합니다.
            </p>
            <div className="upload-hint__grid">
              {REQUIRED_COLUMNS.map((c) => (
                <div className="upload-hint__item" key={c.name}>
                  <b>
                    {c.name} <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>· {c.req}</span>
                  </b>
                  {c.desc}
                </div>
              ))}
            </div>
            <div className="upload-hint__privacy">
              <span>🔒</span>
              <span>
                주문번호·전화번호·이메일 등은 분석 전에 자동 마스킹됩니다. 분석에는{' '}
                <b>상품명·별점·리뷰 내용</b>만 있으면 충분합니다.
              </span>
            </div>
          </div>

          {/* 플랫폼 선택 */}
          <SectionCard title="어디서 받은 리뷰인가요?" subtitle="플랫폼마다 컬럼명이 달라도 다음 단계에서 자동으로 맞춰 드립니다.">
            <div className="platform-picker">
              {SOURCES.map((s) => (
                <button
                  key={s.value}
                  className={`platform-picker__opt${source === s.value ? ' is-active' : ''}`}
                  onClick={() => setSource(s.value)}
                >
                  <span className="ico">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>
          </SectionCard>

          {/* 업로더 */}
          <div className="mt-4">
            <FileUploader onFile={handleUpload} disabled={loading} />
          </div>

          {/* 하단 샘플 CTA */}
          <div className="sample-cta">
            <div className="sample-cta__hint">파일 준비가 어려우신가요?</div>
            <button className="btn btn--ghost" onClick={handleSample}>
              📊 샘플 데이터로 체험하기
            </button>
          </div>

          {/* 실제 리뷰 파일 검증 안내 */}
          <div className="real-file-hint">
            <div className="real-file-hint__title">실제 리뷰 파일로 테스트하려면</div>
            <ul>
              <li>처음에는 <b>개인정보 컬럼을 삭제한 파일</b>로 테스트해 보셔도 됩니다.</li>
              <li><b>상품명·별점·리뷰 내용</b>만 있어도 분석할 수 있습니다.</li>
              <li>주문번호·전화번호·이메일은 업로드 직후 <b>자동으로 가립니다</b>.</li>
              <li>그래도 신경 쓰이시면 <b>민감한 정보는 업로드 전에 미리 지우는 것</b>을 권장합니다.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
