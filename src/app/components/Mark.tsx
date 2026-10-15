'use client';

import { useEffect, useRef } from 'react';

import {
  CAMERA,
  CAMERA_VIEW as VIEW,
  equatorPath,
  globeRadius,
  knurlPath,
  meridianArcPath,
} from '@/lib/cameraMark';

/** Fired on window when a photo opens: every header camera takes the shot. */
export const SHUTTER_EVENT = 'pm:shutter';

export function fireShutter() {
  window.dispatchEvent(new Event(SHUTTER_EVENT));
}

/**
 * The mark: a compact camera seen from the front, its lens a globe — photographs, mapped.
 *
 * `header` is the small version beside the name: body, grip, the three controls on top,
 * and the lens. `detailed` adds the dial's knurling, the AF lamp, the lens release and the
 * inner lens ring, for the map loader. As the loader it draws itself and the globe turns
 * (globals.css, "The mark"). Beside the name, the shutter clicks on hover and whenever a
 * photo opens.
 */
export default function Mark({
  variant = 'header',
  width = 30,
  className,
}: {
  variant?: 'header' | 'detailed';
  width?: number;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const detailed = variant === 'detailed';
  // Stroke widths are in grid units, so a small mark gets relatively heavier lines.
  const sw = detailed ? (width > 120 ? 0.9 : 1.1) : 2.2;
  const globe = globeRadius(detailed);
  const { lens } = CAMERA;
  // The turning meridians keep their weight while squashed, so they're set in pixels.
  const arcPx = (sw * 0.85 * width) / VIEW.w;

  useEffect(() => {
    if (detailed) return;
    const svg = ref.current;
    if (!svg) return;
    const click = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      svg.querySelector('.cam-shutter')?.animate(
        [{ transform: 'none' }, { transform: 'translateY(1.2px)', offset: 0.35 }, { transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
      svg.querySelector('.cam-meridian')?.animate(
        [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.02)' }, { transform: 'scaleX(-1)' }],
        { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    };
    window.addEventListener(SHUTTER_EVENT, click);
    const link = svg.closest('a');
    link?.addEventListener('pointerenter', click);
    return () => {
      window.removeEventListener(SHUTTER_EVENT, click);
      link?.removeEventListener('pointerenter', click);
    };
  }, [detailed]);

  // Every stroke can be drawn on: the loader animates the dash, in this order.
  let order = 0;
  const line = (extra?: string) => ({
    pathLength: 1,
    className: extra ? `cam-line ${extra}` : 'cam-line',
    style: { '--i': order++ } as React.CSSProperties,
  });

  return (
    <svg
      ref={ref}
      className={['mark', `mark-${variant}`, className].filter(Boolean).join(' ')}
      width={width}
      height={(width * VIEW.h) / VIEW.w}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      strokeWidth={sw}
      aria-hidden="true"
    >
      <path {...line()} d={CAMERA.body} />
      <path {...line()} d={CAMERA.grip} strokeWidth={sw * 0.8} />
      <rect {...line('cam-shutter')} {...CAMERA.shutter} strokeWidth={sw * 0.85} />
      <rect {...line()} {...CAMERA.modeDial} strokeWidth={sw * 0.85} />
      {detailed && <path {...line()} d={knurlPath(width > 60 ? 13 : 7)} strokeWidth={sw * 0.38} />}
      <rect {...line()} {...CAMERA.smallDial} strokeWidth={sw * 0.85} />
      {detailed && (
        <>
          <circle {...line()} {...CAMERA.afLamp} strokeWidth={sw * 0.7} />
          <circle {...line()} {...CAMERA.lensRelease} strokeWidth={sw * 0.7} />
        </>
      )}
      <circle {...line()} {...lens} />
      {detailed && <circle {...line()} cx={lens.cx} cy={lens.cy} r={lens.r - 2.2} strokeWidth={sw * 0.7} />}
      <circle {...line()} cx={lens.cx} cy={lens.cy} r={globe} />
      <path {...line()} d={equatorPath(globe)} strokeWidth={sw * 0.85} />
      <ellipse {...line('cam-meridian')} cx={lens.cx} cy={lens.cy} rx={globe * 0.42} ry={globe} strokeWidth={sw * 0.85} />
      {detailed &&
        [1, 2].map((n) => (
          <path
            key={n}
            className={`cam-arc cam-arc-${n}`}
            d={meridianArcPath(globe)}
            strokeWidth={arcPx}
            vectorEffect="non-scaling-stroke"
          />
        ))}
    </svg>
  );
}
