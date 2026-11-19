/**
 * lib/locate.ts
 *
 * One-shot "where am I and which Bezirk is that?" helper used by the welcome
 * flow. Mirrors the logic in the Map tab but returns a result instead of
 * driving UI, and throws translated-key errors the caller can display.
 */
import { Platform } from "react-native";
import * as Location from "expo-location";
import {
  reverseGeocode,
  formatNominatimAddress,
  type NominatimAddress,
} from "./dataFetcher";
import {
  detectDistrictFromAddress,
  detectDistrictFromCoordinates,
} from "./districtDetector";

export interface LocateResult {
  districtId: number | null;
  address: string;
  coords: [number, number];
}

/** Error whose message is an i18n key (e.g. "geoErrPermission"). */
export class LocateError extends Error {}

async function getPosition(): Promise<[number, number]> {
  if (Platform.OS === "web") {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      throw new LocateError("browserNoGeo");
    }
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
        (err) =>
          reject(
            new LocateError(
              err.code === 1 ? "geoErrPermission"
              : err.code === 3 ? "geoErrTimeout"
              : "geoErrUnavailable"
            )
          ),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
      );
    });
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") throw new LocateError("geoErrPermission");
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new LocateError("servicesDisabled");
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const loc = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LocateError("geoErrTimeout")), 20_000);
      }),
    ]);
    return [loc.coords.latitude, loc.coords.longitude];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function locateDistrict(): Promise<LocateResult> {
  const [lat, lon] = await getPosition();

  let address = "";
  let fields: NominatimAddress | undefined;
  try {
    const rev = await reverseGeocode(lat, lon);
    fields = rev.address;
    address = formatNominatimAddress(rev.address, rev.display_name);
  } catch (err) {
    console.warn("[locate] reverseGeocode failed:", err);
  }

  const districtId =
    detectDistrictFromAddress(fields, lat, lon) ??
    detectDistrictFromCoordinates(lat, lon);

  return { districtId, address, coords: [lat, lon] };
}
