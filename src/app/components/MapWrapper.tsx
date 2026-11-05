'use client';

import dynamic from 'next/dynamic';

import SiteHeader from './SiteHeader';
import Mark from './Mark';

const loadMap = () => import('./Map');

/**
 * Fetches and runs the map's code (Mapbox included) ahead of time, so opening the map
 * doesn't stall on it while the loader is up. Safe to call more than once.
 */
export function preloadMap() {
    loadMap().catch(() => {});
}

// Mapbox needs the browser, so the map loads on the client. Until it does, the page
// already has its header and the mark drawing itself where the map will be.
const Map = dynamic(loadMap, {
    ssr: false,
    loading: () => (
        <div className="mapshell">
            <SiteHeader current="map" />
            <div className="mapframe">
                <div className="map-loader">
                    <Mark variant="detailed" width={150} />
                    <span className="sr-only">Loading the map</span>
                </div>
            </div>
        </div>
    ),
});

export default Map;
