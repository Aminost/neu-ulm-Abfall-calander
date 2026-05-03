import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Keyboard,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import * as Location from "expo-location";
import { Search, Locate, ChevronDown, X } from "lucide-react-native";
import { Alert } from "react-native";
import { BEZIRKE } from "../../lib/constants";
import { RECYCLING_LOCATIONS } from "../../lib/locations";
import { searchAddress, reverseGeocode, formatNominatimAddress, looksLikeCoordinates } from "../../lib/dataFetcher";
import type { NominatimAddress } from "../../lib/dataFetcher";
import {
  detectDistrictFromCoordinates,
  detectDistrictFromAddress,
} from "../../lib/districtDetector";
import { useTranslation } from "../../lib/i18n";
import { useAppState } from "../../lib/appState";

// ── Filter configuration ────────────────────────────────────────────────────────

const FILTER_TYPES = [
  { key: "",                    label: "Alle",          color: "#374151" },
  { key: "Wertstoffhof",        label: "Wertstoffhof",  color: "#065f46" },
  { key: "Wertstoffinsel",      label: "Wertstoffinsel",color: "#1d4ed8" },
  { key: "Glascontainer",       label: "Glas",          color: "#7c3aed" },
  { key: "Altkleidercontainer", label: "Altkleider",    color: "#b45309" },
  { key: "Grüngutsammelstelle", label: "Grüngut",       color: "#059669" },
] as const;

// ── Leaflet HTML ────────────────────────────────────────────────────────────────

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

  /* ── Messaging bridge (WebView on native, postMessage on web) ── */
  function send(msg){
    var j=JSON.stringify(msg);
    if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(j);
    else window.parent.postMessage(j,'*');
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
    send({type:'openUrl', url:url});
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

  /* ── Message handler (filter + location updates from React) ── */
  function handleMsg(e){
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
  }
  document.addEventListener('message', handleMsg);
  window.addEventListener('message', handleMsg);
})();
</script>
</body>
</html>`;

// ── Component ──────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const { t } = useTranslation();
  const webviewRef = useRef<WebView>(null);

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

  // Mirror the AppState address into the search box. NEVER show raw
  // coordinates — if the persisted address is a coord-only string (legacy
  // data from before reverseGeocode was robust), surface a friendly text
  // label instead, so the user always sees text and can type a new address.
  useEffect(() => {
    if (!address) {
      setSearchQuery("");
      return;
    }
    if (looksLikeCoordinates(address)) {
      // legacy stored coords → show empty so the placeholder ("Adresse suchen…")
      // is visible; the user types a real query.
      setSearchQuery("");
    } else {
      setSearchQuery(address);
    }
  }, [address]);

  // ── Filter ──

  const handleFilterChange = (key: string) => {
    const next = key === activeFilter ? "" : key;
    setActiveFilter(next);
    const types = next ? [next] : [];
    webviewRef.current?.injectJavaScript(`
      window.dispatchEvent(new MessageEvent('message',{
        data:JSON.stringify({type:'setFilter',types:${JSON.stringify(types)}})
      }));true;
    `);
  };

  // ── Search ──

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (q.length < 2) return;

    // If the user pasted (or the search field contains) raw coordinates
    // like "48.42850, 10.03200", do a reverse geocode and convert to a
    // proper textual address — never send numbers to Nominatim's /search.
    if (looksLikeCoordinates(q)) {
      const [latStr, lonStr] = q.split(",").map((p) => p.trim());
      const lat = parseFloat(latStr);
      const lon = parseFloat(lonStr);
      if (isFinite(lat) && isFinite(lon)) {
        setIsSearching(true);
        try {
          const rev = await reverseGeocode(lat, lon);
          const fullAddress = formatNominatimAddress(rev.address, rev.display_name);
          if (fullAddress) {
            setSearchQuery(fullAddress);
            setSuggestions([
              { label: fullAddress, lat, lon, address: rev.address },
            ]);
            return;
          }
        } catch (err) {
          console.warn("[Map] reverseGeocode (from search input) failed:", err);
        } finally {
          setIsSearching(false);
        }
      }
      // fall through if reverse-lookup failed — but we never want to send
      // raw coords to /search, so bail out cleanly here.
      Alert.alert(t("searchError"), t("genericLocationError"));
      return;
    }

    setIsSearching(true);
    setSuggestions([]);
    Keyboard.dismiss();
    try {
      const results = await searchAddress(q);
      console.info(`[Map] search "${q}" → ${results.length} results inside Neu-Ulm`);
      if (results.length === 0) {
        Alert.alert(t("addressNotFound"), q);
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
      console.warn("[Map] search failed:", err);
      Alert.alert(t("searchError"), t("genericLocationError"));
    } finally {
      setIsSearching(false);
    }
  };

  const handleSuggestionSelect = async (item: { label: string; lat: number; lon: number; address: NominatimAddress }) => {
    setSuggestions([]);

    // Build the COMPLETE address from Nominatim's structured fields
    // (street + house number, postcode + city, Stadtteil) — falls back to
    // a trimmed display_name if structured fields are missing.
    const fullAddress = formatNominatimAddress(item.address, item.label);
    setSearchQuery(fullAddress);

    // Prefer the richer suburb/neighbourhood name match; coords as fallback.
    const detected =
      detectDistrictFromAddress(item.address, item.lat, item.lon) ??
      detectDistrictFromCoordinates(item.lat, item.lon);

    console.info(
      `[Map] suggestion selected:`,
      `\n  address: ${fullAddress}`,
      `\n  coords:  [${item.lat}, ${item.lon}]`,
      `\n  detected Bezirk: ${detected ?? "(none)"}`,
      `\n  Nominatim suburb/city_district/neighbourhood/hamlet: "${item.address?.suburb ?? ""}"/"${item.address?.city_district ?? ""}"/"${item.address?.neighbourhood ?? ""}"/"${item.address?.hamlet ?? ""}"`
    );

    // Atomic update — district + address + coords + autoDetected propagate
    // together to Home/Settings/this screen via AppState.
    await applyDetectedLocation({
      districtId: detected ?? districtId,
      address:    fullAddress,
      coords:     [item.lat, item.lon],
      autoDetected: detected !== null,
    });

    if (detected !== null) {
      const name = BEZIRKE.find((b) => b.id === detected)?.name ?? `Bezirk ${detected}`;
      Alert.alert(t("addressSaved"), `${fullAddress}\n\n${name}`);
    } else {
      Alert.alert(t("addressOutsideTitle"), t("addressOutsideBody"));
    }

    webviewRef.current?.injectJavaScript(`
      window.dispatchEvent(new MessageEvent('message',{
        data:JSON.stringify({type:'setUserLocation',lat:${item.lat},lng:${item.lon}})
      }));true;
    `);
  };

  // ── Location ──

  /** Cross-platform GPS fix: web uses navigator.geolocation directly (more
   *  reliable than expo-location's web wrapper). Native uses expo-location
   *  with permission + services-enabled check + hard timeout. */
  const getCurrentPosition = async (): Promise<[number, number]> => {
    if (Platform.OS === "web") {
      console.info("[Map] getCurrentPosition: web — navigator.geolocation");
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        throw new Error(t("browserNoGeo"));
      }
      return new Promise<[number, number]>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
          (err) => {
            const msg =
              err.code === 1 ? t("geoErrPermission")
              : err.code === 2 ? t("geoErrUnavailable")
              : err.code === 3 ? t("geoErrTimeout")
              : `${t("genericLocationError")} (${err.code}): ${err.message}`;
            reject(new Error(msg));
          },
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
        );
      });
    }

    // Native (iOS / Android) — full check chain
    console.info("[Map] getCurrentPosition: native — requesting permission");
    const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      const tail = canAskAgain
        ? t("permGrantPlease")
        : Platform.OS === "ios"
          ? t("permIosPath")
          : t("permAndroidPath");
      throw new Error(`${t("geoErrPermission")} ${tail}`);
    }

    // Some Android builds report granted but services are switched off.
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      throw new Error(t("servicesDisabled"));
    }

    // Hard timeout — Android can hang for minutes if the GPS chip is cold.
    const positionPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(t("geoErrTimeout"))), 20_000)
    );
    const loc = await Promise.race([positionPromise, timeoutPromise]);
    return [loc.coords.latitude, loc.coords.longitude];
  };

  const handleLocate = async () => {
    setIsLocating(true);
    setSuggestions([]);
    try {
      const [latitude, longitude] = await getCurrentPosition();
      console.info(`[Map] handleLocate: got coords [${latitude}, ${longitude}]`);

      // ── 3. Reverse geocode → always produce a HUMAN-READABLE address.
      // We never show raw lat/lon numbers in the UI — if reverseGeocode fails
      // (network, CORS, rate-limit, …) we use a friendly placeholder instead.
      let fullAddress = "";
      let addressFields: NominatimAddress | undefined;
      try {
        const rev = await reverseGeocode(latitude, longitude);
        fullAddress = formatNominatimAddress(rev.address, rev.display_name);
        addressFields = rev.address;
        console.info(
          `[Map] handleLocate: reverseGeocode →`,
          `\n  fullAddress: ${fullAddress}`,
          `\n  suburb/city_district/neighbourhood/hamlet:`,
          `"${rev.address?.suburb ?? ""}"/"${rev.address?.city_district ?? ""}"/"${rev.address?.neighbourhood ?? ""}"/"${rev.address?.hamlet ?? ""}"`
        );
      } catch (err) {
        console.warn("[Map] reverseGeocode failed:", err);
      }

      // ── 4. Detect Bezirk ─────────────────────────────────────────────────
      const detected =
        detectDistrictFromAddress(addressFields, latitude, longitude) ??
        detectDistrictFromCoordinates(latitude, longitude);
      console.info(`[Map] handleLocate: detected Bezirk = ${detected ?? "(none)"}`);

      // If reverseGeocode failed, build a clean text fallback (NEVER raw
      // coordinates). Use the Bezirk name we just detected as the label.
      if (!fullAddress) {
        const bezirkName =
          detected !== null
            ? (BEZIRKE.find((b) => b.id === detected)?.name ?? `Bezirk ${detected}`)
            : t("currentLocation");
        fullAddress = `${t("currentLocation")} · ${bezirkName}`;
      }
      setSearchQuery(fullAddress);

      // ── 5. Atomic state update — propagates to Home + Settings ───────────
      await applyDetectedLocation({
        districtId: detected ?? districtId,
        address:    fullAddress,
        coords:     [latitude, longitude],
        autoDetected: detected !== null,
      });

      if (detected !== null) {
        const name = BEZIRKE.find((b) => b.id === detected)?.name ?? `Bezirk ${detected}`;
        Alert.alert(t("locationDetected"), `${fullAddress}\n\n${name}`);
      } else {
        Alert.alert(t("outsideRegionTitle"), t("outsideRegionBody"));
      }
      // (alerts above already reflect current language; AppState propagation
      // ensures the address line and Bezirk badge in Home + Settings re-render
      // immediately too.)

      webviewRef.current?.injectJavaScript(`
        window.dispatchEvent(new MessageEvent('message',{
          data:JSON.stringify({type:'setUserLocation',lat:${latitude},lng:${longitude}})
        }));true;
      `);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("genericLocationError");
      console.warn("[Map] handleLocate error:", err);
      Alert.alert(t("genericLocationError"), msg);
    } finally {
      setIsLocating(false);
    }
  };

  // ── District ──

  const handleDistrictSelect = async (id: number) => {
    setShowDistrictPicker(false);
    await updateDistrict(id, searchQuery, false);
  };

  // ── WebView messages (route planning) ──

  const handleWebViewMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "openUrl") {
        Linking.openURL(msg.url);
      }
    } catch { /* ignore */ }
  };

  const currentDistrict = BEZIRKE.find((b) => b.id === districtId)?.name ?? `Bezirk ${districtId}`;
  const locationsJson = JSON.stringify(RECYCLING_LOCATIONS);
  // Read coords from shared AppState so the user pin stays in sync after a
  // location change on any tab (search-suggestion or GPS).
  const coordJson = coords ? JSON.stringify(coords) : "null";
  const leafletHtml = buildLeafletHtml(locationsJson, coordJson);

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

      {/* ── Map ── */}
      <View
        className="flex-1 mx-4 mb-4 rounded-3xl overflow-hidden border border-gray-100"
        style={{ shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 }}
      >
        <WebView
          ref={webviewRef}
          source={{ html: leafletHtml }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          allowsInlineMediaPlayback
          {...(Platform.OS === "android" && {
            allowUniversalAccessFromFileURLs: true,
            allowFileAccess: true,
          })}
          style={{ flex: 1, backgroundColor: "#f3f4f6" }}
          onMessage={handleWebViewMessage}
          renderLoading={() => (
            <View className="absolute inset-0 items-center justify-center bg-gray-50">
              <ActivityIndicator size="large" color="#10b981" />
            </View>
          )}
          startInLoadingState
        />
      </View>
    </SafeAreaView>
  );
}
