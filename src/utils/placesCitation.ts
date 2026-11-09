/** #138: shared CDC PLACES About / copy-citations template.
 * Year from meta.cdcPlaces.years[MEASURE]; if missing, omit the year clause entirely
 * (never render "BRFSS undefined" / blank).
 */
export function placesCitation(
  title: string,
  topic: string,
  year: number | null | undefined,
): string {
  const yearClause =
    year != null && Number.isFinite(year)
      ? ` (BRFSS ${year} model-based estimates)`
      : ' (model-based estimates)'
  return (
    `${title} (tract) — CDC PLACES: Local Data for Better Health, 2025 release` +
    yearClause +
    '. Centers for Disease Control and Prevention, National Center for Chronic Disease Prevention and Health Promotion, Division of Population Health. This product uses CDC PLACES data but is not endorsed by CDC or HHS. Estimates are model-based small-area estimates of self-reported ' +
    topic +
    ', not diagnoses or direct measurements, and should not be used for clinical decisions.'
  )
}
