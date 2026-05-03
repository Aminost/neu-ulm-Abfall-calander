/**
 * map.web.tsx
 *
 * Web-only replacement for map.tsx.
 * Expo automatically picks this file over map.tsx when bundling for web.
 * react-native-maps is NOT imported here — it is native-only and crashes on web.
 *
 * Uses react-leaflet (browser-safe) instead.
 *
 * Install once:
 *   npm install react-leaflet leaflet @types/leaflet
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { ZONES } from '../../src/lib/zones';
import { RECYCLING_LOCATIONS } from '../../src/lib/locations';
import { TRASH_LOCATIONS } from '../../src/lib/trashLocations';
import { useTranslation } from '../../src/lib/i18n';

// ─── Lazy-load Leaflet only in the browser ───────────────────────────────────
// We use dynamic imports so the SSR/static-export pass never touches Leaflet.
// (Leaflet references `window` at module-level, which breaks SSR.)

const NEU_ULM_CENTER: [number, number] = [48.3984, 9.9916];

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MapScreen() {
  const { t } = useTranslation();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const userMarkerRef = useRef<any>(null);

  // ── Bootstrap Leaflet after mount (browser only) ──────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let mounted = true;

    async function initMap() {
      // Dynamic import keeps Leaflet out of SSR bundles
      const L = (await import('leaflet')).default;

      // Leaflet's default icon images break in bundlers; fix the paths
      // @ts-ignore
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      // Inject Leaflet CSS dynamically (once)
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      if (!mapContainerRef.current || !mounted) return;

      // Avoid double-init if React re-renders
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }

      const map = L.map(mapContainerRef.current, {
        center: NEU_ULM_CENTER,
        zoom: 13,
      });

      leafletMapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // ── Draw zone polygons ──────────────────────────────────────────────
      ZONES.forEach(zone => {
        zone.polygons.forEach(ring => {
          // ring items are [lat, lng] tuples
          const latLngs = ring.map(c => L.latLng(c[0], c[1]));
          L.polygon(latLngs, {
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: 0.25,
            weight: 2,
          }).addTo(map);
        });
      });

      // ── Draw recycling / trash markers ─────────────────────────────────
      const allLocations = [...RECYCLING_LOCATIONS, ...TRASH_LOCATIONS];

      allLocations.forEach(loc => {
        const isWertstoffhof = loc.type === 'Wertstoffhof';
        const colour = isWertstoffhof ? 'gold' : '#c8a96e'; // wheat approximation

        // Custom coloured circle-marker (no extra image assets needed)
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:12px;height:12px;border-radius:50%;
            background:${colour};border:2px solid #444;
          "></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
          popupAnchor: [0, -8],
        });

        const marker = L.marker([loc.lat, loc.lng], { icon }).addTo(map);

        const addressLine = loc.address ? `<br/><span>${loc.address}</span>` : '';
        marker.bindPopup(`
          <strong style="font-size:14px">${loc.name}</strong><br/>
          <span>${t(loc.type)}</span>${addressLine}
        `);
      });

      if (mounted) setMapReady(true);
    }

    initMap();

    return () => {
      mounted = false;
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

  // ── "Go to my location" button ────────────────────────────────────────────
  const goToMyLocation = async () => {
    if (typeof window === 'undefined' || !leafletMapRef.current) return;

    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async pos => {
        const L = (await import('leaflet')).default;
        const { latitude: lat, longitude: lng } = pos.coords;
        const map = leafletMapRef.current;

        map.flyTo([lat, lng], 15, { animate: true, duration: 1 });

        if (userMarkerRef.current) {
          userMarkerRef.current.setLatLng([lat, lng]);
        } else {
          const youIcon = L.divIcon({
            className: '',
            html: `<div style="
              width:14px;height:14px;border-radius:50%;
              background:#2563eb;border:3px solid white;
              box-shadow:0 0 0 3px rgba(37,99,235,0.4);
            "></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          userMarkerRef.current = L.marker([lat, lng], { icon: youIcon })
            .addTo(map)
            .bindPopup(t('yourLocation') ?? 'Your location')
            .openPopup();
        }

        setUserPos([lat, lng]);
      },
      err => {
        alert(`Location error: ${err.message}`);
      },
    );
  };

  return (
    <View style={styles.container}>
      {/* The Leaflet map mounts into this plain div */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Locate-me button (mirrors the native version's look) */}
      <Pressable style={styles.locationButton} onPress={goToMyLocation}>
        {/* SVG crosshair — matches lucide-react-native's LocateFixed */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={24}
          height={24}
          viewBox="0 0 24 24"
          fill="none"
          stroke="black"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="2" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22" y2="12" />
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="1" fill="black" />
        </svg>
      </Pressable>

      {/* Loading overlay until Leaflet is ready */}
      {!mapReady && (
        <View style={styles.loadingOverlay}>
          <Text style={styles.loadingText}>Karte wird geladen…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  locationButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 50,
    elevation: 5,
    // @ts-ignore — web-only shadow
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    cursor: 'pointer',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingOverlay: {
    position: 'absolute',
    inset: 0,
    // @ts-ignore
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#374151',
  },
} as const);
