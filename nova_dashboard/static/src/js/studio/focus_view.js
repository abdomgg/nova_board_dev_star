/** NovaFocus — cinematic full-screen spotlight on a single widget. */
import { Component, useState, onMounted, onWillUnmount, xml } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { NovaBody } from "../nova_item";

export class NovaFocus extends Component {
    static template = xml`
        <div class="nv-focus-mask" t-on-mousedown.self="props.onClose">
            <t t-foreach="[meta.id]" t-as="fid" t-key="fid">
            <div class="nv-focus">
                <div class="nv-focus-head">
                    <span class="nv-card-dot" t-att-style="'background:' + meta.color"/>
                    <div class="nv-focus-titles">
                        <h2 t-esc="meta.name"/>
                        <span t-if="meta.model" class="nv-focus-model">
                            <i class="fa fa-database"/> <t t-esc="meta.model"/>
                        </span>
                    </div>
                    <span t-if="payload and payload.anomaly_count" class="nv-chip nv-chip-warn">
                        <i class="fa fa-exclamation-triangle"/>
                        <t t-esc="payload.anomaly_count"/> anomalies
                    </span>
                    <span class="nv-flex-1"/>
                    <span class="nv-focus-counter" t-esc="counter"/>
                    <button t-if="props.onAsk" class="nv-icon-btn" title="Ask NovaMind about this"
                            t-on-click="() => props.onAsk(meta.id)">
                        <i class="fa fa-magic"/></button>
                    <button class="nv-icon-btn" title="Inspect"
                            t-on-click="() => props.onInspect(meta.id)">
                        <i class="fa fa-info-circle"/></button>
                    <button t-if="props.editable" class="nv-icon-btn" title="Edit in Studio"
                            t-on-click="() => props.onEdit(meta.id)">
                        <i class="fa fa-magic"/></button>
                    <button t-if="meta.has_action" class="nv-icon-btn" title="Open records"
                            t-on-click="openRecords">
                        <i class="fa fa-external-link"/></button>
                    <button class="nv-icon-btn" title="Refresh"
                            t-on-click="() => props.onReload(meta.id, {})">
                        <i class="fa fa-refresh"/></button>
                    <button class="nv-icon-btn" title="Close (Esc)" t-on-click="props.onClose">
                        <i class="fa fa-times"/></button>
                </div>

                <div class="nv-focus-stage">
                    <button t-if="props.items.length > 1" class="nv-focus-nav nv-focus-prev"
                            title="Previous widget (←)" t-on-click="prev">
                        <i class="fa fa-chevron-left"/>
                    </button>
                    <div class="nv-focus-card nv-card" t-att-class="'nv-card-' + meta.type">
                        <NovaBody meta="meta" payload="payload" motion="true"
                                  onSlice.bind="onSlice" onPage.bind="onPage"
                                  onRecord.bind="onRecord"/>
                    </div>
                    <button t-if="props.items.length > 1" class="nv-focus-nav nv-focus-next"
                            title="Next widget (→)" t-on-click="next">
                        <i class="fa fa-chevron-right"/>
                    </button>
                </div>

                <div class="nv-focus-foot">
                    <div t-if="stats.length" class="nv-focus-stats">
                        <div t-foreach="stats" t-as="st" t-key="st.label" class="nv-focus-stat">
                            <span class="nv-stat-val" t-esc="st.value"/>
                            <span class="nv-stat-label" t-esc="st.label"/>
                        </div>
                    </div>
                    <div t-if="payload and payload.insight" class="nv-focus-insight">
                        <i class="fa fa-lightbulb-o"/>
                        <span t-esc="payload.insight"/>
                    </div>
                </div>
            </div>
            </t>
        </div>`;
    static components = { NovaBody };
    static props = ["items", "payloads", "startId", "editable", "onClose",
        "onInspect", "onEdit", "onReload", "onAsk?"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        const idx = this.props.items.findIndex((i) => i.id === this.props.startId);
        this.state = useState({ idx: idx >= 0 ? idx : 0 });
        this._keys = (ev) => {
            if (ev.key === "Escape") this.props.onClose();
            else if (ev.key === "ArrowRight") this.next();
            else if (ev.key === "ArrowLeft") this.prev();
        };
        onMounted(() => window.addEventListener("keydown", this._keys));
        onWillUnmount(() => window.removeEventListener("keydown", this._keys));
    }

    get meta() {
        return this.props.items[this.state.idx] || this.props.items[0];
    }
    get payload() {
        return this.props.payloads[this.meta.id];
    }
    get counter() {
        return (this.state.idx + 1) + " / " + this.props.items.length;
    }

    next() {
        this.state.idx = (this.state.idx + 1) % this.props.items.length;
    }
    prev() {
        this.state.idx = (this.state.idx - 1 + this.props.items.length) %
            this.props.items.length;
    }

    compact(v) {
        const a = Math.abs(v);
        if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
        if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
        if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
        return (Math.round(v * 100) / 100).toString();
    }

    get stats() {
        const p = this.payload;
        if (!p || p.error) return [];
        const out = [];
        const push = (label, value) =>
            value !== undefined && value !== null && value !== "" &&
            out.push({ label, value: String(value) });
        if (p.kpi) {
            push("Now", p.kpi.formatted);
            push("Previous", p.kpi.prev_formatted);
            if (p.kpi.delta !== null && p.kpi.delta !== undefined) {
                push("Δ", (p.kpi.delta > 0 ? "+" : "") + p.kpi.delta + "%");
            }
            push("Target", p.kpi.target_formatted);
        }
        if (p.chart && p.chart.datasets) {
            const nums = [];
            for (const d of p.chart.datasets) {
                for (const v of d.data || []) {
                    const n = Array.isArray(v) ? v[1] - v[0] :
                        (v && v.y !== undefined ? v.y : v);
                    if (typeof n === "number" && isFinite(n)) nums.push(n);
                }
            }
            if (nums.length) {
                const sum = nums.reduce((a, b) => a + b, 0);
                push("Total", this.compact(sum));
                push("Average", this.compact(sum / nums.length));
                push("Peak", this.compact(nums.reduce((a, b) => (b > a ? b : a), -Infinity)));
                push("Points", nums.length);
            }
        }
        if (p.board) push("Entries", p.board.entries.length);
        if (p.funnel) push("Stages", p.funnel.stages.length);
        if (p.list) push("Records", p.list.total);
        return out.slice(0, 5);
    }

    async onSlice(arg) {
        let extra = null;
        if (typeof arg === "number") {
            extra = (this.payload.label_domains || [])[arg];
            if (!extra || !extra.length) return;
        } else {
            extra = arg;
        }
        const act = await this.orm.call("nova.dashboard.item",
            "web_record_action", [[this.meta.id]], { extra_domain: extra });
        if (act) this.action.doAction(act);
    }

    async onRecord(resId) {
        const act = await this.orm.call("nova.dashboard.item",
            "web_record_action", [[this.meta.id]], { res_id: resId });
        if (act) this.action.doAction(act);
    }

    onPage(offset) {
        this.props.onReload(this.meta.id, { offset });
    }

    async openRecords() {
        const act = await this.orm.call("nova.dashboard.item",
            "web_record_action", [[this.meta.id]]);
        if (act) this.action.doAction(act);
    }
}
