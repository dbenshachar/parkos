"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-client";

export type MapDestination = {
  lat: number;
  lng: number;
  name: string;
  street: string;
};

export type PaidMapRecommendation = {
  zoneNumber: string;
  price: string;
  distanceMeters: number;
  zoneLat: number;
  zoneLng: number;
};

export type ResidentialMapRecommendation = {
  zoneNumber: string;
  price: string;
  distanceMeters: number;
  zoneLat: number;
  zoneLng: number;
  district: string;
  hours: string;
  description: string;
};

type DestinationMapModalProps = {
  isOpen: boolean;
  onClose: () => void;
  destination: MapDestination;
  paidRecommendations: PaidMapRecommendation[];
  residentialRecommendations: ResidentialMapRecommendation[];
};

function buildGoogleSearchUrl(lat: number, lng: number): string {
  const params = new URLSearchParams({
    api: "1",
    query: `${lat},${lng}`,
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

export function DestinationMapModal({
  isOpen,
  onClose,
  destination,
  paidRecommendations,
  residentialRecommendations,
}: DestinationMapModalProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const parkingMarkers = useMemo(
    () =>
      [
        ...paidRecommendations.map((item) => ({
          kind: "paid" as const,
          zoneNumber: item.zoneNumber,
          price: item.price,
          distanceMeters: item.distanceMeters,
          zoneLat: item.zoneLat,
          zoneLng: item.zoneLng,
        })),
        ...residentialRecommendations.map((item) => ({
          kind: "residential" as const,
          zoneNumber: item.zoneNumber,
          price: item.price,
          distanceMeters: item.distanceMeters,
          zoneLat: item.zoneLat,
          zoneLng: item.zoneLng,
        })),
      ].sort((a, b) => a.distanceMeters - b.distanceMeters),
    [paidRecommendations, residentialRecommendations],
  );

  const fallbackPins = useMemo(
    () => [
      {
        label: `Destination: ${destination.name}`,
        href: buildGoogleSearchUrl(destination.lat, destination.lng),
      },
      ...parkingMarkers.map((item) => ({
        label: `${item.kind === "paid" ? "Paid" : "Residential"} Zone ${item.zoneNumber} (${Math.round(item.distanceMeters)}m)`,
        href: buildGoogleSearchUrl(item.zoneLat, item.zoneLng),
      })),
    ],
    [destination, parkingMarkers],
  );

  useEffect(() => {
    if (!isOpen || !mapRef.current) {
      return;
    }

    let isCancelled = false;
    let markers: google.maps.Marker[] = [];

    const renderMap = async () => {
      setMapError(null);
      try {
        const maps = await loadGoogleMaps();
        if (isCancelled || !mapRef.current) {
          return;
        }

        const map = new maps.Map(mapRef.current, {
          center: { lat: destination.lat, lng: destination.lng },
          zoom: 15,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
        });
        const infoWindow = new maps.InfoWindow();
        const bounds = new maps.LatLngBounds();

        const buildCircleIcon = (fillColor: string, scale = 11): google.maps.Symbol => ({
          path: maps.SymbolPath.CIRCLE,
          fillColor,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2.5,
          scale,
        });

        const addMarker = (
          lat: number,
          lng: number,
          title: string,
          icon: google.maps.Symbol,
          infoHtml: string,
          label?: string,
        ) => {
          const marker = new maps.Marker({
            map,
            position: { lat, lng },
            title,
            icon,
            label: label
              ? {
                  text: label,
                  color: "#ffffff",
                  fontWeight: "700",
                  fontSize: "11px",
                }
              : undefined,
          });
          marker.addListener("click", () => {
            infoWindow.setContent(infoHtml);
            infoWindow.open({
              map,
              anchor: marker,
            });
          });
          markers.push(marker);
          bounds.extend({ lat, lng });
        };

        addMarker(
          destination.lat,
          destination.lng,
          `Destination: ${destination.name}`,
          buildCircleIcon("#111111", 13),
          `<div><strong>${destination.name}</strong><br/>${destination.street}</div>`,
          "D",
        );

        parkingMarkers.forEach((item, index) => {
          const isPaid = item.kind === "paid";
          addMarker(
            item.zoneLat,
            item.zoneLng,
            `${isPaid ? "Paid" : "Residential"} Zone ${item.zoneNumber}`,
            buildCircleIcon(isPaid ? "#d93025" : "#2563eb"),
            `<div><strong>${isPaid ? "Paid" : "Residential"} Zone ${item.zoneNumber}</strong><br/>${isPaid ? item.price : "Permit required"}<br/>${Math.round(item.distanceMeters)}m away</div>`,
            String(index + 1),
          );
        });

        if (markers.length > 1) {
          map.fitBounds(bounds, 72);
        } else {
          map.setCenter({ lat: destination.lat, lng: destination.lng });
          map.setZoom(16);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load Google Maps.";
        setMapError(message);
      }
    };

    renderMap();

    return () => {
      isCancelled = true;
      markers.forEach((marker) => marker.setMap(null));
      markers = [];
    };
  }, [isOpen, destination, parkingMarkers]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-black/15 bg-white p-4 text-black shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-base font-semibold">Destination + Parking Map</h4>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-black/20 px-2 py-1 text-xs hover:bg-black/5"
          >
            Close
          </button>
        </div>
        <p className="mb-3 text-xs text-black/70">
          Marker legend: black = destination, red = paid zones, blue = residential zones.
        </p>

        {mapError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p>{mapError}</p>
            <p className="mt-2 text-xs">Fallback pin links:</p>
            <div className="mt-1 space-y-1">
              {fallbackPins.map((pin) => (
                <p key={pin.href}>
                  <a href={pin.href} target="_blank" rel="noopener noreferrer" className="underline">
                    {pin.label}
                  </a>
                </p>
              ))}
            </div>
          </div>
        ) : null}

        <div
          ref={mapRef}
          className={`h-[420px] w-full overflow-hidden rounded-lg border border-black/15 ${mapError ? "mt-3 opacity-40" : ""}`}
        />
      </div>
    </div>
  );
}
