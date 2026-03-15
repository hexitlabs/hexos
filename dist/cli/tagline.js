const DEFAULT_TAGLINE = "The OS for AI agents.";
const HOLIDAY_TAGLINES = {
    newYear: "New Year's Day: New year, new agents — deploy fresh and automate boldly.",
    lunarNewYear: "Lunar New Year: May your agents be prosperous and your pipelines flow freely.",
    christmas: "Christmas: Peace on earth, agents in production, zero incidents.",
    eid: "Eid al-Fitr: Celebration mode — queues cleared, agents rested, ready to ship.",
    diwali: "Diwali: Light up your operations — agents running bright.",
    easter: "Easter: New beginnings — perfect time to deploy a fresh agent fleet.",
    hanukkah: "Hanukkah: Eight nights of uptime — may your agents stay lit.",
    halloween: "Halloween: The scariest thing? Manual processes. Let agents handle it.",
    thanksgiving: "Thanksgiving: Grateful for agents that never call in sick.",
    valentines: "Valentine's Day: Love your agents — they work 24/7 so you don't have to.",
};
const TAGLINES = [
    "Your AI, your rules.",
    "The OS for AI agents.",
    "Deploy agents, not excuses.",
    "Intelligence, orchestrated.",
    "Your business, automated.",
    "Agents that never sleep.",
    "From zero to AI-powered.",
    "Ship faster with agents.",
    "One CLI to orchestrate them all.",
    "Gateway online — agents standing by.",
    "Your infrastructure, your intelligence.",
    "Multi-agent ops, single command.",
    "Self-hosted AI that actually works.",
    "Deploy once, automate forever.",
    "AI agents on your terms.",
    "The control plane for AI agents.",
    "Run agents like you run servers.",
    "Because manual work doesn't scale.",
    "Automate the boring. Focus on the bold.",
    "Your AI workforce, orchestrated.",
    HOLIDAY_TAGLINES.newYear,
    HOLIDAY_TAGLINES.lunarNewYear,
    HOLIDAY_TAGLINES.christmas,
    HOLIDAY_TAGLINES.eid,
    HOLIDAY_TAGLINES.diwali,
    HOLIDAY_TAGLINES.easter,
    HOLIDAY_TAGLINES.hanukkah,
    HOLIDAY_TAGLINES.halloween,
    HOLIDAY_TAGLINES.thanksgiving,
    HOLIDAY_TAGLINES.valentines,
];
const DAY_MS = 24 * 60 * 60 * 1000;
function utcParts(date) {
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth(),
        day: date.getUTCDate(),
    };
}
const onMonthDay = (month, day) => (date) => {
    const parts = utcParts(date);
    return parts.month === month && parts.day === day;
};
const onSpecificDates = (dates, durationDays = 1) => (date) => {
    const parts = utcParts(date);
    return dates.some(([year, month, day]) => {
        if (parts.year !== year)
            return false;
        const start = Date.UTC(year, month, day);
        const current = Date.UTC(parts.year, parts.month, parts.day);
        return current >= start && current < start + durationDays * DAY_MS;
    });
};
const inYearWindow = (windows) => (date) => {
    const parts = utcParts(date);
    const window = windows.find((entry) => entry.year === parts.year);
    if (!window)
        return false;
    const start = Date.UTC(window.year, window.month, window.day);
    const current = Date.UTC(parts.year, parts.month, parts.day);
    return current >= start && current < start + window.duration * DAY_MS;
};
const isFourthThursdayOfNovember = (date) => {
    const parts = utcParts(date);
    if (parts.month !== 10)
        return false; // November
    const firstDay = new Date(Date.UTC(parts.year, 10, 1)).getUTCDay();
    const offsetToThursday = (4 - firstDay + 7) % 7; // 4 = Thursday
    const fourthThursday = 1 + offsetToThursday + 21; // 1st + offset + 3 weeks
    return parts.day === fourthThursday;
};
const HOLIDAY_RULES = new Map([
    [HOLIDAY_TAGLINES.newYear, onMonthDay(0, 1)],
    [
        HOLIDAY_TAGLINES.lunarNewYear,
        onSpecificDates([
            [2025, 0, 29],
            [2026, 1, 17],
            [2027, 1, 6],
        ], 1),
    ],
    [
        HOLIDAY_TAGLINES.eid,
        onSpecificDates([
            [2025, 2, 30],
            [2025, 2, 31],
            [2026, 2, 20],
            [2027, 2, 10],
        ], 1),
    ],
    [
        HOLIDAY_TAGLINES.diwali,
        onSpecificDates([
            [2025, 9, 20],
            [2026, 10, 8],
            [2027, 9, 28],
        ], 1),
    ],
    [
        HOLIDAY_TAGLINES.easter,
        onSpecificDates([
            [2025, 3, 20],
            [2026, 3, 5],
            [2027, 2, 28],
        ], 1),
    ],
    [
        HOLIDAY_TAGLINES.hanukkah,
        inYearWindow([
            { year: 2025, month: 11, day: 15, duration: 8 },
            { year: 2026, month: 11, day: 5, duration: 8 },
            { year: 2027, month: 11, day: 25, duration: 8 },
        ]),
    ],
    [HOLIDAY_TAGLINES.halloween, onMonthDay(9, 31)],
    [HOLIDAY_TAGLINES.thanksgiving, isFourthThursdayOfNovember],
    [HOLIDAY_TAGLINES.valentines, onMonthDay(1, 14)],
    [HOLIDAY_TAGLINES.christmas, onMonthDay(11, 25)],
]);
function isTaglineActive(tagline, date) {
    const rule = HOLIDAY_RULES.get(tagline);
    if (!rule)
        return true;
    return rule(date);
}
export function activeTaglines(options = {}) {
    if (TAGLINES.length === 0)
        return [DEFAULT_TAGLINE];
    const today = options.now ? options.now() : new Date();
    const filtered = TAGLINES.filter((tagline) => isTaglineActive(tagline, today));
    return filtered.length > 0 ? filtered : TAGLINES;
}
export function pickTagline(options = {}) {
    const env = options.env ?? process.env;
    const override = env?.HEXOS_TAGLINE_INDEX;
    if (override !== undefined) {
        const parsed = Number.parseInt(override, 10);
        if (!Number.isNaN(parsed) && parsed >= 0) {
            const pool = TAGLINES.length > 0 ? TAGLINES : [DEFAULT_TAGLINE];
            return pool[parsed % pool.length];
        }
    }
    const pool = activeTaglines(options);
    const rand = options.random ?? Math.random;
    const index = Math.floor(rand() * pool.length) % pool.length;
    return pool[index];
}
export { TAGLINES, HOLIDAY_RULES, DEFAULT_TAGLINE };
