// The conditions in a sentence or two.
//
// Everything in it is already on the page as a stamp, a dial or a chart; this says it in
// words, twice:
//   - `lede` goes under the place's name ("Excellent fishing today, best 3–5 PM. Water
//     57.7°F, down 6.5°F in 14 days.");
//   - `description` is the page's meta description, with the place and the date, so a search
//     result can show the day's numbers rather than a line that is the same for every place.
//     The date is there because a search engine may show it days after it read the page.

import { isNum } from './util.js';

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

// A sensor this far off or farther is not the place's own water, and is said to be nearby.
const NEARBY_FROM_MI = 3;

/**
 * The water, as a sentence. A reading is the place's own ("Water 57.7°F, down 6.5°F in 14
 * days."), or the nearest sensor's ("The nearest water sensor, 58 miles away, reads 57.4°F."),
 * or worked out from the air ("Water about 52°F, estimated from the air.").
 */
function waterSentence({ waterTempF, measured, sensorMiles, trend }, label) {
    if (!isNum(waterTempF)) return null;
    if (!measured) return `${label} about ${Math.round(waterTempF)}°F, estimated from the air.`;
    const reading = `${waterTempF.toFixed(1)}°F`;
    if (isNum(sensorMiles) && sensorMiles >= NEARBY_FROM_MI) {
        const miles = Math.round(sensorMiles);
        return `The nearest water sensor, ${miles} mile${miles === 1 ? '' : 's'} away, reads ${reading}.`;
    }
    return `${label} ${reading}${trend ? `, ${lowerFirst(trend)}` : ''}.`;
}

/**
 * @param {object} c
 * @param {string|null} c.name       the place, or null when it has no name worth printing
 * @param {string} c.dateText        "Sunday, November 23", at the place
 * @param {number} c.score           today's score, 0–100
 * @param {string} c.band            its rating: "Excellent"
 * @param {string|null} c.bestHours  the best two hours still to come, "3–5 PM"; null when the day is done
 * @param {boolean} [c.flat]         no hour is better than another
 * @param {number|null} c.waterTempF
 * @param {boolean} c.measured       from a sensor, not estimated from the air
 * @param {number|null} [c.sensorMiles]  how far off that sensor is; null when it is the place's own (or the sea's)
 * @param {string|null} [c.trend]    how the water has moved: "Down 6.5°F in 14 days"
 * @returns {{ lede: string, description: string }}
 */
export function conditionsSummary({ name, dateText, score, band, bestHours, flat = false, waterTempF, measured, sensorMiles = null, trend = null }) {
    const when = flat ? 'much the same all day' : bestHours ? `best ${bestHours}` : null;
    const water = { waterTempF, measured, sensorMiles, trend };

    const lede = [
        bestHours || flat ? `${band} fishing today${when ? `, ${when}` : ''}.` : `${band} fishing right now.`,
        waterSentence(water, 'Water'),
    ].filter(Boolean).join(' ');

    const description = [
        `${name ? `${name} fishing` : 'Fishing'} forecast for ${dateText}: ${band.toLowerCase()}, ${score} out of 100${when ? `, ${when}` : ''}.`,
        waterSentence(water, 'Water temperature'),
        'With the wind, the weather and what to throw.',
    ].filter(Boolean).join(' ');

    return { lede, description };
}
