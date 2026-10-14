'use client';

import { useEffect, useRef, useState } from 'react';

import SubscribeForm from './SubscribeForm';

interface SubscribeButtonProps {
    hidden?: boolean;
}

export default function SubscribeButton({ hidden }: SubscribeButtonProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        const onPointer = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onPointer);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('pointerdown', onPointer);
        };
    }, [open]);

    useEffect(() => {
        if (hidden) setOpen(false);
    }, [hidden]);

    return (
        <div ref={rootRef}>
            <button
                className={`subscribe-btn${hidden ? ' icon-btn-hidden' : ''}`}
                onClick={() => setOpen((o) => !o)}
                aria-label="Subscribe to new photos"
                aria-expanded={open}
                aria-controls="subscribe-popover"
                aria-hidden={hidden}
                tabIndex={hidden ? -1 : 0}
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
            </button>

            {open && (
                <div id="subscribe-popover" className="subscribe-popover" role="dialog" aria-label="Subscribe">
                    <p className="subscribe-title">Get new photos by email</p>
                    <SubscribeForm autoFocus />
                    <p className="subscribe-note">
                        A weekly email, only when there are new photos. Your address is stored with Resend and used
                        for nothing else. Unsubscribe from any email.
                    </p>
                    <a className="subscribe-rss" href="/feed.xml">
                        Or follow the RSS feed
                    </a>
                </div>
            )}
        </div>
    );
}
