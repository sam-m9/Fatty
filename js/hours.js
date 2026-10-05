// Parses free-text opening hours and answers "is it open right now?".
//
// Understands things like:
//   "11am-10pm"                       (every day)
//   "Daily 7:00-15:00"
//   "Mon-Fri 11:30am-2pm, 5-10pm; Sat-Sun 10am-11pm"
//   "Tue-Sun 5pm-1am; Mon closed"     (overnight ranges spill into the next day)
//   "Open 24 hours"
// Returns true / false, or null when the text can't be understood.

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_RE = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?/g;
const TIME = String.raw`(noon|midnight|\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m?\.?)?)`;
const RANGE_RE = new RegExp(`${TIME}\\s*(?:-|–|—|to)\\s*${TIME}`, 'g');

function dayIndex(word) {
  return DAY_NAMES.indexOf(word.slice(0, 3));
}

// Returns the set of day indexes a segment's leading day spec covers, or null if it has none.
function parseDays(seg) {
  if (/\b(daily|every ?day|7 days)\b/.test(seg)) return [0, 1, 2, 3, 4, 5, 6];
  if (/\bweekdays?\b/.test(seg)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/.test(seg)) return [0, 6];
  // Only look at the text before the first digit so "Mon-Fri 11-2" works.
  const head = seg.split(/\d|noon|midnight/)[0];
  const days = new Set();
  const rangeRe = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s*(?:-|–|—|to|thru|through)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*/g;
  let m;
  let rest = head;
  while ((m = rangeRe.exec(head))) {
    let a = dayIndex(m[1]);
    const b = dayIndex(m[2]);
    for (let i = 0; i < 7; i++) {
      days.add(a);
      if (a === b) break;
      a = (a + 1) % 7;
    }
    rest = rest.replace(m[0], ' ');
  }
  for (const d of rest.matchAll(DAY_RE)) days.add(dayIndex(d[1]));
  return days.size ? [...days] : null;
}

function parseTime(raw) {
  const t = raw.trim().replace(/\./g, '');
  if (t === 'noon') return { mins: 720, mer: 'p' };
  if (t === 'midnight') return { mins: 1440, mer: 'a' };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?m?$/.exec(t);
  if (!m) return null;
  const h = +m[1];
  const min = +(m[2] || 0);
  if (h > 24 || min > 59) return null;
  return { h, min, mer: m[3] || null };
}

function toMinutes(t, mer) {
  if (t.mins != null) return t.mins;
  let h = t.h;
  const m = mer || t.mer;
  if (m === 'p' && h < 12) h += 12;
  if (m === 'a' && h === 12) h = 0;
  return h * 60 + t.min;
}

function parseRanges(seg) {
  const out = [];
  for (const m of seg.matchAll(RANGE_RE)) {
    const a = parseTime(m[1]);
    const b = parseTime(m[2]);
    if (!a || !b) continue;
    let end = toMinutes(b);
    let start;
    if (!a.mer && a.mins == null && b.mer) {
      // "5-10pm" → 5pm; "11-2pm" → 11am.
      start = toMinutes(a, b.mer);
      if (start > end) start = toMinutes(a, b.mer === 'p' ? 'a' : 'p');
    } else {
      start = toMinutes(a);
    }
    // "11-9" / "11am-2": an end with no am/pm that lands before the start means pm.
    if (!b.mer && b.mins == null && end <= start && b.h < 12) end += 720;
    if (end <= start) end += 1440; // overnight
    out.push([start, end]);
  }
  return out;
}

// Builds a week schedule: index 0..6 → list of [startMin, endMin] (end may exceed 1440).
export function parseHours(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().trim();
  if (!s) return null;
  const ALL_DAY = /24\s*(hours|hrs|h)\b|24\/7/;
  const week = Array.from({ length: 7 }, () => []);
  let any = false;
  let current = [0, 1, 2, 3, 4, 5, 6];
  let pending = null; // "Mon, Wed, Fri 8am-4pm": days listed before the segment with the time
  for (const seg of s.split(/[;\n|]+|,(?=\s*(?:sun|mon|tue|wed|thu|fri|sat|daily|weekend|weekday))/)) {
    let days = parseDays(seg);
    const ranges = parseRanges(seg);
    const allDay = ALL_DAY.test(seg);
    if (days && !ranges.length && !allDay && !/\bclosed\b/.test(seg)) {
      pending = [...new Set([...(pending || []), ...days])];
      continue;
    }
    if (pending) { days = [...new Set([...pending, ...(days || [])])]; pending = null; }
    if (days) current = days;
    if (allDay) {
      for (const d of current) week[d] = [[0, 1440]];
      any = true;
      continue;
    }
    if (!ranges.length && /\bclosed\b/.test(seg)) {
      for (const d of current) week[d] = [];
      any = true;
      continue;
    }
    if (!ranges.length) continue;
    any = true;
    for (const d of current) week[d].push(...ranges);
  }
  return any ? week : null;
}

export function isOpenAt(text, date = new Date()) {
  const week = parseHours(text);
  if (!week) return null;
  const day = date.getDay();
  const m = date.getHours() * 60 + date.getMinutes();
  if (week[day].some(([a, b]) => m >= a && m < b)) return true;
  const prev = (day + 6) % 7;
  if (week[prev].some(([, b]) => b > 1440 && m + 1440 < b)) return true;
  return false;
}
