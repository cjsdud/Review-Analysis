import { useState } from 'react';

const TONE_ORDER = ['기본', '정중', '친근'];

export default function ReplyTemplateBox({ issueLabel, variants = [] }) {
  const tones = TONE_ORDER.filter((t) => variants.some((v) => v.tone === t));
  const [active, setActive] = useState(tones[0] || (variants[0]?.tone ?? '기본'));
  const [copied, setCopied] = useState(false);

  const current = variants.find((v) => v.tone === active) || variants[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(current?.template || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (!variants.length) return null;

  return (
    <div className="reply-box">
      <div style={{ fontWeight: 700, marginBottom: 10 }}>“{issueLabel}” 답글 초안</div>
      <div className="reply-box__tones">
        {(tones.length ? tones : [current?.tone]).map((t) => (
          <button key={t} className={`reply-box__tone${active === t ? ' active' : ''}`} onClick={() => setActive(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="reply-box__text">{current?.template}</div>
      <button className="btn btn--ghost btn--sm reply-box__copy" onClick={copy}>
        {copied ? '✓ 복사됨' : '복사하기'}
      </button>
    </div>
  );
}
