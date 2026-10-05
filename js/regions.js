// Austin neighborhoods grouped into the four regions the Region filter uses.
export const REGIONS = ['East', 'Central', 'South', 'North'];

export const GROUPS = {
  East: ['East Cesar Chavez', 'Holly', 'Govalle', 'Chestnut', 'Central East Austin', 'Rosewood', 'Cherrywood',
    'Upper Boggy Creek', 'MLK', 'Mueller', 'Windsor Park', 'Springdale', 'Johnston Terrace', 'East Riverside', 'Montopolis'],
  Central: ['Downtown', 'Rainey Street', 'Red River', 'Market District', 'Clarksville', 'Old West Austin', 'Tarrytown',
    'West Campus', 'University', 'North University', 'Hyde Park', 'North Loop', 'Rosedale'],
  North: ['Allandale', 'Brentwood', 'Crestview', 'Wooten', 'North Lamar', 'Highland', 'North Shoal Creek', 'The Domain',
    'Arboretum', 'Northwest Hills', 'Anderson Mill', 'Lakeline', 'Tech Ridge', 'Georgian Acres', 'St. John',
    'Wells Branch', 'Jollyville', 'Round Rock', 'Cedar Park', 'Pflugerville', 'Leander'],
  South: ['South Congress', 'Bouldin Creek', 'Travis Heights', 'Zilker', 'Barton Hills', 'South Lamar', 'South First',
    'Galindo', 'Dawson', 'St. Elmo', 'Westgate', 'Sunset Valley', 'Manchaca', 'Southpark Meadows', 'Circle C',
    'Oak Hill', 'West Lake Hills', 'Bee Cave', 'Kyle', 'Buda'],
};

const BY_AREA = new Map();
for (const [region, areas] of Object.entries(GROUPS)) {
  for (const a of areas) BY_AREA.set(a.toLowerCase(), region);
}

export function regionFor(area) {
  return BY_AREA.get(String(area || '').trim().toLowerCase()) || '';
}

export function normalizeRegion(v) {
  const s = String(v || '').trim().toLowerCase();
  return REGIONS.find((r) => r.toLowerCase() === s || s === `${r.toLowerCase()} austin`) || '';
}
