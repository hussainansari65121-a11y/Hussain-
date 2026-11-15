import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
  useMapsLibrary,
  useAdvancedMarkerRef,
} from "@vis.gl/react-google-maps";
import {
  X,
  Search,
  Navigation,
  MapPin,
  LocateFixed,
  Loader2,
  Car,
  Bike,
  Footprints,
  Train,
  Star,
  ExternalLink,
  ArrowRightLeft,
  Clock,
  Route as RouteIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAutocompleteSuggestions } from "../hooks/useAutocompleteSuggestions";
import { reportMapsQuotaIfError } from "../utils/mapsQuota";
import type { MapCommandPayload, TravelModeOption } from "../types/maps";

interface GoogleMapsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  pendingCommand: MapCommandPayload | null;
  onCommandHandled: () => void;
}

interface RouteSummary {
  distanceMeters: number;
  durationMillis: number;
  startLocation?: google.maps.LatLngLiteral;
  endLocation?: google.maps.LatLngLiteral;
}

interface PlaceMarkerData {
  id: string;
  name: string;
  address: string;
  position: google.maps.LatLngLiteral;
  viewport?: google.maps.LatLngBounds | null;
  rating?: number | null;
  userRatingCount?: number | null;
  websiteURI?: string | null;
  isOpenNow?: boolean | null;
}

const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 19.076, lng: 72.8777 };

const TRAVEL_MODES: Array<{
  id: TravelModeOption;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: "DRIVING", label: "Car", icon: Car },
  { id: "TWO_WHEELER", label: "Bike", icon: Bike },
  { id: "WALKING", label: "Walk", icon: Footprints },
  { id: "TRANSIT", label: "Transit", icon: Train },
];

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(millis: number): string {
  const totalMinutes = Math.max(1, Math.round(millis / 60000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
}

function toLatLngLiteral(
  loc: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined
): google.maps.LatLngLiteral | null {
  if (!loc) return null;
  if (typeof (loc as google.maps.LatLng).lat === "function") {
    const latLng = loc as google.maps.LatLng;
    return { lat: latLng.lat(), lng: latLng.lng() };
  }
  const lit = loc as google.maps.LatLngLiteral;
  if (typeof lit.lat === "number" && typeof lit.lng === "number") {
    return { lat: lit.lat, lng: lit.lng };
  }
  return null;
}

function PlaceMarkerWithInfo({
  place,
  isSelected,
  onSelect,
  onDirectionsToPlace,
}: {
  place: PlaceMarkerData;
  isSelected: boolean;
  onSelect: () => void;
  onDirectionsToPlace: (place: PlaceMarkerData) => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={place.position}
        title={place.name}
        onClick={onSelect}
        zIndex={isSelected ? 20 : 10}
      >
        <Pin
          background={isSelected ? "#ec4899" : "#8b5cf6"}
          borderColor={isSelected ? "#fbcfe8" : "#ddd6fe"}
          glyphColor="#ffffff"
          scale={isSelected ? 1.2 : 1.0}
        />
      </AdvancedMarker>

      {isSelected && marker && (
        <InfoWindow anchor={marker} maxWidth={270} onCloseClick={onSelect}>
          <div className="text-slate-900 p-0.5 space-y-1.5 font-sans">
            <div className="font-semibold text-sm leading-snug text-slate-950">
              {place.name}
            </div>
            {place.address && (
              <p className="text-xs text-slate-600 leading-relaxed">
                {place.address}
              </p>
            )}
            {(place.rating || place.isOpenNow !== null && place.isOpenNow !== undefined) && (
              <div className="flex items-center gap-2 text-xs pt-0.5">
                {typeof place.rating === "number" && (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-600">
                    <Star size={12} className="fill-amber-500 text-amber-500" />
                    {place.rating.toFixed(1)}
                    {typeof place.userRatingCount === "number" && (
                      <span className="text-slate-400 font-normal">
                        ({place.userRatingCount})
                      </span>
                    )}
                  </span>
                )}
                {typeof place.isOpenNow === "boolean" && (
                  <span
                    className={`font-medium ${
                      place.isOpenNow ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {place.isOpenNow ? "Open now" : "Closed"}
                  </span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1.5">
              <button
                type="button"
                onClick={() => onDirectionsToPlace(place)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors cursor-pointer"
              >
                <Navigation size={12} />
                Directions
              </button>
              {place.websiteURI && (
                <a
                  href={place.websiteURI}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors"
                >
                  <ExternalLink size={11} />
                  Website
                </a>
              )}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

function RouteOverlay({
  origin,
  destination,
  travelMode,
  triggerKey,
  onRouteResult,
  onRouteLoading,
  onRouteError,
}: {
  origin: string | google.maps.LatLngLiteral | null;
  destination: string | google.maps.LatLngLiteral | null;
  travelMode: TravelModeOption;
  triggerKey: number;
  onRouteResult: (summary: RouteSummary | null) => void;
  onRouteLoading: (loading: boolean) => void;
  onRouteError: (error: string | null) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!routesLib || !map || !origin || !destination || triggerKey === 0) {
      return;
    }

    let cancelled = false;
    onRouteError(null);
    onRouteLoading(true);

    const request = {
      origin,
      destination,
      travelMode,
      fields: ["path", "distanceMeters", "durationMillis", "viewport", "legs"],
    };

    (routesLib.Route as unknown as { computeRoutes: (req: unknown) => Promise<{ routes: any[] }> })
      .computeRoutes(request)
      .then(({ routes }) => {
        if (cancelled) return;
        onRouteLoading(false);

        if (!routes || routes.length === 0) {
          onRouteResult(null);
          onRouteError("No route found between these locations.");
          return;
        }

        const primaryRoute = routes[0];
        const newPolylines: google.maps.Polyline[] = primaryRoute.createPolylines();
        newPolylines.forEach((polyline) => {
          polyline.setOptions({
            strokeColor: "#a855f7",
            strokeOpacity: 0.92,
            strokeWeight: 6,
          });
          polyline.setMap(map);
        });
        polylinesRef.current = newPolylines;

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport, 48);
        }

        const firstLeg = primaryRoute.legs?.[0];
        const startLoc = toLatLngLiteral(firstLeg?.startLocation);
        const endLoc = toLatLngLiteral(firstLeg?.endLocation);

        onRouteResult({
          distanceMeters: primaryRoute.distanceMeters ?? 0,
          durationMillis: primaryRoute.durationMillis ?? 0,
          startLocation: startLoc || undefined,
          endLocation: endLoc || undefined,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        onRouteLoading(false);
        onRouteResult(null);
        reportMapsQuotaIfError(err);
        const msg =
          err instanceof Error
            ? err.message
            : "Could not calculate route. Please verify both locations.";
        onRouteError(msg);
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [routesLib, map, origin, destination, travelMode, triggerKey]);

  return null;
}

function MapsInnerContent({
  onClose,
  pendingCommand,
  onCommandHandled,
}: {
  onClose: () => void;
  pendingCommand: MapCommandPayload | null;
  onCommandHandled: () => void;
}) {
  const map = useMap();
  const placesLib = useMapsLibrary("places");

  const [activeTab, setActiveTab] = useState<"explore" | "directions">("explore");

  // Search / Explore state
  const [searchInput, setSearchInput] = useState("");
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [markers, setMarkers] = useState<PlaceMarkerData[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);

  // User Geolocation state (explicit user consent only)
  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Directions state
  const [originInput, setOriginInput] = useState("");
  const [destinationInput, setDestinationInput] = useState("");
  const [showOriginDropdown, setShowOriginDropdown] = useState(false);
  const [showDestDropdown, setShowDestDropdown] = useState(false);
  const [travelMode, setTravelMode] = useState<TravelModeOption>("DRIVING");
  const [activeRouteReq, setActiveRouteReq] = useState<{
    origin: string | google.maps.LatLngLiteral | null;
    destination: string | google.maps.LatLngLiteral | null;
    key: number;
  }>({ origin: null, destination: null, key: 0 });
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const {
    suggestions: searchSuggestions,
    isLoading: isSearchAutocompleteLoading,
    resetSession: resetSearchSession,
  } = useAutocompleteSuggestions(showSearchDropdown ? searchInput : "");

  const {
    suggestions: originSuggestions,
    resetSession: resetOriginSession,
  } = useAutocompleteSuggestions(showOriginDropdown ? originInput : "");

  const {
    suggestions: destSuggestions,
    resetSession: resetDestSession,
  } = useAutocompleteSuggestions(showDestDropdown ? destinationInput : "");

  const focusPlaceOnMap = useCallback(
    (placeData: PlaceMarkerData) => {
      if (!map) return;
      if (placeData.viewport) {
        map.fitBounds(placeData.viewport, 48);
      } else {
        map.panTo(placeData.position);
        map.setZoom(15);
      }
    },
    [map]
  );

  const mapPlaceToMarkerData = (
    place: google.maps.places.Place,
    fallbackIndex = 0
  ): PlaceMarkerData | null => {
    const pos = toLatLngLiteral(place.location);
    if (!pos) return null;
    return {
      id: place.id || `place-${Date.now()}-${fallbackIndex}`,
      name: place.displayName || "Selected Place",
      address: place.formattedAddress || "",
      position: pos,
      viewport: place.viewport || null,
      rating: place.rating ?? null,
      userRatingCount: place.userRatingCount ?? null,
      websiteURI: place.websiteURI ?? null,
      isOpenNow: null,
    };
  };

  const executeTextSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!placesLib || !trimmed) return;

      setIsSearching(true);
      setSearchError(null);
      setShowSearchDropdown(false);

      try {
        const { places } = await placesLib.Place.searchByText({
          textQuery: trimmed,
          fields: [
            "id",
            "displayName",
            "formattedAddress",
            "location",
            "viewport",
            "rating",
            "userRatingCount",
            "websiteURI",
          ],
          maxResultCount: 5,
        });

        const parsed = (places || [])
          .map((p, idx) => mapPlaceToMarkerData(p, idx))
          .filter((item): item is PlaceMarkerData => item !== null);

        if (parsed.length === 0) {
          setMarkers([]);
          setSelectedMarkerId(null);
          setSearchError(`"${trimmed}" के लिए कोई जगह नहीं मिली।`);
          return;
        }

        setMarkers(parsed);
        setSelectedMarkerId(parsed[0].id);
        focusPlaceOnMap(parsed[0]);
      } catch (err) {
        reportMapsQuotaIfError(err);
        setSearchError("Place search failed. Please try again.");
      } finally {
        setIsSearching(false);
      }
    },
    [placesLib, focusPlaceOnMap]
  );

  const handleSelectSearchSuggestion = async (
    suggestion: google.maps.places.AutocompleteSuggestion
  ) => {
    if (!placesLib || !suggestion.placePrediction) return;
    setShowSearchDropdown(false);
    setSearchError(null);
    setIsSearching(true);

    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: [
          "id",
          "displayName",
          "formattedAddress",
          "location",
          "viewport",
          "rating",
          "userRatingCount",
          "websiteURI",
        ],
      });
      resetSearchSession();

      const markerData = mapPlaceToMarkerData(place);
      if (markerData) {
        setSearchInput(markerData.name);
        setMarkers([markerData]);
        setSelectedMarkerId(markerData.id);
        focusPlaceOnMap(markerData);
      }
    } catch (err) {
      reportMapsQuotaIfError(err);
      setSearchError("Could not load details for this place.");
    } finally {
      setIsSearching(false);
    }
  };

  const requestUserLocation = useCallback(
    (fillAsOrigin = false) => {
      if (!navigator.geolocation) {
        setLocationError("Geolocation is not supported in this browser.");
        return;
      }

      setIsLocating(true);
      setLocationError(null);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: google.maps.LatLngLiteral = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          setUserLocation(coords);
          setIsLocating(false);
          if (map) {
            map.panTo(coords);
            map.setZoom(14);
          }
          if (fillAsOrigin) {
            setOriginInput("My Current Location");
            setShowOriginDropdown(false);
          }
        },
        (err) => {
          setIsLocating(false);
          setLocationError(
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied. You can still type any address."
              : "Unable to get your current location."
          );
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    },
    [map]
  );

  const resolveEndpoint = (
    text: string
  ): string | google.maps.LatLngLiteral | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === "my current location" && userLocation) {
      return userLocation;
    }
    return trimmed;
  };

  const triggerDirections = useCallback(
    (
      originVal: string | google.maps.LatLngLiteral | null,
      destVal: string | google.maps.LatLngLiteral | null
    ) => {
      if (!originVal || !destVal) {
        setRouteError("Please provide both a starting point and destination.");
        return;
      }
      setRouteError(null);
      setActiveRouteReq((prev) => ({
        origin: originVal,
        destination: destVal,
        key: prev.key + 1,
      }));
    },
    []
  );

  // Process incoming voice / text map commands from Zoya
  useEffect(() => {
    if (!pendingCommand || !placesLib) return;

    if (pendingCommand.mode === "directions") {
      setActiveTab("directions");
      if (pendingCommand.travelMode) {
        setTravelMode(pendingCommand.travelMode);
      }
      const nextOrigin = pendingCommand.origin || (userLocation ? "My Current Location" : "Mumbai");
      const nextDest = pendingCommand.destination || "";
      setOriginInput(nextOrigin);
      setDestinationInput(nextDest);

      if (nextOrigin && nextDest) {
        triggerDirections(resolveEndpoint(nextOrigin), resolveEndpoint(nextDest));
      }
      onCommandHandled();
    } else {
      setActiveTab("explore");
      if (pendingCommand.query) {
        setSearchInput(pendingCommand.query);
        void executeTextSearch(pendingCommand.query);
      }
      onCommandHandled();
    }
  }, [pendingCommand, placesLib]);

  const handleDirectionsToPlace = (place: PlaceMarkerData) => {
    setActiveTab("directions");
    const destLabel = place.address || place.name;
    setDestinationInput(destLabel);
    if (userLocation) {
      setOriginInput("My Current Location");
      triggerDirections(userLocation, place.position);
    } else if (originInput.trim()) {
      triggerDirections(resolveEndpoint(originInput), place.position);
    }
  };

  const handleSwapEndpoints = () => {
    const prevOrigin = originInput;
    const prevDest = destinationInput;
    setOriginInput(prevDest);
    setDestinationInput(prevOrigin);
    if (prevDest.trim() && prevOrigin.trim()) {
      triggerDirections(resolveEndpoint(prevDest), resolveEndpoint(prevOrigin));
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header */}
      <div className="p-4 border-b border-white/10 bg-[#0a0f18]/90 flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600/40 to-pink-500/40 border border-violet-500/30 flex items-center justify-center">
              <MapPin size={16} className="text-pink-300" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-wide text-white">
                Zoya Google Maps
              </h2>
              <p className="text-[11px] text-white/45">
                Places Search &amp; Live Route Directions
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => requestUserLocation(activeTab === "directions" && !originInput)}
              disabled={isLocating}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white/80 hover:text-white transition-colors"
              title="Center on my current location"
            >
              {isLocating ? (
                <Loader2 size={14} className="animate-spin text-violet-300" />
              ) : (
                <LocateFixed size={14} className="text-cyan-300" />
              )}
              <span className="hidden sm:inline">My Location</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close Google Maps panel"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1.5 bg-white/5 p-1 rounded-xl border border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab("explore")}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === "explore"
                ? "bg-gradient-to-r from-violet-600 to-pink-600 text-white shadow"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <Search size={13} />
            Explore Places
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("directions")}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === "directions"
                ? "bg-gradient-to-r from-violet-600 to-pink-600 text-white shadow"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <Navigation size={13} />
            Directions
          </button>
        </div>

        {/* Explore Search Bar */}
        {activeTab === "explore" && (
          <div className="relative">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void executeTextSearch(searchInput);
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
                />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    setShowSearchDropdown(true);
                  }}
                  onFocus={() => setShowSearchDropdown(true)}
                  placeholder="Search restaurants, landmarks, cities..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-violet-500/60 focus:bg-white/10 transition-all"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      setShowSearchDropdown(false);
                      setSearchError(null);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchInput.trim()}
                className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-medium text-white transition-colors shrink-0 flex items-center gap-1.5"
              >
                {isSearching ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Search size={13} />
                )}
                Find
              </button>
            </form>

            {/* Autocomplete Dropdown */}
            {showSearchDropdown &&
              (searchSuggestions.length > 0 || isSearchAutocompleteLoading) && (
                <div className="absolute left-0 right-0 top-full mt-1.5 bg-[#0d1421] border border-white/15 rounded-xl shadow-2xl overflow-hidden z-30 max-h-56 overflow-y-auto">
                  {isSearchAutocompleteLoading && searchSuggestions.length === 0 ? (
                    <div className="px-3 py-2.5 text-xs text-white/50 flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin" />
                      Searching places...
                    </div>
                  ) : (
                    searchSuggestions.map((suggestion, idx) => (
                      <button
                        key={suggestion.placePrediction?.placeId || idx}
                        type="button"
                        onClick={() => void handleSelectSearchSuggestion(suggestion)}
                        className="w-full text-left px-3 py-2.5 text-xs text-white/85 hover:bg-violet-500/20 border-b border-white/5 last:border-b-0 flex items-start gap-2 transition-colors"
                      >
                        <MapPin
                          size={13}
                          className="text-pink-400 shrink-0 mt-0.5"
                        />
                        <span className="line-clamp-2">
                          {suggestion.placePrediction?.text.text}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}

            {searchError && (
              <p className="text-[11px] text-amber-300 mt-1.5 px-1">{searchError}</p>
            )}
          </div>
        )}

        {/* Directions Controls */}
        {activeTab === "directions" && (
          <div className="space-y-2">
            <div className="flex items-stretch gap-2">
              <div className="flex-1 space-y-1.5">
                {/* Origin */}
                <div className="relative">
                  <input
                    type="text"
                    value={originInput}
                    onChange={(e) => {
                      setOriginInput(e.target.value);
                      setShowOriginDropdown(true);
                    }}
                    onFocus={() => setShowOriginDropdown(true)}
                    placeholder="Start location (e.g. Bandra, Mumbai)"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 pr-20 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-violet-500/60"
                  />
                  <button
                    type="button"
                    onClick={() => requestUserLocation(true)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 text-[10px] font-medium transition-colors"
                  >
                    Use GPS
                  </button>

                  {showOriginDropdown && originSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-[#0d1421] border border-white/15 rounded-xl shadow-2xl overflow-hidden z-30 max-h-44 overflow-y-auto">
                      {originSuggestions.map((s, idx) => (
                        <button
                          key={s.placePrediction?.placeId || idx}
                          type="button"
                          onClick={() => {
                            setOriginInput(s.placePrediction?.text.text || "");
                            setShowOriginDropdown(false);
                            resetOriginSession();
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-white/85 hover:bg-violet-500/20 border-b border-white/5 last:border-b-0 flex items-start gap-2"
                        >
                          <MapPin size={12} className="text-cyan-400 shrink-0 mt-0.5" />
                          <span className="line-clamp-1">
                            {s.placePrediction?.text.text}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Destination */}
                <div className="relative">
                  <input
                    type="text"
                    value={destinationInput}
                    onChange={(e) => {
                      setDestinationInput(e.target.value);
                      setShowDestDropdown(true);
                    }}
                    onFocus={() => setShowDestDropdown(true)}
                    placeholder="Destination (e.g. Gateway of India)"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-violet-500/60"
                  />
                  {showDestDropdown && destSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-[#0d1421] border border-white/15 rounded-xl shadow-2xl overflow-hidden z-30 max-h-44 overflow-y-auto">
                      {destSuggestions.map((s, idx) => (
                        <button
                          key={s.placePrediction?.placeId || idx}
                          type="button"
                          onClick={() => {
                            setDestinationInput(s.placePrediction?.text.text || "");
                            setShowDestDropdown(false);
                            resetDestSession();
                          }}
                          className="w-full text-left px-3 py-2 text-xs text-white/85 hover:bg-violet-500/20 border-b border-white/5 last:border-b-0 flex items-start gap-2"
                        >
                          <MapPin size={12} className="text-pink-400 shrink-0 mt-0.5" />
                          <span className="line-clamp-1">
                            {s.placePrediction?.text.text}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleSwapEndpoints}
                className="px-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white transition-colors flex items-center justify-center"
                title="Swap origin and destination"
              >
                <ArrowRightLeft size={14} className="rotate-90" />
              </button>
            </div>

            {/* Travel mode & Go */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
                {TRAVEL_MODES.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setTravelMode(id);
                      if (originInput.trim() && destinationInput.trim()) {
                        triggerDirections(
                          resolveEndpoint(originInput),
                          resolveEndpoint(destinationInput)
                        );
                      }
                    }}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      travelMode === id
                        ? "bg-violet-600 text-white"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon size={12} />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowOriginDropdown(false);
                  setShowDestDropdown(false);
                  triggerDirections(
                    resolveEndpoint(originInput),
                    resolveEndpoint(destinationInput)
                  );
                }}
                disabled={isRouting || !originInput.trim() || !destinationInput.trim()}
                className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 disabled:opacity-40 text-xs font-medium text-white flex items-center gap-1.5 transition-all"
              >
                {isRouting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Navigation size={13} />
                )}
                Route
              </button>
            </div>

            {routeError && (
              <p className="text-[11px] text-amber-300 px-1">{routeError}</p>
            )}
          </div>
        )}

        {locationError && (
          <p className="text-[11px] text-amber-300/90 px-1">{locationError}</p>
        )}
      </div>

      {/* Interactive Map Canvas (explicit non-zero height) */}
      <div className="relative flex-1 min-h-[380px] w-full bg-[#090d16]">
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={12}
          gestureHandling="greedy"
          mapTypeControl={false}
          fullscreenControl={false}
          streetViewControl={true}
          internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
          className="w-full h-full"
        >
          {/* User's Current Location Pin */}
          {userLocation && (
            <AdvancedMarker position={userLocation} title="Your Current Location" zIndex={30}>
              <Pin
                background="#06b6d4"
                borderColor="#cffafe"
                glyphColor="#ffffff"
                scale={0.95}
              />
            </AdvancedMarker>
          )}

          {/* Place Search Result Markers */}
          {markers.map((m) => (
            <React.Fragment key={m.id}>
              <PlaceMarkerWithInfo
                place={m}
                isSelected={m.id === selectedMarkerId}
                onSelect={() =>
                  setSelectedMarkerId((curr) => (curr === m.id ? null : m.id))
                }
                onDirectionsToPlace={handleDirectionsToPlace}
              />
            </React.Fragment>
          ))}

          {/* Route Endpoint Markers */}
          {activeTab === "directions" && routeSummary?.startLocation && (
            <AdvancedMarker
              position={routeSummary.startLocation}
              title="Route Start"
              zIndex={15}
            >
              <Pin
                background="#10b981"
                borderColor="#d1fae5"
                glyphColor="#ffffff"
                scale={0.9}
              />
            </AdvancedMarker>
          )}
          {activeTab === "directions" && routeSummary?.endLocation && (
            <AdvancedMarker
              position={routeSummary.endLocation}
              title="Route Destination"
              zIndex={16}
            >
              <Pin
                background="#ec4899"
                borderColor="#fbcfe8"
                glyphColor="#ffffff"
                scale={1.05}
              />
            </AdvancedMarker>
          )}

          {/* Modern Routes API Overlay */}
          <RouteOverlay
            origin={activeRouteReq.origin}
            destination={activeRouteReq.destination}
            travelMode={travelMode}
            triggerKey={activeRouteReq.key}
            onRouteResult={setRouteSummary}
            onRouteLoading={setIsRouting}
            onRouteError={setRouteError}
          />
        </GoogleMap>

        {/* Floating Route Summary Card */}
        {activeTab === "directions" && routeSummary && (
          <div className="absolute bottom-4 left-4 right-4 sm:right-auto sm:min-w-[260px] bg-[#090f1c]/90 border border-violet-500/35 rounded-xl p-3 backdrop-blur-xl shadow-2xl flex items-center justify-between gap-4 pointer-events-auto">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-500/20 border border-violet-400/30 flex items-center justify-center text-violet-300">
                <RouteIcon size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span>{formatDuration(routeSummary.durationMillis)}</span>
                  <span className="text-white/30">&bull;</span>
                  <span className="text-violet-300">
                    {formatDistance(routeSummary.distanceMeters)}
                  </span>
                </div>
                <p className="text-[11px] text-white/50 flex items-center gap-1 mt-0.5">
                  <Clock size={11} />
                  <span>{travelMode.replace("_", " ").toLowerCase()} route</span>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function GoogleMapsPanel({
  isOpen,
  onClose,
  apiKey,
  pendingCommand,
  onCommandHandled,
}: GoogleMapsPanelProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/65 backdrop-blur-xs z-40"
            aria-hidden="true"
          />

          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed inset-y-0 right-0 w-full max-w-[680px] bg-[#070b12]/98 border-l border-white/10 text-white z-40 flex flex-col shadow-2xl backdrop-blur-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Zoya Google Maps"
          >
            {apiKey ? (
              <APIProvider
                apiKey={apiKey}
                libraries={["places", "marker", "routes"]}
                language="en"
                region="IN"
              >
                <MapsInnerContent
                  onClose={onClose}
                  pendingCommand={pendingCommand}
                  onCommandHandled={onCommandHandled}
                />
              </APIProvider>
            ) : (
              <div className="flex flex-col h-full">
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin size={18} className="text-pink-300" />
                    <h2 className="text-base font-semibold">Zoya Google Maps</h2>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                  <MapPin size={32} className="text-violet-400 opacity-70" />
                  <h3 className="text-sm font-medium text-white/90">
                    Google Maps API key is initializing or unavailable
                  </h3>
                  <p className="text-xs text-white/50 max-w-sm leading-relaxed">
                    Please make sure <code className="text-violet-300">VITE_GOOGLE_MAPS_API_KEY</code> is configured in your environment secrets and reload the app.
                  </p>
                </div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
