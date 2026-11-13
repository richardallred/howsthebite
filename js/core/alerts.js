// Which National Weather Service alerts matter to someone on or beside the water,
// and how seriously to take them.
//
//   danger   get off the water: caps the fishing score while in effect
//   caution  worth knowing before you go: shown, but the score is left to the
//            wind and river-flow factors, which already measure the same thing
//
// Everything else NWS issues (frost, air quality, fire weather…) is ignored.

const HOUR_MS = 3600 * 1000;
const UPCOMING_WINDOW_MS = 12 * HOUR_MS;

const DANGER = new Set([
    'Tornado Warning', 'Severe Thunderstorm Warning', 'Special Marine Warning', 'Flash Flood Warning',
    'Extreme Wind Warning', 'Hurricane Warning', 'Hurricane Force Wind Warning', 'Storm Warning',
    'Tropical Storm Warning', 'Storm Surge Warning', 'Blizzard Warning', 'Ice Storm Warning',
    'Snow Squall Warning', 'Dust Storm Warning', 'Tsunami Warning',
]);

const CAUTION = new Set([
    'Tornado Watch', 'Severe Thunderstorm Watch', 'Flash Flood Watch', 'Flood Warning', 'Flood Advisory',
    'Flood Watch', 'Lakeshore Flood Warning', 'Lakeshore Flood Advisory', 'Coastal Flood Warning',
    'Small Craft Advisory', 'Gale Warning', 'Gale Watch', 'Lake Wind Advisory', 'Wind Advisory',
    'High Wind Warning', 'High Wind Watch', 'Brisk Wind Advisory', 'Hazardous Seas Warning',
    'Low Water Advisory', 'Dense Fog Advisory', 'Marine Dense Fog Advisory', 'Heat Advisory',
    'Extreme Heat Warning', 'Extreme Heat Watch', 'Extreme Cold Warning', 'Cold Weather Advisory',
    'Wind Chill Warning', 'Winter Storm Warning', 'Winter Weather Advisory', 'Hurricane Watch',
    'Tropical Storm Watch', 'Rip Current Statement', 'Beach Hazards Statement',
]);

/**
 * @param {Array<{ event: string, onset: number|null, ends: number|null }>} alerts  from fetchAlerts()
 * @param {number} now  epoch ms
 * @returns {{ hazard: string|null, items: Array<{ event, level: 'danger'|'caution', active: boolean, onset, ends }> }}
 *   `hazard` names the dangerous alert in effect right now, if there is one.
 */
export function summariseAlerts(alerts, now) {
    const seen = new Set();
    const items = [];
    for (const alert of alerts ?? []) {
        const level = DANGER.has(alert.event) ? 'danger' : CAUTION.has(alert.event) ? 'caution' : null;
        if (!level || seen.has(alert.event)) continue;
        if (alert.ends && alert.ends <= now) continue;
        const active = !alert.onset || alert.onset <= now;
        if (!active && alert.onset - now > UPCOMING_WINDOW_MS) continue;
        seen.add(alert.event);
        items.push({ event: alert.event, level, active, onset: alert.onset ?? null, ends: alert.ends ?? null });
    }
    items.sort((a, b) => (a.level === b.level ? Number(b.active) - Number(a.active) : a.level === 'danger' ? -1 : 1));
    return { hazard: items.find((item) => item.level === 'danger' && item.active)?.event ?? null, items };
}
