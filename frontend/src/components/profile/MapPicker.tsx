"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { searchAddress } from "@/lib/geocode";
import type { SearchResult } from "@/lib/geocode";

export interface PickedLocation {
  lat: number;
  lng: number;
}

const DEFAULT_CENTER: [number, number] = [20.5937, 78.9629]; // Geographic center of India
const PICKED_ZOOM = 15;
const SEARCH_DEBOUNCE_MS = 400;

const pinIcon = L.divIcon({
  className: "",
  html: `<svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 6.72 11.25 7.3 11.76a1 1 0 0 0 1.4 0C13.28 21.25 20 15.25 20 10c0-4.42-3.58-8-8-8z" fill="#ff2070" stroke="#0c0e09" stroke-width="1"/>
    <circle cx="12" cy="10" r="3" fill="#0c0e09"/>
  </svg>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function ClickHandler({ onPick }: { onPick: (loc: PickedLocation) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// MapContainer's center/zoom props only apply on first mount, so picking a new
// location (by click or search) needs this to actually move the view.
function FlyToMarker({ marker }: { marker: PickedLocation | null }) {
  const map = useMap();

  useEffect(() => {
    if (marker) {
      map.flyTo([marker.lat, marker.lng], PICKED_ZOOM);
    }
  }, [marker, map]);

  return null;
}

function SearchBox({ onSelect }: { onSelect: (loc: PickedLocation) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      // Clearing the input clears stale results immediately, rather than
      // waiting on a debounced fetch that will never fire for an empty query.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchAddress(query);
        setResults(found);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="relative z-[1000]">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search for an address…"
        className="w-full rounded-[var(--radius-card)] border border-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
      />
      {searching && (
        <p className="absolute top-2.5 right-3 font-mono text-[10px] tracking-widest text-foreground-muted uppercase">
          Searching…
        </p>
      )}
      {open && results.length > 0 && (
        <ul className="absolute mt-1 max-h-56 w-full overflow-y-auto rounded-[var(--radius-card)] border border-border bg-background-elevated shadow-[0_0_24px_rgba(0,0,0,0.5)]">
          {results.map((result, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  onSelect({ lat: result.lat, lng: result.lng });
                  setQuery(result.label);
                  setOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-accent-soft hover:text-accent"
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface MapPickerProps {
  marker: PickedLocation | null;
  onPick: (loc: PickedLocation) => void;
}

export function MapPicker({ marker, onPick }: MapPickerProps) {
  return (
    <div className="space-y-2">
      <SearchBox onSelect={onPick} />
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
        <MapContainer
          center={marker ? [marker.lat, marker.lng] : DEFAULT_CENTER}
          zoom={marker ? PICKED_ZOOM : 4}
          scrollWheelZoom
          style={{ height: 280, width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onPick={onPick} />
          <FlyToMarker marker={marker} />
          {marker && <Marker position={[marker.lat, marker.lng]} icon={pinIcon} />}
        </MapContainer>
      </div>
    </div>
  );
}
