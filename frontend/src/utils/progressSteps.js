// 분석 진행 단계(progressStep) → 사용자에게 보여줄 문구.
// 백엔드 reporter / runAnalysis / classifyAll 의 step 이름을 그대로 키로 사용.
// LLM / token / API 같은 내부 표현은 노출하지 않는다.
export const PROGRESS_STEP_LABELS = {
  job_started: '분석 작업을 준비하고 있어요',
  preprocessing_reviews: '리뷰 내용을 정리하고 있어요',
  classifying_reviews: '리뷰 반응을 분류하고 있어요',
  classifying_ambiguous_pending: '애매한 리뷰의 맥락을 다시 확인하고 있어요',
  classifying_ambiguous_done: '리뷰 맥락 확인이 끝났어요',
  classification_done: '리뷰 분류가 끝났어요',
  ai_reanalysis_pending: '애매한 리뷰를 더 자세히 확인하고 있어요',
  ai_reanalysis_done: '리뷰 재확인이 끝났어요',
  building_issue_clusters: '반복되는 이슈를 정리하고 있어요',
  clusters_built: '반복 이슈 정리가 끝났어요',
  product_summaries: '상품별 요약을 만들고 있어요',
  product_summaries_done: '상품별 요약이 끝났어요',
  building_overall_summary: '전체 리포트 요약을 만들고 있어요',
  building_period_comparison: '기간별 리뷰 변화를 계산하고 있어요',
  finalizing: '리포트를 마무리하고 있어요',
  saving_report: '리포트를 저장하고 있어요',
  completed: '분석이 완료됐어요',
  processing: '분석을 계속 진행하고 있어요',
};

export function progressStepLabel(step) {
  if (!step) return null;
  return PROGRESS_STEP_LABELS[step] || null;
}

// progressMeta(processedReviews / totalReviews / processedProducts / ...) → 짧은 보조 문구.
// 예: "240 / 500개 리뷰 처리 중" 또는 "3 / 10개 상품 완료".
export function progressMetaText(meta) {
  if (!meta || typeof meta !== 'object') return null;
  if (meta.processedReviews != null && meta.totalReviews) {
    return `${meta.processedReviews.toLocaleString()} / ${meta.totalReviews.toLocaleString()}개 리뷰 처리 중`;
  }
  if (meta.processedProducts != null && meta.totalProducts) {
    return `${meta.processedProducts} / ${meta.totalProducts}개 상품 완료`;
  }
  if (meta.processedLlmTasks != null && meta.totalLlmTasks) {
    return `${meta.processedLlmTasks} / ${meta.totalLlmTasks}개 작업 완료`;
  }
  return null;
}
