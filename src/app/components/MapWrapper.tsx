'use client';

import dynamic from 'next/dynamic';

const Map = dynamic(() => import('./Map'), {
    ssr: false,
    loading: () => (
        <div className="loading-container">
            <span style={{ fontFamily: 'monospace' }}>Loading Map...</span>
        </div>
    )
});

export default Map;
