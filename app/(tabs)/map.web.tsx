/**
 * Web-specific Map screen — replaces map.tsx on web builds.
 * Uses a native <iframe> (via DOM APIs) instead of react-native-webview.
 */

import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Search, Locate, ChevronDown, X } from "lucide-react-native";
import { BEZIRKE } from "../../lib/constants";
import { RECYCLING_LOCATIONS } from "../../lib/locations";
import {
  searchAddress,
  reverseGeocode,
  formatNominatimAddress,
} from "../../lib/dataFetcher";
import type { NominatimAddress } from "../../lib/dataFetcher";
import {
  detectDistrictFromCoordinates,
  detectDistrictFromAddress,
} from "../../lib/districtDetector";
import { useTranslation } from "../../lib/i18n";
import { useAppState } from "../../lib/appState";

// ── Filter config (shared with map.tsx) ───────────────────────────────────────

const FILTER_TYPES = [
  { key: "",                    label: "Alle",          color: "#374151" },
  { key: "Wertstoffhof",        label: "Wertstoffhof",  color: "#065f46" },
  { key: "Wertstoffinsel",      label: "Wertstoffinsel",color: "#1d4ed8" },
  { key: "Glascontainer",       label: "Glas",          color: "#7c3aed" },
  { key: "Altkleidercontainer", label: "Altkleider",    color: "#b45309" },
  { key: "Grüngutsammelstelle", label: "Grüngut",       color: "#059669" },
] as const;

// ── Leaflet HTML ───────────────────────────────────────────────────────────────

const buildLeafletHtml = (locations: string, userCoord: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body,#map { width:100%; height:100%; }
  .pin {
    width:28px; height:28px; border-radius:50% 50% 50% 0;
    transform:rotate(-45deg); border:2px solid rgba(255,255,255,0.9);
    box-shadow:0 2px 8px rgba(0,0,0,0.35);
  }
  .user-dot {
    width:16px; height:16px; border-radius:50%;
    background:#3b82f6; border:3px solid #fff;
    box-shadow:0 0 0 5px rgba(59,130,246,0.3), 0 2px 6px rgba(0,0,0,0.2);
  }
  .leaflet-popup-content-wrapper {
    border-radius:16px; box-shadow:0 8px 30px rgba(0,0,0,0.12); border:none;
  }
  .leaflet-popup-content { margin:14px 16px; min-width:200px; }
  .leaflet-popup-tip-container { margin-top:-1px; }
  .p-title { font-weight:700; font-size:14px; color:#111827; line-height:1.3; margin-bottom:4px; }
  .p-badge {
    display:inline-block; padding:3px 10px; border-radius:20px;
    font-size:11px; font-weight:600; color:#fff; margin-bottom:6px;
  }
  .p-detail { font-size:12px; color:#6b7280; margin-top:3px; line-height:1.4; }
  .route-btn {
    display:block; width:100%; margin-top:10px; padding:9px 14px;
    background:#10b981; color:#fff; border:none; border-radius:10px;
    font-size:13px; cursor:pointer; font-weight:600; text-align:center;
    letter-spacing:0.01em;
  }
  .route-btn:hover { background:#059669; }
  .route-btn:active { background:#047857; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var map = L.map('map',{zoomControl:true}).setView([48.3974,10.0003],12);

  /* ── Official OpenStreetMap tiles ── */
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  }).addTo(map);

  var COLORS={
    'Wertstoffhof':'#065f46','Wertstoffinsel':'#1d4ed8',
    'Glascontainer':'#7c3aed','Altkleidercontainer':'#b45309',
    'Grüngutsammelstelle':'#059669'
  };
  function colorFor(t){return COLORS[t]||'#374151';}
  function makeIcon(t){
    return L.divIcon({
      html:'<div class="pin" style="background:'+colorFor(t)+';"></div>',
      className:'',iconSize:[28,28],iconAnchor:[14,28]
    });
  }

  /* ── User position — updated by setUserLocation messages ── */
  var userPos = ${userCoord};

  /* ── Route planning — exposed on window so popup onclick can call it ── */
  window.openRoute = function(lat, lng){
    var dest = lat+','+lng;
    var url;
    if(userPos){
      /* Include current user location as origin */
      url = 'https://www.google.com/maps/dir/?api=1'
          + '&origin=' + userPos[0] + ',' + userPos[1]
          + '&destination=' + dest
          + '&travelmode=driving';
    } else {
      url = 'https://www.google.com/maps/dir/?api=1'
          + '&destination=' + dest
          + '&travelmode=driving';
    }
    window.parent.postMessage(JSON.stringify({type:'openUrl', url:url}), '*');
  };

  var allLocs = ${locations};
  var markerLayer = L.layerGroup().addTo(map);
  var activeTypes = [];

  function renderMarkers(){
    markerLayer.clearLayers();
    allLocs.forEach(function(loc){
      if(activeTypes.length > 0 && activeTypes.indexOf(loc.type) === -1) return;
      var c = colorFor(loc.type);
      var popup =
        '<div class="p-title">'+loc.name+'</div>'+
        '<span class="p-badge" style="background:'+c+';">'+loc.type+'</span>'+
        (loc.address ? '<div class="p-detail">📍 '+loc.address+'</div>' : '')+
        (loc.operator ? '<div class="p-detail">🏢 '+loc.operator+'</div>' : '')+
        '<button class="route-btn" onclick="openRoute('+loc.lat+','+loc.lng+')">'+
        '🗺 Route in Google Maps planen</button>';
      L.marker([loc.lat, loc.lng], {icon: makeIcon(loc.type)})
        .bindPopup(popup, {maxWidth:260, minWidth:200})
        .addTo(markerLayer);
    });
  }
  renderMarkers();

  /* ── User location marker ── */
  var userMarker = null;
  function userIcon(){
    return L.divIcon({html:'<div class="user-dot"></div>',className:'',iconSize:[16,16],iconAnchor:[8,8]});
  }
  if(userPos){
    userMarker = L.marker([userPos[0],userPos[1]],{icon:userIcon()})
      .bindPopup('<b>Dein Standort</b>').addTo(map);
    map.setView([userPos[0],userPos[1]],15);
  }

  /* ── Message handler (filter + location updates from parent frame) ── */
  window.addEventListener('message', function(e){
    try{
      var data = e.data;
      var msg = JSON.parse(typeof data === 'string' ? data : JSON.stringify(data));
      if(msg.type === 'setUserLocation'){
        userPos = [msg.lat, msg.lng];
        if(!userMarker){
          userMarker = L.marker([msg.lat,msg.lng],{icon:userIcon()})
            .bindPopup('<b>Dein Standort</b>').addTo(map);
        } else {
          userMarker.setLatLng([msg.lat,msg.lng]);
        }
        map.setView([msg.lat,msg.lng],15,{animate:true});
      } else if(msg.type === 'setFilter'){
        activeTypes = msg.types || [];
        renderMarkers();
      }
    }catch(_){}
  });
})();
</script>
</body>
</html>`;

// ── Component ──────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const { t } = useTranslation();
  const mapContainerRef = useRef<View>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Shared state — district/address/coords stay in lock-step across all tabs
  const {
    districtId,
    address,
    coords,
    updateDistrict,
    applyDetectedLocation,
  } = useAppState();

  const [searchQuery, setSearchQuery] = useState(address);
  const [isLocating, setIsLocating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [showDistrictPicker, setShowDistrictPicker] = useState(false);
  const [suggestions, setSuggestions] = useState<{ label: string; lat: number; lon: number; address: NominatimAddress }[]>([]);
  const [activeFilter, setActiveFilter] = useState("");

  // Mirror the AppState address into the search box.
  useEffect(() => {
    if (address) setSearchQuery(address);
  }, [address]);

  // Build and mount the Leaflet iframe once
  useEffect(() => {
    const container = mapContainerRef.current as unknown as HTMLElement | null;
    if (!container) return;

    const locJson = JSON.stringify(RECYCLING_LOCATIONS);
    const coordJson = coords ? JSON.stringify(coords) : "null";
    const html = buildLeafletHtml(locJson, coordJson);

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "width:100%;height:100%;border:none;";
    iframe.srcdoc = html;
    container.appendChild(iframe);
    iframeRef.current = iframe;

    // Handle route planning messages from iframe
    const handleMsg = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string);
        if (msg.type === "openUrl") window.open(msg.url, "_blank", "noopener");
      } catch { /* ignore */ }
    };
    window.addEventListener("message", handleMsg);

    return () => {
      window.removeEventListener("message", handleMsg);
      if (container.contains(iframe)) container.removeChild(iframe);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pan map when shared coords change (any tab can trigger this)
  useEffect(() => {
    if (!coords || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      JSON.stringify({ type: "setUserLocation", lat: coords[0], lng: coords[1] }),
      "*"
    );
  }, [coords]);

  // ── Filter ──

  const handleFilterChange = (key: string) => {
    const next = key === activeFilter ? "" : key;
    setActiveFilter(next);
    const types = next ? [next] : [];
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ type: "setFilter", types }),
      "*"
    );
  };

  // ── Search ──

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    setIsSearching(true);
    setSuggestions([]);
    Keyboard.dismiss();
    try {
      const results = await searchAddress(q);
      console.info(`[MapWeb] search "${q}" → ${results.length} results inside Neu-Ulm`);
      if (results.length === 0) {
        Alert.alert(
          "Keine Treffer",
          `Für "${q}" wurde keine Adresse in Neu-Ulm gefunden. Bitte Straße + Hausnummer prüfen.`
        );
        return;
      }
      setSuggestions(
        results.slice(0, 6).map((r) => ({
          label:   r.display_name,
          lat:     parseFloat(r.lat),
          lon:     parseFloat(r.lon),
          address: r.address,
        }))
      );
    } catch (err) {
      console.warn("[MapWeb] search failed:", err);
      Alert.alert("Suche fehlgeschlagen", "Adresssuche konnte nicht ausgeführt werden. Bitte später erneut versuchen.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSuggestionSelect = async (item: { label: string; lat: number; lon: number; address: NominatimAddress }) => {
    setSuggestions([]);

    // Build COMPLETE address from Nominatim's structured fields
    const fullAddress = formatNominatimAddress(item.address, item.label);
    setSearchQuery(fullAddress);

    // Stadtteil-name match preferred; coords as fallback
    const detected =
      detectDistrictFromAddress(item.address, item.lat, item.lon) ??
      detectDistrictFromCoordinates(item.lat, item.lon);

    console.info(
      `[MapWeb] suggestion selected:`,
      `\n  address: ${fullAddress}`,
      `\n  coords:  [${item.lat}, ${item.lon}]`,
      `\n  detected Bezirk: ${detected ?? "(none)"}`
    );

    // Atomic update — district + address + coords + autoDetected propagate
    // together to Home/Settings via AppState.
    await applyDetectedLocation({
      districtId: detected ?? districtId,
      address:    fullAddress,
      coords:     [item.lat, item.lon],
      autoDetected: detected !== null,
    });

    if (detected !== null) {
      const name = BEZIRKE.find((b) => b.id === detected)?.name ?? `Bezirk ${detected}`;
      Alert.alert("Adresse gespeichert", `${fullAddress}\n\n${name}`);
    } else {
      Alert.alert(
        "Adresse außerhalb",
        `Diese Adresse liegt außerhalb der erkennbaren Stadtteile von Neu-Ulm. Der bisher gewählte Bezirk bleibt aktiv.`
      );
    }
  };

  // ── Location (browser geolocation) ──

  const handleLocate = async () => {
    if (!navigator.geolocation) {
      Alert.alert("Geolocation nicht unterstützt", "Dieser Browser unterstützt keine Standortermittlung.");
      return;
    }
    setIsLocating(true);
    setSuggestions([]);
    try {
      console.info("[MapWeb] handleLocate: requesting browser geolocation…");
      const pos: GeolocationPosition = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12_000,
          maximumAge: 0,
        })
      );
      const { latitude, longitude } = pos.coords;
      console.info(`[MapWeb] handleLocate: got coords [${latitude}, ${longitude}]`);

      // Reverse geocode for COMPLETE address (best-effort)
      let fullAddress = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      let addressFields: NominatimAddress | undefined;
      try {
        const rev = await reverseGeocode(latitude, longitude);
        fullAddress = formatNominatimAddress(rev.address, rev.display_name) || fullAddress;
        addressFields = rev.address;
        console.info(`[MapWeb] handleLocate: reverseGeocode → ${fullAddress}`);
      } catch (err) {
        console.warn("[MapWeb] reverseGeocode failed:", err);
      }
      setSearchQuery(fullAddress);

      const detected =
        detectDistrictFromAddress(addressFields, latitude, longitude) ??
        detectDistrictFromCoordinates(latitude, longitude);
      console.info(`[MapWeb] handleLocate: detected Bezirk = ${detected ?? "(none)"}`);

      // Atomic state update — propagates to Home + Settings via AppState
      await applyDetectedLocation({
        districtId: detected ?? districtId,
        address:    fullAddress,
        coords:     [latitude, longitude],
        autoDetected: detected !== null,
      });

      if (detected !== null) {
        const name = BEZIRKE.find((b) => b.id === detected)?.name ?? `Bezirk ${detected}`;
        Alert.alert("Standort erkannt", `${fullAddress}\n\n${name}`);
      } else {
        Alert.alert(
          "Außerhalb von Neu-Ulm",
          `Dein Standort scheint außerhalb der bekannten Stadtteile zu liegen. Der bisher gewählte Bezirk bleibt aktiv.`
        );
      }
    } catch (err) {
      console.warn("[MapWeb] geolocation error:", err);
      const msg = err instanceof GeolocationPositionError
        ? (err.code === 1 ? "Standort-Zugriff im Browser verweigert. Bitte in den Browser-Einstellungen erlauben."
           : err.code === 2 ? "Standort nicht verfügbar. Bitte WLAN/GPS aktivieren und erneut versuchen."
           : "Standortermittlung dauerte zu lange. Bitte erneut versuchen.")
        : "Standort konnte nicht ermittelt werden.";
      Alert.alert("Standort-Fehler", msg);
    } finally {
      setIsLocating(false);
    }
  };

  // ── District ──

  const handleDistrictSelect = async (id: number) => {
    setShowDistrictPicker(false);
    // Manual pick — clear autoDetected, keep current address
    await updateDistrict(id, address, false);
  };

  const currentDistrict = BEZIRKE.find((b) => b.id === districtId)?.name ?? `Bezirk ${districtId}`;

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* ── Header ── */}
      <View className="px-6 pt-6 pb-3">
        <Text className="text-3xl font-bold text-gray-900 tracking-tight mb-4">
          {t("map")}
        </Text>

        {/* Search row */}
        <View className="flex-row gap-2 mb-3">
          <View className="flex-1 flex-row items-center bg-white border border-gray-200 rounded-2xl px-4">
            <Search size={16} color="#9ca3af" />
            <TextInput
              className="flex-1 ml-2 text-sm text-gray-900 py-3"
              placeholder={t("addressSearch")}
              placeholderTextColor="#9ca3af"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(""); setSuggestions([]); }}>
                <X size={16} color="#9ca3af" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            onPress={handleSearch}
            disabled={isSearching}
            className="bg-emerald-500 px-4 rounded-2xl items-center justify-center"
          >
            {isSearching
              ? <ActivityIndicator size="small" color="#fff" />
              : <Search size={18} color="#fff" />}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleLocate}
            disabled={isLocating}
            className="bg-white border border-gray-200 px-3 rounded-2xl items-center justify-center"
          >
            {isLocating
              ? <ActivityIndicator size="small" color="#10b981" />
              : <Locate size={18} color="#10b981" />}
          </TouchableOpacity>
        </View>

        {/* Search suggestions */}
        {suggestions.length > 0 && (
          <View
            className="bg-white border border-gray-100 rounded-2xl mb-2 overflow-hidden"
            style={{ shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, elevation: 4 }}
          >
            {suggestions.map((s, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => handleSuggestionSelect(s)}
                className={`px-4 py-3 ${i < suggestions.length - 1 ? "border-b border-gray-50" : ""}`}
              >
                <Text className="text-sm text-gray-800" numberOfLines={2}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingBottom: 2 }}
          className="mb-2"
        >
          {FILTER_TYPES.map((f) => {
            const active = activeFilter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                onPress={() => handleFilterChange(f.key)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 20,
                  backgroundColor: active ? f.color : "#fff",
                  borderWidth: 1.5,
                  borderColor: active ? f.color : "#e5e7eb",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: active ? "#fff" : f.color }}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* District picker */}
        <TouchableOpacity
          onPress={() => setShowDistrictPicker(!showDistrictPicker)}
          className="flex-row items-center justify-between bg-white border border-gray-200 rounded-2xl px-4 py-3"
        >
          <Text className="text-sm font-medium text-gray-800 flex-1" numberOfLines={1}>
            {currentDistrict}
          </Text>
          <ChevronDown
            size={18}
            color="#6b7280"
            style={{ transform: [{ rotate: showDistrictPicker ? "180deg" : "0deg" }] }}
          />
        </TouchableOpacity>

        {showDistrictPicker && (
          <View
            className="bg-white border border-gray-100 rounded-2xl mt-1 overflow-hidden"
            style={{ shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8, elevation: 4 }}
          >
            <ScrollView style={{ maxHeight: 220 }}>
              {BEZIRKE.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  onPress={() => handleDistrictSelect(b.id)}
                  className={`px-4 py-3 border-b border-gray-50 flex-row items-center ${b.id === districtId ? "bg-emerald-50" : ""}`}
                >
                  <Text className={`text-sm flex-1 ${b.id === districtId ? "font-semibold text-emerald-700" : "text-gray-700"}`} numberOfLines={2}>
                    {b.name}
                  </Text>
                  {b.id === districtId && <Text className="text-emerald-600">✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* ── Map (iframe) ── */}
      <View
        ref={mapContainerRef}
        className="flex-1 mx-4 mb-4 rounded-3xl overflow-hidden border border-gray-100"
        style={{ shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 }}
      />
    </SafeAreaView>
  );
}
