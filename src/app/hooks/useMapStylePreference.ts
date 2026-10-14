import { useState, useEffect, useCallback } from 'react';

export type BaseMap = 'map' | 'satellite';

const STORAGE_KEY = 'base-map';

export function useMapStylePreference() {
    const [baseMap, setBaseMap] = useState<BaseMap>(() => {
        if (typeof window === 'undefined') return 'map';
        return localStorage.getItem(STORAGE_KEY) === 'satellite' ? 'satellite' : 'map';
    });

    useEffect(() => {
        // Lets the glass controls switch to a plate that reads over imagery.
        document.documentElement.setAttribute('data-base-map', baseMap);
        localStorage.setItem(STORAGE_KEY, baseMap);
    }, [baseMap]);

    const toggle = useCallback(() => {
        setBaseMap(b => b === 'satellite' ? 'map' : 'satellite');
    }, []);

    return [baseMap, toggle] as const;
}
