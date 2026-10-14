'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface YearFilterProps {
  photos: { date?: string | null }[];
  selectedYear: number | null;
  onYearChange: (year: number | null) => void;
}

/** The years as plain words; a pair of brackets slides to the one chosen. */
export default function YearFilter({ photos, selectedYear, onYearChange }: YearFilterProps) {
  const years = useMemo(() => {
    const unique = new Set<number>();
    photos.forEach((p) => {
      if (p.date) unique.add(new Date(p.date).getFullYear());
    });
    return Array.from(unique).sort((a, b) => b - a);
  }, [photos]);

  const options: (number | null)[] = useMemo(() => [null, ...years], [years]);
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

  if (years.length === 0) return null;

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
            {year ?? 'All'}
          </button>
        ))}
      </nav>
    </div>
  );
}
