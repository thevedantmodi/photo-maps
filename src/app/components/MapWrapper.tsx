'use client';

import dynamic from 'next/dynamic';

import SiteHeader from './SiteHeader';
import Mark from './Mark';

// Mapbox needs the browser, so the map loads on the client. Until it does, the page
// already has its header and the mark drawing itself where the map will be.
const Map = dynamic(() => import('./Map'), {
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
