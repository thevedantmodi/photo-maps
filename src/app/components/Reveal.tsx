'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * True once the element has scrolled into view (and stays true), for scroll-in
 * animations. The CSS does the moving; see "Scroll reveals" in globals.css.
 */
export function useInView<T extends Element>(rootMargin = '0px 0px -12% 0px') {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin, threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView] as const;
}

type Variant = 'rise' | 'develop' | 'draw';

/**
 * A block that animates in as it scrolls into view: `rise` slides up, `develop`
 * reveals top to bottom like a print, `draw` rules a line under it left to right.
 */
export default function Reveal({
  variant = 'rise',
  delay = 0,
  className,
  children,
}: {
  variant?: Variant;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={className ? `reveal ${className}` : 'reveal'}
      data-reveal={variant}
      data-in={inView}
      style={{ '--delay': `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
