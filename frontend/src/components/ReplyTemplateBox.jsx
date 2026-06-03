import { useState } from 'react';

// 5 tone segmented 컨트롤 순서 + 한국어 라벨. 백엔드 buildReplyTemplates 가 같은 키를
// 발행하고, legacy '기본/정중/친근' 키도 normalizeReplyTone 으로 흡수된다.
const TONE_ORDER = ['polite', 'friendly', 'concise', 'empathetic', 'professional'];
const TONE_LABELS = {
  polite: '정중',
  friendly: '친근',
  concise: '간결',
  empathetic: '공감',
  professional: '전문',
  // legacy 데이터(분석이 이전 코드로 만들어진 경우) — 같은 칸에 표시.
  기본: '정중',
  정중: '정중',
  친근: '친근',
};

export default function ReplyTemplateBox({ issueLabel, variants = [] }) {
  // variants 에 들어 있는 tone 만 노출 — 새 분석은 5 종, legacy 는 3 종.
  const tones = TONE_ORDER.filter((t) => variants.some((v) => v.tone === t));
  // legacy 한글 tone 만 있고 신규 키가 하나도 없으면 그것도 표시.
  const fallbackLegacy = tones.length === 0
    ? [...new Set(variants.map((v) => v.tone).filter(Boolean))]
    : tones;
  const displayTones = fallbackLegacy;
  const [active, setActive] = useState(displayTones[0] || (variants[0]?.tone ?? 'polite'));
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
      <div className="reply-box__head">
        <div className="reply-box__title">“{issueLabel}”</div>
        <div className="segmented">
          {(displayTones.length ? displayTones : [current?.tone]).map((t) => (
            <button
              key={t}
              type="button"
              className={`segmented__btn${active === t ? ' is-active' : ''}`}
              onClick={() => setActive(t)}
              title={`${TONE_LABELS[t] || t} 말투`}
            >
              {TONE_LABELS[t] || t}
            </button>
          ))}
        </div>
      </div>
      <div className="reply-box__text">{current?.template}</div>
      <button className="btn btn--ghost btn--sm reply-box__copy" onClick={copy}>
        {copied ? '✓ 복사됨' : '📋 복사하기'}
      </button>
    </div>
  );
}
