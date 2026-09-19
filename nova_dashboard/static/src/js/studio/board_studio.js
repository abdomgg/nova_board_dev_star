/** NovaBoardStudio — create & configure dashboards without leaving the canvas. */
import { Component, useState, onWillStart, onMounted, onWillUnmount, xml } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

const ACCENTS = ["#7C6CFF", "#4CC2FF", "#22C7A9", "#34D399", "#FBBF24",
    "#FF8A4C", "#FB7185", "#F472B6", "#A78BFA", "#60A5FA"];

const READ_FIELDS = ["name", "description", "theme", "accent_color", "motion",
    "date_preset", "compare_previous", "refresh_interval", "create_menu",
    "menu_parent_id", "menu_first", "linked_board_ids",
    "webhook_url", "webhook_interval"];

const INTERVALS = [["off", "Off"], ["hour", "Every hour"],
    ["day", "Daily"], ["week", "Weekly"]];

export class NovaBoardStudio extends Component {
    static template = xml`
        <div class="nv-studio-mask" t-on-mousedown.self="tryClose">
            <div class="nv-studio nv-board-studio">
                <div class="nv-studio-side nv-board-side">
                    <div class="nv-studio-head">
                        <div class="nv-studio-title">
                            <i class="fa fa-th-large"/>
                            <span t-esc="props.boardId ? 'Board Settings' : 'New Dashboard'"/>
                        </div>
                        <button class="nv-icon-btn" title="Close" t-on-click="tryClose">
                            <i class="fa fa-times"/></button>
                    </div>

                    <div class="nv-studio-scroll">
                        <div class="nv-sec">
                            <div class="nv-field">
                                <label>Name</label>
                                <input class="nv-inp" placeholder="e.g. Revenue Cockpit" maxlength="60"
                                       t-att-value="state.cfg.name"
                                       t-on-input="(ev) => this.set('name', ev.target.value)"/>
                            </div>
                            <div class="nv-field">
                                <label>Subtitle <span class="nv-opt">optional</span></label>
                                <input class="nv-inp" placeholder="Shown under the title" maxlength="90"
                                       t-att-value="state.cfg.description"
                                       t-on-input="(ev) => this.set('description', ev.target.value)"/>
                            </div>
                        </div>

                        <div class="nv-sec">
                            <div class="nv-sec-label">Theme</div>
                            <div class="nv-themegrid">
                                <button t-foreach="state.meta.themes" t-as="th" t-key="th.key"
                                        class="nv-theme-card"
                                        t-att-class="state.cfg.theme === th.key ? 'nv-active' : ''"
                                        t-on-click="() => this.set('theme', th.key)">
                                    <span t-att-class="'nv-thumb nv-thumb-' + th.key">
                                        <span class="nv-thumb-bar"/>
                                        <span class="nv-thumb-blocks">
                                            <span/><span/><span/>
                                        </span>
                                    </span>
                                    <span class="nv-theme-name" t-esc="th.label"/>
                                </button>
                            </div>
                            <div class="nv-field">
                                <label>Accent</label>
                                <div class="nv-accent-row">
                                    <input type="color" class="nv-color"
                                           t-att-value="state.cfg.accent_color or '#7C6CFF'"
                                           t-on-input="(ev) => this.set('accent_color', ev.target.value)"/>
                                    <button t-foreach="accents" t-as="c" t-key="c"
                                            class="nv-dot" t-att-style="'background:' + c"
                                            t-att-class="state.cfg.accent_color === c ? 'nv-active' : ''"
                                            t-on-click="() => this.set('accent_color', c)"/>
                                </div>
                            </div>
                            <label class="nv-switch">
                                <input type="checkbox" t-att-checked="state.cfg.motion"
                                       t-on-change="(ev) => this.set('motion', ev.target.checked)"/>
                                <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                <span>Motion effects</span>
                            </label>
                        </div>

                        <div class="nv-sec">
                            <div class="nv-sec-label">Behaviour</div>
                            <div class="nv-field">
                                <label>Default period</label>
                                <select class="nv-inp" t-on-change="(ev) => this.set('date_preset', ev.target.value)">
                                    <option t-foreach="state.meta.presets" t-as="p" t-key="p.key"
                                            t-att-value="p.key"
                                            t-att-selected="state.cfg.date_preset === p.key"
                                            t-esc="p.label"/>
                                </select>
                            </div>
                            <div class="nv-field">
                                <label>Auto refresh</label>
                                <select class="nv-inp" t-on-change="(ev) => this.set('refresh_interval', ev.target.value)">
                                    <option t-foreach="state.meta.refresh" t-as="r" t-key="r.key"
                                            t-att-value="r.key"
                                            t-att-selected="state.cfg.refresh_interval === r.key"
                                            t-esc="r.label"/>
                                </select>
                            </div>
                            <label class="nv-switch">
                                <input type="checkbox" t-att-checked="state.cfg.compare_previous"
                                       t-on-change="(ev) => this.set('compare_previous', ev.target.checked)"/>
                                <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                <span>Compare to previous period</span>
                            </label>
                        </div>

                        <div class="nv-sec">
                            <div class="nv-sec-label">Menu placement — drop it anywhere</div>
                            <label class="nv-switch">
                                <input type="checkbox" t-att-checked="state.cfg.create_menu"
                                       t-on-change="(ev) => this.set('create_menu', ev.target.checked)"/>
                                <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                <span>Show this board as a menu item</span>
                            </label>
                            <div t-if="state.cfg.create_menu" class="nv-field">
                                <label>Inside which menu? <span class="nv-opt">Sales, Accounting, CRM…</span></label>
                                <div class="nv-auto-wrap">
                                    <input class="nv-inp" placeholder="Pick a parent menu — click to browse"
                                           t-att-value="state.menuQuery"
                                           t-on-input="onMenuInput"
                                           t-on-focus="onMenuInput"
                                           t-on-click="onMenuInput"/>
                                    <i class="fa fa-angle-down nv-auto-ico"/>
                                    <div t-if="state.menuOpen" class="nv-auto-menu">
                                        <div class="nv-auto-head">
                                            <i class="fa fa-sitemap"/> Odoo menu tree
                                        </div>
                                        <button t-foreach="state.menuOpts" t-as="m" t-key="m.id"
                                                t-att-class="state.cfg.menu_parent_id === m.id ? 'nv-active' : ''"
                                                t-on-click="() => this.pickMenu(m)">
                                            <span><i class="fa fa-bars"/> <t t-esc="m.name"/></span>
                                        </button>
                                        <div t-if="!state.menuOpts.length" class="nv-menu-note">
                                            No menu matches.</div>
                                    </div>
                                </div>
                                <div class="nv-menu-note">
                                    <i class="fa fa-info-circle"/>
                                    Leave empty to place it under the NovaBoard app.
                                </div>
                                <label class="nv-switch">
                                    <input type="checkbox" t-att-checked="state.cfg.menu_first"
                                           t-on-change="(ev) => this.set('menu_first', ev.target.checked)"/>
                                    <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                    <span>Open as the module's landing page (first entry)</span>
                                </label>
                            </div>
                        </div>

                        <div t-if="siblings.length" class="nv-sec">
                            <div class="nv-sec-label">Constellation — linked dashboards</div>
                            <div class="nv-checklist">
                                <label t-foreach="siblings" t-as="sb" t-key="sb.id" class="nv-check">
                                    <input type="checkbox"
                                           t-att-checked="state.cfg.link_ids.includes(sb.id)"
                                           t-on-change="() => this.toggleLink(sb.id)"/>
                                    <span class="nv-dot-mini" t-att-style="'background:' + sb.accent + ';margin-left:0'"/>
                                    <span t-esc="sb.name"/>
                                </label>
                            </div>
                            <div class="nv-menu-note">
                                <i class="fa fa-link"/>
                                Linked boards appear as quick-switch chips on top of this one.
                            </div>
                        </div>

                        <div class="nv-sec">
                            <div class="nv-sec-label">Automation — n8n bridge</div>
                            <div class="nv-field">
                                <label>Webhook URL <span class="nv-opt">POSTs KPIs, insights, anomalies</span></label>
                                <input class="nv-inp nv-mono" placeholder="https://n8n.example.com/webhook/…"
                                       t-att-value="state.cfg.webhook_url"
                                       t-on-input="(ev) => this.set('webhook_url', ev.target.value)"/>
                            </div>
                            <div class="nv-field-row">
                                <div class="nv-field">
                                    <label>Push frequency</label>
                                    <select class="nv-inp" t-on-change="(ev) => this.set('webhook_interval', ev.target.value)">
                                        <option t-foreach="intervals" t-as="iv" t-key="iv[0]"
                                                t-att-value="iv[0]"
                                                t-att-selected="state.cfg.webhook_interval === iv[0]"
                                                t-esc="iv[1]"/>
                                    </select>
                                </div>
                                <button t-if="props.boardId" class="nv-btn nv-mini-btn nv-switch-pad"
                                        t-att-disabled="!state.cfg.webhook_url or state.testing"
                                        t-on-click="testWebhook">
                                    <i t-att-class="'fa ' + (state.testing ? 'fa-circle-o-notch fa-spin' : 'fa-paper-plane')"/>
                                    Send test
                                </button>
                            </div>
                        </div>

                        <div t-if="props.boardId" class="nv-sec nv-sec-danger">
                            <button class="nv-btn nv-btn-danger" t-on-click="removeBoard">
                                <i class="fa fa-trash"/> Delete this dashboard
                            </button>
                        </div>
                    </div>

                    <div class="nv-studio-foot">
                        <span class="nv-flex-1"/>
                        <button class="nv-btn" t-on-click="tryClose">Cancel</button>
                        <button class="nv-btn nv-btn-primary"
                                t-att-disabled="!state.cfg.name or state.saving"
                                t-on-click="save">
                            <i t-att-class="'fa ' + (state.saving ? 'fa-circle-o-notch fa-spin' : 'fa-check')"/>
                            <t t-esc="props.boardId ? 'Save' : 'Create dashboard'"/>
                        </button>
                    </div>
                </div>

                <div t-if="state.confirm" class="nv-confirm-mask"
                     t-on-mousedown.self="() => state.confirm = false">
                    <div class="nv-confirm">
                        <div class="nv-confirm-icon"><i class="fa fa-exclamation-triangle"/></div>
                        <h4 t-esc="confirmTitle"/>
                        <p t-esc="confirmBody"/>
                        <div class="nv-confirm-actions">
                            <button class="nv-btn" t-on-click="() => state.confirm = false">
                                Cancel</button>
                            <button class="nv-btn nv-btn-danger" t-on-click="doConfirm">
                                <i class="fa fa-trash"/> <t t-esc="confirmLabel"/></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    static props = ["boardId", "onClose", "onSaved"];

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.state = useState({
            cfg: {
                name: "", description: "", theme: "aurora",
                accent_color: "#7C6CFF", motion: true,
                date_preset: "this_year", compare_previous: true,
                refresh_interval: "0", create_menu: false,
                menu_parent_id: false, menu_first: true, link_ids: [],
                webhook_url: "", webhook_interval: "off",
            },
            meta: { themes: [], presets: [], refresh: [], can_manage: true },
            menuQuery: "", menuOpts: [], menuOpen: false,
            saving: false, dirty: false, testing: false, confirm: false,
        });
        this._menuTimer = null;
        this._closeMenuList = () => (this.state.menuOpen = false);
        this._esc = (ev) => {
            if (ev.key !== "Escape") return;
            if (this.state.confirm) this.state.confirm = false;
            else this.tryClose();
        };

        onWillStart(async () => {
            this.state.meta = await this.orm.call("nova.dashboard", "web_board_meta", []);
            if (this.props.boardId) {
                const [r] = await this.orm.read("nova.dashboard", [this.props.boardId],
                    READ_FIELDS);
                Object.assign(this.state.cfg, {
                    name: r.name || "",
                    description: r.description || "",
                    theme: r.theme || "aurora",
                    accent_color: r.accent_color || "#7C6CFF",
                    motion: !!r.motion,
                    date_preset: r.date_preset || "this_year",
                    compare_previous: !!r.compare_previous,
                    refresh_interval: r.refresh_interval || "0",
                    create_menu: !!r.create_menu,
                    menu_parent_id: r.menu_parent_id ? r.menu_parent_id[0] : false,
                    menu_first: r.menu_first === undefined ? true : !!r.menu_first,
                    link_ids: r.linked_board_ids || [],
                    webhook_url: r.webhook_url || "",
                    webhook_interval: r.webhook_interval || "off",
                });
                this.state.menuQuery = r.menu_parent_id ? r.menu_parent_id[1] : "";
            }
        });
        onMounted(() => {
            window.addEventListener("keydown", this._esc);
            window.addEventListener("click", this._closeMenuList);
        });
        onWillUnmount(() => {
            window.removeEventListener("keydown", this._esc);
            window.removeEventListener("click", this._closeMenuList);
            if (this._menuTimer) clearTimeout(this._menuTimer);
        });
    }

    get accents() { return ACCENTS; }
    get intervals() { return INTERVALS; }

    get siblings() {
        return (this.state.meta.boards || []).filter(
            (b) => b.id !== this.props.boardId);
    }

    toggleLink(id) {
        const arr = this.state.cfg.link_ids;
        const i = arr.indexOf(id);
        if (i >= 0) arr.splice(i, 1);
        else arr.push(id);
        this.state.dirty = true;
    }

    onMenuInput(ev) {
        ev.stopPropagation();
        if (ev.type === "input") {
            this.state.menuQuery = ev.target.value;
            this.state.cfg.menu_parent_id = false;
        }
        this.state.menuOpen = true;
        if (this._menuTimer) clearTimeout(this._menuTimer);
        this._menuTimer = setTimeout(async () => {
            this.state.menuOpts = await this.orm.call(
                "nova.dashboard", "web_search_menus", [this.state.menuQuery]);
        }, 200);
    }

    pickMenu(m) {
        this.state.cfg.menu_parent_id = m.id;
        this.state.menuQuery = m.name;
        this.state.menuOpen = false;
        this.state.dirty = true;
    }

    async testWebhook() {
        this.state.testing = true;
        try {
            await this.orm.write("nova.dashboard", [this.props.boardId], {
                webhook_url: this.state.cfg.webhook_url,
                webhook_interval: this.state.cfg.webhook_interval,
            });
            const res = await this.orm.call("nova.dashboard", "web_webhook_test",
                [[this.props.boardId]]);
            this.notification.add(res.message,
                { type: res.ok ? "success" : "danger" });
        } catch (e) {
            this.notification.add(e.data?.message || e.message || "Test failed.",
                { type: "danger" });
        }
        this.state.testing = false;
    }

    set(key, value) {
        this.state.cfg[key] = value;
        this.state.dirty = true;
    }

    async save() {
        if (!this.state.cfg.name || this.state.saving) return;
        this.state.saving = true;
        try {
            let id = this.props.boardId;
            const { link_ids, ...rest } = this.state.cfg;
            const vals = { ...rest, linked_board_ids: [[6, 0, link_ids]] };
            if (id) {
                await this.orm.write("nova.dashboard", [id], vals);
            } else {
                [id] = await this.orm.create("nova.dashboard", [vals]);
            }
            this.notification.add(
                this.props.boardId ? "Dashboard updated." : "Dashboard created.",
                { type: "success" });
            this.props.onSaved(id);
        } catch (e) {
            this.notification.add(
                e.data?.message || e.message || "Could not save the dashboard.",
                { type: "danger" });
            this.state.saving = false;
        }
    }

    removeBoard() {
        this.state.confirm = "delete";
    }

    tryClose() {
        if (!this.state.dirty) {
            this.props.onClose();
            return;
        }
        this.state.confirm = "discard";
    }

    get confirmTitle() {
        return this.state.confirm === "delete" ? "Delete dashboard" : "Discard changes?";
    }
    get confirmBody() {
        return this.state.confirm === "delete"
            ? `Delete "${this.state.cfg.name}" and all of its widgets? This cannot be undone.`
            : "Your dashboard settings will be lost.";
    }
    get confirmLabel() {
        return this.state.confirm === "delete" ? "Delete" : "Discard";
    }

    async doConfirm() {
        if (this.state.confirm === "delete") {
            try {
                await this.orm.unlink("nova.dashboard", [this.props.boardId]);
                this.notification.add("Dashboard deleted.", { type: "warning" });
                this.props.onSaved(null);
            } catch (e) {
                this.notification.add(e.data?.message || e.message || "Delete failed.",
                    { type: "danger" });
                this.state.confirm = false;
            }
        } else {
            this.props.onClose();
        }
    }
}
