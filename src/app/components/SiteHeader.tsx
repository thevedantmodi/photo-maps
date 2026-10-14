'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import SubscribePanel from './SubscribePanel';
import ThemeSwitch from './ThemeSwitch';
import VMark from './VMark';

export type Section = 'landing' | 'map' | 'directory' | 'photo';

/** Anything on the page can open the subscribe form under the menu with this event. */
export const OPEN_SUBSCRIBE_EVENT = 'pm:open-subscribe';

export function openSubscribe() {
  window.dispatchEvent(new Event(OPEN_SUBSCRIBE_EVENT));
}

interface SiteHeaderProps {
  current: Section;
  /** Map tools (search, 3D terrain), in the columns between the menu and the theme. */
  tools?: React.ReactNode;
  /** Extra entries for the phone menu. */
  menuExtra?: React.ReactNode;
}

/**
 * One ruled bar on every page: the V and name, the stacked menu, optional tools, and
 * Light | Dark. On a phone the menu folds behind a Menu button.
 */
export default function SiteHeader({ current, tools, menuExtra }: SiteHeaderProps) {
  const [subOpen, setSubOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  const closeSub = useCallback(() => setSubOpen(false), []);

  useEffect(() => {
    const open = () => {
      setMenuOpen(false);
      setSubOpen(true);
    };
    window.addEventListener(OPEN_SUBSCRIBE_EVENT, open);
    return () => window.removeEventListener(OPEN_SUBSCRIBE_EVENT, open);
  }, []);

  // A click anywhere outside the header folds the menu and the subscribe form away.
  useEffect(() => {
    if (!subOpen && !menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setSubOpen(false);
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [subOpen, menuOpen]);

  const navLinks = (
    <>
      <Link href="/map" className="ul" aria-current={current === 'map' ? 'page' : undefined}>
        Galleries
      </Link>
      <Link
        href="/directory"
        className="ul"
        aria-current={current === 'directory' ? 'page' : undefined}
      >
        Directory
      </Link>
      <button
        type="button"
        className="text-btn ul"
        aria-expanded={subOpen}
        aria-controls="subscribe-panel"
        onClick={() => {
          setMenuOpen(false);
          setSubOpen((o) => !o);
        }}
      >
        Subscribe
      </button>
      <a href="/feed.xml" className="ul">
        RSS feed
      </a>
    </>
  );

  return (
    <header className="sh" ref={rootRef}>
      <Link href="/" className="sh-logo" aria-label="Vedant Modi, home">
        <VMark />
        <span aria-hidden="true">Vedant Modi</span>
      </Link>

      <nav className="sh-nav" aria-label="Site">
        {navLinks}
      </nav>

      <div className="sh-tools">{tools}</div>

      <ThemeSwitch className="sh-theme" />

      <button
        type="button"
        className="text-btn sh-menu-btn"
        aria-expanded={menuOpen}
        aria-controls="site-menu"
        onClick={() => {
          setSubOpen(false);
          setMenuOpen((o) => !o);
        }}
      >
        {menuOpen ? 'Close' : 'Menu'}
      </button>

      <nav id="site-menu" className="sh-menu" data-open={menuOpen} aria-label="Menu" inert={!menuOpen}>
        {navLinks}
        {menuExtra}
        <ThemeSwitch />
      </nav>

      <SubscribePanel open={subOpen} onClose={closeSub} />
    </header>
  );
}
