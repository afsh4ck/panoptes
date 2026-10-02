/** Short chip labels for strategic-site classes (English source text). */
const LABELS = Object.freeze({
  naval_base: 'Naval',
  air_base: 'Air base',
  army_base: 'Army',
  missile_base: 'Missile',
  radar_station: 'Radar',
  barracks: 'Barracks',
  training_area: 'Training',
  base: 'Base',
  military_airfield: 'Airfield',
  power_plant: 'Power plant',
  research_reactor: 'Research reactor',
  enrichment: 'Enrichment',
  missile_silo: 'Missile silo',
  test_site: 'Test site',
  large_airport: 'Large',
  medium_airport: 'Medium',
  port_large: 'Large',
  port_medium: 'Medium',
  port_small: 'Small',
  port_very_small: 'Very small',
  coal: 'Coal',
  gas: 'Gas',
  oil: 'Oil',
  nuclear: 'Nuclear',
  hydro: 'Hydro',
  wind: 'Wind',
  solar: 'Solar',
  other: 'Other',
});

/** Chip label for a class id; unknown ids are humanised. */
export function siteClassLabel(cls) {
  const key = String(cls || 'other');
  if (LABELS[key]) return LABELS[key];
  const text = key.replace(/[_-]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Other';
}
