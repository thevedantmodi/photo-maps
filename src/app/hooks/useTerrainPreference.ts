import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'terrain';

// 3D terrain costs GPU time and battery. Phones, tablets and weak machines
// start with it off; anyone can turn it on and the choice sticks.
function lowPowerDevice() {
    const nav = navigator as Navigator & { deviceMemory?: number };
    if (window.matchMedia('(pointer: coarse)').matches) return true;
    if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) return true;
    if (nav.deviceMemory && nav.deviceMemory < 4) return true;
    return false;
}

export function useTerrainPreference() {
    const [enabled, setEnabled] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'on') return true;
        if (stored === 'off') return false;
        return !lowPowerDevice();
    });

    const [touched, setTouched] = useState(false);

    useEffect(() => {
        // Only persist an explicit choice, so the device default can still
        // follow the hardware if the user never touches the toggle.
        if (touched) localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    }, [enabled, touched]);

    const toggle = useCallback(() => {
        setTouched(true);
        setEnabled(e => !e);
    }, []);

    return [enabled, toggle] as const;
}
