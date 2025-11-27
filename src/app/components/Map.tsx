'use client';

import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTheme } from '../hooks/useTheme';

// Fix for default marker icons if we were using them, but we are using custom ones.

interface Photo {
    id: string;
    lat: number;
    lng: number;
    thumb: string;
    large: string;
    originalName: string;
}

interface MapProps {
    photos: Photo[];
}

const MapComponent = ({ photos }: MapProps) => {
    const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
    const theme = useTheme();

    const createCustomIcon = (thumbUrl: string) => {
        return L.divIcon({
            html: `<div class="photo-marker" style="background-image: url('${thumbUrl}');"></div>`,
            className: 'custom-marker-icon',
            iconSize: [48, 48],
            iconAnchor: [24, 24],
            popupAnchor: [0, -24]
        });
    };

    const createClusterIcon = (cluster: any) => {
        const count = cluster.getChildCount();
        const markers = cluster.getAllChildMarkers();
        // Get up to 3 thumbnails from markers (we pass thumb url in title prop)
        const thumbs = markers.slice(0, 3).map((marker: any) => marker.options.title);

        let htmlContent = '';

        if (thumbs.length === 0) {
            // Fallback
            htmlContent = `<div style="width: 100%; height: 100%; background: var(--cluster-bg); border-radius: 50%;"></div>`;
        } else if (thumbs.length === 1) {
            htmlContent = `<div style="background-image: url('${thumbs[0]}'); width: 100%; height: 100%; background-size: cover; border-radius: 50%;"></div>`;
        } else {
            // Create a collage
            // We'll just overlay them slightly
            htmlContent = `<div style="position: relative; width: 100%; height: 100%; border-radius: 50%; overflow: hidden; background: var(--cluster-bg);">`;
            thumbs.forEach((thumb: string, i: number) => {
                // Simple grid/stack logic
                // Better layout:
                // 2 images: split vertical
                // 3 images: 1 top, 2 bottom

                let style = '';
                if (thumbs.length === 2) {
                    style = `position: absolute; left: ${i * 50}%; top: 0; width: 50%; height: 100%; background-image: url('${thumb}'); background-size: cover; background-position: center;`;
                } else {
                    // 3 images
                    if (i === 0) {
                        style = `position: absolute; left: 0; top: 0; width: 100%; height: 50%; background-image: url('${thumb}'); background-size: cover; background-position: center;`;
                    } else {
                        style = `position: absolute; left: ${(i - 1) * 50}%; top: 50%; width: 50%; height: 50%; background-image: url('${thumb}'); background-size: cover; background-position: center;`;
                    }
                }
                htmlContent += `<div style="${style}"></div>`;
            });
            htmlContent += `</div>`;
        }

        return L.divIcon({
            html: `<div class="cluster-marker-container">
        ${htmlContent}
        <div class="cluster-count-badge">${count}</div>
      </div>`,
            className: 'custom-cluster-icon',
            iconSize: [64, 64]
        });
    };

    const tileLayerUrl = theme === 'dark'
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

    return (
        <>
            <MapContainer
                center={[20, 0]}
                zoom={2}
                style={{ height: '100vh', width: '100%', background: 'var(--map-background)' }}
                minZoom={2}
            >
                <TileLayer
                    url={tileLayerUrl}
                    attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
                />

                <MarkerClusterGroup
                    chunkedLoading
                    iconCreateFunction={createClusterIcon}
                    maxClusterRadius={60}
                    spiderfyOnMaxZoom={true}
                >
                    {photos.map((photo) => (
                        <Marker
                            key={photo.id}
                            position={[photo.lat, photo.lng]}
                            icon={createCustomIcon(photo.thumb)}
                            title={photo.thumb} // Pass thumb url here for cluster access
                            eventHandlers={{
                                click: () => setSelectedPhoto(photo),
                            }}
                        />
                    ))}
                </MarkerClusterGroup>
            </MapContainer>

            {selectedPhoto && (
                <div
                    className="modal-overlay"
                    onClick={() => setSelectedPhoto(null)}
                >
                    <div style={{ position: 'relative', maxWidth: '90%', maxHeight: '85%', display: 'flex', justifyContent: 'center' }}>
                        <img
                            src={selectedPhoto.large}
                            alt="Full size"
                            style={{
                                maxWidth: '100%',
                                maxHeight: '80vh',
                                borderRadius: '4px',
                                boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
                            }}
                        />
                        <button
                            className="modal-close-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPhoto(null);
                            }}
                        >
                            &times;
                        </button>
                    </div>
                    <div className="modal-caption">
                        {selectedPhoto.originalName}
                    </div>
                </div>
            )}
        </>
    );
};

export default MapComponent;
