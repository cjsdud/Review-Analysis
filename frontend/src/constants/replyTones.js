// CS 답글 초안 — 지원 말투(tone). 백엔드 backend/src/constants/replyTones.js 와
// 동일한 키 / 라벨을 사용한다. 두 파일의 key 가 한 글자라도 어긋나면 segmented
// 버튼이 빈 상태가 되거나 tone API 가 INVALID_REPLY_TONE 으로 떨어진다.

export const REPLY_TONES = ['polite', 'friendly', 'concise', 'empathetic', 'professional'];

export const REPLY_TONE_SHORT_LABEL = {
  polite: '정중',
  friendly: '친근',
  concise: '간결',
  empathetic: '공감',
  professional: '전문',
};

export const REPLY_TONE_FULL_LABEL = {
  polite: '정중한 말투',
  friendly: '친근한 말투',
  concise: '간결한 말투',
  empathetic: '공감형 말투',
  professional: '전문적인 말투',
};

export const DEFAULT_REPLY_TONE = 'polite';

export function isValidReplyTone(value) {
  return REPLY_TONES.includes(value);
}
