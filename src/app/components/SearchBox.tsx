"use client";

import { useCallback, useRef, useState } from "react";
import { PlaceSuggestion, searchPlaces } from "@/lib/mapboxGeocode";

interface SearchBoxProps {
  mapboxToken?: string;
  onSelect: (place: PlaceSuggestion) => void;
}

const SearchBox = ({ mapboxToken, onSelect }: SearchBoxProps) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleSelect = (place: PlaceSuggestion) => {
    onSelect(place);
    setQuery(place.name);
    setSuggestions([]);
  };

  return (
    <div className="search-box-container">
      <input
        className="search-box-input"
        type="text"
        inputMode="search"
        placeholder="Jump to a place…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && suggestions[0]) handleSelect(suggestions[0]);
          if (e.key === "Escape") {
            setQuery("");
            setSuggestions([]);
          }
        }}
      />
      {(loading || suggestions.length > 0) && (
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
