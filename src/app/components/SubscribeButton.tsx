'use client';

import { useEffect, useRef, useState } from 'react';

interface SubscribeButtonProps {
    hidden?: boolean;
}

type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function SubscribeButton({ hidden }: SubscribeButtonProps) {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<Status>('idle');
    const [error, setError] = useState('');
    const [alreadySent, setAlreadySent] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        inputRef.current?.focus();
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

    const submit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setStatus('sending');
        setError('');
        const website = new FormData(e.currentTarget).get('website');
        try {
            const res = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, website }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error(body?.error ?? 'Something went wrong, try again');
            setAlreadySent(Boolean(body?.alreadySent));
            setStatus('sent');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong, try again');
            setStatus('error');
        }
    };

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
                    {status === 'sent' ? (
                        <p className="subscribe-note">
                            {alreadySent
                                ? 'We sent a confirmation link to this address in the last 10 minutes. Check your inbox and spam, or try again later.'
                                : "Check your inbox for a confirmation link. You won't get anything until you click it."}
                        </p>
                    ) : (
                        <form className="subscribe-form" onSubmit={submit}>
                            <input
                                ref={inputRef}
                                className="subscribe-input"
                                type="email"
                                required
                                autoComplete="email"
                                placeholder="you@example.com"
                                aria-label="Email address"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            {/* Honeypot, hidden from people and screen readers. */}
                            <input
                                type="text"
                                name="website"
                                tabIndex={-1}
                                autoComplete="off"
                                aria-hidden="true"
                                className="subscribe-honeypot"
                            />
                            <button className="subscribe-submit" type="submit" disabled={status === 'sending'}>
                                {status === 'sending' ? 'Sending…' : 'Subscribe'}
                            </button>
                        </form>
                    )}
                    {status === 'error' && (
                        <p className="subscribe-error" role="alert">
                            {error}
                        </p>
                    )}
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
