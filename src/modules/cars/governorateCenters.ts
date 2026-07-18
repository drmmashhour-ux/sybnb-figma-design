// Hand-authored governorate-capital coordinates for the CARS radius-filter fallback when the
// browser denies/lacks geolocation (025/Carcad Phase F). There is no existing coordinate table in
// this repo covering all governorates: syriaData.ts and osmSyriaRoads.ts carry names only, and
// sr-geocoding.mjs's KNOWN_PLACES is a Damascus-neighborhood keyword gazetteer keyed by free text,
// not a governorate id. Keys here match SYRIA_GOVERNORATES' key values in syriaData.ts exactly.
export const GOVERNORATE_CENTERS: Record<string, { lat: number; lng: number }> = {
  damascus: { lat: 33.5138, lng: 36.2765 },
  'rif-dimashq': { lat: 33.5, lng: 36.4 },
  aleppo: { lat: 36.2021, lng: 37.1343 },
  homs: { lat: 34.7324, lng: 36.7137 },
  hama: { lat: 35.1318, lng: 36.7517 },
  latakia: { lat: 35.5317, lng: 35.7915 },
  tartus: { lat: 34.8886, lng: 35.8865 },
  idlib: { lat: 35.9306, lng: 36.6339 },
  daraa: { lat: 32.6189, lng: 36.1021 },
  sweida: { lat: 32.7094, lng: 36.5694 },
  'deir-ezzor': { lat: 35.3359, lng: 40.1408 },
  raqqa: { lat: 35.9528, lng: 39.0088 },
  hasakah: { lat: 36.5024, lng: 40.7477 },
  quneitra: { lat: 33.1264, lng: 35.8244 },
}
