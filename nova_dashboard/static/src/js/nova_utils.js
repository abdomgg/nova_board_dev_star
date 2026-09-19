/** NovaBoard shared utilities */

export const PALETTES = {
    theme:  null, // resolved from dashboard accent at runtime
    vivid:  ["#7C6CFF", "#22C7A9", "#FF7A9E", "#FFB35C", "#4CC2FF", "#A78BFA", "#34D399", "#F472B6"],
    ocean:  ["#0EA5E9", "#22D3EE", "#2DD4BF", "#34D399", "#60A5FA", "#818CF8", "#38BDF8", "#5EEAD4"],
    sunset: ["#F97316", "#FB7185", "#F59E0B", "#EF4444", "#FB923C", "#F472B6", "#FBBF24", "#FCA5A5"],
    forest: ["#10B981", "#84CC16", "#22C55E", "#14B8A6", "#A3E635", "#4ADE80", "#2DD4BF", "#86EFAC"],
    candy:  ["#EC4899", "#8B5CF6", "#06B6D4", "#F43F5E", "#A855F7", "#3B82F6", "#D946EF", "#6366F1"],
    mono:   ["#94A3B8", "#CBD5E1", "#64748B", "#E2E8F0", "#475569", "#F1F5F9", "#334155", "#B0BCCB"],
};

export function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(124,108,255,${alpha})`;
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function shiftHue(hex, deg) {
    let h = (hex || "#7C6CFF").replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    let r = parseInt(h.slice(0, 2), 16) / 255,
        g = parseInt(h.slice(2, 4), 16) / 255,
        b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let hh = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) hh = ((b - r) / d + 2) / 6;
        else hh = ((r - g) / d + 4) / 6;
    }
    hh = (hh + deg / 360) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
    return "#" + to(f(hh + 1 / 3)) + to(f(hh)) + to(f(hh - 1 / 3));
}

export function paletteFor(name, accent) {
    if (name && name !== "theme" && PALETTES[name]) return PALETTES[name];
    const a = accent || "#7C6CFF";
    return [a, shiftHue(a, 150), shiftHue(a, 40), shiftHue(a, 200),
            shiftHue(a, 80), shiftHue(a, 280), shiftHue(a, 320), shiftHue(a, 110)];
}

export function compact(v) {
    const sign = v < 0 ? "-" : "";
    v = Math.abs(Number(v) || 0);
    const units = [["T", 1e12], ["B", 1e9], ["M", 1e6], ["K", 1e3]];
    for (const [u, d] of units) {
        if (v >= d) {
            let n = Math.round((v / d) * 10) / 10;
            if (n === Math.floor(n)) n = Math.floor(n);
            return sign + n + u;
        }
    }
    if (v === Math.floor(v)) return sign + v;
    return sign + (Math.round(v * 100) / 100);
}

/** Animated count-up on an element; respects motion flag. */
export function countUp(el, target, formatted, motion, duration = 1100) {
    if (!el) return;
    if (!motion || !isFinite(target)) {
        el.textContent = formatted;
        return;
    }
    const start = performance.now();
    const isCompactFmt = /[KMBT]/.test(formatted);
    const prefix = formatted.match(/^[^\d\-.]*/)?.[0] || "";
    const suffix = formatted.match(/[^\d.]*$/)?.[0] || "";
    function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 4);
        const cur = target * eased;
        el.textContent = t >= 1 ? formatted
            : isCompactFmt ? prefix + compact(cur) + suffix.replace(/[KMBT]/, "")
            : prefix + Math.round(cur).toLocaleString() + suffix;
        if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

export function sparkPath(values, w, h, pad = 2) {
    if (!values || values.length < 2) return { line: "", area: "" };
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const step = (w - pad * 2) / (values.length - 1);
    const pts = values.map((v, i) => [
        pad + i * step,
        h - pad - ((v - min) / span) * (h - pad * 2),
    ]);
    let line = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const cx = (x0 + x1) / 2;
        line += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
    }
    const area = line + ` L ${pts[pts.length - 1][0]} ${h} L ${pts[0][0]} ${h} Z`;
    return { line, area };
}

export function downloadText(filename, text, mime = "text/plain") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
