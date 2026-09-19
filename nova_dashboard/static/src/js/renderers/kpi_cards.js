/** Nova value cards — KPI and Tile. */
import { Component, useRef, onMounted, onPatched, xml } from "@odoo/owl";
import { countUp, sparkPath, hexToRgba, shiftHue } from "../nova_utils";

export class NovaKpi extends Component {
    static template = xml`
        <div class="nv-kpi" t-att-class="props.payload.type === 'tile' ? 'nv-kpi-tile' : ''">
            <div class="nv-kpi-main">
                <div class="nv-kpi-icon" t-att-style="iconStyle">
                    <i t-att-class="'fa ' + (props.meta.icon || 'fa-bolt')"/>
                </div>
                <div class="nv-kpi-body">
                    <div class="nv-kpi-value" t-ref="value"><t t-esc="kpi.formatted"/></div>
                    <div class="nv-kpi-chips">
                        <span t-if="hasDelta" class="nv-delta"
                              t-att-class="kpi.delta >= 0 ? 'nv-up' : 'nv-down'"
                              t-att-title="prevTitle">
                            <i t-att-class="'fa ' + (kpi.delta >= 0 ? 'fa-caret-up' : 'fa-caret-down')"/>
                            <t t-esc="absDelta"/>%
                        </span>
                        <span t-if="kpi.forecast_next" class="nv-chip nv-chip-fc"
                              title="Next-period forecast">
                            <i class="fa fa-magic me-1"/><t t-esc="kpi.forecast_next"/>
                        </span>
                        <span t-if="trendIcon and !hasDelta" class="nv-chip">
                            <i t-att-class="'fa ' + trendIcon"/>
                        </span>
                    </div>
                </div>
                <div t-if="ringPct !== null" class="nv-kpi-ring" t-att-title="kpi.target_pct + '% of target'">
                    <svg viewBox="0 0 44 44">
                        <circle cx="22" cy="22" r="18" class="nv-ring-track"/>
                        <circle cx="22" cy="22" r="18" class="nv-ring-fill"
                                t-att-style="ringStyle"/>
                    </svg>
                    <span class="nv-ring-text"><t t-esc="ringText"/></span>
                </div>
            </div>
            <svg t-if="spark.line" class="nv-spark" viewBox="0 0 120 34" preserveAspectRatio="none">
                <defs>
                    <linearGradient t-att-id="gid" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" t-att-stop-color="sparkFillTop"/>
                        <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
                    </linearGradient>
                </defs>
                <path t-att-d="spark.area" t-att-fill="'url(#' + gid + ')'"/>
                <path t-att-d="spark.line" fill="none" t-att-stroke="props.meta.color"
                      stroke-width="2" stroke-linecap="round"
                      t-att-class="props.motion ? 'nv-spark-line nv-anim' : 'nv-spark-line'"/>
            </svg>
        </div>`;
    static props = ["payload", "meta", "motion"];

    setup() {
        this.valueRef = useRef("value");
        this._animated = null;
        onMounted(() => this.animate());
        onPatched(() => this.animate());
    }

    animate() {
        const k = this.kpi;
        if (this._animated === k.formatted) return;
        this._animated = k.formatted;
        countUp(this.valueRef.el, k.value || 0, k.formatted || "0", this.props.motion);
    }

    get kpi() {
        return this.props.payload.kpi || {};
    }
    get gid() {
        return "nvs" + this.props.payload.id;
    }
    get hasDelta() {
        return this.kpi.delta !== null && this.kpi.delta !== undefined;
    }
    get absDelta() {
        return Math.abs(this.kpi.delta ?? 0);
    }
    get prevTitle() {
        return this.kpi.prev_formatted ? "Previous period: " + this.kpi.prev_formatted : "";
    }
    get trendIcon() {
        const t = this.kpi.trend;
        if (t === "rising") return "fa-arrow-trend-up fa-level-up";
        if (t === "falling") return "fa-level-down";
        return "";
    }
    get iconStyle() {
        const c = this.props.meta.color || "#7C6CFF";
        return (
            `background:linear-gradient(135deg, ${hexToRgba(c, 0.95)}, ` +
            `${hexToRgba(shiftHue(c, 40), 0.85)});` +
            `box-shadow:0 6px 18px ${hexToRgba(c, 0.35)};`
        );
    }
    get spark() {
        const pts = this.kpi.spark || [];
        if (pts.length < 2) return { line: "", area: "" };
        return sparkPath(pts, 120, 34, 3);
    }
    get sparkFillTop() {
        return hexToRgba(this.props.meta.color || "#7C6CFF", 0.25);
    }
    get ringPct() {
        const p = this.kpi.target_pct;
        return p === null || p === undefined ? null : Math.min(p, 999);
    }
    get ringText() {
        const p = this.ringPct;
        return p === null ? "" : Math.round(p) + "%";
    }
    get ringStyle() {
        const r = 18, circ = 2 * Math.PI * r;
        const frac = Math.max(0, Math.min(1, (this.ringPct || 0) / 100));
        const c = (this.ringPct || 0) >= 100
            ? "var(--nv-good)" : (this.props.meta.color || "#7C6CFF");
        return (
            `stroke:${c};stroke-dasharray:${circ};` +
            `stroke-dashoffset:${circ * (1 - frac)};` +
            (this.props.motion ? "transition:stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1);" : "")
        );
    }
}
