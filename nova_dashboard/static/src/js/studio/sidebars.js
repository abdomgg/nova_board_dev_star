/** NovaBoard sidebars — Inspector (widget), Board Info, Admin Control Center. */
import { Component, useState, onWillStart, xml } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

/* ===================================================================== *
 *  NovaInspector — deep info on one widget, fully clickable             *
 * ===================================================================== */
export class NovaInspector extends Component {
    static template = xml`
        <div class="nv-side">
            <div class="nv-drawer-head">
                <h3><i t-att-class="'fa ' + (state.info ? state.info.icon : 'fa-info-circle')"/>
                    <t t-esc="state.info ? state.info.name : 'Inspector'"/></h3>
                <button class="nv-icon-btn" t-on-click="props.onClose">
                    <i class="fa fa-times"/></button>
            </div>
            <div class="nv-side-body">
                <div t-if="!state.info" class="nv-skeleton">
                    <div class="nv-sk-bar" style="width:70%"/>
                    <div class="nv-sk-bar" style="width:55%"/>
                    <div class="nv-sk-block"/>
                </div>
                <t t-else="">
                    <!-- live numbers -->
                    <div t-if="stats.length" class="nv-side-sec nv-stagger" style="--i:0">
                        <div class="nv-side-label">Live numbers</div>
                        <div class="nv-statgrid">
                            <div t-foreach="stats" t-as="st" t-key="st.label"
                                 class="nv-stat" t-att-class="st.tone ? 'nv-stat-' + st.tone : ''">
                                <span class="nv-stat-val" t-esc="st.value"/>
                                <span class="nv-stat-label" t-esc="st.label"/>
                            </div>
                        </div>
                    </div>

                    <!-- data lineage -->
                    <div class="nv-side-sec nv-stagger" style="--i:1">
                        <div class="nv-side-label">Data lineage</div>
                        <button t-if="state.info.model_tech" class="nv-line nv-line-click"
                                title="Open the records behind this widget"
                                t-on-click="openRecords">
                            <i class="fa fa-database"/>
                            <span t-esc="state.info.model_label"/>
                            <code t-esc="state.info.model_tech"/>
                            <i class="fa fa-external-link nv-line-go"/>
                        </button>
                        <div class="nv-line"><i class="fa fa-calculator"/>
                            <span t-esc="state.info.agg"/>
                            <code t-if="state.info.measures.length"
                                  t-esc="state.info.measures.join(', ')"/>
                        </div>
                        <div t-if="state.info.group" class="nv-line">
                            <i class="fa fa-object-group"/>
                            <span>Grouped by <b t-esc="state.info.group"/>
                                <t t-if="state.info.group_gran"> · <t t-esc="state.info.group_gran"/></t>
                            </span>
                        </div>
                        <div t-if="state.info.subgroup" class="nv-line">
                            <i class="fa fa-clone"/>
                            <span>Split by <b t-esc="state.info.subgroup"/></span>
                        </div>
                        <div t-if="state.info.date_field" class="nv-line">
                            <i class="fa fa-calendar"/>
                            <span><b t-esc="state.info.date_field"/> · <t t-esc="state.info.scope"/></span>
                        </div>
                        <div t-if="state.info.domain" class="nv-line nv-line-code">
                            <i class="fa fa-filter"/>
                            <code t-esc="state.info.domain"/>
                        </div>
                    </div>

                    <!-- intelligence -->
                    <div class="nv-side-sec nv-stagger" style="--i:2">
                        <div class="nv-side-label">Intelligence</div>
                        <div class="nv-flagrow">
                            <span class="nv-flag" t-att-class="state.info.flags.forecast ? 'nv-on' : ''">
                                <i class="fa fa-line-chart"/> Forecast</span>
                            <span class="nv-flag" t-att-class="state.info.flags.anomalies ? 'nv-on' : ''">
                                <i class="fa fa-exclamation-triangle"/> Anomalies</span>
                            <span class="nv-flag" t-att-class="state.info.flags.compare ? 'nv-on' : ''">
                                <i class="fa fa-exchange"/> vs Prev</span>
                        </div>
                        <div t-if="payload and payload.insight" class="nv-side-insight">
                            <i class="fa fa-lightbulb-o"/>
                            <span t-esc="payload.insight"/>
                        </div>
                    </div>

                    <!-- actions -->
                    <div t-if="props.editable" class="nv-side-sec nv-stagger" style="--i:3">
                        <div class="nv-side-label">Actions</div>
                        <div class="nv-side-actions">
                            <button class="nv-btn" t-on-click="() => props.onEdit(props.itemId)">
                                <i class="fa fa-magic"/> Edit in Studio</button>
                            <button class="nv-btn" t-on-click="() => props.onReload(props.itemId, {})">
                                <i class="fa fa-refresh"/> Refresh</button>
                            <button t-if="state.info.has_action" class="nv-btn" t-on-click="openRecords">
                                <i class="fa fa-external-link"/> Open records</button>
                            <button t-if="props.onAsk" class="nv-btn nv-btn-ai"
                                    t-on-click="() => props.onAsk(props.itemId)">
                                <i class="fa fa-magic"/> Investigate with AI</button>
                        </div>
                    </div>
                </t>
            </div>
        </div>`;
    static props = ["itemId", "payload", "editable", "onClose", "onEdit",
        "onReload", "onAsk?"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.state = useState({ info: null });
        onWillStart(() => this.load());
    }

    async load() {
        this.state.info = await this.orm.call(
            "nova.dashboard.item", "web_inspect", [[this.props.itemId]]);
    }

    get payload() {
        return this.props.payload;
    }

    /** Client-side stats squeezed from whatever payload shape we have. */
    get stats() {
        const p = this.payload;
        if (!p || p.error) return [];
        const out = [];
        const push = (label, value, tone) =>
            value !== undefined && value !== null && value !== "" &&
            out.push({ label, value: String(value), tone });
        if (p.kpi) {
            push("Current", p.kpi.formatted);
            push("Previous", p.kpi.prev_formatted);
            if (p.kpi.delta !== null && p.kpi.delta !== undefined) {
                push("Δ vs prev", (p.kpi.delta > 0 ? "+" : "") + p.kpi.delta + "%",
                    p.kpi.delta >= 0 ? "good" : "bad");
            }
            push("Target", p.kpi.target_formatted);
            push("Forecast next", p.kpi.forecast_next);
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
                push("Points", nums.length);
                push("Total", this.compact(sum));
                push("Average", this.compact(sum / nums.length));
                push("Peak", this.compact(nums.reduce((a, b) => (b > a ? b : a), -Infinity)));
            }
            push("Series", p.chart.datasets.length);
        }
        if (p.board && p.board.entries) push("Entries", p.board.entries.length);
        if (p.funnel && p.funnel.stages) push("Stages", p.funnel.stages.length);
        if (p.list) push("Records", p.list.total);
        if (p.anomaly_count) push("Anomalies", p.anomaly_count, "warn");
        return out.slice(0, 8);
    }

    compact(v) {
        const a = Math.abs(v);
        if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
        if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
        if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
        return (Math.round(v * 100) / 100).toString();
    }

    async openRecords() {
        const act = await this.orm.call("nova.dashboard.item",
            "web_record_action", [[this.props.itemId]]);
        if (act) this.action.doAction(act);
    }
}

/* ===================================================================== *
 *  NovaBoardInfo — the whole board at a glance                          *
 * ===================================================================== */
export class NovaBoardInfo extends Component {
    static template = xml`
        <div class="nv-side">
            <div class="nv-drawer-head">
                <h3><i class="fa fa-info-circle"/> Board Info</h3>
                <button class="nv-icon-btn" t-on-click="props.onClose">
                    <i class="fa fa-times"/></button>
            </div>
            <div class="nv-side-body">
                <div class="nv-side-sec nv-stagger" style="--i:0">
                    <div class="nv-side-label">At a glance</div>
                    <div class="nv-statgrid">
                        <div class="nv-stat">
                            <span class="nv-stat-val" t-esc="props.config.items.length"/>
                            <span class="nv-stat-label">Widgets</span>
                        </div>
                        <div class="nv-stat">
                            <span class="nv-stat-val" t-esc="models.length"/>
                            <span class="nv-stat-label">Models</span>
                        </div>
                        <div class="nv-stat" t-att-class="anomalies ? 'nv-stat-warn' : ''">
                            <span class="nv-stat-val" t-esc="anomalies"/>
                            <span class="nv-stat-label">Anomalies</span>
                        </div>
                        <div class="nv-stat">
                            <span class="nv-stat-val" t-esc="props.lastRefresh or '—'"/>
                            <span class="nv-stat-label">Refreshed</span>
                        </div>
                    </div>
                </div>

                <div class="nv-side-sec nv-stagger" style="--i:1">
                    <div class="nv-side-label">Widget mix</div>
                    <div class="nv-mix">
                        <div t-foreach="mix" t-as="m" t-key="m.type" class="nv-mix-row">
                            <i t-att-class="'fa ' + m.icon"/>
                            <span class="nv-mix-name" t-esc="m.type"/>
                            <span class="nv-mix-bar">
                                <span t-att-style="'width:' + m.pct + '%'"/>
                            </span>
                            <span class="nv-mix-n" t-esc="m.n"/>
                        </div>
                    </div>
                </div>

                <div class="nv-side-sec nv-stagger" style="--i:2">
                    <div class="nv-side-label">Data sources · click to open</div>
                    <div class="nv-chips-wrap">
                        <button t-foreach="models" t-as="mo" t-key="mo"
                                class="nv-src-chip" t-on-click="() => this.openModel(mo)">
                            <i class="fa fa-database"/> <t t-esc="mo"/>
                        </button>
                        <div t-if="!models.length" class="nv-menu-note">No data widgets yet.</div>
                    </div>
                </div>

                <div class="nv-side-sec nv-stagger" style="--i:3">
                    <div class="nv-side-label">Setup</div>
                    <div class="nv-line"><i class="fa fa-paint-brush"/>
                        <span>Theme <b t-esc="props.config.theme"/></span>
                        <span class="nv-dot-mini" t-att-style="'background:' + props.config.accent"/>
                    </div>
                    <div class="nv-line"><i class="fa fa-calendar"/>
                        <span>Default period <b t-esc="props.config.date_preset"/></span></div>
                    <div class="nv-line"><i class="fa fa-refresh"/>
                        <span>Auto refresh <b t-esc="props.config.refresh ? props.config.refresh + 's' : 'off'"/></span></div>
                </div>

                <div class="nv-side-sec nv-stagger" style="--i:4">
                    <div class="nv-side-label">Quick actions</div>
                    <div class="nv-side-actions">
                        <button class="nv-btn" t-on-click="props.onExport">
                            <i class="fa fa-download"/> Export JSON</button>
                        <button t-if="props.config.editable" class="nv-btn" t-on-click="props.onSettings">
                            <i class="fa fa-cog"/> Settings</button>
                        <button class="nv-btn" t-on-click="props.onTv">
                            <i class="fa fa-television"/> TV mode</button>
                    </div>
                </div>
            </div>
        </div>`;
    static props = ["config", "payloads", "lastRefresh", "onClose", "onExport",
        "onSettings", "onTv"];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
    }

    get models() {
        const set = new Set();
        for (const it of this.props.config.items) {
            if (it.model) set.add(it.model);
        }
        return [...set];
    }

    get anomalies() {
        let n = 0;
        for (const id in this.props.payloads) {
            n += (this.props.payloads[id] &&
                this.props.payloads[id].anomaly_count) || 0;
        }
        return n;
    }

    get mix() {
        const ICONS = {
            kpi: "fa-bolt", tile: "fa-square", gauge: "fa-tachometer",
            bullet: "fa-arrows-h", bar: "fa-bar-chart", hbar: "fa-align-left",
            line: "fa-line-chart", area: "fa-area-chart", waterfall: "fa-signal",
            radar: "fa-bullseye", scatter: "fa-braille", pie: "fa-pie-chart",
            doughnut: "fa-circle-o-notch", polar: "fa-dot-circle-o",
            funnel: "fa-filter", heatmap: "fa-th", leaderboard: "fa-trophy",
            list: "fa-table", todo: "fa-check-square-o", text: "fa-file-text-o",
        };
        const counts = {};
        for (const it of this.props.config.items) {
            counts[it.type] = (counts[it.type] || 0) + 1;
        }
        const total = this.props.config.items.length || 1;
        return Object.keys(counts).sort((a, b) => counts[b] - counts[a])
            .map((t) => ({
                type: t, n: counts[t],
                pct: Math.round((counts[t] / total) * 100),
                icon: ICONS[t] || "fa-square",
            }));
    }

    openModel(model) {
        this.action.doAction({
            type: "ir.actions.act_window",
            name: model,
            res_model: model,
            views: [[false, "list"], [false, "form"]],
            target: "current",
        });
    }
}

/* ===================================================================== *
 *  NovaAdminPanel — manager control center                              *
 * ===================================================================== */
export class NovaAdminPanel extends Component {
    static template = xml`
        <div class="nv-side">
            <div class="nv-drawer-head">
                <h3><i class="fa fa-shield"/> Control Center</h3>
                <button class="nv-icon-btn" t-on-click="props.onClose">
                    <i class="fa fa-times"/></button>
            </div>
            <div class="nv-side-body">
                <div t-if="!state.meta" class="nv-skeleton">
                    <div class="nv-sk-bar" style="width:70%"/>
                    <div class="nv-sk-block"/>
                </div>
                <div t-elif="!state.meta.allowed" class="nv-menu-note">
                    Manager access required.
                </div>
                <t t-else="">
                    <div class="nv-side-sec nv-stagger" style="--i:0">
                        <div class="nv-side-label">Fleet</div>
                        <div class="nv-statgrid">
                            <div class="nv-stat">
                                <span class="nv-stat-val" t-esc="state.meta.totals.boards"/>
                                <span class="nv-stat-label">Dashboards</span>
                            </div>
                            <div class="nv-stat">
                                <span class="nv-stat-val" t-esc="state.meta.totals.widgets"/>
                                <span class="nv-stat-label">Widgets</span>
                            </div>
                            <div class="nv-stat" t-att-class="state.meta.ai.llm ? 'nv-stat-good' : ''">
                                <span class="nv-stat-val">
                                    <i t-att-class="'fa ' + (state.meta.ai.llm ? 'fa-magic' : 'fa-microchip')"/>
                                </span>
                                <span class="nv-stat-label"
                                      t-esc="state.meta.ai.llm ? ((state.meta.ai.provider === 'anthropic' ? 'Claude' : 'LLM') + ' linked') : 'Built-in AI'"/>
                            </div>
                        </div>
                    </div>

                    <div class="nv-side-sec nv-stagger" style="--i:1">
                        <div class="nv-side-label">NovaMind engine</div>
                        <div t-if="!state.ai" class="nv-skeleton">
                            <div class="nv-sk-bar" style="width:60%"/>
                        </div>
                        <t t-else="">
                            <div class="nv-prov-row">
                                <button t-foreach="providers" t-as="p" t-key="p.key"
                                        class="nv-prov"
                                        t-att-class="state.ai.provider === p.key ? 'nv-active' : ''"
                                        t-on-click="() => this.setProvider(p.key)">
                                    <i t-att-class="'fa ' + p.icon"/> <t t-esc="p.label"/>
                                </button>
                            </div>
                            <div t-if="state.ai.provider === 'builtin'" class="nv-menu-note">
                                <i class="fa fa-microchip"/>
                                Zero-config NLU — works offline. Link Claude or any
                                OpenAI-compatible LLM for free-form building power.
                            </div>
                            <t t-else="">
                                <div class="nv-field">
                                    <label>API key
                                        <span t-if="state.ai.has_key" class="nv-opt">
                                            saved <t t-esc="state.ai.key_hint"/></span>
                                    </label>
                                    <input type="password" class="nv-inp nv-mono"
                                           t-att-placeholder="state.ai.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'"
                                           t-att-value="state.aiKey"
                                           t-on-input="(ev) => state.aiKey = ev.target.value"/>
                                </div>
                                <div class="nv-field">
                                    <label>Model</label>
                                    <input class="nv-inp nv-mono"
                                           t-att-placeholder="state.ai.provider === 'anthropic' ? 'claude-3-5-haiku-latest' : 'gpt-4o-mini'"
                                           t-att-value="state.ai.model"
                                           t-on-input="(ev) => state.ai.model = ev.target.value"/>
                                </div>
                                <div class="nv-field">
                                    <label>Endpoint <span class="nv-opt">blank = official API</span></label>
                                    <input class="nv-inp nv-mono"
                                           t-att-placeholder="state.ai.provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions'"
                                           t-att-value="state.ai.endpoint"
                                           t-on-input="(ev) => state.ai.endpoint = ev.target.value"/>
                                </div>
                            </t>
                            <div class="nv-side-actions">
                                <button class="nv-btn nv-btn-primary"
                                        t-att-disabled="state.aiSaving"
                                        t-on-click="saveAI">
                                    <i t-att-class="'fa ' + (state.aiSaving ? 'fa-circle-o-notch fa-spin' : 'fa-check')"/>
                                    Save</button>
                                <button t-if="state.ai.provider !== 'builtin'" class="nv-btn"
                                        t-att-disabled="state.aiTesting"
                                        t-on-click="testAI">
                                    <i t-att-class="'fa ' + (state.aiTesting ? 'fa-circle-o-notch fa-spin' : 'fa-plug')"/>
                                    Test connection</button>
                                <button t-if="state.ai.has_key" class="nv-btn"
                                        t-on-click="removeKey">
                                    <i class="fa fa-eraser"/> Remove key</button>
                            </div>
                        </t>
                    </div>

                    <div class="nv-side-sec nv-stagger" style="--i:2">
                        <div class="nv-side-label">Dashboards · click to open</div>
                        <div class="nv-admin-list">
                            <div t-foreach="state.meta.boards" t-as="b" t-key="b.id"
                                 class="nv-admin-row"
                                 t-att-class="props.currentId === b.id ? 'nv-active' : ''">
                                <button class="nv-admin-open" t-on-click="() => props.onOpenBoard(b.id)">
                                    <span class="nv-dot-mini" t-att-style="'background:' + b.accent"/>
                                    <span class="nv-admin-name" t-esc="b.name"/>
                                    <span class="nv-count" t-esc="b.count"/>
                                </button>
                                <span t-if="b.webhook" class="nv-admin-hook"
                                      t-att-title="'Webhook ' + b.webhook_interval +
                                                   (b.webhook_last ? ' · last ' + b.webhook_last : '')">
                                    <i class="fa fa-share-alt"/>
                                </span>
                                <button class="nv-icon-btn nv-mini" title="Push digest now"
                                        t-if="b.webhook"
                                        t-on-click="() => this.pushNow(b.id)">
                                    <i class="fa fa-paper-plane"/>
                                </button>
                                <button class="nv-icon-btn nv-mini" title="Duplicate"
                                        t-on-click="() => this.duplicate(b.id)">
                                    <i class="fa fa-clone"/>
                                </button>
                                <button class="nv-icon-btn nv-mini" title="Settings"
                                        t-on-click="() => props.onEditBoard(b.id)">
                                    <i class="fa fa-cog"/>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="nv-side-sec nv-stagger" style="--i:3">
                        <div class="nv-side-label">Provisioning</div>
                        <div class="nv-side-actions">
                            <button class="nv-btn" t-on-click="props.onNewBoard">
                                <i class="fa fa-plus"/> New dashboard</button>
                            <button class="nv-btn" t-att-disabled="state.installing"
                                    t-on-click="installSamples">
                                <i t-att-class="'fa ' + (state.installing ? 'fa-circle-o-notch fa-spin' : 'fa-download')"/>
                                Install samples</button>
                            <button class="nv-btn" t-on-click="props.onImport">
                                <i class="fa fa-upload"/> Import JSON</button>
                        </div>
                    </div>
                </t>
            </div>
        </div>`;
    static props = ["currentId", "onClose", "onOpenBoard", "onEditBoard",
        "onNewBoard", "onImport", "onApplied"];

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.state = useState({ meta: null, installing: false,
            ai: null, aiKey: "", aiSaving: false, aiTesting: false });
        onWillStart(() => this.load());
    }

    get providers() {
        return [
            { key: "builtin", label: "Built-in", icon: "fa-microchip" },
            { key: "anthropic", label: "Claude", icon: "fa-magic" },
            { key: "openai", label: "OpenAI-compat", icon: "fa-plug" },
        ];
    }

    setProvider(key) {
        this.state.ai.provider = key;
    }

    async saveAI() {
        this.state.aiSaving = true;
        try {
            await this.orm.call("nova.dashboard", "web_save_ai_settings",
                [this.state.ai.provider], {
                    key: this.state.aiKey || false,
                    model: this.state.ai.model || "",
                    endpoint: this.state.ai.endpoint || "",
                });
            this.notification.add("NovaMind engine saved.", { type: "success" });
            this.state.aiKey = "";
            await this.loadAI();
            this.load();
        } catch (e) {
            this.notification.add(e.data?.message || e.message, { type: "danger" });
        }
        this.state.aiSaving = false;
    }

    async testAI() {
        this.state.aiTesting = true;
        try {
            const res = await this.orm.call("nova.dashboard", "web_ai_test", []);
            this.notification.add(res.message,
                { type: res.ok ? "success" : "danger" });
        } catch (e) {
            this.notification.add(e.data?.message || e.message, { type: "danger" });
        }
        this.state.aiTesting = false;
    }

    async removeKey() {
        await this.orm.call("nova.dashboard", "web_save_ai_settings",
            [this.state.ai.provider], { remove_key: true });
        this.notification.add("API key removed — back to the built-in brain.",
            { type: "warning" });
        this.loadAI();
        this.load();
    }

    async loadAI() {
        this.state.ai = await this.orm.call("nova.dashboard", "web_ai_settings", []);
    }

    async load() {
        this.state.meta = await this.orm.call("nova.dashboard", "web_admin_meta", []);
        if (this.state.meta.allowed && !this.state.ai) {
            this.loadAI();
        }
    }

    async duplicate(boardId) {
        try {
            const newId = await this.orm.call("nova.dashboard", "web_duplicate",
                [[boardId]]);
            this.notification.add("Dashboard duplicated.", { type: "success" });
            this.props.onApplied(newId);
            this.load();
        } catch (e) {
            this.notification.add(e.data?.message || e.message, { type: "danger" });
        }
    }

    async pushNow(boardId) {
        try {
            const res = await this.orm.call("nova.dashboard", "web_webhook_test",
                [[boardId]]);
            this.notification.add(res.message,
                { type: res.ok ? "success" : "danger" });
            this.load();
        } catch (e) {
            this.notification.add(e.data?.message || e.message, { type: "danger" });
        }
    }

    async installSamples() {
        this.state.installing = true;
        try {
            const ids = await this.orm.call("nova.dashboard", "web_install_samples", []);
            this.notification.add(
                ids.length ? `Installed ${ids.length} sample dashboard(s).`
                    : "Samples need the Sales or CRM app.",
                { type: ids.length ? "success" : "warning" });
            if (ids.length) this.props.onApplied(ids[0]);
            this.load();
        } catch (e) {
            this.notification.add(e.data?.message || e.message, { type: "danger" });
        }
        this.state.installing = false;
    }
}
