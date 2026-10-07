/**
 * Curated flat list of African regions and countries used across Promiscope for
 * player registration and scout search filtering.
 *
 * Each entry is a `{ label, value }` object:
 * - `label` — human-readable display name shown in dropdowns and filter chips
 *   (e.g. `"Nigeria"`, `"West Africa"`).
 * - `value` — URL-safe lowercase slug stored on-chain and passed as a filter
 *   argument to `filter_players()` on the Soroban contract (e.g. `"nigeria"`,
 *   `"west-africa"`). Slugs use hyphens as word separators and no accents.
 *
 * The list includes both individual countries (where Promiscope has significant
 * user density) and broad sub-regional groupings (for scouts who search across
 * a wider territory). It is alphabetically sorted by `label` so it can be
 * rendered directly without re-sorting.
 *
 * **Consumers:**
 * - `components/player/PlayerOnboardingWizard.tsx` — region picker during player registration
 * - `components/academy/BulkPlayerImport.tsx` — region column validation in CSV import
 * - `lib/bulkImportParser.ts` — validates region values parsed from uploaded spreadsheets
 * - `__tests__/components/PlayerFilterForm.test.tsx` — test assertions against region options
 *
 * To add a new region, append an entry in alphabetical order by `label` and
 * keep the `value` slug consistent with the on-chain contract's accepted values.
 *
 * @example
 * // Render a plain <select> of all regions
 * AFRICAN_REGIONS.map(({ label, value }) => (
 *   <option key={value} value={value}>{label}</option>
 * ))
 */
export const AFRICAN_REGIONS: { label: string; value: string }[] = [
  { label: 'Cameroon', value: 'cameroon' },
  { label: 'Central Africa', value: 'central-africa' },
  { label: "Côte d'Ivoire", value: 'cote-divoire' },
  { label: 'East Africa', value: 'east-africa' },
  { label: 'Egypt', value: 'egypt' },
  { label: 'Ethiopia', value: 'ethiopia' },
  { label: 'Ghana', value: 'ghana' },
  { label: 'Kenya', value: 'kenya' },
  { label: 'Nigeria', value: 'nigeria' },
  { label: 'North Africa', value: 'north-africa' },
  { label: 'Senegal', value: 'senegal' },
  { label: 'South Africa', value: 'south-africa' },
  { label: 'Southern Africa', value: 'southern-africa' },
  { label: 'Tanzania', value: 'tanzania' },
  { label: 'Uganda', value: 'uganda' },
  { label: 'West Africa', value: 'west-africa' },
];

/**
 * The same regions as {@link AFRICAN_REGIONS}, grouped by sub-region for
 * rendering `<optgroup>` elements in select inputs.
 *
 * The object keys are the human-readable sub-region display names used as
 * `<optgroup label="...">` headings (e.g. `"West Africa"`, `"East Africa"`).
 * Each value is an array of `{ label, value }` entries — identical in shape
 * and slug format to {@link AFRICAN_REGIONS} — containing the countries and
 * sub-regions that belong to that group.
 *
 * **Important:** the `value` slugs in this grouped structure are intentionally
 * identical to those in {@link AFRICAN_REGIONS}. This ensures the on-chain
 * `filter_players()` contract call always receives the same flat slug regardless
 * of whether the UI uses the flat list or the grouped one.
 *
 * **Consumers:**
 * - `components/scout/PlayerFilterForm.tsx` — renders a grouped `<select>` so
 *   scouts can browse by sub-region before drilling into a specific country.
 *
 * @example
 * // Render a grouped <select> with <optgroup> sections
 * Object.entries(AFRICAN_REGIONS_GROUPED).map(([group, regions]) => (
 *   <optgroup key={group} label={group}>
 *     {regions.map(({ label, value }) => (
 *       <option key={value} value={value}>{label}</option>
 *     ))}
 *   </optgroup>
 * ))
 */
export const AFRICAN_REGIONS_GROUPED: Record<
  string,
  { label: string; value: string }[]
> = {
  'West Africa': [
    { label: "Côte d'Ivoire", value: 'cote-divoire' },
    { label: 'Ghana', value: 'ghana' },
    { label: 'Nigeria', value: 'nigeria' },
    { label: 'Senegal', value: 'senegal' },
    { label: 'West Africa', value: 'west-africa' },
  ],
  'East Africa': [
    { label: 'East Africa', value: 'east-africa' },
    { label: 'Ethiopia', value: 'ethiopia' },
    { label: 'Kenya', value: 'kenya' },
    { label: 'Tanzania', value: 'tanzania' },
    { label: 'Uganda', value: 'uganda' },
  ],
  'North Africa': [
    { label: 'Egypt', value: 'egypt' },
    { label: 'North Africa', value: 'north-africa' },
  ],
  'Southern Africa': [
    { label: 'South Africa', value: 'south-africa' },
    { label: 'Southern Africa', value: 'southern-africa' },
  ],
  'Central Africa': [
    { label: 'Cameroon', value: 'cameroon' },
    { label: 'Central Africa', value: 'central-africa' },
  ],
};
