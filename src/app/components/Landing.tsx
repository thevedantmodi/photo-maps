'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import SiteHeader, { openSubscribe } from './SiteHeader';

const ROWS = [0, 1, 2, 3];

/** How long the rows take to slide off before the map takes over. */
const LEAVE_MS = 420;

interface LandingProps {
  photoUrl: string | null;
  years: { from: number; to: number } | null;
}

/**
 * The entrance: the title four times over, each line stepping right and fading like an
 * echo, then Enter. The intro is pure CSS (globals.css, "Landing"); this component only
 * handles leaving for the map.
 */
export default function Landing({ photoUrl, years }: LandingProps) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  // Photos used to open at /#<slug>. Those links live on in old messages, so send them on.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    let slug = hash;
    try {
      slug = decodeURIComponent(hash);
    } catch {
      // Malformed escape; use it as typed.
    }
    router.replace(`/p/${encodeURIComponent(slug)}`);
  }, [router]);

  useEffect(() => {
    router.prefetch('/map');
  }, [router]);

  const enter = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let modified clicks open a new tab as usual.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (leaving) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      router.push('/map');
      return;
    }
    setLeaving(true);
    window.setTimeout(() => router.push('/map'), LEAVE_MS);
  };

  return (
    <main className="landing" data-leaving={leaving}>
      <SiteHeader current="landing" />

      <section className="landing-hero">
        {/* The V: two plain lines in percentages, so it spans the hero at any size without
            stretching its stroke. Each draws in turn, top-left down, then back up. */}
        <svg className="landing-v" aria-hidden="true">
          <line x1="0" y1="0" x2="50%" y2="100%" pathLength={1} />
          <line x1="50%" y1="100%" x2="100%" y2="0" pathLength={1} />
        </svg>

        <h1 className="sr-only">Photos by Vedant Modi</h1>
        <div className="landing-rows" aria-hidden="true">
          {ROWS.map((i) => (
            <span key={i} className="landing-row" style={{ '--i': i } as React.CSSProperties}>
              <span>Photos by</span>
              <span>Vedant Modi</span>
            </span>
          ))}
        </div>

        <Link href="/map" className="landing-enter" onClick={enter}>
          Enter <span className="arrow" aria-hidden="true">→</span>
        </Link>

        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- served from R2, already sized
          <img className="landing-photo" src={photoUrl} alt="" />
        )}
      </section>

      <footer className="landing-foot">
        <span>
          {years && (
            <>
              <span className="k">Years:</span>
              {years.from === years.to ? years.from : `${years.from}–${years.to}`}
            </>
          )}
        </span>
        <span>
          <button type="button" className="text-btn ul" onClick={openSubscribe}>
            <b>Subscribe →</b>
          </button>
        </span>
      </footer>
    </main>
  );
}
