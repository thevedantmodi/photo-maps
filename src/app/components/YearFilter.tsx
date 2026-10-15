'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { UNDATED, yearOf } from '@/lib/yearParam';

interface YearFilterProps {
  photos: { date?: string | null }[];
  selectedYear: number | null;
  onYearChange: (year: number | null) => void;
}

/**
 * The years as plain words; a pair of brackets slides to the one chosen. Photos with no
 * date taken get "Undated" at the end, so they can be found too.
 */
export default function YearFilter({ photos, selectedYear, onYearChange }: YearFilterProps) {
  const { years, undated } = useMemo(() => {
    const unique = new Set<number>();
    let undated = false;
    photos.forEach((p) => {
      const y = yearOf(p);
      if (y === UNDATED) undated = true;
      else unique.add(y);
    });
    return { years: Array.from(unique).sort((a, b) => b - a), undated };
  }, [photos]);

  const options: (number | null)[] = useMemo(
    () => [null, ...years, ...(undated ? [UNDATED] : [])],
    [years, undated],
  );
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);

  const index = Math.max(0, options.indexOf(selectedYear));

  useLayoutEffect(() => {
    const measure = () => {
      const el = buttons.current[index];
      if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [index, options]);

  if (options.length < 2) return null;

  return (
    <div className="years">
      <span className="label years-label" aria-hidden="true">
        Year
      </span>
      <nav className="years-list" aria-label="Filter by year">
        {box && (
          <span
            className="years-brackets"
            aria-hidden="true"
            style={{ transform: `translateX(${box.x}px)`, width: box.w }}
          >
            <span>(</span>
            <span>)</span>
          </span>
        )}
        {options.map((year, i) => (
          <button
            key={year ?? 'all'}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            className="years-btn"
            aria-pressed={year === selectedYear}
            onClick={() => onYearChange(year)}
          >
            {year === null ? 'All' : year === UNDATED ? 'Undated' : year}
          </button>
        ))}
      </nav>
    </div>
  );
}
