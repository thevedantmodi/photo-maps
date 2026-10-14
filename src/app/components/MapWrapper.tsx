'use client';

import dynamic from 'next/dynamic';

import SiteHeader from './SiteHeader';
import VMark from './VMark';

// Mapbox needs the browser, so the map loads on the client. Until it does, the page
// already has its header and the V drawing itself where the map will be.
const Map = dynamic(() => import('./Map'), {
    ssr: false,
    loading: () => (
        <div className="mapshell">
            <SiteHeader current="map" />
            <div className="mapframe">
                <div className="map-loader">
                    <VMark width={96} strokeWidth={0.8} />
                    <span className="sr-only">Loading the map</span>
                </div>
            </div>
        </div>
    ),
});

export default Map;
