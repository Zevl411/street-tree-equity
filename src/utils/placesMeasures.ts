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
  shortSleep: ['SLEEP', 'Short sleep duration among adults', 'short sleep duration'],
  uninsured: ['ACCESS2', 'Current lack of health insurance among adults aged 18-64 years', 'current lack of health insurance among adults aged 18–64'],
  depression: ['DEPRESSION', 'Depression among adults', 'depression history (ever told of a depressive disorder)'],
  generalHealth: ['GHLTH', 'Fair or poor self-rated health status among adults', 'fair or poor general health'],
}

/** PLACES metric ids in registry/invent append order. */
export const PLACES_METRIC_IDS = Object.keys(PLACES_MEASURES) as MetricId[]

/** #150 Designer-locked methods note, shared by About and Copy citations. */
export const DEPRESSION_METHODS = 'Depression history is the estimated share of adults aged 18+ who report ever being told by a doctor, nurse, or other health professional that they had a depressive disorder. It is a lifetime measure, not necessarily current depression, and does not describe severity or duration. Mental health (MHLTH) measures 14+ days of poor mental health in the past 30 days. These measures describe communities, not individuals.'

/** #151 locked self-rated/PHLTH distinction, shared by About and Copy citations. */
export const GHLTH_METHODS = 'Fair or poor health is the estimated share of adults aged 18+ who rate their overall health as fair or poor. It is self-rated general health at the time of the survey, not an objective health assessment. Physical health (PHLTH) is a separate measure: 14+ days of poor physical health in the past 30 days. These measures describe communities, not individuals.'

/** Citation for one PLACES metric; year from meta.cdcPlaces.years[measure] (clause omitted if missing). */
export function placesMetricCitation(id: MetricId, years: Record<string, number | undefined> | null | undefined): string | null {
  const p = PLACES_MEASURES[id]
  return p ? placesCitation(p[1], p[2], years?.[p[0]]) : null
}
