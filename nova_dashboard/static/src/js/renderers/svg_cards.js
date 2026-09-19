/** Nova SVG cards — gauge, bullet, funnel, heatmap. Pure SVG, no libs. */
import { Component, xml } from "@odoo/owl";
import { hexToRgba, shiftHue } from "../nova_utils";

/* ------------------------------------------------------------------ */
/* GAUGE — animated 240° sweep arc with needle-less modern look        */
/* ------------------------------------------------------------------ */
export class NovaGauge extends Component {
    static template = xml`
        <div class="nv-gauge">
            <svg viewBox="0 0 200 132" class="nv-gauge-svg">
                <defs>
                    <linearGradient t-att-id="gradId" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" t-att-stop-color="color"/>
                        <stop offset="100%" t-att-stop-color="colorEnd"/>
                    </linearGradient>
                </defs>
                <path t-att-d="arc(1)" fill="none" class="nv-gauge-track"
                      stroke-width="14" stroke-linecap="round"/>
                <path t-att-d="arc(ratio)" fill="none"
                      t-att-stroke="'url(#' + gradId + ')'"
                      stroke-width="14" stroke-linecap="round"
                      t-att-class="props.motion ? 'nv-gauge-fill nv-anim' : 'nv-gauge-fill'"/>
                <text x="100" y="92" text-anchor="middle" class="nv-gauge-value">
                    <t t-esc="kpi.formatted"/>
                </text>
                <text x="100" y="112" text-anchor="middle" class="nv-gauge-sub">
                    <t t-esc="subLabel"/>
                </text>
            </svg>
            <div t-if="kpi.target" class="nv-gauge-target">
                <span class="nv-pill" t-att-class="(kpi.target_pct or 0) >= 100 ? 'nv-pill-good' : ''">
                    <i class="fa fa-bullseye me-1"/><t t-esc="targetText"/>
                </span>
            </div>
        </div>`;
    static props = ["payload", "meta", "motion"];

    get kpi() {
        return this.props.payload.kpi || {};
    }
    get gradId() {
        return "nvg" + this.props.payload.id;
    }
    get color() {
        return this.props.meta.color || "#7C6CFF";
    }
    get colorEnd() {
        return shiftHue(this.color, 45);
    }
    get ratio() {
        const k = this.kpi;
        const max = k.gauge_max || 1;
        return Math.max(0.005, Math.min(1, (k.value || 0) / max));
    }
    get subLabel() {
        const k = this.kpi;
        if (k.target_formatted) return "of " + k.target_formatted + " target";
        return this.props.meta.name || "";
    }
    get targetText() {
        return (this.kpi.target_pct ?? 0) + "% of target";
    }
    /** 240° arc from 150° to 30° (sweeping clockwise over the top). */
    arc(ratio) {
        const cx = 100, cy = 100, r = 78;
        const start = 150, sweep = 240 * Math.max(0, Math.min(1, ratio));
        const rad = (a) => ((a - 90) * Math.PI) / 180;
        const pt = (a) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
        const [x0, y0] = pt(start);
        const [x1, y1] = pt(start + sweep);
        const large = sweep > 180 ? 1 : 0;
        return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    }
}

/* ------------------------------------------------------------------ */
/* BULLET — compact target-vs-actual bar                                */
/* ------------------------------------------------------------------ */
export class NovaBullet extends Component {
    static template = xml`
        <div class="nv-bullet">
            <div class="nv-bullet-top">
                <span class="nv-bullet-value"><t t-esc="kpi.formatted"/></span>
                <span t-if="kpi.delta !== null and kpi.delta !== undefined"
                      class="nv-delta" t-att-class="kpi.delta >= 0 ? 'nv-up' : 'nv-down'">
                    <i t-att-class="'fa ' + (kpi.delta >= 0 ? 'fa-caret-up' : 'fa-caret-down')"/>
                    <t t-esc="absDelta"/>%
                </span>
            </div>
            <div class="nv-bullet-track">
                <div class="nv-bullet-band nv-band-1" style="width:100%"/>
                <div class="nv-bullet-band nv-band-2" style="width:80%"/>
                <div class="nv-bullet-band nv-band-3" style="width:55%"/>
                <div class="nv-bullet-fill" t-att-class="props.motion ? 'nv-anim' : ''"
                     t-att-style="'width:' + pct + '%; background:' + barColor"/>
                <div t-if="kpi.target" class="nv-bullet-marker"
                     t-att-style="'left:' + targetPct + '%'"/>
            </div>
            <div class="nv-bullet-foot">
                <span t-if="kpi.target_formatted">Target <t t-esc="kpi.target_formatted"/></span>
                <span t-if="kpi.target_pct !== null and kpi.target_pct !== undefined"
                      t-att-class="kpi.target_pct >= 100 ? 'nv-good-text' : ''">
                    <t t-esc="kpi.target_pct"/>%
                </span>
            </div>
        </div>`;
    static props = ["payload", "meta", "motion"];

    get kpi() {
        return this.props.payload.kpi || {};
    }
    get absDelta() {
        return Math.abs(this.kpi.delta ?? 0);
    }
    get pct() {
        const k = this.kpi;
        return Math.min(100, ((k.value || 0) / (k.gauge_max || 1)) * 100).toFixed(1);
    }
    get targetPct() {
        const k = this.kpi;
        return Math.min(100, ((k.target || 0) / (k.gauge_max || 1)) * 100).toFixed(1);
    }
    get barColor() {
        return this.props.meta.color || "#7C6CFF";
    }
}

/* ------------------------------------------------------------------ */
/* FUNNEL — gradient trapezoids with stage conversion                   */
/* ------------------------------------------------------------------ */
export class NovaFunnel extends Component {
    static template = xml`
        <div class="nv-funnel">
            <div t-foreach="stages" t-as="s" t-key="s_index" class="nv-funnel-row"
                 t-att-class="props.motion ? 'nv-stagger' : ''"
                 t-att-style="'--i:' + s_index"
                 t-on-click="() => this.clickStage(s)">
                <div class="nv-funnel-bar"
                     t-att-style="barStyle(s, s_index)">
                    <span class="nv-funnel-label" t-esc="s.label"/>
                    <span class="nv-funnel-val" t-esc="s.formatted"/>
                </div>
                <span class="nv-funnel-pct" t-esc="s.pct + '%'"/>
            </div>
        </div>`;
    static props = ["payload", "meta", "motion", "onSlice?"];

    get stages() {
        return (this.props.payload.funnel || {}).stages || [];
    }
    barStyle(s, i) {
        const c = this.props.meta.color || "#7C6CFF";
        const w = Math.max(18, s.pct);
        return (
            `width:${w}%;` +
            `background:linear-gradient(90deg, ${hexToRgba(c, 0.95)}, ${hexToRgba(
                shiftHue(c, 30 + i * 14), 0.8)});`
        );
    }
    clickStage(s) {
        if (this.props.onSlice && s.domain && s.domain.length) {
            this.props.onSlice(s.domain);
        }
    }
}

/* ------------------------------------------------------------------ */
/* HEATMAP — intensity matrix                                           */
/* ------------------------------------------------------------------ */
export class NovaHeatmap extends Component {
    static template = xml`
        <div class="nv-heatmap">
            <div class="nv-hm-grid" t-att-style="gridStyle">
                <div class="nv-hm-corner"/>
                <div t-foreach="hm.x" t-as="x" t-key="x_index" class="nv-hm-xlab" t-esc="x"/>
                <t t-foreach="hm.y" t-as="y" t-key="y_index">
                    <div class="nv-hm-ylab" t-esc="y"/>
                    <div t-foreach="hm.x" t-as="x" t-key="x_index" class="nv-hm-cell"
                         t-att-class="(props.motion ? 'nv-stagger ' : '') + (canClick(y_index, x_index) ? 'nv-hm-click' : '')"
                         t-att-style="cellStyle(y_index, x_index)"
                         t-att-title="y + ' × ' + x + ': ' + cellVal(y_index, x_index) + (canClick(y_index, x_index) ? ' — click to open' : '')"
                         t-on-click="() => this.click(y_index, x_index)">
                        <span t-if="hm.x.length &lt;= 12" t-esc="cellText(y_index, x_index)"/>
                    </div>
                </t>
            </div>
        </div>`;
    static props = ["payload", "meta", "motion", "onCell?"];

    get hm() {
        return this.props.payload.heatmap || { x: [], y: [], matrix: [], max: 0 };
    }
    domainAt(yi, xi) {
        const d = (this.hm.domains || [])[yi];
        return (d && d[xi]) || null;
    }
    canClick(yi, xi) {
        const d = this.domainAt(yi, xi);
        return !!(this.props.onCell && d && d.length);
    }
    click(yi, xi) {
        if (this.canClick(yi, xi)) {
            this.props.onCell(this.domainAt(yi, xi));
        }
    }
    get gridStyle() {
        return `grid-template-columns: minmax(60px, auto) repeat(${this.hm.x.length}, 1fr);`;
    }
    cellVal(yi, xi) {
        return (this.hm.matrix[yi] || [])[xi] || 0;
    }
    cellText(yi, xi) {
        const v = this.cellVal(yi, xi);
        if (!v) return "";
        return v >= 1000 ? Math.round(v / 100) / 10 + "K" : Math.round(v * 10) / 10;
    }
    cellStyle(yi, xi) {
        const v = this.cellVal(yi, xi);
        const max = this.hm.max || 1;
        const a = v ? 0.12 + 0.85 * (v / max) : 0.04;
        const c = this.props.meta.color || "#7C6CFF";
        const i = yi * this.hm.x.length + xi;
        return `background:${hexToRgba(c, a)};--i:${i % 40};` +
            (v / max > 0.62 ? "color:#fff;" : "");
    }
}
