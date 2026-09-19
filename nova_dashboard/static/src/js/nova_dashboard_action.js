/** NovaBoard root client action. */
import {
    Component, useState, useRef, onWillStart, onMounted, onWillUnmount, xml,
} from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { NovaGrid } from "./grid_engine";
import { NovaItem } from "./nova_item";
import { NovaStudio } from "./studio/nova_studio";
import { NovaBoardStudio } from "./studio/board_studio";
import { NovaAIPanel } from "./studio/nova_ai";
import { NovaInspector, NovaBoardInfo, NovaAdminPanel } from "./studio/sidebars";
import { NovaPalette } from "./studio/command_palette";
import { NovaFocus } from "./studio/focus_view";
import { NovaHub } from "./studio/hub";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { downloadText } from "./nova_utils";

export class NovaDashboardAction extends Component {
    static template = xml`
        <div class="nv-root" t-att-class="rootClass" t-att-style="rootStyle">
            <div t-if="state.motion" class="nv-bg">
                <div class="nv-blob nv-blob-1"/>
                <div class="nv-blob nv-blob-2"/>
                <div class="nv-blob nv-blob-3"/>
            </div>

            <!-- ======================= HUB ======================= -->
            <NovaHub t-if="state.view === 'hub'"
                     hub="state.hub"
                     busy="state.hubBusy"
                     onOpen.bind="openBoard"
                     onNew.bind="newBoard"
                     onEdit.bind="editBoardFromPanel"
                     onDuplicate.bind="hubDuplicate"
                     onDelete.bind="hubDelete"
                     onAI.bind="openAI"/>

            <t t-if="state.view === 'board'">
            <!-- ======================= TOP BAR ======================= -->
            <div class="nv-topbar">
                <div class="nv-brand">
                    <div class="nv-brand-mark nv-clickable" title="Search everything (Ctrl+K)"
                         t-on-click="openPaletteClick"><i class="fa fa-bolt"/></div>
                    <div class="nv-brand-text">
                        <div class="nv-board-switch" t-on-click="toggleBoards">
                            <h1 t-esc="state.config ? state.config.name : 'NovaBoard'"/>
                            <i class="fa fa-angle-down"/>
                        </div>
                        <span t-if="state.config and state.config.description"
                              class="nv-board-desc" t-esc="state.config.description"/>
                    </div>
                    <div t-if="state.boardsOpen" class="nv-menu nv-board-menu" t-on-click.stop="() => {}">
                        <button class="nv-menu-home" t-on-click="goHome">
                            <i class="fa fa-home"/> All dashboards
                        </button>
                        <button t-foreach="state.boards" t-as="b" t-key="b.id"
                                t-att-class="state.config and b.id === state.config.id ? 'nv-active' : ''"
                                t-on-click="() => this.openBoard(b.id)">
                            <i class="fa fa-th-large"/> <t t-esc="b.name"/>
                            <span class="nv-count" t-esc="b.count"/>
                        </button>
                        <div t-if="!state.boards.length" class="nv-menu-note">No dashboards yet</div>
                        <button class="nv-menu-new" t-on-click="newBoard">
                            <i class="fa fa-plus"/> New dashboard
                        </button>
                    </div>
                </div>

                <div class="nv-toolbar">
                    <!-- date preset -->
                    <div class="nv-menu-wrap">
                        <button class="nv-btn" t-on-click="toggleDates">
                            <i class="fa fa-calendar"/>
                            <span t-esc="presetLabel"/>
                            <i class="fa fa-angle-down ms-1"/>
                        </button>
                        <div t-if="state.datesOpen" class="nv-menu nv-date-menu" t-on-click.stop="() => {}">
                            <button t-foreach="presets" t-as="p" t-key="p.key"
                                    t-att-class="state.preset === p.key ? 'nv-active' : ''"
                                    t-on-click="() => this.setPreset(p.key)">
                                <t t-esc="p.label"/>
                            </button>
                        </div>
                    </div>
                    <div t-if="state.preset === 'custom'" class="nv-custom-range">
                        <input type="date" t-model="state.dateFrom" t-on-change="onCustomDate"/>
                        <span>→</span>
                        <input type="date" t-model="state.dateTo" t-on-change="onCustomDate"/>
                    </div>

                    <!-- compare toggle -->
                    <button class="nv-btn" t-att-class="state.compare ? 'nv-btn-on' : ''"
                            title="Compare with previous period" t-on-click="toggleCompare">
                        <i class="fa fa-exchange"/><span class="nv-btn-label">vs prev</span>
                    </button>

                    <!-- insights -->
                    <button class="nv-btn nv-btn-accent" t-on-click="openInsights"
                            title="AI insight digest">
                        <i class="fa fa-lightbulb-o"/><span class="nv-btn-label">Insights</span>
                    </button>

                    <span t-if="pulseCount" class="nv-pulse-chip"
                          t-att-title="pulseCount + ' active alerts / anomalies — open the digest'"
                          t-on-click="openInsights">
                        <i class="fa fa-bell"/> <t t-esc="pulseCount"/>
                    </span>

                    <!-- NovaMind copilot -->
                    <button class="nv-btn nv-btn-ai" t-on-click="openAI"
                            title="NovaMind — AI copilot: build, edit, ask">
                        <i class="fa fa-magic"/><span class="nv-btn-label">NovaMind</span>
                    </button>

                    <!-- theme -->
                    <div class="nv-menu-wrap">
                        <button class="nv-icon-btn" title="Theme" t-on-click="toggleThemes">
                            <i class="fa fa-paint-brush"/>
                        </button>
                        <div t-if="state.themesOpen" class="nv-menu" t-on-click.stop="() => {}">
                            <button t-foreach="themes" t-as="th" t-key="th.key"
                                    t-att-class="state.theme === th.key ? 'nv-active' : ''"
                                    t-on-click="() => this.setTheme(th.key)">
                                <span class="nv-swatch" t-att-class="'nv-swatch-' + th.key"/>
                                <t t-esc="th.label"/>
                            </button>
                            <button t-on-click="toggleMotion">
                                <i t-att-class="'fa ' + (state.motion ? 'fa-toggle-on' : 'fa-toggle-off')"/>
                                Motion effects
                            </button>
                        </div>
                    </div>

                    <button class="nv-icon-btn" title="Refresh all" t-on-click="refreshAll">
                        <i class="fa fa-refresh" t-att-class="state.loadingAll ? 'fa-spin' : ''"/>
                    </button>
                    <button class="nv-icon-btn" title="TV mode (fullscreen)" t-on-click="tvMode">
                        <i class="fa fa-television"/>
                    </button>

                    <t t-if="state.config and state.config.editable">
                        <span class="nv-sep"/>
                        <button class="nv-btn" t-att-class="state.editMode ? 'nv-btn-on' : ''"
                                t-on-click="toggleEdit">
                            <i class="fa fa-arrows"/><span class="nv-btn-label">Arrange</span>
                        </button>
                        <button class="nv-btn nv-btn-primary" t-on-click="addWidget">
                            <i class="fa fa-plus"/><span class="nv-btn-label">Widget</span>
                        </button>
                        <div class="nv-menu-wrap">
                            <button class="nv-icon-btn" title="More" t-on-click="toggleMore">
                                <i class="fa fa-ellipsis-v"/>
                            </button>
                            <div t-if="state.moreOpen" class="nv-menu" t-on-click.stop="() => {}">
                                <button t-on-click="duplicateBoard"><i class="fa fa-clone"/> Duplicate board</button>
                                <button t-on-click="exportBoard"><i class="fa fa-download"/> Export board (JSON)</button>
                                <button t-on-click="importBoard"><i class="fa fa-upload"/> Import board</button>
                                <button t-on-click="editBoard"><i class="fa fa-cog"/> Board settings</button>
                            </div>
                        </div>
                    </t>
                </div>
            </div>

            <!-- ======================= INSIGHTS DRAWER ======================= -->
            <div t-if="state.panel === 'insights'" class="nv-drawer-mask" t-on-click="closePanel">
                <div class="nv-drawer" t-on-click.stop="() => {}">
                    <div class="nv-drawer-head">
                        <h3><i class="fa fa-lightbulb-o"/> Insight Digest</h3>
                        <button class="nv-btn nv-mini-btn nv-btn-ai" t-on-click="novaBrief"
                                title="NovaMind reads the whole board and briefs you">
                            <i class="fa fa-magic"/> Nova Brief</button>
                        <button class="nv-icon-btn" t-on-click="closePanel">
                            <i class="fa fa-times"/></button>
                    </div>
                    <div class="nv-drawer-body">
                        <div t-if="state.insightsLoading" class="nv-skeleton">
                            <div class="nv-sk-bar" style="width:80%"/>
                            <div class="nv-sk-bar" style="width:65%"/>
                            <div class="nv-sk-bar" style="width:72%"/>
                        </div>
                        <t t-else="">
                            <div t-foreach="state.insights" t-as="ins" t-key="ins_index"
                                 class="nv-insight-row nv-insight-click"
                                 t-att-class="(ins.anomalies ? 'nv-insight-warn ' : '') + (state.motion ? 'nv-stagger' : '')"
                                 t-att-style="'--i:' + ins_index"
                                 title="Inspect this widget"
                                 t-on-click="() => this.openInspector(ins.id)">
                                <i t-att-class="'fa ' + (ins.anomalies ? 'fa-exclamation-triangle' : 'fa-line-chart')"/>
                                <div>
                                    <div class="nv-insight-src" t-esc="ins.item"/>
                                    <div class="nv-insight-text" t-esc="ins.text"/>
                                </div>
                            </div>
                            <div t-if="!state.insights.length" class="nv-empty">
                                Nothing remarkable in this period — all metrics look steady.
                            </div>
                        </t>
                    </div>
                </div>
            </div>

            <!-- =================== CONSTELLATION =================== -->
            <div t-if="state.config and state.config.links and state.config.links.length"
                 class="nv-links">
                <span class="nv-links-label"><i class="fa fa-link"/> Linked</span>
                <button t-foreach="state.config.links" t-as="lk" t-key="lk.id"
                        class="nv-link-chip" t-att-style="'--bc:' + lk.accent"
                        t-att-title="lk.count + ' widgets — switches with your current period'"
                        t-on-click="() => this.hopBoard(lk.id)">
                    <span class="nv-link-dot" t-att-style="'background:' + lk.accent"/>
                    <t t-esc="lk.name"/>
                </button>
            </div>

            <!-- ======================= BODY ======================= -->
            <div class="nv-body" t-att-class="state.loadingAll ? 'nv-refreshing' : ''">
                <div t-if="state.loadError" class="nv-error nv-error-page">
                    <i class="fa fa-exclamation-circle"/> <t t-esc="state.loadError"/>
                </div>
                <div t-elif="!state.config and !state.boards.length" class="nv-hero">
                    <div class="nv-hero-icon"><i class="fa fa-bolt"/></div>
                    <h2>Welcome to NovaBoard</h2>
                    <p>Spin up your first dashboard, then compose it widget by widget — live.</p>
                    <div class="nv-hero-actions">
                        <button class="nv-btn nv-btn-primary" t-on-click="newBoard">
                            <i class="fa fa-plus"/> Create dashboard</button>
                        <button class="nv-btn nv-btn-ai" t-on-click="openAI">
                            <i class="fa fa-magic"/> Ask NovaMind to build it</button>
                    </div>
                </div>
                <div t-elif="state.config and !state.config.items.length" class="nv-hero">
                    <div class="nv-hero-icon"><i class="fa fa-rocket"/></div>
                    <h2>This board is empty</h2>
                    <p>Open the Studio and watch your first widget render live as you build it.</p>
                    <div t-if="state.config.editable" class="nv-hero-actions">
                        <button class="nv-btn nv-btn-primary" t-on-click="addWidget">
                            <i class="fa fa-magic"/> Open Widget Studio</button>
                        <button class="nv-btn nv-btn-ai" t-on-click="openAI">
                            <i class="fa fa-bolt"/> Let NovaMind compose it</button>
                    </div>
                </div>
                <t t-elif="state.config" t-foreach="[state.config.id]" t-as="bid" t-key="bid">
                <NovaGrid items="state.config.items"
                          layout="state.layout"
                          editMode="state.editMode"
                          motion="state.motion"
                          onLayoutChange.bind="onLayoutChange">
                    <t t-set-slot="cell" t-slot-scope="scope">
                        <NovaItem meta="scope.item"
                                  payload="state.payloads[scope.item.id]"
                                  motion="state.motion"
                                  editable="state.config.editable"
                                  onReload.bind="reloadItem"
                                  onRemoved.bind="onItemRemoved"
                                  onEdit.bind="openStudio"
                                  onInspect.bind="openInspector"
                                  onFocus.bind="openFocus"
                                  onAsk.bind="askAbout"/>
                    </t>
                </NovaGrid>
                </t>
            </div>
            </t>
            <input type="file" class="d-none" t-ref="file" accept=".json"
                   t-on-change="onImportFile"/>

            <NovaPalette t-if="state.palette"
                         boards="state.boards"
                         config="state.config"
                         manager="!!(state.config and state.config.editable) or !!(state.hub and state.hub.can_manage) or !state.boards.length"
                         onClose.bind="closePalette"
                         onRun.bind="runPalette"/>

            <NovaFocus t-if="state.focus and state.config"
                       items="state.config.items"
                       payloads="state.payloads"
                       startId="state.focus.itemId"
                       editable="state.config.editable"
                       onClose.bind="closeFocus"
                       onInspect.bind="inspectFromFocus"
                       onEdit.bind="editFromFocus"
                       onReload.bind="reloadItem"
                       onAsk.bind="askAbout"/>

            <!-- ======================= RIGHT RAIL ======================= -->
            <div t-if="state.view === 'board' and state.config" class="nv-rail">
                <button class="nv-rail-btn" title="All dashboards (Hub)" t-on-click="goHome">
                    <i class="fa fa-home"/>
                </button>
                <span class="nv-rail-sep"/>
                <button class="nv-rail-btn" t-att-class="state.panel === 'info' ? 'nv-active' : ''"
                        title="Board info" t-on-click="() => this.togglePanel('info')">
                    <i class="fa fa-info"/>
                </button>
                <button class="nv-rail-btn" t-att-class="state.panel === 'insights' ? 'nv-active' : ''"
                        title="Insight digest" t-on-click="openInsights">
                    <i class="fa fa-lightbulb-o"/>
                </button>
                <button class="nv-rail-btn nv-rail-ai" t-att-class="state.panel === 'ai' ? 'nv-active' : ''"
                        title="NovaMind copilot" t-on-click="() => this.togglePanel('ai')">
                    <i class="fa fa-magic"/>
                </button>
                <span class="nv-rail-sep"/>
                <button t-if="state.config.editable" class="nv-rail-btn"
                        t-att-class="state.panel === 'admin' ? 'nv-active' : ''"
                        title="Control center" t-on-click="() => this.togglePanel('admin')">
                    <i class="fa fa-shield"/>
                </button>
                <button class="nv-rail-btn" title="TV mode" t-on-click="tvMode">
                    <i class="fa fa-television"/>
                </button>
            </div>

            <!-- ======================= SIDEBARS ======================= -->
            <div t-if="state.inspect" class="nv-drawer-mask" t-on-click="closeInspector">
                <div class="nv-drawer nv-side-drawer" t-on-click.stop="() => {}">
                    <NovaInspector itemId="state.inspect"
                                   payload="state.payloads[state.inspect]"
                                   editable="state.config and state.config.editable"
                                   onClose.bind="closeInspector"
                                   onEdit.bind="editFromInspector"
                                   onReload.bind="reloadItem"
                                   onAsk.bind="askAbout"/>
                </div>
            </div>

            <div t-if="state.panel === 'info' and state.config" class="nv-drawer-mask"
                 t-on-click="closePanel">
                <div class="nv-drawer nv-side-drawer" t-on-click.stop="() => {}">
                    <NovaBoardInfo config="state.config"
                                   payloads="state.payloads"
                                   lastRefresh="state.lastRefresh"
                                   onClose.bind="closePanel"
                                   onExport.bind="exportBoard"
                                   onSettings.bind="settingsFromPanel"
                                   onTv.bind="tvMode"/>
                </div>
            </div>

            <div t-if="state.panel === 'admin'" class="nv-drawer-mask"
                 t-on-click="closePanel">
                <div class="nv-drawer nv-side-drawer" t-on-click.stop="() => {}">
                    <NovaAdminPanel currentId="state.config ? state.config.id : 0"
                                    onClose.bind="closePanel"
                                    onOpenBoard.bind="openBoardFromPanel"
                                    onEditBoard.bind="editBoardFromPanel"
                                    onNewBoard.bind="newBoardFromPanel"
                                    onImport.bind="importFromPanel"
                                    onApplied.bind="onSamplesInstalled"/>
                </div>
            </div>

            <NovaAIPanel t-if="state.panel === 'ai'"
                         dashboardId="state.config ? state.config.id : false"
                         accent="state.accent"
                         initialPrompt="state.aiPrompt"
                         onApplied.bind="onAIApplied"
                         onClose.bind="closeAI"
                         onOpenEngine.bind="engineFromAI"/>
            <NovaStudio t-if="state.studio"
                        itemId="state.studio.itemId"
                        dashboardId="state.config.id"
                        accent="state.accent"
                        filters="filters"
                        presets="presets"
                        onClose.bind="closeStudio"
                        onSaved.bind="onStudioSaved"
                        onAI.bind="aiFromStudio"/>
            <NovaBoardStudio t-if="state.boardStudio"
                             boardId="state.boardStudio.boardId"
                             onClose.bind="closeBoardStudio"
                             onSaved.bind="onBoardSaved"/>
        </div>`;
    static components = { NovaGrid, NovaItem, NovaStudio, NovaBoardStudio, NovaAIPanel, NovaInspector, NovaBoardInfo, NovaAdminPanel, NovaPalette, NovaFocus, NovaHub };
    static props = { "*": true };

    setup() {
        this.orm = useService("orm");
        this.actionService = useService("action");
        this.notification = useService("notification");
        this.dialog = useService("dialog");
        this.state = useState({
            config: null,
            boards: [],
            payloads: {},
            layout: {},
            theme: "aurora",
            accent: "#7C6CFF",
            motion: true,
            preset: "this_year",
            dateFrom: "",
            dateTo: "",
            compare: true,
            editMode: false,
            boardsOpen: false,
            datesOpen: false,
            themesOpen: false,
            moreOpen: false,
            panel: null,
            inspect: null,
            insightsLoading: false,
            insights: [],
            loadingAll: false,
            loadError: "",
            studio: null,
            boardStudio: null,
            lastRefresh: "",
            palette: false,
            focus: null,
            aiPrompt: "",
            view: "hub",
            hub: null,
            hubBusy: false,
        });
        this._timer = null;
        this._layoutTimer = null;
        this.fileRef = useRef("file");
        this._closeAll = () => {
            this.state.boardsOpen = this.state.datesOpen =
                this.state.themesOpen = this.state.moreOpen = false;
        };
        this._hotkeys = (ev) => {
            if (ev.key === "Escape" && !this.state.studio &&
                    !this.state.boardStudio && !this.state.focus &&
                    !this.state.palette) {
                if (this.state.inspect) {
                    this.state.inspect = null;
                } else if (this.state.panel && this.state.panel !== "ai") {
                    this.state.panel = null;
                }
                return;
            }
            if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
                // claim Ctrl+K inside NovaBoard before Odoo's own palette
                ev.preventDefault();
                ev.stopImmediatePropagation();
                this._closeAll();
                this.state.palette = !this.state.palette;
            }
        };

        onWillStart(async () => {
            this.state.boards = await this.orm.call("nova.dashboard", "web_list", []);
            const wanted = this.props.action?.params?.dashboard_id ||
                this.props.action?.context?.nova_dashboard_id;
            if (wanted) {
                await this.loadBoard(wanted);
            } else {
                await this.goHome();
            }
            if (this.props.action?.params?.open_ai) {
                this.state.panel = "ai";
            }
        });
        onMounted(() => {
            window.addEventListener("click", this._closeAll);
            window.addEventListener("keydown", this._hotkeys, true);
        });
        onWillUnmount(() => {
            window.removeEventListener("click", this._closeAll);
            window.removeEventListener("keydown", this._hotkeys, true);
            if (this._timer) clearInterval(this._timer);
            if (this._layoutTimer) clearTimeout(this._layoutTimer);
        });
    }

    /* ------------------------------------------------------------------ */
    get rootClass() {
        return `nv-theme-${this.state.theme}` +
            (this.state.motion ? " nv-motion" : "") +
            (this.state.editMode ? " nv-editing" : "");
    }
    get rootStyle() {
        return `--nv-accent:${this.state.accent};`;
    }
    get pulseCount() {
        let n = 0;
        for (const id in this.state.payloads) {
            const p = this.state.payloads[id];
            if (!p) continue;
            n += (p.anomaly_count || 0) + (p.alert && p.alert.active ? 1 : 0);
        }
        return n;
    }

    get presets() {
        return this.state.config ? this.state.config.presets : [];
    }
    get presetLabel() {
        const p = this.presets.find((p) => p.key === this.state.preset);
        return p ? p.label : "Date";
    }
    get themes() {
        return [
            { key: "aurora", label: "Aurora" },
            { key: "nebula", label: "Nebula" },
            { key: "carbon", label: "Carbon" },
            { key: "daylight", label: "Daylight" },
            { key: "solar", label: "Solar" },
        ];
    }
    get filters() {
        const f = { preset: this.state.preset, compare: this.state.compare };
        if (this.state.preset === "custom") {
            f.date_from = this.state.dateFrom || false;
            f.date_to = this.state.dateTo || false;
        }
        return f;
    }

    /* ------------------------------------------------------------------ */
    async loadBoard(id, keepFilters = false) {
        try {
            const cfg = await this.orm.call("nova.dashboard", "web_config", [[id]]);
            this.state.config = cfg;
            this.state.theme = cfg.theme;
            this.state.accent = cfg.accent;
            this.state.motion = cfg.motion;
            if (!keepFilters) {
                this.state.preset = cfg.date_preset === "none" ? "this_year" : cfg.date_preset;
                this.state.compare = cfg.compare;
            }
            this.state.payloads = {};
            this.state.layout = {};
            for (const it of cfg.items) {
                this.state.layout[it.id] = it.pos;
            }
            this.state.loadError = "";
            this.state.view = "board";
            this.fetchAll();
            this.armAutoRefresh(cfg.refresh);
        } catch (e) {
            // dead deep-link (deleted board, stale menu) → land on the Hub
            this.notification.add(
                e.data?.message || e.message || "Could not load this dashboard.",
                { type: "warning" });
            this.goHome();
        }
    }

    async fetchAll() {
        const cfg = this.state.config;
        if (!cfg) return;
        this.state.loadingAll = true;
        if (!cfg.items.length) {
            this.state.loadingAll = false;
            return;
        }
        try {
            // single round-trip for the whole board
            const rows = await this.orm.call(
                "nova.dashboard", "web_fetch_all", [[cfg.id]],
                { filters: this.filters });
            const map = {};
            for (const r of rows) map[r.id] = r.payload;
            this.state.payloads = { ...this.state.payloads, ...map };
            this.state.loadingAll = false;
            this.state.lastRefresh = new Date().toLocaleTimeString(
                [], { hour: "2-digit", minute: "2-digit" });
        } catch (e) {
            this.fetchAllSequential();
        }
    }

    fetchAllSequential() {
        const cfg = this.state.config;
        let pending = cfg.items.length;
        for (const it of cfg.items) {
            this.fetchOne(it.id).finally(() => {
                pending -= 1;
                if (pending <= 0) this.state.loadingAll = false;
            });
        }
    }

    async fetchOne(itemId, extra = {}) {
        try {
            const payload = await this.orm.call(
                "nova.dashboard.item", "web_fetch", [[itemId]],
                { filters: { ...this.filters, ...extra } });
            this.state.payloads = { ...this.state.payloads, [itemId]: payload };
        } catch (e) {
            this.state.payloads = {
                ...this.state.payloads,
                [itemId]: {
                    id: itemId, type: "error",
                    error: e.data?.message || e.message || "Failed to load",
                },
            };
        }
    }

    /** Per-card reload. opts: {offset} pagination · {meta:true} reload whole config */
    async reloadItem(itemId, opts = {}) {
        if (opts.meta) {
            const keep = this.state.payloads;
            await this.loadBoard(this.state.config.id);
            // soft-keep old payloads while new ones stream in
            this.state.payloads = { ...keep, ...this.state.payloads };
            return;
        }
        if (itemId) {
            const extra = {};
            if (opts.offset !== undefined) extra.offset = opts.offset;
            if (opts.sort !== undefined) extra.sort = opts.sort;
            // skeleton only on hard refresh, not while paging/sorting
            if (opts.offset === undefined && opts.sort === undefined) {
                const { [itemId]: _drop, ...rest } = this.state.payloads;
                this.state.payloads = rest;
            }
            this.fetchOne(itemId, extra);
        }
    }

    onItemRemoved(itemId) {
        const cfg = this.state.config;
        cfg.items = cfg.items.filter((i) => i.id !== itemId);
        const { [itemId]: _d, ...rest } = this.state.payloads;
        this.state.payloads = rest;
        delete this.state.layout[itemId];
    }

    armAutoRefresh(seconds) {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        if (seconds && seconds > 0) {
            this._timer = setInterval(() => this.fetchAll(), seconds * 1000);
        }
    }

    /* ------------------- top-bar handlers ------------------- */
    toggleBoards(ev) { ev.stopPropagation(); const v = !this.state.boardsOpen; this._closeAll(); this.state.boardsOpen = v; }
    toggleDates(ev) { ev.stopPropagation(); const v = !this.state.datesOpen; this._closeAll(); this.state.datesOpen = v; }
    toggleThemes(ev) { ev.stopPropagation(); const v = !this.state.themesOpen; this._closeAll(); this.state.themesOpen = v; }
    toggleMore(ev) { ev.stopPropagation(); const v = !this.state.moreOpen; this._closeAll(); this.state.moreOpen = v; }

    hopBoard(id) {
        // dashboards talk to each other: the period travels with you
        this._closeAll();
        this.loadBoard(id, true);
    }

    openBoard(id) {
        this._closeAll();
        if (this.state.view === "hub" || !this.state.config ||
                id !== this.state.config.id) {
            this.loadBoard(id);
        }
    }

    async goHome() {
        this._closeAll();
        this.state.panel = null;
        this.state.inspect = null;
        this.state.focus = null;
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        this.state.view = "hub";
        await this.refreshHub();
    }

    async refreshHub() {
        this.state.hubBusy = !this.state.hub;
        try {
            this.state.hub = await this.orm.call("nova.dashboard", "web_hub", []);
            this.state.boards = await this.orm.call("nova.dashboard", "web_list", []);
        } catch (e) {
            this.state.hub = { can_manage: false, boards: [],
                totals: { boards: 0, widgets: 0 } };
        }
        this.state.hubBusy = false;
    }

    async hubDuplicate(id) {
        try {
            await this.orm.call("nova.dashboard", "web_duplicate", [[id]]);
            this.notification.add("Dashboard duplicated.", { type: "success" });
            this.refreshHub();
        } catch (e) {
            this.notification.add(e.data?.message || e.message, { type: "danger" });
        }
    }

    hubDelete(id, name) {
        this.dialog.add(ConfirmationDialog, {
            title: "Delete dashboard",
            body: `Delete "${name}" and all of its widgets? This cannot be undone.`,
            confirmLabel: "Delete",
            confirm: async () => {
                await this.orm.unlink("nova.dashboard", [id]);
                this.notification.add("Dashboard deleted.", { type: "warning" });
                this.refreshHub();
            },
            cancel: () => {},
        });
    }

    setPreset(key) {
        this.state.preset = key;
        this._closeAll();
        if (key !== "custom") this.fetchAll();
    }
    onCustomDate() {
        if (this.state.dateFrom && this.state.dateTo) this.fetchAll();
    }
    toggleCompare() {
        this.state.compare = !this.state.compare;
        this.fetchAll();
    }
    setTheme(key) {
        this.state.theme = key;
        this._closeAll();
        if (this.state.config?.editable) {
            this.orm.write("nova.dashboard", [this.state.config.id], { theme: key });
        }
    }
    toggleMotion() {
        this.state.motion = !this.state.motion;
        if (this.state.config?.editable) {
            this.orm.write("nova.dashboard", [this.state.config.id],
                { motion: this.state.motion });
        }
    }
    refreshAll() {
        this.fetchAll();
    }
    tvMode() {
        const el = document.querySelector(".nv-root");
        if (!document.fullscreenElement) {
            (el || document.documentElement).requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
    }
    toggleEdit() {
        this.state.editMode = !this.state.editMode;
    }

    addWidget() {
        this._closeAll();
        this.state.studio = { itemId: null };
    }

    openStudio(itemId) {
        this._closeAll();
        this.state.studio = { itemId };
    }

    closeStudio() {
        this.state.studio = null;
    }

    onStudioSaved() {
        this.state.studio = null;
        this.reloadItem(null, { meta: true });
    }

    newBoard() {
        this._closeAll();
        this.state.boardStudio = { boardId: null };
    }

    editBoard() {
        this._closeAll();
        this.state.boardStudio = { boardId: this.state.config.id };
    }

    closeBoardStudio() {
        this.state.boardStudio = null;
    }

    openAI() {
        this._closeAll();
        this.state.inspect = null;
        this.state.panel = "ai";
    }

    closeAI() {
        this.state.panel = null;
        this.state.aiPrompt = "";
    }

    /* ------------------- palette & focus ------------------- */
    closePalette() {
        this.state.palette = false;
    }

    openPaletteClick(ev) {
        ev.stopPropagation();
        this._closeAll();
        this.state.palette = true;
    }

    openFocus(itemId) {
        this._closeAll();
        this.state.focus = { itemId };
    }

    closeFocus() {
        this.state.focus = null;
    }

    inspectFromFocus(itemId) {
        this.openInspector(itemId);
    }

    editFromFocus(itemId) {
        this.state.focus = null;
        this.openStudio(itemId);
    }

    runPalette(res) {
        this.state.palette = false;
        if (res.kind === "board") {
            this.loadBoard(res.id);
        } else if (res.kind === "widget") {
            this.state.focus = { itemId: res.id };
        } else if (res.kind === "ai") {
            this.state.aiPrompt = res.id;
            this.state.inspect = null;
            this.state.panel = "ai";
        } else if (res.kind === "action") {
            this.runAction(res.id);
        }
    }

    runAction(key) {
        if (key.startsWith("theme-")) {
            this.setTheme(key.slice(6));
            return;
        }
        const map = {
            "new-widget": () => this.addWidget(),
            "new-board": () => this.newBoard(),
            "board-settings": () => this.editBoard(),
            "arrange": () => this.toggleEdit(),
            "ai": () => this.openAI(),
            "insights": () => this.openInsights(),
            "info": () => this.togglePanel("info"),
            "admin": () => this.togglePanel("admin"),
            "refresh": () => this.refreshAll(),
            "tv": () => this.tvMode(),
            "home": () => this.goHome(),
            "export": () => this.exportBoard(),
            "duplicate": () => this.duplicateBoard(),
            "import": () => this.importBoard(),
            "toggle-motion": () => this.toggleMotion(),
            "toggle-compare": () => this.toggleCompare(),
            "samples": async () => {
                const ids = await this.orm.call(
                    "nova.dashboard", "web_install_samples", []);
                this.notification.add(
                    ids.length ? `Installed ${ids.length} sample dashboard(s).`
                        : "Samples need the Sales or CRM app.",
                    { type: ids.length ? "success" : "warning" });
                if (ids.length) this.onSamplesInstalled(ids[0]);
            },
        };
        (map[key] || (() => {}))();
    }

    async onAIApplied(res) {
        this.state.boards = await this.orm.call("nova.dashboard", "web_list", []);
        const id = res.board_id ||
            (this.state.config && this.state.config.id) ||
            (this.state.boards[0] && this.state.boards[0].id);
        if (id) this.loadBoard(id);
    }

    async onBoardSaved(id) {
        this.state.boardStudio = null;
        this.state.boards = await this.orm.call("nova.dashboard", "web_list", []);
        if (id) {
            this.loadBoard(id);
        } else {
            this.state.config = null;
            this.state.payloads = {};
            this.state.layout = {};
            this.goHome();
        }
    }

    /* ------------------- layout persistence ------------------- */
    onLayoutChange(layout) {
        this.state.layout = layout;
        if (!this.state.config?.editable) return;
        if (this._layoutTimer) clearTimeout(this._layoutTimer);
        this._layoutTimer = setTimeout(() => {
            this.orm.call("nova.dashboard", "web_save_layout",
                [[this.state.config.id]], { layout });
        }, 600);
    }

    /* ------------------- side panels ------------------- */
    togglePanel(name) {
        this._closeAll();
        this.state.inspect = null;
        this.state.panel = this.state.panel === name ? null : name;
    }

    closePanel() {
        this.state.panel = null;
    }

    askAbout(itemId) {
        const it = (this.state.config?.items || []).find((i) => i.id === itemId);
        if (!it) return;
        this._closeAll();
        this.state.inspect = null;
        this.state.focus = null;
        this.state.aiPrompt =
            `Investigate the widget "${it.name}": explain what it is showing ` +
            "right now, dig into the numbers, anomalies and trend versus the " +
            "previous period, and suggest one concrete improvement.";
        this.state.panel = "ai";
    }

    engineFromAI() {
        this.state.aiPrompt = "";
        this.state.inspect = null;
        this.state.panel = "admin";
    }

    aiFromStudio() {
        this.state.studio = null;
        this.state.aiPrompt = "";
        this.state.inspect = null;
        this.state.panel = "ai";
    }

    novaBrief() {
        this.state.aiPrompt =
            "Brief me on this dashboard: summarize the key numbers and " +
            "trends, call out every anomaly and tripped alert, compare to " +
            "the previous period, and finish with three concrete " +
            "recommendations.";
        this.state.panel = "ai";
    }

    openInspector(itemId) {
        if (!itemId) return;
        this._closeAll();
        this.state.panel = null;
        this.state.inspect = itemId;
    }

    closeInspector() {
        this.state.inspect = null;
    }

    editFromInspector(itemId) {
        this.state.inspect = null;
        this.openStudio(itemId);
    }

    settingsFromPanel() {
        this.state.panel = null;
        this.editBoard();
    }

    openBoardFromPanel(id) {
        this.openBoard(id);
    }

    editBoardFromPanel(id) {
        this.state.panel = null;
        this.state.boardStudio = { boardId: id };
    }

    newBoardFromPanel() {
        this.state.panel = null;
        this.newBoard();
    }

    importFromPanel() {
        this.state.panel = null;
        this.importBoard();
    }

    async onSamplesInstalled(boardId) {
        this.state.boards = await this.orm.call("nova.dashboard", "web_list", []);
        if (boardId) this.loadBoard(boardId);
    }

    async openInsights() {
        this._closeAll();
        this.state.inspect = null;
        this.state.panel = "insights";
        this.state.insightsLoading = true;
        try {
            this.state.insights = await this.orm.call(
                "nova.dashboard", "web_digest", [[this.state.config.id]],
                { filters: this.filters });
        } catch (e) {
            this.state.insights = [];
        }
        this.state.insightsLoading = false;
    }

    async duplicateBoard() {
        this._closeAll();
        try {
            const newId = await this.orm.call("nova.dashboard", "web_duplicate",
                [[this.state.config.id]]);
            this.notification.add("Dashboard duplicated.", { type: "success" });
            this.state.boards = await this.orm.call("nova.dashboard", "web_list", []);
            this.loadBoard(newId);
        } catch (e) {
            this.notification.add(e.data?.message || e.message, { type: "danger" });
        }
    }

    /* ------------------- import / export ------------------- */
    async exportBoard() {
        this._closeAll();
        const data = await this.orm.call("nova.dashboard", "web_export",
            [[this.state.config.id]]);
        downloadText(
            (this.state.config.name || "novaboard").replace(/\s+/g, "_") + ".novaboard.json",
            JSON.stringify(data, null, 2), "application/json");
    }
    importBoard() {
        this._closeAll();
        this.fileRef.el?.click();
    }
    async onImportFile(ev) {
        const file = ev.target.files[0];
        ev.target.value = "";
        if (!file) return;
        const text = await file.text();
        try {
            const newId = await this.orm.call("nova.dashboard", "web_import", [text]);
            this.notification.add("Dashboard imported.", { type: "success" });
            this.state.boards = await this.orm.call("nova.dashboard", "web_list", []);
            this.loadBoard(newId);
        } catch (e) {
            this.notification.add(
                e.data?.message || e.message || "Import failed — invalid file.",
                { type: "danger" });
        }
    }
}

registry.category("actions").add("nova_dashboard_action", NovaDashboardAction);
