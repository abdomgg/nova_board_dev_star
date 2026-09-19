/** NovaStudio — full-frontend widget authoring with live preview.
 *  Replaces backend form configuration: pick a type, point at data,
 *  style it, and watch the real widget render against real records. */
import {
    Component, useState, useRef, onWillStart, onMounted, onWillUnmount, xml,
} from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { NovaBody } from "../nova_item";
import { paletteFor } from "../nova_utils";

const CHART_FAMILY = new Set(["bar", "hbar", "line", "area", "waterfall",
    "pie", "doughnut", "polar", "radar"]);
const NEEDS_GROUP = new Set([...CHART_FAMILY, "funnel", "heatmap", "leaderboard"]);
const VALUE_TYPES = new Set(["kpi", "tile", "gauge", "bullet"]);
const TIME_CHARTS = new Set(["line", "area", "bar", "hbar", "waterfall"]);

const TYPE_GROUPS = [
    { label: "Value", types: [
        { key: "kpi", label: "KPI", icon: "fa-bolt" },
        { key: "tile", label: "Tile", icon: "fa-square" },
        { key: "gauge", label: "Gauge", icon: "fa-tachometer" },
        { key: "bullet", label: "Bullet", icon: "fa-arrows-h" },
    ]},
    { label: "Charts", types: [
        { key: "bar", label: "Bar", icon: "fa-bar-chart" },
        { key: "hbar", label: "H-Bar", icon: "fa-align-left" },
        { key: "line", label: "Line", icon: "fa-line-chart" },
        { key: "area", label: "Area", icon: "fa-area-chart" },
        { key: "waterfall", label: "Waterfall", icon: "fa-signal" },
        { key: "radar", label: "Radar", icon: "fa-bullseye" },
        { key: "scatter", label: "Scatter", icon: "fa-braille" },
    ]},
    { label: "Proportions", types: [
        { key: "pie", label: "Pie", icon: "fa-pie-chart" },
        { key: "doughnut", label: "Doughnut", icon: "fa-circle-o-notch" },
        { key: "polar", label: "Polar", icon: "fa-dot-circle-o" },
        { key: "funnel", label: "Funnel", icon: "fa-filter" },
        { key: "heatmap", label: "Heatmap", icon: "fa-th" },
    ]},
    { label: "Data", types: [
        { key: "leaderboard", label: "Top N", icon: "fa-trophy" },
        { key: "list", label: "List", icon: "fa-table" },
    ]},
    { label: "Utility", types: [
        { key: "todo", label: "To-Do", icon: "fa-check-square-o" },
        { key: "text", label: "Note", icon: "fa-file-text-o" },
    ]},
];

const ICONS = ["bolt", "rocket", "line-chart", "bar-chart", "pie-chart",
    "area-chart", "usd", "eur", "money", "shopping-cart", "credit-card",
    "users", "user", "user-plus", "briefcase", "building", "truck", "cube",
    "cubes", "archive", "tags", "star", "heart", "trophy", "flag", "bell",
    "calendar", "clock-o", "check-circle", "exclamation-triangle", "bullseye",
    "crosshairs", "filter", "database", "globe", "envelope", "phone",
    "comments", "wrench", "cog", "leaf", "fire", "magnet", "diamond"];

const ACCENTS = ["#7C6CFF", "#4CC2FF", "#22C7A9", "#34D399", "#FBBF24",
    "#FF8A4C", "#FB7185", "#F472B6", "#A78BFA", "#94A3B8"];

const PALETTE_DEFS = [
    ["theme", "Theme"], ["vivid", "Vivid"], ["ocean", "Ocean"],
    ["sunset", "Sunset"], ["forest", "Forest"], ["candy", "Candy"],
    ["mono", "Mono"],
];

const AGGS = [["count", "Count records"], ["sum", "Sum"], ["avg", "Average"],
    ["min", "Minimum"], ["max", "Maximum"]];
const GRANS = [["hour", "Hour"], ["day", "Day"], ["week", "Week"],
    ["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]];
const SORTS = [["none", "Natural order"], ["desc", "Value high → low"],
    ["asc", "Value low → high"]];
const STYLES = [["compact", "Compact · 1.2M"], ["full", "Full · 1,200,000"]];

const READ_FIELDS = ["name", "item_type", "icon", "color", "chart_palette",
    "model_id", "model_name", "domain", "date_field_id", "date_preset_item",
    "agg", "measure_field_ids", "scatter_x_field_id", "scatter_y_field_id",
    "group_field_id", "group_granularity", "subgroup_field_id",
    "subgroup_granularity", "record_limit", "sort_dir", "stacked",
    "show_values", "show_legend", "cumulative", "fill_gaps", "value_style",
    "unit_label", "use_currency", "show_records", "enable_forecast",
    "forecast_periods", "detect_anomalies", "compare_previous_item",
    "target_value", "alert_rule", "alert_value", "alert_color",
    "list_field_ids", "text_content"];

export class NovaStudio extends Component {
    static template = xml`
        <div class="nv-studio-mask" t-on-mousedown.self="tryClose">
            <div class="nv-studio">
                <!-- ===================== CONFIG SIDE ===================== -->
                <div class="nv-studio-side">
                    <div class="nv-studio-head">
                        <div class="nv-studio-title">
                            <i class="fa fa-magic"/>
                            <span t-esc="props.itemId ? 'Edit Widget' : 'Widget Studio'"/>
                        </div>
                        <button t-if="props.onAI" class="nv-icon-btn nv-studio-ai"
                                title="Describe the widget to NovaMind instead"
                                t-on-click="() => props.onAI()">
                            <i class="fa fa-magic"/></button>
                        <button class="nv-icon-btn" title="Close" t-on-click="tryClose">
                            <i class="fa fa-times"/></button>
                    </div>

                    <input class="nv-inp nv-inp-title" t-ref="name"
                           placeholder="Widget name…" maxlength="60"
                           t-att-value="state.cfg.name"
                           t-on-input="(ev) => this.set('name', ev.target.value, false)"/>

                    <div class="nv-tabs">
                        <button t-att-class="state.tab === 'data' ? 'nv-active' : ''"
                                t-on-click="() => state.tab = 'data'">
                            <i class="fa fa-database"/> Data</button>
                        <button t-att-class="state.tab === 'style' ? 'nv-active' : ''"
                                t-on-click="() => state.tab = 'style'">
                            <i class="fa fa-paint-brush"/> Style</button>
                        <button t-att-class="state.tab === 'intel' ? 'nv-active' : ''"
                                t-on-click="() => state.tab = 'intel'">
                            <i class="fa fa-lightbulb-o"/> Intelligence</button>
                    </div>

                    <div class="nv-studio-scroll">
                        <!-- ================= DATA TAB ================= -->
                        <t t-if="state.tab === 'data'">
                            <div class="nv-sec">
                                <div class="nv-sec-label">Widget type</div>
                                <t t-foreach="typeGroups" t-as="grp" t-key="grp.label">
                                    <div class="nv-typecat" t-esc="grp.label"/>
                                    <div class="nv-typegrid">
                                        <button t-foreach="grp.types" t-as="tp" t-key="tp.key"
                                                class="nv-typecard"
                                                t-att-class="state.cfg.item_type === tp.key ? 'nv-active' : ''"
                                                t-on-click="() => this.pickType(tp.key)">
                                            <i t-att-class="'fa ' + tp.icon"/>
                                            <span t-esc="tp.label"/>
                                        </button>
                                    </div>
                                </t>
                            </div>

                            <div t-if="needsModel" class="nv-sec">
                                <div class="nv-sec-label">Data source</div>
                                <div class="nv-auto-wrap">
                                    <input class="nv-inp" placeholder="Pick a model — click to browse, type to filter"
                                           t-att-value="state.modelQuery"
                                           t-on-input="onModelInput"
                                           t-on-focus="onModelInput"
                                           t-on-click="onModelInput"/>
                                    <i class="fa fa-angle-down nv-auto-ico"/>
                                    <div t-if="state.modelOpen" class="nv-auto-menu">
                                        <div class="nv-auto-head">
                                            <i class="fa fa-database"/>
                                            <t t-esc="modelCountLabel"/>
                                        </div>
                                        <button t-foreach="state.modelOpts" t-as="m" t-key="m.id"
                                                t-att-class="state.cfg.model_id === m.id ? 'nv-active' : ''"
                                                t-on-click="() => this.pickModel(m)">
                                            <span><i class="fa fa-table"/> <t t-esc="m.name"/></span>
                                            <code t-esc="m.model"/>
                                        </button>
                                        <div t-if="!state.modelOpts.length" class="nv-menu-note">
                                            No model matches “<t t-esc="state.modelQuery"/>”.
                                        </div>
                                    </div>
                                </div>
                                <div t-if="state.cfg.model_id" class="nv-src-pill">
                                    <i class="fa fa-database"/>
                                    <span t-esc="state.cfg.model_label"/>
                                    <code t-esc="state.cfg.model_tech"/>
                                    <button class="nv-icon-btn nv-mini" title="Clear model"
                                            t-on-click="clearModel"><i class="fa fa-times"/></button>
                                </div>
                                <div class="nv-field">
                                    <label>Filter domain <span class="nv-opt">optional</span></label>
                                    <textarea class="nv-inp nv-mono" rows="2"
                                              placeholder='[["state","=","sale"]]'
                                              t-att-value="state.cfg.domain"
                                              t-on-change="(ev) => this.set('domain', ev.target.value)"/>
                                </div>
                            </div>

                            <div t-if="showMeasures" class="nv-sec">
                                <div class="nv-sec-label">Measure</div>
                                <div class="nv-field">
                                    <label>Aggregation</label>
                                    <select class="nv-inp" t-on-change="(ev) => this.pickOpt('agg', ev)">
                                        <option t-foreach="aggs" t-as="a" t-key="a[0]"
                                                t-att-value="a[0]"
                                                t-att-selected="state.cfg.agg === a[0]"
                                                t-esc="a[1]"/>
                                    </select>
                                </div>
                                <div t-if="state.cfg.agg !== 'count'" class="nv-field">
                                    <label>Measure field(s)</label>
                                    <div class="nv-checklist">
                                        <label t-foreach="state.fields.measures" t-as="f" t-key="f.id"
                                               class="nv-check">
                                            <input type="checkbox"
                                                   t-att-checked="state.cfg.measure_ids.includes(f.id)"
                                                   t-on-change="() => this.toggleIn('measure_ids', f.id)"/>
                                            <span t-esc="f.label"/>
                                            <code t-esc="f.name"/>
                                        </label>
                                        <div t-if="!state.fields.measures.length" class="nv-menu-note">
                                            No numeric fields on this model.</div>
                                    </div>
                                </div>
                            </div>

                            <div t-if="isScatter" class="nv-sec">
                                <div class="nv-sec-label">Scatter axes</div>
                                <div class="nv-field-row">
                                    <div class="nv-field">
                                        <label>X measure</label>
                                        <select class="nv-inp" t-on-change="(ev) => this.pickField('scatter_x_field_id', ev)">
                                            <option value="">— pick —</option>
                                            <option t-foreach="state.fields.measures" t-as="f" t-key="f.id"
                                                    t-att-value="f.id"
                                                    t-att-selected="state.cfg.scatter_x_field_id === f.id"
                                                    t-esc="f.label"/>
                                        </select>
                                    </div>
                                    <div class="nv-field">
                                        <label>Y measure</label>
                                        <select class="nv-inp" t-on-change="(ev) => this.pickField('scatter_y_field_id', ev)">
                                            <option value="">— pick —</option>
                                            <option t-foreach="state.fields.measures" t-as="f" t-key="f.id"
                                                    t-att-value="f.id"
                                                    t-att-selected="state.cfg.scatter_y_field_id === f.id"
                                                    t-esc="f.label"/>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div t-if="needsGroup or isScatter" class="nv-sec">
                                <div class="nv-sec-label" t-esc="isHeatmap ? 'Axes' : 'Grouping'"/>
                                <div class="nv-field">
                                    <label t-esc="isHeatmap ? 'Rows (Y axis)' : (isScatter ? 'Color series by (optional)' : 'Group by')"/>
                                    <select class="nv-inp" t-on-change="(ev) => this.pickField('group_field_id', ev)">
                                        <option value="">— pick —</option>
                                        <option t-foreach="state.fields.groups" t-as="f" t-key="f.id"
                                                t-att-value="f.id"
                                                t-att-selected="state.cfg.group_field_id === f.id"
                                                t-esc="f.label + ' · ' + f.ttype"/>
                                    </select>
                                </div>
                                <div t-if="groupIsDate" class="nv-field">
                                    <label>Time bucket</label>
                                    <select class="nv-inp" t-on-change="(ev) => this.pickOpt('group_granularity', ev)">
                                        <option t-foreach="grans" t-as="g" t-key="g[0]"
                                                t-att-value="g[0]"
                                                t-att-selected="state.cfg.group_granularity === g[0]"
                                                t-esc="g[1]"/>
                                    </select>
                                </div>
                                <div t-if="canSubgroup" class="nv-field">
                                    <label t-esc="isHeatmap ? 'Columns (X axis)' : 'Split series by (optional)'"/>
                                    <select class="nv-inp" t-on-change="(ev) => this.pickField('subgroup_field_id', ev)">
                                        <option value="">— none —</option>
                                        <option t-foreach="subgroupOptions" t-as="f" t-key="f.id"
                                                t-att-value="f.id"
                                                t-att-selected="state.cfg.subgroup_field_id === f.id"
                                                t-esc="f.label + ' · ' + f.ttype"/>
                                    </select>
                                </div>
                                <div t-if="subgroupIsDate" class="nv-field">
                                    <label>Column time bucket</label>
                                    <select class="nv-inp" t-on-change="(ev) => this.pickOpt('subgroup_granularity', ev)">
                                        <option t-foreach="grans" t-as="g" t-key="g[0]"
                                                t-att-value="g[0]"
                                                t-att-selected="state.cfg.subgroup_granularity === g[0]"
                                                t-esc="g[1]"/>
                                    </select>
                                </div>
                                <div t-if="!isScatter" class="nv-field-row">
                                    <div class="nv-field">
                                        <label>Limit <span class="nv-opt">0 = all</span></label>
                                        <input type="number" min="0" max="500" class="nv-inp"
                                               t-att-value="state.cfg.record_limit"
                                               t-on-change="(ev) => this.pickNum('record_limit', ev)"/>
                                    </div>
                                    <div class="nv-field">
                                        <label>Sort</label>
                                        <select class="nv-inp" t-on-change="(ev) => this.pickOpt('sort_dir', ev)">
                                            <option t-foreach="sorts" t-as="s" t-key="s[0]"
                                                    t-att-value="s[0]"
                                                    t-att-selected="state.cfg.sort_dir === s[0]"
                                                    t-esc="s[1]"/>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div t-if="isList" class="nv-sec">
                                <div class="nv-sec-label">Columns</div>
                                <div class="nv-checklist nv-checklist-tall">
                                    <label t-foreach="state.fields.columns" t-as="f" t-key="f.id"
                                           class="nv-check">
                                        <input type="checkbox"
                                               t-att-checked="state.cfg.list_ids.includes(f.id)"
                                               t-on-change="() => this.toggleIn('list_ids', f.id)"/>
                                        <span t-esc="f.label"/>
                                        <code t-esc="f.name"/>
                                    </label>
                                </div>
                                <div class="nv-field">
                                    <label>Rows per page</label>
                                    <input type="number" min="3" max="80" class="nv-inp"
                                           t-att-value="state.cfg.record_limit or 8"
                                           t-on-change="(ev) => this.pickNum('record_limit', ev)"/>
                                </div>
                            </div>

                            <div t-if="needsModel" class="nv-sec">
                                <div class="nv-sec-label">Time scope</div>
                                <div class="nv-field">
                                    <label>Date field</label>
                                    <select class="nv-inp" t-on-change="(ev) => this.pickField('date_field_id', ev)">
                                        <option value="">— none (ignore dates) —</option>
                                        <option t-foreach="state.fields.dates" t-as="f" t-key="f.id"
                                                t-att-value="f.id"
                                                t-att-selected="state.cfg.date_field_id === f.id"
                                                t-esc="f.label"/>
                                    </select>
                                </div>
                                <div class="nv-field">
                                    <label>Period</label>
                                    <select class="nv-inp" t-on-change="(ev) => this.pickOpt('date_preset_item', ev)">
                                        <option t-foreach="scopeOptions" t-as="p" t-key="p.key"
                                                t-att-value="p.key"
                                                t-att-selected="state.cfg.date_preset_item === p.key"
                                                t-esc="p.label"/>
                                    </select>
                                </div>
                            </div>

                            <div t-if="state.cfg.item_type === 'text'" class="nv-sec">
                                <div class="nv-sec-label">Content</div>
                                <textarea class="nv-inp" rows="7"
                                          placeholder="Write your note… (HTML allowed)"
                                          t-att-value="state.cfg.text_content"
                                          t-on-change="(ev) => this.set('text_content', ev.target.value)"/>
                            </div>
                            <div t-if="state.cfg.item_type === 'todo'" class="nv-sec">
                                <div class="nv-menu-note">
                                    <i class="fa fa-info-circle"/>
                                    Tasks are added directly on the card once it's on the board.
                                </div>
                            </div>
                        </t>

                        <!-- ================= STYLE TAB ================= -->
                        <t t-if="state.tab === 'style'">
                            <div class="nv-sec">
                                <div class="nv-sec-label">Icon</div>
                                <div class="nv-icongrid">
                                    <button t-foreach="icons" t-as="ic" t-key="ic"
                                            t-att-class="state.cfg.icon === 'fa-' + ic ? 'nv-active' : ''"
                                            t-att-title="ic"
                                            t-on-click="() => this.set('icon', 'fa-' + ic, false)">
                                        <i t-att-class="'fa fa-' + ic"/>
                                    </button>
                                </div>
                            </div>
                            <div class="nv-sec">
                                <div class="nv-sec-label">Accent color</div>
                                <div class="nv-accent-row">
                                    <input type="color" class="nv-color"
                                           t-att-value="state.cfg.color or props.accent"
                                           t-on-input="(ev) => this.set('color', ev.target.value, false)"/>
                                    <button t-foreach="accents" t-as="c" t-key="c"
                                            class="nv-dot" t-att-style="'background:' + c"
                                            t-att-class="state.cfg.color === c ? 'nv-active' : ''"
                                            t-on-click="() => this.set('color', c, false)"/>
                                    <button class="nv-btn nv-mini-btn" title="Use board accent"
                                            t-on-click="() => this.set('color', '', false)">Auto</button>
                                </div>
                            </div>
                            <div t-if="showPalette" class="nv-sec">
                                <div class="nv-sec-label">Chart palette</div>
                                <div class="nv-palettes">
                                    <button t-foreach="paletteRows" t-as="p" t-key="p.key"
                                            class="nv-palette"
                                            t-att-class="state.cfg.chart_palette === p.key ? 'nv-active' : ''"
                                            t-on-click="() => this.set('chart_palette', p.key, false)">
                                        <span class="nv-palette-name" t-esc="p.label"/>
                                        <span class="nv-palette-dots">
                                            <span t-foreach="p.colors" t-as="c" t-key="c_index"
                                                  t-att-style="'background:' + c"/>
                                        </span>
                                    </button>
                                </div>
                            </div>
                            <div class="nv-sec">
                                <div class="nv-sec-label">Display</div>
                                <label t-if="showLegendOpt" class="nv-switch">
                                    <input type="checkbox" t-att-checked="state.cfg.show_legend"
                                           t-on-change="(ev) => this.pickBool('show_legend', ev)"/>
                                    <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                    <span>Legend</span>
                                </label>
                                <label t-if="isChartType" class="nv-switch">
                                    <input type="checkbox" t-att-checked="state.cfg.show_values"
                                           t-on-change="(ev) => this.pickBool('show_values', ev)"/>
                                    <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                    <span>Data labels</span>
                                </label>
                                <label t-if="canStack" class="nv-switch">
                                    <input type="checkbox" t-att-checked="state.cfg.stacked"
                                           t-on-change="(ev) => this.pickBool('stacked', ev)"/>
                                    <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                    <span>Stacked series</span>
                                </label>
                                <label t-if="canTime" class="nv-switch">
                                    <input type="checkbox" t-att-checked="state.cfg.cumulative"
                                           t-on-change="(ev) => this.pickBool('cumulative', ev)"/>
                                    <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                    <span>Cumulative</span>
                                </label>
                                <label t-if="canTime" class="nv-switch">
                                    <input type="checkbox" t-att-checked="state.cfg.fill_gaps"
                                           t-on-change="(ev) => this.pickBool('fill_gaps', ev)"/>
                                    <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                    <span>Fill time gaps</span>
                                </label>
                                <label t-if="needsModel" class="nv-switch">
                                    <input type="checkbox" t-att-checked="state.cfg.show_records"
                                           t-on-change="(ev) => this.pickBool('show_records', ev)"/>
                                    <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                    <span>Click-through to records</span>
                                </label>
                            </div>
                            <div t-if="needsModel" class="nv-sec">
                                <div class="nv-sec-label">Number format</div>
                                <div class="nv-field">
                                    <select class="nv-inp" t-on-change="(ev) => this.pickOpt('value_style', ev)">
                                        <option t-foreach="styles" t-as="s" t-key="s[0]"
                                                t-att-value="s[0]"
                                                t-att-selected="state.cfg.value_style === s[0]"
                                                t-esc="s[1]"/>
                                    </select>
                                </div>
                                <div class="nv-field-row">
                                    <div class="nv-field">
                                        <label>Unit suffix</label>
                                        <input class="nv-inp" maxlength="8" placeholder="kg · pcs"
                                               t-att-value="state.cfg.unit_label"
                                               t-on-change="(ev) => this.set('unit_label', ev.target.value)"/>
                                    </div>
                                    <label class="nv-switch nv-switch-pad">
                                        <input type="checkbox" t-att-checked="state.cfg.use_currency"
                                               t-on-change="(ev) => this.pickBool('use_currency', ev)"/>
                                        <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                        <span>Currency</span>
                                    </label>
                                </div>
                            </div>
                        </t>

                        <!-- ================= INTEL TAB ================= -->
                        <t t-if="state.tab === 'intel'">
                            <div class="nv-sec">
                                <div class="nv-sec-label">Predictive</div>
                                <label class="nv-switch" t-att-class="canForecast ? '' : 'nv-disabled'">
                                    <input type="checkbox" t-att-checked="state.cfg.enable_forecast"
                                           t-att-disabled="!canForecast"
                                           t-on-change="(ev) => this.pickBool('enable_forecast', ev)"/>
                                    <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                    <span>Forecast with confidence band</span>
                                </label>
                                <div t-if="!canForecast" class="nv-menu-note">
                                    Forecasting needs a time-based chart (line, area or bars grouped by a date field).
                                </div>
                                <div t-if="state.cfg.enable_forecast and canForecast" class="nv-field">
                                    <label>Periods ahead</label>
                                    <input type="number" min="1" max="12" class="nv-inp"
                                           t-att-value="state.cfg.forecast_periods"
                                           t-on-change="(ev) => this.pickNum('forecast_periods', ev)"/>
                                </div>
                            </div>
                            <div class="nv-sec">
                                <div class="nv-sec-label">Vigilance</div>
                                <label class="nv-switch" t-att-class="isChartType ? '' : 'nv-disabled'">
                                    <input type="checkbox" t-att-checked="state.cfg.detect_anomalies"
                                           t-att-disabled="!isChartType"
                                           t-on-change="(ev) => this.pickBool('detect_anomalies', ev)"/>
                                    <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                    <span>Flag anomalies on the chart</span>
                                </label>
                            </div>
                            <div class="nv-sec">
                                <div class="nv-sec-label">Context</div>
                                <label class="nv-switch" t-att-class="canCompare ? '' : 'nv-disabled'">
                                    <input type="checkbox" t-att-checked="state.cfg.compare_previous_item"
                                           t-att-disabled="!canCompare"
                                           t-on-change="(ev) => this.pickBool('compare_previous_item', ev)"/>
                                    <span class="nv-switch-track"><span class="nv-switch-dot"/></span>
                                    <span>Overlay previous period</span>
                                </label>
                                <div t-if="isValue" class="nv-field">
                                    <label>Target value <span class="nv-opt">drives gauge and progress ring</span></label>
                                    <input type="number" step="any" class="nv-inp"
                                           t-att-value="state.cfg.target_value"
                                           t-on-change="(ev) => this.pickNum('target_value', ev)"/>
                                </div>
                            </div>
                            <div t-if="isValue" class="nv-sec">
                                <div class="nv-sec-label">Pulse alert — make it blink</div>
                                <div class="nv-field-row">
                                    <div class="nv-field">
                                        <label>Rule</label>
                                        <select class="nv-inp" t-on-change="(ev) => this.pickOpt('alert_rule', ev)">
                                            <option value="off" t-att-selected="state.cfg.alert_rule === 'off'">Off</option>
                                            <option value="above" t-att-selected="state.cfg.alert_rule === 'above'">Value above</option>
                                            <option value="below" t-att-selected="state.cfg.alert_rule === 'below'">Value below</option>
                                        </select>
                                    </div>
                                    <div t-if="state.cfg.alert_rule !== 'off'" class="nv-field">
                                        <label>Threshold</label>
                                        <input type="number" step="any" class="nv-inp"
                                               t-att-value="state.cfg.alert_value"
                                               t-on-change="(ev) => this.pickNum('alert_value', ev)"/>
                                    </div>
                                </div>
                                <div t-if="state.cfg.alert_rule !== 'off'" class="nv-accent-row">
                                    <input type="color" class="nv-color"
                                           t-att-value="state.cfg.alert_color or '#FF5470'"
                                           t-on-input="(ev) => this.set('alert_color', ev.target.value)"/>
                                    <span class="nv-opt">card border + glow blinks in this color when the rule trips</span>
                                </div>
                            </div>
                        </t>
                    </div>

                    <div class="nv-studio-foot">
                        <span t-if="missing.length" class="nv-studio-hint">
                            <i class="fa fa-info-circle"/> <t t-esc="missing[0]"/>
                        </span>
                        <span class="nv-flex-1"/>
                        <button class="nv-btn" t-on-click="tryClose">Cancel</button>
                        <button class="nv-btn nv-btn-primary" t-att-disabled="missing.length or state.saving"
                                t-on-click="save">
                            <i t-att-class="'fa ' + (state.saving ? 'fa-circle-o-notch fa-spin' : 'fa-check')"/>
                            <t t-esc="props.itemId ? 'Save widget' : 'Add to board'"/>
                        </button>
                    </div>
                </div>

                <!-- ===================== PREVIEW STAGE ===================== -->
                <div class="nv-studio-stage">
                    <div class="nv-stage-bar">
                        <span class="nv-stage-live"><span class="nv-live-dot"/> Live preview · real data</span>
                        <span class="nv-flex-1"/>
                        <span class="nv-stage-scope" t-esc="stageNote"/>
                        <button class="nv-icon-btn" title="Refresh preview" t-on-click="() => this.preview(true)">
                            <i class="fa fa-refresh" t-att-class="state.previewBusy ? 'fa-spin' : ''"/>
                        </button>
                    </div>
                    <div class="nv-stage-canvas">
                        <div class="nv-card nv-stage-card nv-card-motion"
                             t-att-class="'nv-card-' + state.cfg.item_type"
                             t-att-style="stageStyle">
                            <div class="nv-card-head">
                                <span class="nv-card-dot"
                                      t-att-style="'background:' + (state.cfg.color or props.accent)"/>
                                <span class="nv-card-title" t-esc="state.cfg.name or 'New Widget'"/>
                                <span t-if="state.preview and state.preview.anomaly_count"
                                      class="nv-chip nv-chip-warn">
                                    <i class="fa fa-exclamation-triangle"/>
                                    <t t-esc="state.preview.anomaly_count"/>
                                </span>
                            </div>
                            <NovaBody meta="previewMeta" payload="state.previewBusy ? null : state.preview"
                                      motion="true"/>
                            <div t-if="state.preview and state.preview.insight" class="nv-card-insight">
                                <i class="fa fa-lightbulb-o"/>
                                <span t-esc="state.preview.insight"/>
                            </div>
                        </div>
                    </div>
                </div>

                <div t-if="state.confirm" class="nv-confirm-mask"
                     t-on-mousedown.self="() => state.confirm = false">
                    <div class="nv-confirm">
                        <div class="nv-confirm-icon"><i class="fa fa-exclamation-triangle"/></div>
                        <h4>Discard changes?</h4>
                        <p>Your widget configuration will be lost.</p>
                        <div class="nv-confirm-actions">
                            <button class="nv-btn" t-on-click="() => state.confirm = false">
                                Keep editing</button>
                            <button class="nv-btn nv-btn-danger" t-on-click="props.onClose">
                                <i class="fa fa-trash"/> Discard</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    static components = { NovaBody };
    static props = ["itemId", "dashboardId", "accent", "filters", "presets",
        "onClose", "onSaved", "onAI?"];

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.state = useState({
            tab: "data",
            cfg: {
                name: "", item_type: "kpi", icon: "fa-bolt", color: "",
                chart_palette: "theme",
                model_id: false, model_label: "", model_tech: "", domain: "",
                date_field_id: false, date_preset_item: "dashboard",
                agg: "count", measure_ids: [],
                scatter_x_field_id: false, scatter_y_field_id: false,
                group_field_id: false, group_granularity: "month",
                subgroup_field_id: false, subgroup_granularity: "month",
                record_limit: 0, sort_dir: "none",
                stacked: false, show_values: false, show_legend: true,
                cumulative: false, fill_gaps: true,
                value_style: "compact", unit_label: "", use_currency: false,
                show_records: true,
                enable_forecast: false, forecast_periods: 3,
                detect_anomalies: true, compare_previous_item: false,
                target_value: 0,
                alert_rule: "off", alert_value: 0, alert_color: "#FF5470",
                list_ids: [], text_content: "",
            },
            fields: { measures: [], groups: [], dates: [], columns: [] },
            modelQuery: "", modelOpts: [], modelOpen: false, modelTotal: 0,
            preview: null, previewBusy: false,
            saving: false, dirty: false, confirm: false,
        });
        this.nameRef = useRef("name");
        this._pvTimer = null;
        this._pvToken = 0;
        this._mTimer = null;
        this._esc = (ev) => {
            if (ev.key !== "Escape") return;
            if (this.state.confirm) this.state.confirm = false;
            else this.tryClose();
        };
        this._closeAuto = () => (this.state.modelOpen = false);

        onWillStart(async () => {
            if (this.props.itemId) {
                await this.hydrate(this.props.itemId);
            }
            this.preview(true);
        });
        onMounted(() => {
            window.addEventListener("keydown", this._esc);
            window.addEventListener("click", this._closeAuto);
            if (!this.props.itemId) {
                this.nameRef.el?.focus();
            }
        });
        onWillUnmount(() => {
            window.removeEventListener("keydown", this._esc);
            window.removeEventListener("click", this._closeAuto);
            if (this._pvTimer) clearTimeout(this._pvTimer);
            if (this._mTimer) clearTimeout(this._mTimer);
        });
    }

    /* ------------------------- hydration ------------------------- */
    async hydrate(itemId) {
        const [r] = await this.orm.read("nova.dashboard.item", [itemId], READ_FIELDS);
        const c = this.state.cfg;
        c.name = r.name || "";
        c.item_type = r.item_type;
        c.icon = r.icon || "fa-bolt";
        c.color = r.color || "";
        c.chart_palette = r.chart_palette || "theme";
        c.model_id = r.model_id ? r.model_id[0] : false;
        c.model_label = r.model_id ? r.model_id[1] : "";
        c.model_tech = r.model_name || "";
        c.domain = r.domain || "";
        c.date_field_id = r.date_field_id ? r.date_field_id[0] : false;
        c.date_preset_item = r.date_preset_item || "dashboard";
        c.agg = r.agg || "count";
        c.measure_ids = r.measure_field_ids || [];
        c.scatter_x_field_id = r.scatter_x_field_id ? r.scatter_x_field_id[0] : false;
        c.scatter_y_field_id = r.scatter_y_field_id ? r.scatter_y_field_id[0] : false;
        c.group_field_id = r.group_field_id ? r.group_field_id[0] : false;
        c.group_granularity = r.group_granularity || "month";
        c.subgroup_field_id = r.subgroup_field_id ? r.subgroup_field_id[0] : false;
        c.subgroup_granularity = r.subgroup_granularity || "month";
        c.record_limit = r.record_limit || 0;
        c.sort_dir = r.sort_dir || "none";
        c.stacked = !!r.stacked;
        c.show_values = !!r.show_values;
        c.show_legend = !!r.show_legend;
        c.cumulative = !!r.cumulative;
        c.fill_gaps = !!r.fill_gaps;
        c.value_style = r.value_style || "compact";
        c.unit_label = r.unit_label || "";
        c.use_currency = !!r.use_currency;
        c.show_records = !!r.show_records;
        c.enable_forecast = !!r.enable_forecast;
        c.forecast_periods = r.forecast_periods || 3;
        c.detect_anomalies = !!r.detect_anomalies;
        c.compare_previous_item = !!r.compare_previous_item;
        c.target_value = r.target_value || 0;
        c.alert_rule = r.alert_rule || "off";
        c.alert_value = r.alert_value || 0;
        c.alert_color = r.alert_color || "#FF5470";
        c.list_ids = r.list_field_ids || [];
        c.text_content = this.stripHtml(r.text_content);
        this.state.modelQuery = c.model_label;
        if (c.model_id) {
            await this.loadFields();
        }
    }

    stripHtml(html) {
        return html || "";
    }

    /* ------------------------- catalogs ------------------------- */
    get typeGroups() { return TYPE_GROUPS; }
    get icons() { return ICONS; }
    get accents() { return ACCENTS; }
    get aggs() { return AGGS; }
    get grans() { return GRANS; }
    get sorts() { return SORTS; }
    get styles() { return STYLES; }
    get paletteRows() {
        return PALETTE_DEFS.map(([key, label]) => ({
            key, label,
            colors: paletteFor(key, this.state.cfg.color || this.props.accent).slice(0, 6),
        }));
    }
    get scopeOptions() {
        const base = [{ key: "dashboard", label: "Follow dashboard filter" }];
        return base.concat((this.props.presets || []).filter((p) => p.key !== "custom"));
    }

    /* ------------------------- type logic ------------------------- */
    get t() { return this.state.cfg.item_type; }
    get needsModel() { return this.t !== "text" && this.t !== "todo"; }
    get isValue() { return VALUE_TYPES.has(this.t); }
    get isChartType() { return CHART_FAMILY.has(this.t) || this.t === "scatter"; }
    get isScatter() { return this.t === "scatter"; }
    get isList() { return this.t === "list"; }
    get isHeatmap() { return this.t === "heatmap"; }
    get needsGroup() { return NEEDS_GROUP.has(this.t); }
    get showMeasures() {
        return this.needsModel && !this.isScatter && !this.isList && this.t !== "todo";
    }
    get showPalette() {
        return CHART_FAMILY.has(this.t) || ["scatter", "funnel", "heatmap", "leaderboard"].includes(this.t);
    }
    get showLegendOpt() { return CHART_FAMILY.has(this.t) || this.isScatter; }
    get canSubgroup() {
        return this.isHeatmap || ["bar", "hbar", "line", "area", "radar"].includes(this.t);
    }
    get canStack() { return ["bar", "hbar", "line", "area"].includes(this.t); }
    get canTime() { return TIME_CHARTS.has(this.t) && this.groupIsDate; }
    get canForecast() { return this.canTime; }
    get canCompare() { return this.isValue || CHART_FAMILY.has(this.t); }

    fieldIn(list, id) {
        return (this.state.fields[list] || []).find((f) => f.id === id);
    }
    get groupIsDate() {
        const f = this.fieldIn("groups", this.state.cfg.group_field_id);
        return !!f && (f.ttype === "date" || f.ttype === "datetime");
    }
    get subgroupIsDate() {
        const f = this.fieldIn("groups", this.state.cfg.subgroup_field_id);
        return !!f && (f.ttype === "date" || f.ttype === "datetime");
    }
    get subgroupOptions() {
        return this.state.fields.groups.filter(
            (f) => f.id !== this.state.cfg.group_field_id);
    }

    get missing() {
        const c = this.state.cfg;
        const out = [];
        if (this.needsModel && !c.model_id) out.push("Pick a data model to feed this widget.");
        if (this.isScatter && (!c.scatter_x_field_id || !c.scatter_y_field_id)) {
            out.push("Scatter needs both X and Y measures.");
        }
        if (this.needsGroup && !this.isScatter && !c.group_field_id) {
            out.push("This widget needs a Group By field.");
        }
        if (this.isHeatmap && !c.subgroup_field_id) {
            out.push("Heatmap needs a column grouping too.");
        }
        if (this.isList && !c.list_ids.length) out.push("Pick at least one column.");
        return out;
    }

    /* ------------------------- preview ------------------------- */
    get previewMeta() {
        const c = this.state.cfg;
        return {
            id: 0,
            name: c.name || "New Widget",
            type: c.item_type,
            icon: c.icon || "fa-bolt",
            color: c.color || this.props.accent,
            palette: c.chart_palette,
            model: c.model_tech,
            pos: {},
            has_action: false,
        };
    }
    get stageStyle() {
        const SIZE = {
            kpi: [340, 230], tile: [340, 210], gauge: [360, 320], bullet: [430, 230],
            bar: [580, 390], hbar: [580, 390], line: [580, 390], area: [580, 390],
            waterfall: [580, 390], radar: [470, 410], scatter: [580, 390],
            pie: [470, 400], doughnut: [470, 400], polar: [470, 400],
            funnel: [470, 390], heatmap: [580, 410],
            leaderboard: [470, 430], list: [620, 430],
            todo: [390, 390], text: [430, 330],
        };
        const [w, h] = SIZE[this.t] || [520, 380];
        return `width:${w}px;height:${h}px;`;
    }
    get stageNote() {
        const c = this.state.cfg;
        if (!this.needsModel) return "";
        if (c.date_preset_item && c.date_preset_item !== "dashboard") {
            const p = this.scopeOptions.find((o) => o.key === c.date_preset_item);
            return p ? p.label : "";
        }
        const key = (this.props.filters || {}).preset;
        const p = (this.props.presets || []).find((o) => o.key === key);
        return p ? p.label + " (dashboard)" : "";
    }

    buildVals() {
        const c = this.state.cfg;
        return {
            dashboard_id: this.props.dashboardId,
            name: c.name || "New Widget",
            item_type: c.item_type,
            icon: c.icon || "fa-bolt",
            color: c.color || false,
            chart_palette: c.chart_palette,
            model_id: c.model_id || false,
            domain: c.domain || false,
            date_field_id: c.date_field_id || false,
            date_preset_item: c.date_preset_item,
            agg: c.agg,
            measure_field_ids: [[6, 0, c.measure_ids]],
            scatter_x_field_id: c.scatter_x_field_id || false,
            scatter_y_field_id: c.scatter_y_field_id || false,
            group_field_id: c.group_field_id || false,
            group_granularity: c.group_granularity,
            subgroup_field_id: c.subgroup_field_id || false,
            subgroup_granularity: c.subgroup_granularity,
            record_limit: c.record_limit || 0,
            sort_dir: c.sort_dir,
            stacked: c.stacked,
            show_values: c.show_values,
            show_legend: c.show_legend,
            cumulative: c.cumulative,
            fill_gaps: c.fill_gaps,
            value_style: c.value_style,
            unit_label: c.unit_label || false,
            use_currency: c.use_currency,
            show_records: c.show_records,
            enable_forecast: c.enable_forecast,
            forecast_periods: c.forecast_periods || 3,
            detect_anomalies: c.detect_anomalies,
            compare_previous_item: c.compare_previous_item,
            target_value: c.target_value || 0,
            alert_rule: c.alert_rule || "off",
            alert_value: c.alert_value || 0,
            alert_color: c.alert_color || "#FF5470",
            list_field_ids: [[6, 0, c.list_ids]],
            text_content: c.text_content || false,
        };
    }

    preview(immediate = false) {
        if (this._pvTimer) clearTimeout(this._pvTimer);
        this._pvTimer = setTimeout(() => this._doPreview(), immediate ? 0 : 420);
    }

    async _doPreview() {
        const token = ++this._pvToken;
        this.state.previewBusy = true;
        try {
            const payload = await this.orm.call(
                "nova.dashboard.item", "web_preview",
                [this.buildVals()], { filters: this.props.filters });
            if (token === this._pvToken) this.state.preview = payload;
        } catch (e) {
            if (token === this._pvToken) {
                this.state.preview = {
                    id: 0, type: this.t,
                    error: e.data?.message || e.message || "Preview failed",
                };
            }
        }
        if (token === this._pvToken) this.state.previewBusy = false;
    }

    /* ------------------------- mutations ------------------------- */
    set(key, value, refetch = true) {
        this.state.cfg[key] = value;
        this.state.dirty = true;
        if (refetch) this.preview();
    }
    pickOpt(key, ev) { this.set(key, ev.target.value); }
    pickField(key, ev) {
        const v = ev.target.value;
        this.set(key, v ? parseInt(v, 10) : false);
    }
    pickNum(key, ev) {
        const v = parseFloat(ev.target.value);
        this.set(key, isFinite(v) ? v : 0);
    }
    pickBool(key, ev) { this.set(key, ev.target.checked); }
    toggleIn(key, id) {
        const arr = this.state.cfg[key];
        const i = arr.indexOf(id);
        if (i >= 0) arr.splice(i, 1);
        else arr.push(id);
        this.set(key, arr);
    }

    pickType(key) {
        this.state.cfg.item_type = key;
        this.state.dirty = true;
        if (key === "list" && !this.state.cfg.record_limit) {
            this.state.cfg.record_limit = 8;
        }
        this.preview();
    }

    /* ------------------------- model picker ------------------------- */
    get modelCountLabel() {
        const n = this.state.modelOpts.length;
        const total = this.state.modelTotal;
        if (!n) return "Installed models";
        return total > n
            ? `${n} of ${total} installed models — type to narrow`
            : `${n} installed model${n > 1 ? "s" : ""}`;
    }

    onModelInput(ev) {
        ev.stopPropagation();
        if (ev.type === "input") {
            this.state.modelQuery = ev.target.value;
        }
        const opening = !this.state.modelOpen;
        this.state.modelOpen = true;
        if (this._mTimer) clearTimeout(this._mTimer);
        this._mTimer = setTimeout(async () => {
            const res = await this.orm.call(
                "nova.dashboard.item", "web_search_models",
                [this.state.modelQuery]);
            this.state.modelOpts = res.rows || [];
            this.state.modelTotal = res.total || 0;
        }, opening && !this.state.modelQuery ? 0 : 200);
    }
    async pickModel(m) {
        const c = this.state.cfg;
        c.model_id = m.id;
        c.model_label = m.name;
        c.model_tech = m.model;
        this.state.modelQuery = m.name;
        this.state.modelOpen = false;
        c.date_field_id = c.group_field_id = c.subgroup_field_id = false;
        c.scatter_x_field_id = c.scatter_y_field_id = false;
        c.measure_ids = [];
        c.list_ids = [];
        c.domain = "";
        this.state.dirty = true;
        await this.loadFields();
        this.autoPickDate();
        this.preview(true);
    }
    clearModel() {
        const c = this.state.cfg;
        c.model_id = false;
        c.model_label = "";
        c.model_tech = "";
        this.state.modelQuery = "";
        this.state.fields = { measures: [], groups: [], dates: [], columns: [] };
        this.set("group_field_id", false);
    }
    async loadFields() {
        this.state.fields = await this.orm.call(
            "nova.dashboard.item", "web_model_fields", [this.state.cfg.model_id]);
    }
    autoPickDate() {
        if (this.state.cfg.date_field_id) return;
        const prefs = ["date_order", "date", "create_date"];
        for (const name of prefs) {
            const f = this.state.fields.dates.find((d) => d.name === name);
            if (f) {
                this.state.cfg.date_field_id = f.id;
                return;
            }
        }
    }

    /* ------------------------- save / close ------------------------- */
    async save() {
        if (this.missing.length || this.state.saving) return;
        this.state.saving = true;
        try {
            if (this.props.itemId) {
                await this.orm.write("nova.dashboard.item", [this.props.itemId],
                    this.buildVals());
            } else {
                await this.orm.create("nova.dashboard.item", [this.buildVals()]);
            }
            this.notification.add(
                this.props.itemId ? "Widget updated." : "Widget added to the board.",
                { type: "success" });
            this.props.onSaved();
        } catch (e) {
            this.notification.add(
                e.data?.message || e.message || "Could not save the widget.",
                { type: "danger" });
            this.state.saving = false;
        }
    }

    tryClose() {
        if (!this.state.dirty) {
            this.props.onClose();
            return;
        }
        this.state.confirm = true;
    }
}
