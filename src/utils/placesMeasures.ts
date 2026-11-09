/** #140: single source of truth for CDC PLACES metric → [measure, title, topic].
 * Imported by App.vue (About + Copy citations) and currentViewCsv.ts (CSV citation lines).
 * `measure` must match a MEASURES entry in scripts/add-cdc-places.mjs (tests/placesMeasures.test.ts).
 */
import type { MetricId } from './metrics.ts'
import { placesCitation } from './placesCitation.ts'

export type PlacesEntry = [measure: string, title: string, topic: string]

export const PLACES_MEASURES: Partial<Record<MetricId, PlacesEntry>> = {
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
}

/** PLACES metric ids in map (registry) order. */
export const PLACES_METRIC_IDS = Object.keys(PLACES_MEASURES) as MetricId[]

/** Citation for one PLACES metric; year from meta.cdcPlaces.years[measure] (clause omitted if missing). */
export function placesMetricCitation(id: MetricId, years: Record<string, number | undefined> | null | undefined): string | null {
  const p = PLACES_MEASURES[id]
  return p ? placesCitation(p[1], p[2], years?.[p[0]]) : null
}
