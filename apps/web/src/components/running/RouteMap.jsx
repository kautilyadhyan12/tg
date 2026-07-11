import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/*
 * RouteMap — thin Leaflet wrapper used by the planner, live run, and summary.
 *
 * Uses free OpenStreetMap tiles (no API key). `path` and `plannedPath` are
 * arrays of [lat, lng]. `live` marks the current position during a run.
 *
 * Self-contained: this component is only imported by the new Running pages,
 * so it can't affect any existing screen.
 */

// Default Leaflet marker icons reference image files that Vite won't resolve
// by default; build small inline divIcons instead so no assets are needed.
const dot = (color) =>
  L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;
            background:${color};border:2px solid #fff;
            box-shadow:0 0 8px ${color};"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

const START_ICON = dot('#FF8A1F');
const LIVE_ICON  = dot('#4ade80');

function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.length > 1) {
      map.fitBounds(coords, { padding: [30, 30] });
    } else if (coords && coords.length === 1) {
      map.setView(coords[0], 15);
    }
  }, [coords, map]);
  return null;
}

function Recenter({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.panTo(position, { animate: true });
  }, [position, map]);
  return null;
}

export default function RouteMap({
  plannedPath = [],
  livePath = [],
  livePosition = null,
  height = 320,
  color = '#FF8A1F',
}) {
  const center =
    plannedPath[0] || livePath[0] || livePosition || [20, 0];
  const allForBounds = plannedPath.length ? plannedPath : livePath;

  return (
    <div
      style={{
        height,
        borderRadius: 16,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <MapContainer
        center={center}
        zoom={14}
        style={{ height: '100%', width: '100%', background: '#0D0C0B' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {plannedPath.length > 1 && (
          <Polyline
            positions={plannedPath}
            pathOptions={{ color, weight: 5, opacity: 0.85 }}
          />
        )}

        {livePath.length > 1 && (
          <Polyline
            positions={livePath}
            pathOptions={{ color: '#4ade80', weight: 5, opacity: 0.95 }}
          />
        )}

        {plannedPath[0] && <Marker position={plannedPath[0]} icon={START_ICON} />}
        {livePosition && <Marker position={livePosition} icon={LIVE_ICON} />}

        {allForBounds.length > 0 && <FitBounds coords={allForBounds} />}
        {livePosition && <Recenter position={livePosition} />}
      </MapContainer>
    </div>
  );
}
