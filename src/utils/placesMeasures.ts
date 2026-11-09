/** #140: single source of truth for CDC PLACES metric → [measure, title, topic].
 * Imported by App.vue (About + Copy citations) and currentViewCsv.ts (CSV citation lines).
 * `measure` must match a MEASURES entry in scripts/add-cdc-places.mjs (tests/placesMeasures.test.ts).
 */
import { METRIC_IDS, type MetricId, type MetricValueKey } from './metrics.ts'
import { placesCitation } from './placesCitation.ts'

// #150 data-only staging: no registry label/switch/citation is published before Designer lock.
export type PlacesMeasureId = MetricId | 'depression'
export type PlacesEntry = [measure: string, title: string, topic: string, data?: { valueKey: MetricValueKey; higherIsBetter: boolean }]

export const PLACES_MEASURES: Partial<Record<PlacesMeasureId, PlacesEntry>> = {
  asthma: ['CASTHMA', 'Current asthma among adults', 'current asthma'],
  diabetes: ['DIABETES', 'Diagnosed diabetes among adults', 'diagnosed diabetes'],
  obesity: ['OBESITY', 'Obesity among adults', 'obesity'],
  mentalHealth: ['MHLTH', 'Frequent mental distress among adults', 'frequent mental distress'],
  physicalHealth: ['PHLTH', 'Frequent physical distress among adults', 'frequent physical distress'],
  chd: ['CHD', 'Coronary heart disease among adults', 'coronary heart disease or angina'],
  bphigh: ['BPHIGH', 'High blood pressure among adults', 'high blood pressure'],
  inactivity: ['LPA', 'No leisure-time physical activity among adults', 'no leisure-time physical activity'],
  copd: ['COPD', 'Chronic obstructive pulmonary disease (COPD) among adults', 'COPD'],
  smoking: ['CSMOKING', 'Current cigarette smoking among adults', 'current cigarette smoking'],
  stroke: ['STROKE', 'Stroke among adults', 'stroke'],
  disability: ['DISABILITY', 'Any disability among adults', 'any disability'],
  shortSleep: ['SLEEP', 'Short sleep duration among adults', 'short sleep duration'],
  uninsured: ['ACCESS2', 'Current lack of health insurance among adults aged 18-64 years', 'current lack of health insurance among adults aged 18–64'],
  // Source metadata only; Designer will lock the user-facing copy before registry activation.
  depression: ['DEPRESSION', 'Depression among adults', 'depression', { valueKey: 'pctDepression', higherIsBetter: false }],
}

/** All ingested measures; DEPRESSION is measure 15 without changing rendered switch order. */
export const PLACES_DATA_IDS = Object.keys(PLACES_MEASURES) as PlacesMeasureId[]
/** Only Designer-approved registered metrics reach About/citations and existing UI consumers. */
export const PLACES_METRIC_IDS = PLACES_DATA_IDS.filter((id): id is MetricId => METRIC_IDS.includes(id as MetricId))

/** Citation for one PLACES metric; year from meta.cdcPlaces.years[measure] (clause omitted if missing). */
export function placesMetricCitation(id: PlacesMeasureId, years: Record<string, number | undefined> | null | undefined): string | null {
  const p = PLACES_MEASURES[id]
  return p ? placesCitation(p[1], p[2], years?.[p[0]]) : null
}
