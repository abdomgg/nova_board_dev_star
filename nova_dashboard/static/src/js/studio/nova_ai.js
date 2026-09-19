/** NovaMind panel — conversational dashboard building & data Q&A. */
import {
    Component, useState, useRef, onWillStart, onMounted, onWillUnmount, xml,
} from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

const CHIPS = [
    { icon: "fa-line-chart", text: "Build a sales dashboard" },
    { icon: "fa-filter", text: "Build a CRM dashboard" },
    { icon: "fa-area-chart", text: "Add a line chart of revenue by month with forecast" },
    { icon: "fa-trophy", text: "Top 10 customers by revenue this year" },
    { icon: "fa-question-circle", text: "How many orders this month?" },
    { icon: "fa-paint-brush", text: "Switch theme to daylight" },
    { icon: "fa-download", text: "Install sample dashboards" },
];

export class NovaAIPanel extends Component {
    static template = xml`
        <div class="nv-drawer-mask" t-on-click="props.onClose">
            <div class="nv-drawer nv-ai-drawer" t-on-click.stop="() => {}">
                <div class="nv-drawer-head">
                    <h3><span class="nv-ai-mark"><i class="fa fa-magic"/></span> NovaMind</h3>
                    <button t-if="state.engine" class="nv-ai-engpill"
                            t-att-class="engineReady ? 'nv-eng-on' : ''"
                            t-att-title="engineReady ? 'Active engine — click to manage' : 'Click to configure the engine in Control Center'"
                            t-on-click="openEngine">
                        <i t-att-class="'fa ' + (engineReady ? 'fa-magic' : 'fa-microchip')"/>
                        <t t-esc="engineLabel"/>
                    </button>
                    <button class="nv-icon-btn" t-on-click="props.onClose">
                        <i class="fa fa-times"/></button>
                </div>

                <div class="nv-ai-body" t-ref="scroll">
                    <div t-foreach="state.msgs" t-as="m" t-key="m_index"
                         class="nv-msg" t-att-class="'nv-msg-' + m.role">
                        <div class="nv-msg-bubble">
                            <div t-foreach="lines(m.text)" t-as="ln" t-key="ln_index"
                                 class="nv-msg-line" t-esc="ln"/>
                            <div t-if="m.actions and m.actions.length" class="nv-msg-acts">
                                <span t-foreach="m.actions" t-as="a" t-key="a_index"
                                      class="nv-msg-act">
                                    <i class="fa fa-check-circle"/> <t t-esc="a"/>
                                </span>
                            </div>
                            <span t-if="m.engine" class="nv-msg-engine">
                                <i t-att-class="'fa ' + (m.engine === 'llm' ? 'fa-plug' : 'fa-microchip')"/>
                                <t t-esc="m.engine === 'llm' ? 'LLM engine' : 'built-in brain'"/>
                            </span>
                            <table t-if="m.table" class="nv-ai-table">
                                <thead><tr>
                                    <th t-foreach="m.table.headers" t-as="h"
                                        t-key="h_index" t-esc="h"/>
                                </tr></thead>
                                <tbody>
                                    <tr t-foreach="m.table.rows" t-as="r" t-key="r_index">
                                        <td t-foreach="r" t-as="c" t-key="c_index"
                                            t-esc="c"/>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div t-if="state.busy" class="nv-msg nv-msg-ai">
                        <div class="nv-msg-bubble nv-ai-typing">
                            <span/><span/><span/>
                        </div>
                    </div>

                    <div t-if="showChips" class="nv-ai-chips">
                        <button t-foreach="chips" t-as="c" t-key="c.text"
                                t-on-click="() => this.send(c.text)">
                            <i t-att-class="'fa ' + c.icon"/> <t t-esc="c.text"/>
                        </button>
                    </div>
                </div>

                <div class="nv-ai-foot">
                    <textarea class="nv-inp nv-ai-input" rows="1"
                              placeholder="Ask NovaMind to build, change or explain anything…"
                              t-att-value="state.input"
                              t-on-input="(ev) => state.input = ev.target.value"
                              t-on-keydown="onKey"/>
                    <button class="nv-btn nv-btn-primary nv-ai-send"
                            t-att-disabled="state.busy or !state.input.trim()"
                            t-on-click="() => this.send()">
                        <i class="fa fa-paper-plane"/>
                    </button>
                </div>
            </div>
        </div>`;
    static props = ["dashboardId", "accent", "onApplied", "onClose", "initialPrompt?", "onOpenEngine?"];

    setup() {
        this.orm = useService("orm");
        this.scrollRef = useRef("scroll");
        this.state = useState({
            msgs: [{
                role: "ai",
                text: "Hey — I'm NovaMind. I can compose entire dashboards, " +
                    "add or restyle widgets, and answer questions straight " +
                    "from your data. What shall we build?",
                actions: [], table: null,
            }],
            input: "",
            busy: false,
            engine: null,
        });
        this._esc = (ev) => { if (ev.key === "Escape") this.props.onClose(); };
        onWillStart(async () => {
            try {
                this.state.engine = await this.orm.call(
                    "nova.dashboard", "web_ai_engine", []);
            } catch (e) {
                this.state.engine = null;
            }
        });
        onMounted(() => {
            window.addEventListener("keydown", this._esc);
            if (this.props.initialPrompt) {
                this.send(this.props.initialPrompt);
            }
        });
        onWillUnmount(() => window.removeEventListener("keydown", this._esc));
    }

    get chips() { return CHIPS; }

    get engineReady() {
        const e = this.state.engine;
        return !!(e && (e.provider === "builtin" || e.ready));
    }

    get engineLabel() {
        const e = this.state.engine;
        if (!e) return "";
        if (e.provider === "builtin") return "Built-in brain";
        const name = e.provider === "anthropic" ? "Claude" : "LLM";
        return e.ready ? name + " · " + (e.model || "").slice(0, 24)
            : name + " — key missing";
    }

    openEngine() {
        if (this.props.onOpenEngine) this.props.onOpenEngine();
    }
    get showChips() { return this.state.msgs.length === 1 && !this.state.busy; }

    lines(text) {
        return String(text || "").replace(/\*\*/g, "").split("\n").filter(Boolean);
    }

    scrollSoon() {
        requestAnimationFrame(() => {
            const el = this.scrollRef.el;
            if (el) el.scrollTop = el.scrollHeight;
        });
    }

    onKey(ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
            ev.preventDefault();
            this.send();
        }
    }

    async send(forced) {
        const q = (forced ?? this.state.input).trim();
        if (!q || this.state.busy) return;
        this.state.msgs.push({ role: "user", text: q, actions: [], table: null });
        this.state.input = "";
        this.state.busy = true;
        this.scrollSoon();
        const history = this.state.msgs.slice(0, -1).slice(-6).map((m) => ({
            role: m.role === "ai" ? "assistant" : "user",
            content: m.text,
        }));
        try {
            const res = await this.orm.call("nova.dashboard", "web_ai",
                [this.props.dashboardId || false, q], { history });
            this.state.msgs.push({
                role: "ai",
                text: res.reply || "Done.",
                actions: res.actions || [],
                table: res.table || null,
                engine: res.engine || "",
            });
            if (res.reload) {
                this.props.onApplied(res);
            }
        } catch (e) {
            this.state.msgs.push({
                role: "ai",
                text: e.data?.message || e.message || "Something went sideways — try again?",
                actions: [], table: null,
            });
        }
        this.state.busy = false;
        this.scrollSoon();
    }
}
