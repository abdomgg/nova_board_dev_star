/** NovaItem — glass card wrapper · NovaBody — reusable renderer dispatcher. */
import { Component, useState, useRef, xml } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { downloadText } from "./nova_utils";
import { NovaChart } from "./renderers/chart_card";
import { NovaGauge, NovaBullet, NovaFunnel, NovaHeatmap } from "./renderers/svg_cards";
import { NovaKpi } from "./renderers/kpi_cards";
import { NovaLeaderboard, NovaList, NovaTodo, NovaText } from "./renderers/data_cards";

const CHART_SET = new Set([
    "bar", "hbar", "line", "area", "waterfall", "pie", "doughnut", "polar",
    "radar", "scatter",
]);

/* ===================================================================== *
 *  NovaBody — skeleton / error / renderer dispatch.                     *
 *  Used by the live dashboard cards AND the Studio preview stage.       *
 * ===================================================================== */
export class NovaBody extends Component {
    static template = xml`
        <div class="nv-card-body">
            <div t-if="!payload" class="nv-skeleton">
                <div class="nv-sk-bar" style="width:55%"/>
                <div class="nv-sk-block"/>
            </div>
            <div t-elif="payload.error" class="nv-error">
                <i class="fa fa-exclamation-circle"/>
                <span t-esc="payload.error"/>
            </div>
            <t t-else="">
                <div t-if="isValue" class="nv-drill"
                     t-att-class="props.meta.has_action ? 'nv-drill-on' : ''"
                     t-att-title="props.meta.has_action ? 'Click to open the records' : ''"
                     t-on-click="() => props.meta.has_action and this.slice(null)">
                    <NovaKpi t-if="kind === 'kpi'" payload="payload" meta="props.meta" motion="props.motion"/>
                    <NovaGauge t-elif="kind === 'gauge'" payload="payload" meta="props.meta" motion="props.motion"/>
                    <NovaBullet t-elif="kind === 'bullet'" payload="payload" meta="props.meta" motion="props.motion"/>
                    <NovaKpi t-else="" payload="payload" meta="props.meta" motion="props.motion"/>
                </div>
                <NovaFunnel t-elif="kind === 'funnel'" payload="payload" meta="props.meta" motion="props.motion" onSlice.bind="slice"/>
                <NovaHeatmap t-elif="kind === 'heatmap'" payload="payload" meta="props.meta" motion="props.motion" onCell.bind="slice"/>
                <NovaLeaderboard t-elif="kind === 'leaderboard'" payload="payload" meta="props.meta" motion="props.motion" onSlice.bind="slice"/>
                <NovaList t-elif="kind === 'list'" payload="payload" meta="props.meta" motion="props.motion" onPage.bind="page" onRecord.bind="record" onSort.bind="sort"/>
                <NovaTodo t-elif="kind === 'todo'" payload="payload" meta="props.meta" motion="props.motion" onToggle.bind="toggle" onAdd.bind="add"/>
                <NovaText t-elif="kind === 'text'" payload="payload" meta="props.meta" motion="props.motion"/>
                <NovaChart t-elif="isChart" payload="payload" meta="props.meta" motion="props.motion" onSlice.bind="slice"/>
                <div t-else="" class="nv-empty">Unsupported widget</div>
            </t>
        </div>`;
    static components = {
        NovaChart, NovaGauge, NovaBullet, NovaFunnel, NovaHeatmap,
        NovaKpi, NovaLeaderboard, NovaList, NovaTodo, NovaText,
    };
    static props = ["meta", "payload", "motion", "onSlice?", "onPage?", "onRecord?", "onToggle?", "onAdd?", "onSort?"];

    get payload() {
        return this.props.payload;
    }
    get kind() {
        return this.payload ? this.payload.type : this.props.meta.type;
    }
    get isChart() {
        return CHART_SET.has(this.kind);
    }
    get isValue() {
        return ["kpi", "tile", "gauge", "bullet"].includes(this.kind);
    }
    slice(arg) { (this.props.onSlice || (() => {}))(arg); }
    page(arg) { (this.props.onPage || (() => {}))(arg); }
    sort(spec) { (this.props.onSort || (() => {}))(spec); }
    record(id) { (this.props.onRecord || (() => {}))(id); }
    toggle(id) { (this.props.onToggle || (() => {}))(id); }
    add(name) { (this.props.onAdd || (() => {}))(name); }
}

/* ===================================================================== *
 *  NovaItem — full interactive card with menu, insight & drill-down.    *
 * ===================================================================== */
export class NovaItem extends Component {
    static template = xml`
        <div class="nv-card" t-ref="card"
             t-att-class="(props.motion ? 'nv-card-motion ' : '') + 'nv-card-' + props.meta.type + (alertOn ? ' nv-card-alert' : '')"
             t-att-style="alertOn ? '--al:' + payload.alert.color : ''">
            <div class="nv-card-head">
                <span class="nv-card-dot" t-att-style="'background:' + props.meta.color"/>
                <span class="nv-card-title" t-att-class="props.onInspect ? 'nv-title-click' : ''"
                      t-att-title="props.onInspect ? 'Inspect this widget' : ''"
                      t-on-click="inspect" t-esc="props.meta.name"/>
                <span t-if="alertOn" class="nv-chip nv-chip-alert"
                      t-att-style="'--al:' + payload.alert.color"
                      t-att-title="'Pulse alert: value ' + payload.alert.rule + ' ' + payload.alert.threshold">
                    <i class="fa fa-bell"/>
                </span>
                <span t-if="payload and payload.anomaly_count" class="nv-chip nv-chip-warn nv-chip-click"
                      t-att-title="payload.anomaly_count + ' anomalies — click to inspect'"
                      t-on-click="inspect">
                    <i class="fa fa-exclamation-triangle"/> <t t-esc="payload.anomaly_count"/>
                </span>
                <span class="nv-flex-1"/>
                <button t-if="props.onFocus" class="nv-icon-btn nv-hover-btn"
                        title="Focus view" t-on-click="focus">
                    <i class="fa fa-expand"/>
                </button>
                <button t-if="payload and payload.insight" class="nv-icon-btn nv-insight-btn"
                        t-att-class="state.showInsight ? 'nv-active' : ''"
                        title="AI insight" t-on-click="() => state.showInsight = !state.showInsight">
                    <i class="fa fa-lightbulb-o"/>
                </button>
                <div class="nv-menu-wrap">
                    <button class="nv-icon-btn" t-on-click="toggleMenu" title="Card menu">
                        <i class="fa fa-ellipsis-v"/>
                    </button>
                    <div t-if="state.menuOpen" class="nv-menu" t-on-click.stop="() => {}">
                        <button t-on-click="refresh"><i class="fa fa-refresh"/> Refresh</button>
                        <button t-if="props.onAsk" t-on-click="askFromMenu">
                            <i class="fa fa-magic"/> Ask NovaMind</button>
                        <button t-if="props.onInspect" t-on-click="inspectFromMenu">
                            <i class="fa fa-info-circle"/> Inspect</button>
                        <button t-if="props.onFocus" t-on-click="focusFromMenu">
                            <i class="fa fa-expand"/> Focus view</button>
                        <button t-if="props.meta.has_action" t-on-click="openRecords">
                            <i class="fa fa-external-link"/> Open records</button>
                        <button t-if="props.editable" t-on-click="edit">
                            <i class="fa fa-magic"/> Edit in Studio</button>
                        <button t-if="props.editable" t-on-click="openForm">
                            <i class="fa fa-pencil-square-o"/> Advanced form</button>
                        <button t-if="props.editable" t-on-click="duplicate">
                            <i class="fa fa-clone"/> Duplicate</button>
                        <button t-if="canPng" t-on-click="exportPng">
                            <i class="fa fa-image"/> Export PNG</button>
                        <button t-if="canCsv" t-on-click="exportCsv">
                            <i class="fa fa-table"/> Export CSV</button>
                        <button t-if="props.editable" class="nv-menu-danger" t-on-click="remove">
                            <i class="fa fa-trash"/> Delete</button>
                    </div>
                </div>
            </div>

            <NovaBody meta="props.meta" payload="payload" motion="props.motion"
                      onSlice.bind="onSlice" onPage.bind="onPage" onRecord.bind="onRecord"
                      onToggle.bind="onToggle" onAdd.bind="onAdd" onSort.bind="onSort"/>

            <div t-if="payload and payload.insight and state.showInsight" class="nv-card-insight">
                <i class="fa fa-lightbulb-o"/>
                <span t-esc="payload.insight"/>
            </div>
        </div>`;
    static components = { NovaBody };
    static props = ["meta", "payload", "motion", "editable", "onReload", "onRemoved", "onEdit?", "onInspect?", "onFocus?", "onAsk?"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.dialog = useService("dialog");
        this.notification = useService("notification");
        this.cardRef = useRef("card");
        this.state = useState({ menuOpen: false, showInsight: false });
        this._closeMenu = () => (this.state.menuOpen = false);
    }

    get payload() {
        return this.props.payload;
    }
    get alertOn() {
        return !!(this.payload && this.payload.alert && this.payload.alert.active);
    }
    get kind() {
        return this.payload ? this.payload.type : this.props.meta.type;
    }
    get isChart() {
        return CHART_SET.has(this.kind);
    }
    get canPng() {
        return this.payload && !this.payload.error && this.isChart && this.kind !== "radar";
    }
    get canCsv() {
        const p = this.payload;
        return p && !p.error && (p.chart || p.board || p.list || p.funnel);
    }

    toggleMenu(ev) {
        ev.stopPropagation();
        const open = !this.state.menuOpen;
        this.state.menuOpen = open;
        if (open) {
            setTimeout(() =>
                window.addEventListener("click", this._closeMenu, { once: true }));
        }
    }

    refresh() {
        this.state.menuOpen = false;
        this.props.onReload(this.props.meta.id, {});
    }

    inspect(ev) {
        if (!this.props.onInspect) return;
        ev.stopPropagation();
        this.props.onInspect(this.props.meta.id);
    }

    askFromMenu() {
        this.state.menuOpen = false;
        this.props.onAsk(this.props.meta.id);
    }

    inspectFromMenu() {
        this.state.menuOpen = false;
        this.props.onInspect(this.props.meta.id);
    }

    focus(ev) {
        ev.stopPropagation();
        this.props.onFocus(this.props.meta.id);
    }

    focusFromMenu() {
        this.state.menuOpen = false;
        this.props.onFocus(this.props.meta.id);
    }

    async openRecords() {
        this.state.menuOpen = false;
        const act = await this.orm.call(
            "nova.dashboard.item", "web_record_action",
            [[this.props.meta.id]]);
        if (act) this.action.doAction(act);
    }

    edit() {
        this.state.menuOpen = false;
        if (this.props.onEdit) {
            this.props.onEdit(this.props.meta.id);
        } else {
            this.openForm();
        }
    }

    openForm() {
        this.state.menuOpen = false;
        this.action.doAction(
            {
                type: "ir.actions.act_window",
                res_model: "nova.dashboard.item",
                res_id: this.props.meta.id,
                views: [[false, "form"]],
                target: "new",
            },
            { onClose: () => this.props.onReload(this.props.meta.id, { meta: true }) }
        );
    }

    async duplicate() {
        this.state.menuOpen = false;
        await this.orm.call("nova.dashboard.item", "copy", [[this.props.meta.id]]);
        this.props.onReload(null, { meta: true });
    }

    remove() {
        this.state.menuOpen = false;
        this.dialog.add(ConfirmationDialog, {
            title: "Delete widget",
            body: `Remove "${this.props.meta.name}" from this dashboard?`,
            confirmLabel: "Delete",
            confirm: async () => {
                await this.orm.unlink("nova.dashboard.item", [this.props.meta.id]);
                this.props.onRemoved(this.props.meta.id);
            },
            cancel: () => {},
        });
    }

    async onSlice(arg) {
        let extra = null;
        if (typeof arg === "number") {
            extra = (this.payload.label_domains || [])[arg];
            if (!extra || !extra.length) return;
        } else {
            extra = arg;
        }
        const act = await this.orm.call(
            "nova.dashboard.item", "web_record_action",
            [[this.props.meta.id]], { extra_domain: extra });
        if (act) this.action.doAction(act);
    }

    async onRecord(resId) {
        const act = await this.orm.call(
            "nova.dashboard.item", "web_record_action",
            [[this.props.meta.id]], { res_id: resId });
        if (act) this.action.doAction(act);
    }

    onPage(arg) {
        const opts = typeof arg === "object" && arg !== null
            ? { offset: arg.offset, sort: arg.sort }
            : { offset: arg };
        this.props.onReload(this.props.meta.id, opts);
    }

    onSort(spec) {
        this.props.onReload(this.props.meta.id, { sort: spec, offset: 0 });
    }

    async onToggle(lineId) {
        await this.orm.call("nova.dashboard.item", "web_toggle_todo",
            [[this.props.meta.id]], { todo_id: lineId });
        this.props.onReload(this.props.meta.id, {});
    }

    async onAdd(name) {
        await this.orm.call("nova.dashboard.item", "web_add_todo",
            [[this.props.meta.id]], { name });
        this.props.onReload(this.props.meta.id, {});
    }

    exportPng() {
        this.state.menuOpen = false;
        const canvas = this.cardRef.el?.querySelector("canvas");
        if (!canvas) return;
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = (this.props.meta.name || "chart") + ".png";
        a.click();
    }

    exportCsv() {
        this.state.menuOpen = false;
        const p = this.payload;
        const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        let rows = [];
        if (p.chart) {
            const head = ["Label", ...p.chart.datasets.map((d) => d.label)];
            rows.push(head.map(esc).join(","));
            (p.chart.labels || []).forEach((l, i) => {
                rows.push([l, ...p.chart.datasets.map((d) => {
                    const v = d.data[i];
                    return Array.isArray(v) ? v[1] - v[0] : v ?? "";
                })].map(esc).join(","));
            });
        } else if (p.board) {
            rows.push(["Rank", "Label", "Value", "Delta %"].map(esc).join(","));
            p.board.entries.forEach((e) =>
                rows.push([e.rank, e.label, e.value, e.delta ?? ""].map(esc).join(",")));
        } else if (p.funnel) {
            rows.push(["Stage", "Value", "%"].map(esc).join(","));
            p.funnel.stages.forEach((s) =>
                rows.push([s.label, s.value, s.pct].map(esc).join(",")));
        } else if (p.list) {
            rows.push(p.list.headers.map(esc).join(","));
            p.list.rows.forEach((r) => rows.push(r.cells.map(esc).join(",")));
        }
        downloadText((this.props.meta.name || "data") + ".csv",
            rows.join("\n"), "text/csv");
    }
}
