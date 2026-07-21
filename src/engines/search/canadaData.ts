// Quebec-only for now (not full Canada) -- see docs/compliance notes. STR legality in Quebec is
// judged by an admin reviewer, not hard-coded here (municipal/borough/seasonal rules change and
// vary block-by-block within a single borough), but boroughs known to flatly ban short-term rental
// of a principal residence are flagged with `strBanned` so the wizard/admin can surface a warning
// rather than encode the legal judgment itself.
export type CanadaPlaceLabel = {
  key: string
  ar: string
  en: string
  fr: string
}

export type CanadianArea = CanadaPlaceLabel & {
  strBanned?: boolean
}

export type CanadianCity = CanadaPlaceLabel & {
  areas: CanadianArea[]
}

export type CanadianProvince = CanadaPlaceLabel & {
  cities: CanadianCity[]
}

// Montreal's 19 boroughs (arrondissements). Ville de Montréal STR bylaw (as researched, always
// re-confirm against montreal.ca before relying on this for a real submission): principal-residence
// STR is only permitted June 10 - Sept 10 in most boroughs (max 90 days/year); Lachine,
// Saint-Laurent, and Saint-Léonard prohibit it outright; secondary/investment properties are
// banned almost everywhere except specific named streets.
const MONTREAL_BOROUGHS: CanadianArea[] = [
  { key: 'ahuntsic-cartierville', ar: 'أهونتسيك كارتيرفيل', en: 'Ahuntsic-Cartierville', fr: 'Ahuntsic-Cartierville' },
  { key: 'anjou', ar: 'أنجو', en: 'Anjou', fr: 'Anjou' },
  { key: 'cdn-ndg', ar: 'كوت دي نيج', en: 'Côte-des-Neiges–Notre-Dame-de-Grâce', fr: 'Côte-des-Neiges–Notre-Dame-de-Grâce' },
  { key: 'lachine', ar: 'لاشين', en: 'Lachine', fr: 'Lachine', strBanned: true },
  { key: 'lasalle', ar: 'لاسال', en: 'LaSalle', fr: 'LaSalle' },
  { key: 'plateau-mont-royal', ar: 'بلاتو مون روايال', en: 'Le Plateau-Mont-Royal', fr: 'Le Plateau-Mont-Royal' },
  { key: 'sud-ouest', ar: 'الجنوب الغربي', en: 'Le Sud-Ouest', fr: 'Le Sud-Ouest' },
  { key: 'ile-bizard', ar: 'جزيرة بيزار', en: "L'Île-Bizard–Sainte-Geneviève", fr: "L'Île-Bizard–Sainte-Geneviève" },
  { key: 'mercier-hochelaga', ar: 'ميرسييه هوشلاغا', en: 'Mercier–Hochelaga-Maisonneuve', fr: 'Mercier–Hochelaga-Maisonneuve' },
  { key: 'montreal-nord', ar: 'مونتريال الشمالية', en: 'Montréal-Nord', fr: 'Montréal-Nord' },
  { key: 'outremont', ar: 'أوتريمون', en: 'Outremont', fr: 'Outremont' },
  { key: 'pierrefonds-roxboro', ar: 'بييرفون روكسبورو', en: 'Pierrefonds-Roxboro', fr: 'Pierrefonds-Roxboro' },
  { key: 'rdp-pat', ar: 'ريفيير دي بريري', en: 'Rivière-des-Prairies–Pointe-aux-Trembles', fr: 'Rivière-des-Prairies–Pointe-aux-Trembles' },
  { key: 'rosemont', ar: 'روزمون', en: 'Rosemont–La Petite-Patrie', fr: 'Rosemont–La Petite-Patrie' },
  { key: 'saint-laurent', ar: 'سان لوران', en: 'Saint-Laurent', fr: 'Saint-Laurent', strBanned: true },
  { key: 'saint-leonard', ar: 'سان ليونارد', en: 'Saint-Léonard', fr: 'Saint-Léonard', strBanned: true },
  { key: 'verdun', ar: 'فيردان', en: 'Verdun', fr: 'Verdun' },
  { key: 'ville-marie', ar: 'فيل ماري', en: 'Ville-Marie', fr: 'Ville-Marie' },
  { key: 'villeray', ar: 'فيلراي', en: 'Villeray–Saint-Michel–Parc-Extension', fr: 'Villeray–Saint-Michel–Parc-Extension' },
]

const genericCityAreas: CanadianArea[] = [
  { key: 'downtown', ar: 'وسط المدينة', en: 'Downtown', fr: 'Centre-ville' },
  { key: 'city-center', ar: 'مركز المدينة', en: 'City Center', fr: 'Centre-ville' },
]

export const QUEBEC_CITIES: CanadianCity[] = [
  { key: 'montreal', ar: 'مونتريال', en: 'Montreal', fr: 'Montréal', areas: MONTREAL_BOROUGHS },
  { key: 'quebec-city', ar: 'مدينة كيبيك', en: 'Quebec City', fr: 'Ville de Québec', areas: genericCityAreas },
  { key: 'gatineau', ar: 'غاتينو', en: 'Gatineau', fr: 'Gatineau', areas: genericCityAreas },
  { key: 'laval', ar: 'لافال', en: 'Laval', fr: 'Laval', areas: genericCityAreas },
  { key: 'longueuil', ar: 'لونغوي', en: 'Longueuil', fr: 'Longueuil', areas: genericCityAreas },
  { key: 'sherbrooke', ar: 'شيربروك', en: 'Sherbrooke', fr: 'Sherbrooke', areas: genericCityAreas },
  { key: 'trois-rivieres', ar: 'تروا ريفيير', en: 'Trois-Rivières', fr: 'Trois-Rivières', areas: genericCityAreas },
  { key: 'saguenay', ar: 'ساغيناي', en: 'Saguenay', fr: 'Saguenay', areas: genericCityAreas },
]

export const CANADA_PROVINCES: CanadianProvince[] = [
  { key: 'quebec', ar: 'كيبيك', en: 'Quebec', fr: 'Québec', cities: QUEBEC_CITIES },
]

export function getCanadianProvince(provinceKey: string) {
  return CANADA_PROVINCES.find((province) => province.key === provinceKey)
}

export function getCanadianCity(provinceKey: string, cityKey: string) {
  return getCanadianProvince(provinceKey)?.cities.find((city) => city.key === cityKey)
}

export function isStrBannedArea(provinceKey: string, cityKey: string, areaKey: string) {
  return Boolean(getCanadianCity(provinceKey, cityKey)?.areas.find((area) => area.key === areaKey)?.strBanned)
}
