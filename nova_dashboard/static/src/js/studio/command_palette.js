/** NovaPalette — Ctrl/Cmd+K omnibox: boards, widgets, actions, NovaMind. */
import { Component, useState, useRef, onMounted, onWillUnmount, xml } from "@odoo/owl";

const ACTIONS = [
    { key: "home", label: "All dashboards — Hub", icon: "fa-home" },
    { key: "new-widget", label: "New widget — open Studio", icon: "fa-magic", need: "edit" },
    { key: "new-board", label: "New dashboard", icon: "fa-plus", need: "manage" },
    { key: "board-settings", label: "Board settings", icon: "fa-cog", need: "edit" },
    { key: "arrange", label: "Toggle arrange mode", icon: "fa-arrows", need: "edit" },
    { key: "ai", label: "Open NovaMind copilot", icon: "fa-magic" },
    { key: "insights", label: "Insight digest", icon: "fa-lightbulb-o", need: "board" },
    { key: "info", label: "Board info", icon: "fa-info-circle", need: "board" },
    { key: "admin", label: "Control center", icon: "fa-shield", need: "edit" },
    { key: "refresh", label: "Refresh all widgets", icon: "fa-refresh", need: "board" },
    { key: "tv", label: "TV mode (fullscreen)", icon: "fa-television" },
    { key: "duplicate", label: "Duplicate this board", icon: "fa-clone", need: "edit" },
    { key: "export", label: "Export board as JSON", icon: "fa-download", need: "board" },
    { key: "import", label: "Import board from JSON", icon: "fa-upload", need: "manage" },
    { key: "samples", label: "Install sample dashboards", icon: "fa-gift", need: "manage" },
    { key: "toggle-motion", label: "Toggle motion effects", icon: "fa-bolt" },
    { key: "toggle-compare", label: "Toggle compare vs previous", icon: "fa-exchange", need: "board" },
    { key: "theme-aurora", label: "Theme: Aurora", icon: "fa-paint-brush", need: "board" },
    { key: "theme-nebula", label: "Theme: Nebula", icon: "fa-paint-brush", need: "board" },
    { key: "theme-carbon", label: "Theme: Carbon", icon: "fa-paint-brush", need: "board" },
    { key: "theme-daylight", label: "Theme: Daylight", icon: "fa-paint-brush", need: "board" },
    { key: "theme-solar", label: "Theme: Solar", icon: "fa-paint-brush", need: "board" },
];

const TYPE_ICONS = {
    kpi: "fa-bolt", tile: "fa-square", gauge: "fa-tachometer", bullet: "fa-arrows-h",
    bar: "fa-bar-chart", hbar: "fa-align-left", line: "fa-line-chart",
    area: "fa-area-chart", waterfall: "fa-signal", radar: "fa-bullseye",
    scatter: "fa-braille", pie: "fa-pie-chart", doughnut: "fa-circle-o-notch",
    polar: "fa-dot-circle-o", funnel: "fa-filter", heatmap: "fa-th",
    leaderboard: "fa-trophy", list: "fa-table", todo: "fa-check-square-o",
    text: "fa-file-text-o",
};

export class NovaPalette extends Component {
    static template = xml`
        <div class="nv-palette-mask" t-on-mousedown.self="props.onClose">
            <div class="nv-palette">
                <div class="nv-palette-input">
                    <i class="fa fa-search"/>
                    <input t-ref="input" placeholder="Jump to a board, widget, action… or ask NovaMind"
                           t-att-value="state.q"
                           t-on-input="onInput"
                           t-on-keydown="onKey"/>
                    <kbd>esc</kbd>
                </div>
                <div class="nv-palette-body" t-ref="list">
                    <t t-foreach="groups" t-as="g" t-key="g.label">
                        <div class="nv-palette-group" t-esc="g.label"/>
                        <button t-foreach="g.rows" t-as="r" t-key="r.uid"
                                class="nv-palette-row"
                                t-att-class="r.uid === selectedUid ? 'nv-active' : ''"
                                t-att-data-uid="r.uid"
                                t-on-mouseenter="() => state.sel = r.uid"
                                t-on-click="() => this.run(r)">
                            <span class="nv-palette-ico" t-att-class="r.kind === 'ai' ? 'nv-ico-ai' : ''">
                                <i t-att-class="'fa ' + r.icon"/>
                            </span>
                            <span class="nv-palette-label">
                                <t t-foreach="r.parts" t-as="p" t-key="p_index">
                                    <b t-if="p.hit" t-esc="p.ch"/>
                                    <t t-else="" t-esc="p.ch"/>
                                </t>
                            </span>
                            <span t-if="r.hint" class="nv-palette-hint" t-esc="r.hint"/>
                            <kbd t-if="r.uid === selectedUid">↵</kbd>
                        </button>
                    </t>
                    <div t-if="!groups.length" class="nv-palette-empty">
                        <i class="fa fa-magic"/> Press Enter to ask NovaMind
                    </div>
                </div>
                <div class="nv-palette-foot">
                    <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> run</span>
                    <span class="nv-flex-1"/>
                    <span class="nv-palette-brand"><i class="fa fa-bolt"/> NovaBoard</span>
                </div>
            </div>
        </div>`;
    static props = ["boards", "config", "manager", "onClose", "onRun"];

    setup() {
        this.inputRef = useRef("input");
        this.listRef = useRef("list");
        this.state = useState({ q: "", sel: null });
        this._esc = (ev) => { if (ev.key === "Escape") this.props.onClose(); };
        onMounted(() => {
            window.addEventListener("keydown", this._esc);
            this.inputRef.el?.focus();
        });
        onWillUnmount(() => window.removeEventListener("keydown", this._esc));
    }

    /* ----------------------- fuzzy machinery ----------------------- */
    fuzzy(query, text) {
        if (!query) return { score: 1, marks: [] };
        const q = query.toLowerCase();
        const t = text.toLowerCase();
        let score = 0, qi = 0;
        const marks = [];
        for (let ti = 0; ti < t.length && qi < q.length; ti++) {
            if (t[ti] === q[qi]) {
                marks.push(ti);
                score += 10;
                if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "-") score += 8;
                if (marks.length > 1 && marks[marks.length - 2] === ti - 1) score += 5;
                qi++;
            }
        }
        if (qi < q.length) return null;
        if (t.startsWith(q)) score += 30;
        if (t.includes(q)) score += 15;
        return { score, marks };
    }

    parts(text, marks) {
        const set = new Set(marks);
        return [...text].map((ch, i) => ({ ch, hit: set.has(i) }));
    }

    get pool() {
        const out = [];
        const cfg = this.props.config;
        for (const b of this.props.boards || []) {
            out.push({
                uid: "b" + b.id, kind: "board", id: b.id, icon: "fa-th-large",
                label: b.name, hint: b.count + " widgets", group: "Dashboards",
            });
        }
        if (cfg) {
            for (const it of cfg.items) {
                out.push({
                    uid: "w" + it.id, kind: "widget", id: it.id,
                    icon: TYPE_ICONS[it.type] || "fa-square",
                    label: it.name,
                    hint: it.model || it.type, group: "Widgets — Enter for Focus view",
                });
            }
        }
        for (const a of ACTIONS) {
            if (a.need === "edit" && !(cfg && cfg.editable)) continue;
            if (a.need === "board" && !cfg) continue;
            if (a.need === "manage" && !this.props.manager) continue;
            out.push({
                uid: "a" + a.key, kind: "action", id: a.key, icon: a.icon,
                label: a.label, hint: "", group: "Actions",
            });
        }
        return out;
    }

    get results() {
        const q = this.state.q.trim();
        const scored = [];
        for (const r of this.pool) {
            const f = this.fuzzy(q, r.label);
            if (!f) continue;
            scored.push({ ...r, score: f.score, parts: this.parts(r.label, f.marks) });
        }
        scored.sort((a, b) => b.score - a.score);
        const top = q ? scored.slice(0, 14) : scored.slice(0, 18);
        if (q.length > 2) {
            top.push({
                uid: "ai", kind: "ai", id: q, icon: "fa-magic",
                label: `Ask NovaMind: “${q}”`, hint: "AI",
                parts: this.parts(`Ask NovaMind: “${q}”`, []),
                group: "NovaMind",
            });
        }
        return top;
    }

    get groups() {
        const order = [];
        const map = {};
        for (const r of this.results) {
            if (!map[r.group]) {
                map[r.group] = { label: r.group, rows: [] };
                order.push(map[r.group]);
            }
            map[r.group].rows.push(r);
        }
        return order;
    }

    get flat() {
        return this.groups.flatMap((g) => g.rows);
    }

    get selectedUid() {
        const flat = this.flat;
        if (!flat.length) return null;
        return flat.some((r) => r.uid === this.state.sel) ? this.state.sel : flat[0].uid;
    }

    /* ----------------------- interactions ----------------------- */
    onInput(ev) {
        this.state.q = ev.target.value;
        this.state.sel = null;
    }

    onKey(ev) {
        const flat = this.flat;
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
            ev.preventDefault();
            if (!flat.length) return;
            const idx = flat.findIndex((r) => r.uid === this.selectedUid);
            const next = ev.key === "ArrowDown"
                ? (idx + 1) % flat.length
                : (idx - 1 + flat.length) % flat.length;
            this.state.sel = flat[next].uid;
            this.scrollToSel();
        } else if (ev.key === "Enter") {
            ev.preventDefault();
            const row = flat.find((r) => r.uid === this.selectedUid);
            if (row) this.run(row);
            else if (this.state.q.trim().length > 1) {
                this.run({ kind: "ai", id: this.state.q.trim() });
            }
        }
    }

    scrollToSel() {
        requestAnimationFrame(() => {
            const el = this.listRef.el?.querySelector(
                `[data-uid="${this.selectedUid}"]`);
            el?.scrollIntoView({ block: "nearest" });
        });
    }

    run(row) {
        this.props.onRun({ kind: row.kind, id: row.id });
    }
}
