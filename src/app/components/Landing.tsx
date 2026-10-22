'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import Reveal from './Reveal';
import SiteHeader, { openSubscribe } from './SiteHeader';

const ROWS = [0, 1, 2, 3];

/** How long the rows take to slide off before the map takes over. */
const LEAVE_MS = 420;

export interface RecentPhoto {
  slug: string;
  title: string;
  year: number | null;
  url: string;
}

interface LandingProps {
  /** The photo in front of the title, and the object-position that crops it. */
  photo: { url: string; position: string } | null;
  years: { from: number; to: number } | null;
  recent: RecentPhoto[];
}

/** Printer's crop marks at the corners of the first screen, like an art book's proof. */
function CropMarks() {
  return (
    <div className="crop-marks" aria-hidden="true">
      {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
        <svg key={corner} className={`crop crop-${corner}`} width="28" height="28" viewBox="0 0 28 28">
          <line x1="0" y1="10" x2="18" y2="10" pathLength={1} />
          <line x1="10" y1="0" x2="10" y2="18" pathLength={1} />
        </svg>
      ))}
    </div>
  );
}

/**
 * The entrance: the title four times over, each line stepping right and fading like an
 * echo, then Enter. Below the first screen, the newest photographs develop as they scroll
 * into view, the years rule themselves out, and Enter comes round again. The intro and
 * scroll animations are CSS (globals.css, "Landing" and "Scroll reveals"); this component
 * handles leaving for the map.
 */
export default function Landing({ photo, years, recent }: LandingProps) {
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
    // ?intro (for screen recordings) carries through to the map, which then plays its loader in full.
    const href = new URLSearchParams(window.location.search).has('intro') ? '/map?intro' : '/map';
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      router.push(href);
      return;
    }
    setLeaving(true);
    window.setTimeout(() => router.push(href), LEAVE_MS);
  };

  const span = years ? (years.from === years.to ? String(years.from) : `${years.from}–${years.to}`) : null;

  return (
    <main className="landing" data-leaving={leaving}>
      <div className="landing-first">
        <SiteHeader current="landing" />

        <section className="landing-hero">
          <CropMarks />

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

          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- served from R2, already sized
            <img className="landing-photo" src={photo.url} alt="" style={{ objectPosition: photo.position }} />
          )}
        </section>

        <footer className="landing-foot">
          <span>
            {span && (
              <>
                <span className="k">Years:</span>
                {span}
              </>
            )}
          </span>
          <span>
            <button type="button" className="text-btn ul" onClick={openSubscribe}>
              <b>Subscribe →</b>
            </button>
          </span>
        </footer>
      </div>

      {recent.length > 0 && (
        <section className="landing-recent" aria-labelledby="recent-title">
          <Reveal variant="draw" className="landing-section-head">
            <h2 id="recent-title" className="label">
              Recent
            </h2>
          </Reveal>
          <ul className="recent-grid">
            {recent.map((p, i) => (
              <li key={p.slug}>
                <Reveal variant="develop" delay={(i % 4) * 90}>
                  <Link href={`/p/${encodeURIComponent(p.slug)}`} className="recent-item">
                    {/* eslint-disable-next-line @next/next/no-img-element -- served from R2, already sized */}
                    <img src={p.url} alt="" loading="lazy" />
                    <span className="recent-caption">
                      <span className="recent-title">{p.title}</span>
                      {p.year !== null && <span className="recent-year">({p.year})</span>}
                    </span>
                  </Link>
                </Reveal>
              </li>
            ))}
          </ul>
        </section>
      )}

      {years && years.from !== years.to && (
        <section className="landing-years" aria-label={`Photographs from ${span}`}>
          <Reveal variant="rise" className="years-span">
            <span className="year-big">{years.from}</span>
            <span className="year-line" aria-hidden="true" />
            <span className="year-big">{years.to}</span>
          </Reveal>
        </section>
      )}

      <section className="landing-cta">
        <Reveal variant="draw">
          <Link href="/map" className="cta-enter" onClick={enter}>
            Enter the map <span className="arrow" aria-hidden="true">→</span>
          </Link>
        </Reveal>
        <Reveal variant="rise" delay={120}>
          <p className="cta-also">
            Or browse the <Link href="/directory" className="ul">directory</Link> of places.
          </p>
        </Reveal>
      </section>
    </main>
  );
}
