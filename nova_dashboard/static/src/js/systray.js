/** NovaBoard systray launcher — your dashboards one click away, in EVERY app. */
import { Component, useState, onWillStart, xml } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { user } from "@web/core/user";

export class NovaSystray extends Component {
    static template = xml`
        <div t-if="state.show" class="nv-sys">
            <button class="nv-sys-btn" title="NovaBoard — dashboards anywhere"
                    t-on-click="toggle">
                <i class="fa fa-bolt"/>
            </button>
            <div t-if="state.open" class="nv-sys-menu" t-on-click.stop="() => {}">
                <div class="nv-sys-head">
                    <span class="nv-sys-mark"><i class="fa fa-bolt"/></span>
                    NovaBoard
                </div>
                <button class="nv-sys-item nv-sys-hub" t-on-click="openHub">
                    <i class="fa fa-th-large"/> All dashboards
                    <span class="nv-sys-kbd">Hub</span>
                </button>
                <button class="nv-sys-item nv-sys-hub" t-on-click="openAI">
                    <i class="fa fa-magic"/> Build with AI
                    <span class="nv-sys-kbd">NovaMind</span>
                </button>
                <div class="nv-sys-sep"/>
                <div t-if="state.loading" class="nv-sys-note">Loading…</div>
                <t t-else="">
                    <button t-foreach="state.boards" t-as="b" t-key="b.id"
                            class="nv-sys-item" t-on-click="() => this.openBoard(b.id)">
                        <span class="nv-sys-dot" t-att-class="'nv-sys-' + b.theme"/>
                        <span class="nv-sys-name" t-esc="b.name"/>
                        <span class="nv-sys-count" t-esc="b.count"/>
                    </button>
                    <div t-if="!state.boards.length" class="nv-sys-note">
                        No dashboards yet — open the Hub to create one.
                    </div>
                </t>
            </div>
        </div>`;
    static props = {};

    setup() {
        this.orm = useService("orm");
        this.actionService = useService("action");
        this.state = useState({ show: false, open: false, loading: false,
            boards: [], loaded: false });
        this._close = () => (this.state.open = false);
        onWillStart(async () => {
            try {
                this.state.show = await user.hasGroup(
                    "nova_dashboard.group_nova_user");
            } catch (e) {
                this.state.show = false;
            }
        });
    }

    async toggle(ev) {
        ev.stopPropagation();
        const opening = !this.state.open;
        this.state.open = opening;
        if (opening) {
            setTimeout(() =>
                window.addEventListener("click", this._close, { once: true }));
            if (!this.state.loaded) {
                this.state.loading = true;
                try {
                    this.state.boards = await this.orm.call(
                        "nova.dashboard", "web_list", []);
                    this.state.loaded = true;
                } catch (e) {
                    this.state.boards = [];
                }
                this.state.loading = false;
            }
        }
    }

    openHub() {
        this.state.open = false;
        this.actionService.doAction({
            type: "ir.actions.client",
            tag: "nova_dashboard_action",
            name: "Dashboards",
        });
    }

    openAI() {
        this.state.open = false;
        this.actionService.doAction({
            type: "ir.actions.client",
            tag: "nova_dashboard_action",
            name: "NovaMind",
            params: { open_ai: 1 },
        });
    }

    openBoard(id) {
        this.state.open = false;
        this.actionService.doAction({
            type: "ir.actions.client",
            tag: "nova_dashboard_action",
            name: "Dashboard",
            params: { dashboard_id: id },
        });
    }
}

registry.category("systray").add(
    "nova_dashboard.launcher",
    { Component: NovaSystray },
    { sequence: 26 },
);
