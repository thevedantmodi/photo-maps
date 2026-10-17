"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PlaceSuggestion, searchPlaces } from "@/lib/mapboxGeocode";
import type { CustomPlace } from "@/lib/customPlaces";

interface SearchBoxProps {
  mapboxToken?: string;
  places: CustomPlace[];
  onSelect: (place: PlaceSuggestion) => void;
}

/**
 * An outlined box in the header. On a phone it's the word Search, which opens the box
 * in a row under the header.
 */
const SearchBox = ({ mapboxToken, places, onSelect }: SearchBoxProps) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback(
    (value: string) => {
      if (!mapboxToken) return;
      const id = ++requestRef.current;
      setLoading(true);
      searchPlaces(value, mapboxToken, places)
        .then((results) => {
          // Only the latest query's answer counts.
          if (id !== requestRef.current) return;
          setSuggestions(results);
          setActive(0);
          setSearched(true);
        })
        .finally(() => {
          if (id === requestRef.current) setLoading(false);
        });
    },
    [mapboxToken, places],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const clear = () => {
    requestRef.current++;
    setQuery("");
    setSuggestions([]);
    setSearched(false);
    setLoading(false);
  };

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      clear();
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  };

  const select = (place: PlaceSuggestion) => {
    onSelect(place);
    clear();
    setOpen(false);
    inputRef.current?.blur();
  };

  // The phone row: focus the box once it has unfolded.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 180);
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const noResults = searched && !loading && query.trim() !== "" && suggestions.length === 0;
  const listOpen = focused && (loading || suggestions.length > 0 || noResults);

  return (
    <div className="search" data-open={open} ref={rootRef}>
      <button
        type="button"
        className="text-btn search-open-btn"
        aria-expanded={open}
        aria-controls="search-box"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Close search" : "Search"}
      </button>
      <div className="search-box" id="search-box">
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          inputMode="search"
          placeholder="Find a place"
          aria-label="Find a place"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls="search-list"
          aria-autocomplete="list"
          aria-activedescendant={
            listOpen && suggestions[active] ? `search-option-${active}` : undefined
          }
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && suggestions.length > 0) {
              e.preventDefault();
              setActive((a) => (a + 1) % suggestions.length);
            } else if (e.key === "ArrowUp" && suggestions.length > 0) {
              e.preventDefault();
              setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === "Enter" && suggestions[active]) {
              e.preventDefault();
              select(suggestions[active]);
            } else if (e.key === "Escape") {
              clear();
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
        />
        <ul id="search-list" className="search-list" role="listbox" data-open={listOpen}>
          {loading && <li className="search-status">Searching…</li>}
          {!loading &&
            suggestions.map((s, i) => (
              <li key={`${s.name}-${i}`} role="none">
                <button
                  type="button"
                  id={`search-option-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="search-option"
                  tabIndex={-1}
                  // mousedown, not click: a click would blur the box and close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(s);
                  }}
                >
                  {s.name}
                </button>
              </li>
            ))}
          {noResults && <li className="search-status">No places found.</li>}
        </ul>
      </div>
    </div>
  );
};

export default SearchBox;
