import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-rotate';

/*
 * NavigationMap — Google-Maps-style live navigation view for an active run.
 *
 * Features:
 *  - Heading-locked rotation: the map rotates so the runner's direction is
 *    always "up" (uses leaflet-rotate). Falls back gracefully to a static
 *    north-up map if rotation isn't available.
 *  - Direction-arrow marker that points the way the runner is heading.
 *  - Dual path: planned route (muted) + actual path run so far (orange glow).
 *  - Smooth follow: recenters on the runner as they move, unless the user has
 *    panned away (then a Re-center button appears — handled by the parent).
 *
 * Pure presentation — only used by ActiveRun. Touches nothing else.
 */

const ACCENT = '#FF8A1F';

// Arrow marker (rotates with heading) for the runner's current position.
function makeArrowIcon(heading = 0) {
  return L.divIcon({
    className: '',
    html: `
      <div style="transform: rotate(${heading}deg); transition: transform 0.3s ease;">
        <div style="
          width:0;height:0;
          border-left:11px solid transparent;
          border-right:11px solid transparent;
          border-bottom:22px solid ${ACCENT};
          filter: drop-shadow(0 0 6px ${ACCENT});
        "></div>
        <div style="
          width:14px;height:14px;border-radius:50%;
          background:${ACCENT};border:3px solid #fff;
          margin:-4px auto 0;box-shadow:0 0 10px ${ACCENT};
        "></div>
      </div>`,
    iconSize: [22, 30],
    iconAnchor: [11, 18],
  });
}

// Labeled pin for the route start and finish.
function makePinIcon(label, color) {
  return L.divIcon({
    className: '',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div style="
          background:${color};color:#fff;font-size:10px;font-weight:800;
          letter-spacing:0.5px;padding:3px 8px;border-radius:8px;
          box-shadow:0 2px 8px rgba(0,0,0,0.4);white-space:nowrap;">${label}</div>
        <div style="
          width:0;height:0;border-left:5px solid transparent;
          border-right:5px solid transparent;border-top:7px solid ${color};
          margin-top:-1px;"></div>
        <div style="
          width:13px;height:13px;border-radius:50%;background:${color};
          border:3px solid #fff;margin-top:-3px;
          box-shadow:0 0 10px ${color};"></div>
      </div>`,
    iconSize: [60, 40],
    iconAnchor: [30, 40],
  });
}
const START_ICON  = makePinIcon('START', '#4ade80');
const FINISH_ICON = makePinIcon('FINISH', '#ef4444');

// Helper: are two points effectively the same spot (a loop)?
function samePoint(a, b) {
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
}

// Handles rotation + follow behavior imperatively (leaflet-rotate adds
// setBearing to the map instance when available).
function Navigator({ position, heading, follow, zoom }) {
  const map = useMap();
  const lastHeading = useRef(0);

  useEffect(() => {
    if (!position) return;
    if (follow) {
      try {
        map.setView(position, zoom || map.getZoom(), { animate: true, duration: 0.5 });
      } catch (_) {}
    }
  }, [position, follow, zoom, map]);

  useEffect(() => {
    if (heading == null || !follow) return;
    // Rotate map so heading points "up" (bearing = -heading).
    if (typeof map.setBearing === 'function') {
      try {
        map.setBearing(-heading);
        lastHeading.current = heading;
      } catch (_) {}
    }
  }, [heading, follow, map]);

  return null;
}

// Detect user panning to toggle "follow" off (parent shows Re-center).
function PanDetector({ onUserPan }) {
  const map = useMap();
  useEffect(() => {
    const onDragStart = () => onUserPan && onUserPan();
    map.on('dragstart', onDragStart);
    return () => map.off('dragstart', onDragStart);
  }, [map, onUserPan]);
  return null;
}

// Forces Leaflet to recompute its container size + reload tiles after mount.
// Without this, a map created inside a fixed/absolute full-screen container
// (or one that animates in) can render blank because it measured 0x0 at init.
function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    fix();
    const t1 = setTimeout(fix, 200);
    const t2 = setTimeout(fix, 600);
    window.addEventListener('resize', fix);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', fix); };
  }, [map]);
  return null;
}

function InitialCenter({ plannedPath, position }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || position) return;
    if (plannedPath && plannedPath.length > 0) {
      map.setView(plannedPath[0], 16);
      done.current = true;
    }
  }, [plannedPath, position, map]);
  return null;
}

export default function NavigationMap({
  plannedPath = [],
  livePath = [],
  position = null,
  heading = 0,
  follow = true,
  onUserPan,
  height = '100%',
  zoom = 17,
}) {
  const center = position || plannedPath[0] || livePath[0] || [20, 0];

  return (
    <div style={{ height, width: '100%', position: 'relative' }}>
      <MapContainer
        center={center}
        zoom={zoom}
        rotate={true}
        rotateControl={false}
        touchRotate={true}
        zoomControl={false}
        attributionControl={false}
        style={{ height: '100%', width: '100%', background: '#0A0908' }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <InvalidateSize />
        <InitialCenter plannedPath={plannedPath} position={position} />

        {/* Planned route — clearly visible blue with a soft halo */}
        {plannedPath.length > 1 && (
          <>
            <Polyline positions={plannedPath}
              pathOptions={{ color: '#1d4ed8', weight: 10, opacity: 0.25, lineCap: 'round' }} />
            <Polyline positions={plannedPath}
              pathOptions={{ color: '#3b82f6', weight: 5, opacity: 0.95, lineCap: 'round', dashArray: '12 8' }} />
          </>
        )}

        {/* Path run so far — bright orange with a soft outer glow */}
        {livePath.length > 1 && (
          <>
            <Polyline positions={livePath}
              pathOptions={{ color: ACCENT, weight: 12, opacity: 0.25, lineCap: 'round' }} />
            <Polyline positions={livePath}
              pathOptions={{ color: ACCENT, weight: 6, opacity: 1, lineCap: 'round' }} />
          </>
        )}

        {/* Start / Finish markers on the planned route */}
        {plannedPath.length > 1 && (() => {
          const startPt = plannedPath[0];
          const endPt = plannedPath[plannedPath.length - 1];
          const isLoop = samePoint(startPt, endPt);
          if (isLoop) {
            return <Marker position={startPt} icon={makePinIcon('START / FINISH', ACCENT)} />;
          }
          return (
            <>
              <Marker position={startPt} icon={START_ICON} />
              <Marker position={endPt} icon={FINISH_ICON} />
            </>
          );
        })()}

        {position && <Marker position={position} icon={makeArrowIcon(heading)} />}

        <Navigator position={position} heading={heading} follow={follow} zoom={zoom} />
        <PanDetector onUserPan={onUserPan} />
      </MapContainer>
    </div>
  );
}
