/** NovaHub — the landing gallery: every dashboard flying as a live card. */
import { Component, useState, xml } from "@odoo/owl";

const TYPE_ICONS = {
    kpi: "fa-bolt", tile: "fa-square", gauge: "fa-tachometer", bullet: "fa-arrows-h",
    bar: "fa-bar-chart", hbar: "fa-align-left", line: "fa-line-chart",
    area: "fa-area-chart", waterfall: "fa-signal", radar: "fa-bullseye",
    scatter: "fa-braille", pie: "fa-pie-chart", doughnut: "fa-circle-o-notch",
    polar: "fa-dot-circle-o", funnel: "fa-filter", heatmap: "fa-th",
    leaderboard: "fa-trophy", list: "fa-table", todo: "fa-check-square-o",
    text: "fa-file-text-o",
};

export class NovaHub extends Component {
    static template = xml`
        <div class="nv-hub">
            <div class="nv-hub-hero">
                <div class="nv-hub-mark"><i class="fa fa-bolt"/></div>
                <h1>NovaBoard</h1>
                <p t-if="hub">
                    <b t-esc="hub.totals.boards"/> dashboard<t t-if="hub.totals.boards !== 1">s</t>
                    · <b t-esc="hub.totals.widgets"/> live widgets — pick one, or let NovaMind build the next.
                </p>
                <div class="nv-hub-bar">
                    <div class="nv-hub-search">
                        <i class="fa fa-search"/>
                        <input placeholder="Filter dashboards…  (Ctrl+K searches everything)"
                               t-att-value="state.q"
                               t-on-input="(ev) => state.q = ev.target.value"/>
                    </div>
                    <button t-if="canManage" class="nv-btn nv-btn-primary" t-on-click="props.onNew">
                        <i class="fa fa-plus"/> New dashboard</button>
                    <button class="nv-btn nv-btn-ai" t-on-click="props.onAI">
                        <i class="fa fa-magic"/> Build with AI</button>
                </div>
            </div>

            <div t-if="props.busy" class="nv-hub-grid">
                <div t-foreach="[0,1,2]" t-as="i" t-key="i" class="nv-hub-card nv-hub-ghost">
                    <div class="nv-skeleton"><div class="nv-sk-bar" style="width:60%"/>
                        <div class="nv-sk-block"/></div>
                </div>
            </div>

            <t t-elif="hub">
                <div t-if="!hub.boards.length" class="nv-hero nv-hub-empty">
                    <div class="nv-hero-icon"><i class="fa fa-bolt"/></div>
                    <h2>Welcome to NovaBoard</h2>
                    <p>Spin up your first dashboard, or describe it and let NovaMind compose it.</p>
                    <div class="nv-hero-actions">
                        <button t-if="canManage" class="nv-btn nv-btn-primary" t-on-click="props.onNew">
                            <i class="fa fa-plus"/> Create dashboard</button>
                        <button class="nv-btn nv-btn-ai" t-on-click="props.onAI">
                            <i class="fa fa-magic"/> Ask NovaMind</button>
                    </div>
                </div>

                <div t-else="" class="nv-hub-grid">
                    <div t-foreach="cards" t-as="b" t-key="b.id"
                         class="nv-hub-float" t-att-style="'--i:' + b_index + ';--fd:' + floatDelay(b.id)">
                        <div class="nv-hub-card" t-att-class="'nv-hub-card-' + b.theme"
                             t-att-style="'--bc:' + b.accent"
                             t-on-click="() => props.onOpen(b.id)">
                            <div class="nv-hub-strip">
                                <span class="nv-hub-dot" t-att-style="'background:' + b.accent"/>
                                <span t-foreach="bars(b.id)" t-as="h" t-key="h_index"
                                      class="nv-hub-bars" t-att-style="'height:' + h + '%;--j:' + h_index"/>
                            </div>
                            <div class="nv-hub-body">
                                <h3 t-esc="b.name"/>
                                <p t-if="b.description" t-esc="b.description"/>
                                <div class="nv-hub-meta">
                                    <span class="nv-hub-count">
                                        <i class="fa fa-cubes"/> <t t-esc="b.count"/> widgets
                                    </span>
                                    <span class="nv-hub-types">
                                        <i t-foreach="b.types" t-as="ty" t-key="ty"
                                           t-att-class="'fa ' + typeIcon(ty)" t-att-title="ty"/>
                                    </span>
                                    <span class="nv-flex-1"/>
                                    <i t-if="b.links" class="fa fa-link"
                                       t-att-title="b.links + ' linked dashboards'"/>
                                    <i t-if="b.refresh" class="fa fa-refresh" title="Auto-refresh on"/>
                                    <i t-if="b.webhook" class="fa fa-share-alt" title="n8n webhook active"/>
                                    <i t-if="b.menu" class="fa fa-bookmark" title="Has its own menu"/>
                                </div>
                            </div>
                            <div class="nv-hub-actions" t-on-click.stop="() => {}">
                                <button class="nv-icon-btn" title="Open"
                                        t-on-click="() => props.onOpen(b.id)">
                                    <i class="fa fa-arrow-right"/></button>
                                <button t-if="canManage" class="nv-icon-btn" title="Settings"
                                        t-on-click="() => props.onEdit(b.id)">
                                    <i class="fa fa-cog"/></button>
                                <button t-if="canManage" class="nv-icon-btn" title="Duplicate"
                                        t-on-click="() => props.onDuplicate(b.id)">
                                    <i class="fa fa-clone"/></button>
                                <button t-if="canManage" class="nv-icon-btn nv-hub-del" title="Delete"
                                        t-on-click="() => props.onDelete(b.id, b.name)">
                                    <i class="fa fa-trash"/></button>
                            </div>
                            <div class="nv-hub-updated">updated <t t-esc="b.updated"/></div>
                        </div>
                    </div>

                    <div t-if="canManage" class="nv-hub-float"
                         t-att-style="'--i:' + cards.length + ';--fd:' + floatDelay(99)">
                        <button class="nv-hub-card nv-hub-new" t-on-click="props.onNew">
                            <i class="fa fa-plus"/>
                            <span>New dashboard</span>
                            <small>or press Ctrl+K</small>
                        </button>
                    </div>
                    <div class="nv-hub-float"
                         t-att-style="'--i:' + (cards.length + 1) + ';--fd:' + floatDelay(55)">
                        <button class="nv-hub-card nv-hub-ai" t-on-click="props.onAI">
                            <span class="nv-hub-ai-orb"><i class="fa fa-magic"/></span>
                            <span class="nv-hub-ai-title">Build with AI</span>
                            <small>“Build me a sales dashboard with forecast…”</small>
                        </button>
                    </div>
                </div>
            </t>
        </div>`;
    static props = ["hub", "busy", "onOpen", "onNew", "onEdit", "onDuplicate",
        "onDelete", "onAI"];

    setup() {
        this.state = useState({ q: "" });
    }

    get hub() {
        return this.props.hub;
    }
    get canManage() {
        return !!(this.hub && this.hub.can_manage);
    }
    get cards() {
        const q = this.state.q.trim().toLowerCase();
        const boards = (this.hub && this.hub.boards) || [];
        if (!q) return boards;
        return boards.filter((b) =>
            b.name.toLowerCase().includes(q) ||
            (b.description || "").toLowerCase().includes(q));
    }

    typeIcon(t) {
        return TYPE_ICONS[t] || "fa-square";
    }

    /** Deterministic pseudo-random bars per board — stable mini "chart". */
    bars(id) {
        const out = [];
        let seed = (id * 2654435761) % 4294967296;
        for (let i = 0; i < 7; i++) {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            out.push(22 + (seed % 68));
        }
        return out;
    }

    floatDelay(id) {
        return (id % 7) * 0.8;
    }
}
