"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Photo } from "../types";
import { getLocationGroups, LocationGroup } from "@/lib/locationGroups";
import { reverseGeocode } from "@/lib/mapboxGeocode";
import type { CustomPlace } from "@/lib/customPlaces";

interface NamedGroup extends LocationGroup {
  name: string | null; // null while the geocode lookup is still in flight
}

interface LocationSidebarProps {
  photos: Photo[];
  places: CustomPlace[];
  mapboxToken?: string;
  onSelect: (group: { longitude: number; latitude: number; count: number }) => void;
  hideToggle?: boolean;
}

const LocationSidebar = ({ photos, places, mapboxToken, onSelect, hideToggle }: LocationSidebarProps) => {
  const [open, setOpen] = useState(false);
  // Derived, not synced via effect: the panel can't be left open and
  // orphaned behind the expanded search bar without a cascading setState.
  const panelOpen = open && !hideToggle;

  // Recomputed from photos, not stored in state — the effect below only
  // owns the async name lookups, so it never sets state synchronously.
  const rawGroups = useMemo(() => getLocationGroups(photos), [photos]);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!mapboxToken || rawGroups.length === 0) return;

    let cancelled = false;
    (async () => {
      // Sequential, not Promise.all: keeps this to one request in flight at a
      // time and lets cached (instant) lookups resolve before slower ones.
      for (const group of rawGroups) {
        if (cancelled) return;
        const name = await reverseGeocode(group.longitude, group.latitude, mapboxToken, places);
        if (cancelled) return;
        setNames((prev) => ({ ...prev, [group.id]: name }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawGroups, mapboxToken, places]);

  const groups: NamedGroup[] = useMemo(
    () => rawGroups.map((g) => ({ ...g, name: names[g.id] ?? null })),
    [rawGroups, names],
  );

  return (
    <>
      <button
        className={`sidebar-toggle-btn${hideToggle ? " icon-btn-hidden" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={panelOpen ? "Close location list" : "Open location list"}
        aria-expanded={panelOpen}
        aria-hidden={hideToggle}
        tabIndex={hideToggle ? -1 : 0}
      >
        {panelOpen ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      <AnimatePresence>
        {panelOpen && (
          <motion.div
            className="location-sidebar"
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="location-sidebar-header">Places</div>
            <div className="location-sidebar-list">
              {groups.map((g) => (
                <button
                  key={g.id}
                  className="location-sidebar-item"
                  onClick={() => {
                    onSelect(g);
                    setOpen(false);
                  }}
                >
                  <span className="location-sidebar-name">{g.name ?? "Loading…"}</span>
                  <span className="location-sidebar-count">{g.count}</span>
                </button>
              ))}
              {groups.length === 0 && (
                <div className="location-sidebar-empty">No located photos yet.</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default LocationSidebar;
