import { Fragment } from 'react';

const STEPS = ['업로드', '컬럼 매핑', '분석 결과'];

// current: 1 | 2 | 3 — 현재 진행 단계
export default function Stepper({ current = 1 }) {
  return (
    <div className="stepper">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const cls = n < current ? 'is-done' : n === current ? 'is-active' : '';
        return (
          <Fragment key={label}>
            <div className={`stepper__item ${cls}`}>
              <span className="stepper__dot">{n < current ? '✓' : n}</span>
              <span className="stepper__label">{label}</span>
            </div>
            {i < STEPS.length - 1 && <span className="stepper__bar" />}
          </Fragment>
        );
      })}
    </div>
  );
}
