'use client';

import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

    const createCustomIcon = (thumbUrl: string) => {
        return L.divIcon({
            html: `<div style="
        background-image: url('${thumbUrl}'); 
        width: 48px; 
        height: 48px; 
        background-size: cover; 
        background-position: center;
        border-radius: 50%; 
        border: 3px solid white; 
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        transition: transform 0.2s;
      "></div>`,
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
            htmlContent = `<div style="width: 100%; height: 100%; background: #333; border-radius: 50%;"></div>`;
        } else if (thumbs.length === 1) {
            htmlContent = `<div style="background-image: url('${thumbs[0]}'); width: 100%; height: 100%; background-size: cover; border-radius: 50%;"></div>`;
        } else {
            // Create a collage
            const subSize = 24; // approx half
            // We'll just overlay them slightly
            htmlContent = `<div style="position: relative; width: 100%; height: 100%; border-radius: 50%; overflow: hidden; background: #222;">`;
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
            html: `<div style="
        background-color: rgba(30, 30, 30, 0.8); 
        backdrop-filter: blur(10px);
        border-radius: 50%; 
        width: 64px; 
        height: 64px; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        color: white; 
        font-weight: bold; 
        font-size: 14px;
        border: 3px solid rgba(255,255,255,0.8);
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        overflow: hidden;
        position: relative;
      ">
        ${htmlContent}
        <div style="
            position: absolute; 
            top: 50%; 
            left: 50%; 
            transform: translate(-50%, -50%); 
            background: rgba(0,0,0,0.6); 
            color: white; 
            border-radius: 12px; 
            padding: 2px 6px; 
            font-size: 12px;
            pointer-events: none;
        ">${count}</div>
      </div>`,
            className: 'custom-cluster-icon',
            iconSize: [64, 64]
        });
    };

    return (
        <>
            <MapContainer
                center={[20, 0]}
                zoom={2}
                style={{ height: '100vh', width: '100%', background: '#111' }}
                minZoom={2}
            >
                <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
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
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        backgroundColor: 'rgba(0,0,0,0.95)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '20px',
                        backdropFilter: 'blur(10px)',
                        flexDirection: 'column'
                    }}
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
                                boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
                            }}
                        />
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPhoto(null);
                            }}
                            style={{
                                position: 'absolute',
                                top: '-20px',
                                right: '-20px',
                                background: 'rgba(255,255,255,0.2)',
                                border: 'none',
                                color: 'white',
                                fontSize: '24px',
                                cursor: 'pointer',
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'background 0.2s',
                                backdropFilter: 'blur(5px)'
                            }}
                        >
                            &times;
                        </button>
                    </div>
                    <div style={{ marginTop: '20px', color: '#ccc', fontFamily: 'sans-serif' }}>
                        {selectedPhoto.originalName}
                    </div>
                </div>
            )}
        </>
    );
};



export default MapComponent;
