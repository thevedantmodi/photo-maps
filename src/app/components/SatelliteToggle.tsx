'use client';

interface SatelliteToggleProps {
    enabled: boolean;
    onToggle: () => void;
    hidden?: boolean;
}

export default function SatelliteToggle({ enabled, onToggle, hidden }: SatelliteToggleProps) {
    return (
        <button
            className={`satellite-toggle${enabled ? ' satellite-toggle-on' : ''}${hidden ? ' icon-btn-hidden' : ''}`}
            onClick={onToggle}
            aria-label="Satellite view"
            aria-pressed={enabled}
            aria-hidden={hidden}
            tabIndex={hidden ? -1 : 0}
            title={enabled ? 'Switch to map view' : 'Switch to satellite view'}
        >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M13 7L9 3 5 7l4 4" />
                <path d="M17 11l4 4-4 4-4-4" />
                <path d="M8 12l4 4 6-6-4-4z" />
                <path d="M16 8l3-3" />
                <path d="M9 21a6 6 0 0 0-6-6" />
            </svg>
        </button>
    );
}
