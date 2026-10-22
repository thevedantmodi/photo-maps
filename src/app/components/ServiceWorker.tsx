'use client';

import { useEffect } from 'react';

/** Registers the service worker (public/sw.js) in production, where it makes the site installable. */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
