import { useEffect, useMemo, useState } from 'react';
import { REPLY_TONES, REPLY_TONE_SHORT_LABEL, DEFAULT_REPLY_TONE, allowedReplyTonesForPlan } from '../constants/replyTones.js';
import { generateReplyTemplates } from '../api/analysisApi.js';
import { useAuth } from '../auth/AuthContext.jsx';

// CS 답글 초안 박스 — segmented 컨트롤로 tone 선택, 선택된 tone 1개만 렌더.
//
// 데이터 흐름:
//   1) 분석 시점에는 polite 1개만 미리 생성되어 props.variants 에 들어 있다.
//   2) 사용자가 다른 tone 탭(친근/간결/공감/전문) 을 누르면 /api/ai/reply-templates 로
//      해당 tone 1개만 lazy 요청 — 결과를 templatesByTone 에 캐싱해 같은 tone 재요청 X.
//   3) legacy 데이터(과거 5톤 통째로 저장됨) 는 props.variants 에 모두 들어 있으니
//      lazy fetch 없이 그대로 표시.
//
// props:
//   issueLabel        : string (필수, 표시 + API key)
//   variants          : [{tone, toneLabel, template}] (서버가 미리 생성한 기본 tone — 보통 polite 1개)
//   category?         : string (lazy fetch 컨텍스트)
//   severity?         : 'low'|'medium'|'high'
//   polarity?         : 'negative'|'mixed'|'positive'
//   recommendedAction?: string

export default function ReplyTemplateBox({
  issueLabel,
  variants = [],
  category,
  severity,
  polarity,
  recommendedAction,
}) {
  // 초기 캐시 — props.variants 의 각 tone 을 키로 저장.
  const initialByTone = useMemo(() => {
    const out = {};
    for (const v of variants) {
      const t = v?.tone;
      if (t && REPLY_TONES.includes(t)) out[t] = v;
    }
    return out;
  }, [variants]);
  const [templatesByTone, setTemplatesByTone] = useState(initialByTone);
  // props.variants 가 바뀌면(다른 이슈 카드를 렌더하면) 캐시도 갱신.
  useEffect(() => { setTemplatesByTone(initialByTone); }, [initialByTone]);

  // 첫 선택 tone — variants 안에 polite 가 있으면 polite, 아니면 첫 번째.
  const firstAvailable = variants[0]?.tone;
  const [selectedTone, setSelectedTone] = useState(
    initialByTone[DEFAULT_REPLY_TONE] ? DEFAULT_REPLY_TONE : (firstAvailable || DEFAULT_REPLY_TONE),
  );
  const [loadingTone, setLoadingTone] = useState(null);
  const [errorByTone, setErrorByTone] = useState({});
  const [copied, setCopied] = useState(false);

  // 플랜별 허용 톤 — Free 는 정중(polite) 만, Starter 이상은 5개 전부.
  // billing 미적용/미로그인 환경에서도 안전하게 동작 (planCode 없으면 free 로 간주).
  const { subscription } = useAuth();
  const allowedTones = useMemo(
    () => allowedReplyTonesForPlan(subscription?.planCode),
    [subscription?.planCode],
  );
  const isToneLocked = (t) => !allowedTones.includes(t);

  // 선택한 tone 이 아직 없으면 lazy fetch — 단, 잠긴 톤은 절대 요청하지 않는다.
  useEffect(() => {
    if (!issueLabel) return;
    if (isToneLocked(selectedTone)) return;
    if (templatesByTone[selectedTone]) return;
    if (loadingTone === selectedTone) return;
    let cancelled = false;
    (async () => {
      setLoadingTone(selectedTone);
      setErrorByTone((prev) => ({ ...prev, [selectedTone]: null }));
      try {
        const list = await generateReplyTemplates({
          issueLabel, category, tone: selectedTone,
          recommendedAction, polarity, severity,
        });
        if (cancelled) return;
        const picked = (list || []).find((v) => v?.tone === selectedTone) || list?.[0];
        if (picked) {
          setTemplatesByTone((prev) => ({ ...prev, [selectedTone]: picked }));
        } else {
          setErrorByTone((prev) => ({
            ...prev,
            [selectedTone]: '이 말투의 답글 초안을 만들 수 없었어요. 잠시 후 다시 시도해 주세요.',
          }));
        }
      } catch (e) {
        if (cancelled) return;
        // rate limit / plan 한도 / 권한 등 message 그대로 표시.
        setErrorByTone((prev) => ({
          ...prev,
          [selectedTone]: e?.message || '답글 초안을 불러오지 못했어요.',
        }));
      } finally {
        if (!cancelled) setLoadingTone((cur) => (cur === selectedTone ? null : cur));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTone, issueLabel]);

  const [lockHint, setLockHint] = useState(false);
  const current = templatesByTone[selectedTone];
  const isLoading = loadingTone === selectedTone && !current;
  const error = errorByTone[selectedTone];

  // 탭 클릭 — 허용 톤이면 선택, 잠긴 톤이면 선택하지 않고 업그레이드 안내만.
  function onToneClick(t) {
    if (isToneLocked(t)) {
      setLockHint(true);
      return;
    }
    setLockHint(false);
    setSelectedTone(t);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(current?.template || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (!issueLabel) return null;

  return (
    <div className="reply-box">
      <div className="reply-box__head">
        <div className="reply-box__title">“{issueLabel}”</div>
        {/* h-scroll-snap--inset: 카드 안에 있어 gutter bleed 없이 mobile 가로 스크롤만. */}
        <div className="segmented h-scroll-snap--inset" role="tablist" aria-label="답글 말투 선택">
          {REPLY_TONES.map((t) => {
            const isActive = selectedTone === t;
            const locked = isToneLocked(t);
            const isCached = !!templatesByTone[t];
            const title = locked
              ? `${REPLY_TONE_SHORT_LABEL[t]} 말투 — Starter 이상에서 사용 가능`
              : `${REPLY_TONE_SHORT_LABEL[t]} 말투${isCached ? '' : ' (탭하면 불러옵니다)'}`;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-disabled={locked || undefined}
                className={`segmented__btn${isActive ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
                onClick={() => onToneClick(t)}
                title={title}
              >
                {locked && <span aria-hidden="true">🔒 </span>}
                {REPLY_TONE_SHORT_LABEL[t]}
              </button>
            );
          })}
        </div>
      </div>
      {lockHint && (
        <div className="reply-box__lock-hint">
          정중한 말투 외 다른 말투는 <b>Starter 이상</b>에서 사용할 수 있어요.
        </div>
      )}
      {isLoading ? (
        <div className="reply-box__text muted">답글 초안을 만들고 있어요…</div>
      ) : error ? (
        <div className="reply-box__text" style={{ color: '#b91c1c' }}>{error}</div>
      ) : (
        <div className="reply-box__text">{current?.template || ''}</div>
      )}
      <button
        className="btn btn--ghost btn--sm reply-box__copy"
        onClick={copy}
        disabled={!current?.template}
      >
        {copied ? '✓ 복사됨' : '📋 복사하기'}
      </button>
    </div>
  );
}
