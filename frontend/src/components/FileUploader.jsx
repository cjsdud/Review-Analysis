import { useRef, useState } from 'react';

export default function FileUploader({ onFile, disabled }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [fileName, setFileName] = useState('');

  function handleFiles(files) {
    const file = files?.[0];
    if (!file) return;
    setFileName(file.name);
    onFile(file);
  }

  return (
    <div
      className={`uploader${drag ? ' drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <div className="uploader__icon">📄</div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>리뷰 파일을 여기에 끌어다 놓으세요</div>
      <div className="uploader__hint">또는 클릭해서 파일 선택 · CSV / XLSX 지원 (최대 10MB)</div>
      <button className="btn btn--primary" type="button" disabled={disabled}>
        파일 선택
      </button>
      {fileName && <div className="uploader__file">선택됨: {fileName}</div>}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
