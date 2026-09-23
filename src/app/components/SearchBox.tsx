"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PlaceSuggestion, searchPlaces } from "@/lib/mapboxGeocode";

interface SearchBoxProps {
  mapboxToken?: string;
  onSelect: (place: PlaceSuggestion) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

const SearchBox = ({ mapboxToken, onSelect, expanded, onExpandedChange }: SearchBoxProps) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback(
    (value: string) => {
      if (!mapboxToken) return;
      setLoading(true);
      searchPlaces(value, mapboxToken)
        .then(setSuggestions)
        .finally(() => setLoading(false));
    },
    [mapboxToken],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  };

  const collapse = useCallback(() => {
    onExpandedChange(false);
    setQuery("");
    setSuggestions([]);
  }, [onExpandedChange]);

  const handleSelect = (place: PlaceSuggestion) => {
    onSelect(place);
    collapse();
  };

  // Focus once the grow animation has had time to give the input room.
  useEffect(() => {
    if (!expanded) return;
    const id = setTimeout(() => inputRef.current?.focus(), 180);
    return () => clearTimeout(id);
  }, [expanded]);

  // Collapse on an empty-query click outside, so the bar doesn't sit open
  // and empty after someone taps the map.
  useEffect(() => {
    if (!expanded) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (query.trim()) return;
      if (trackRef.current && !trackRef.current.contains(e.target as Node)) {
        collapse();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [expanded, query, collapse]);

  return (
    <div className="search-track" ref={trackRef}>
      <motion.div
        layout
        className={`search-shape ${expanded ? "search-shape--expanded" : "search-shape--collapsed"}`}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {!expanded ? (
            <motion.button
              key="collapsed"
              className="search-shape-btn"
              onClick={() => onExpandedChange(true)}
              aria-label="Search for a place"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </motion.button>
          ) : (
            <motion.div
              key="expanded"
              className="search-shape-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, delay: expanded ? 0.08 : 0 }}
            >
              <button className="search-back-btn" onClick={collapse} aria-label="Close search">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <input
                ref={inputRef}
                className="search-shape-input"
                type="text"
                inputMode="search"
                placeholder="Jump to a place…"
                value={query}
                onChange={(e) => handleChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && suggestions[0]) handleSelect(suggestions[0]);
                  if (e.key === "Escape") collapse();
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {expanded && (loading || suggestions.length > 0) && (
        <div className="search-box-suggestions">
          {loading && <div className="search-box-status">Searching…</div>}
          {!loading &&
            suggestions.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                className="search-box-suggestion"
                onClick={() => handleSelect(s)}
              >
                {s.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
};

export default SearchBox;
