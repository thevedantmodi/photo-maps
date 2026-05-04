'use client';

import dynamic from 'next/dynamic';

const Map = dynamic(() => import('./Map'), {
    ssr: false,
    loading: () => (
        <div className="loading-container">
            <div className="skeleton-pulse skeleton-marker" style={{ top: '35%', left: '22%' }} />
            <div className="skeleton-pulse skeleton-marker" style={{ top: '45%', left: '48%' }} />
            <div className="skeleton-pulse skeleton-marker" style={{ top: '30%', left: '70%' }} />
            <div className="skeleton-pulse skeleton-marker" style={{ top: '55%', left: '60%', animationDelay: '0.3s' }} />
            <div className="skeleton-pulse skeleton-marker" style={{ top: '40%', left: '35%', animationDelay: '0.6s' }} />
            <div className="skeleton-pulse skeleton-controls" />
            <div className="skeleton-pulse skeleton-toggle" />
        </div>
    )
});

export default Map;
