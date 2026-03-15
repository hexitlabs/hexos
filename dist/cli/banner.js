import { resolveCommitHash } from "../infra/git-commit.js";
import { visibleWidth } from "../terminal/ansi.js";
import { isRich, theme } from "../terminal/theme.js";
import { pickTagline } from "./tagline.js";
let bannerEmitted = false;
const graphemeSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
function splitGraphemes(value) {
    if (!graphemeSegmenter)
        return Array.from(value);
    try {
        return Array.from(graphemeSegmenter.segment(value), (seg) => seg.segment);
    }
    catch {
        return Array.from(value);
    }
}
const hasJsonFlag = (argv) => argv.some((arg) => arg === "--json" || arg.startsWith("--json="));
const hasVersionFlag = (argv) => argv.some((arg) => arg === "--version" || arg === "-V" || arg === "-v");
export function formatCliBannerLine(version, options = {}) {
    const commit = options.commit ?? resolveCommitHash({ env: options.env });
    const commitLabel = commit ?? "unknown";
    const tagline = pickTagline(options);
    const rich = options.richTty ?? isRich();
    const title = "🔷 HexOS";
    const prefix = "🔷 ";
    const columns = options.columns ?? process.stdout.columns ?? 120;
    const plainFullLine = `${title} ${version} (${commitLabel}) — ${tagline}`;
    const fitsOnOneLine = visibleWidth(plainFullLine) <= columns;
    if (rich) {
        if (fitsOnOneLine) {
            return `${theme.heading(title)} ${theme.info(version)} ${theme.muted(`(${commitLabel})`)} ${theme.muted("—")} ${theme.accentDim(tagline)}`;
        }
        const line1 = `${theme.heading(title)} ${theme.info(version)} ${theme.muted(`(${commitLabel})`)}`;
        const line2 = `${" ".repeat(prefix.length)}${theme.accentDim(tagline)}`;
        return `${line1}\n${line2}`;
    }
    if (fitsOnOneLine) {
        return plainFullLine;
    }
    const line1 = `${title} ${version} (${commitLabel})`;
    const line2 = `${" ".repeat(prefix.length)}${tagline}`;
    return `${line1}\n${line2}`;
}
const HEXOS_ASCII = [
    "  ⬡ HexOS v1.0.0",
    "  The OS for AI agents",
];
export function formatCliBannerArt(options = {}) {
    const rich = options.richTty ?? isRich();
    if (!rich)
        return HEXOS_ASCII.join("\n");
    const colored = HEXOS_ASCII.map((line, i) => {
        if (i === 0)
            return theme.accentBright(line);
        return theme.accentDim(line);
    });
    return colored.join("\n");
}
export function emitCliBanner(version, options = {}) {
    if (bannerEmitted)
        return;
    const argv = options.argv ?? process.argv;
    if (!process.stdout.isTTY)
        return;
    if (hasJsonFlag(argv))
        return;
    if (hasVersionFlag(argv))
        return;
    const line = formatCliBannerLine(version, options);
    process.stdout.write(`\n${line}\n\n`);
    bannerEmitted = true;
}
export function hasEmittedCliBanner() {
    return bannerEmitted;
}
