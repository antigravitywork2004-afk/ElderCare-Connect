export type Coords = { latitude: number; longitude: number } | null;

export async function captureLocation(timeoutMs = 6000): Promise<Coords> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (c: Coords) => {
      if (done) return;
      done = true;
      resolve(c);
    };
    const t = setTimeout(() => finish(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(t);
        finish({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => {
        clearTimeout(t);
        finish(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export async function reverseGeocode(lat: number, lng: number, timeoutMs = 3000): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`,
      {
        headers: { "User-Agent": "ElderCare-SOS-Alert" },
        signal: controller.signal,
      }
    );
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      return data.display_name || null;
    }
  } catch (e) {
    console.error("Reverse geocoding failed:", e);
  }
  clearTimeout(t);
  return null;
}
