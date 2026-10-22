import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

// The theme lives on <html data-theme>, set before first paint by the script in
// layout.tsx. This store reads it from there, so every component (and the inline
// script) agrees on one value without a hydration mismatch.

const listeners = new Set<() => void>();

function current(): Theme {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function subscribe(onChange: () => void) {
    listeners.add(onChange);
    return () => {
        listeners.delete(onChange);
    };
}

function apply(theme: Theme) {
    document.documentElement.setAttribute('data-theme', theme);
    listeners.forEach((l) => l());
}

function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Gallery lights: the page dims to black, the theme changes in the dark, then the lights
// come back up. The map's style swap takes a moment, so while a map is mounted
// (data-map-present) the lights wait for its 'pm:map-styled' event, with a cap.
const LIGHTS_DOWN_MS = 180;
const MAP_WAIT_CAP_MS = 900;
let switching = false;

function switchTheme(theme: Theme) {
    try {
        localStorage.setItem('theme', theme);
        localStorage.setItem('theme-manual', '1');
    } catch {
        // Storage unavailable; the choice just won't persist.
    }
    if (theme === current()) return;

    const root = document.documentElement;
    if (reducedMotion()) {
        apply(theme);
        return;
    }
    if (switching) return;
    switching = true;
    root.setAttribute('data-lights', 'off');

    window.setTimeout(() => {
        const lightsUp = () => {
            window.removeEventListener('pm:map-styled', lightsUp);
            window.clearTimeout(cap);
            root.removeAttribute('data-lights');
            switching = false;
        };
        const waitForMap = root.hasAttribute('data-map-present');
        window.addEventListener('pm:map-styled', lightsUp);
        const cap = window.setTimeout(lightsUp, waitForMap ? MAP_WAIT_CAP_MS : 60);
        apply(theme);
    }, LIGHTS_DOWN_MS);
}

export function useTheme() {
    const theme = useSyncExternalStore<Theme>(subscribe, current, () => 'light');

    // Follow the system setting until someone picks a theme by hand.
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
            let manual = false;
            try {
                manual = localStorage.getItem('theme-manual') === '1';
            } catch {
                manual = false;
            }
            if (!manual) apply(e.matches ? 'dark' : 'light');
        };
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    const toggle = useCallback(() => switchTheme(current() === 'dark' ? 'light' : 'dark'), []);
    const set = useCallback((t: Theme) => switchTheme(t), []);

    return [theme, toggle, set] as const;
}
