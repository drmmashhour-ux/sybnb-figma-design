// Governorate-capital coordinates for centring maps on a searched location. Keys match
// SYRIA_GOVERNORATES' key values in syriaData.ts exactly. This is the shared/canonical copy in the
// search-engine layer; STR search (ResultsMap) centres its map on the searched governorate using it.
// (The Cars context keeps its own module-local copy in src/modules/cars/governorateCenters.ts —
// that bounded context is frozen and intentionally left untouched; the two tables can be
// consolidated here later.)
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

/** Centre coordinates for a governorate key, or null if unknown. */
export function governorateCenter(key: string | undefined | null): { lat: number; lng: number } | null {
  if (!key) return null
  return GOVERNORATE_CENTERS[key] || null
}
