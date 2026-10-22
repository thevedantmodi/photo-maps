'use client';

import { useEffect, useRef } from 'react';

import RssIcon from './RssIcon';
import SubscribeForm from './SubscribeForm';

/** Unfolds under the header menu. Double opt-in through /api/subscribe, as before. */
export default function SubscribePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // After the unfold has started, so the focus ring doesn't flash at the old position.
    const id = window.setTimeout(() => inputRef.current?.focus(), 120);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inside = rootRef.current?.contains(document.activeElement);
      onClose();
      // Back to the Subscribe button that opened it (the menu's or the header's, whichever
      // is showing), rather than to the top of the page.
      if (inside) {
        requestAnimationFrame(() => {
          const opener = [...document.querySelectorAll<HTMLElement>('[aria-controls="subscribe-panel"]')].find(
            (el) => el.offsetParent !== null,
          );
          opener?.focus();
        });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  return (
    <div
      id="subscribe-panel"
      ref={rootRef}
      className="sub-panel"
      data-open={open}
      role="region"
      aria-label="Subscribe"
      inert={!open}
    >
      <p className="sub-title">New photos by email.</p>
      <SubscribeForm ref={inputRef} />
      <p className="sub-note">
        At most once a week, only when there are new photos. Your address is kept by my email
        service and used for nothing else. Or follow the{' '}
        <a href="/feed.xml" className="ul sub-rss">
          <RssIcon />
          RSS feed
        </a>
        .
      </p>
    </div>
  );
}
