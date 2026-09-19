/** Nova data cards — leaderboard, list, todo, text. */
import { Component, useState, xml } from "@odoo/owl";
import { hexToRgba, shiftHue } from "../nova_utils";

/* ------------------------------------------------------------------ */
export class NovaLeaderboard extends Component {
    static template = xml`
        <div class="nv-board">
            <div t-foreach="entries" t-as="e" t-key="e.rank" class="nv-board-row"
                 t-att-class="rowClass(e)"
                 t-att-style="'--i:' + e_index"
                 t-on-click="() => this.open(e)">
                <span class="nv-board-rank" t-att-class="'nv-rank-' + e.rank" t-esc="e.rank"/>
                <div class="nv-board-mid">
                    <div class="nv-board-head">
                        <span class="nv-board-label" t-esc="e.label"/>
                        <span class="nv-board-val" t-esc="e.formatted"/>
                    </div>
                    <div class="nv-board-track">
                        <div class="nv-board-fill" t-att-class="props.motion ? 'nv-anim' : ''"
                             t-att-style="fillStyle(e, e_index)"/>
                    </div>
                </div>
                <span t-if="e.delta !== null and e.delta !== undefined" class="nv-delta nv-delta-sm"
                      t-att-class="e.delta >= 0 ? 'nv-up' : 'nv-down'">
                    <i t-att-class="'fa ' + (e.delta >= 0 ? 'fa-caret-up' : 'fa-caret-down')"/>
                    <t t-esc="absD(e)"/>%
                </span>
            </div>
            <div t-if="!entries.length" class="nv-empty">No data in this period</div>
        </div>`;
    static props = ["payload", "meta", "motion", "onSlice?"];

    get entries() {
        return (this.props.payload.board || {}).entries || [];
    }
    absD(e) {
        return Math.abs(e.delta ?? 0);
    }
    rowClass(e) {
        let c = this.props.motion ? "nv-stagger" : "";
        if (this.props.onSlice && e.domain?.length) c += " nv-clickable";
        return c;
    }
    fillStyle(e, i) {
        const c = this.props.meta.color || "#7C6CFF";
        return (
            `width:${Math.max(2, e.pct)}%;` +
            `background:linear-gradient(90deg, ${hexToRgba(c, 0.95)}, ` +
            `${hexToRgba(shiftHue(c, 25 + i * 9), 0.75)});`
        );
    }
    open(e) {
        if (this.props.onSlice && e.domain?.length) this.props.onSlice(e.domain);
    }
}

/* ------------------------------------------------------------------ */
export class NovaList extends Component {
    static template = xml`
        <div class="nv-list">
            <div class="nv-list-scroll">
                <table class="nv-table">
                    <thead>
                        <tr>
                            <th t-foreach="list.headers" t-as="h" t-key="h_index"
                                t-att-class="props.onSort ? 'nv-th-sort' : ''"
                                t-att-title="props.onSort ? 'Sort by ' + h : ''"
                                t-on-click="() => this.sortBy(h_index)">
                                <t t-esc="h"/>
                                <i t-if="sortIcon(h_index)" t-att-class="'fa ' + sortIcon(h_index)"/>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr t-foreach="list.rows" t-as="r" t-key="r.id"
                            t-att-class="rowClass(r_index)"
                            t-att-style="'--i:' + r_index"
                            t-on-click="() => this.open(r)">
                            <td t-foreach="r.cells" t-as="c" t-key="c_index" t-esc="c"/>
                        </tr>
                    </tbody>
                    <tfoot t-if="list.totals">
                        <tr class="nv-list-totals" title="Grand totals across every matching record">
                            <td t-foreach="list.totals" t-as="tt" t-key="tt_index">
                                <t t-if="tt_index === 0 and !tt">Σ Total</t>
                                <t t-else="" t-esc="tt"/>
                            </td>
                        </tr>
                    </tfoot>
                </table>
                <div t-if="!list.rows.length" class="nv-empty">No records</div>
            </div>
            <div t-if="pages > 1" class="nv-list-pager">
                <button class="nv-icon-btn" t-att-disabled="page &lt;= 1"
                        t-on-click="() => this.go(-1)"><i class="fa fa-chevron-left"/></button>
                <span class="nv-pager-text"><t t-esc="page"/> / <t t-esc="pages"/></span>
                <button class="nv-icon-btn" t-att-disabled="page >= pages"
                        t-on-click="() => this.go(1)"><i class="fa fa-chevron-right"/></button>
            </div>
        </div>`;
    static props = ["payload", "meta", "motion", "onPage?", "onRecord?", "onSort?"];

    get list() {
        return this.props.payload.list || { headers: [], rows: [], total: 0, limit: 12, offset: 0 };
    }
    get page() {
        return Math.floor(this.list.offset / (this.list.limit || 1)) + 1;
    }
    get pages() {
        return Math.max(1, Math.ceil((this.list.total || 0) / (this.list.limit || 1)));
    }
    rowClass(i) {
        let c = this.props.motion ? "nv-stagger" : "";
        if (this.props.onRecord) c += " nv-clickable";
        return c;
    }
    sortIcon(i) {
        const srt = this.list.sort || {};
        const f = (this.list.fields || [])[i];
        if (!f || srt.field !== f) return "";
        return srt.dir === "asc" ? "fa-caret-up" : "fa-caret-down";
    }

    sortBy(i) {
        if (!this.props.onSort) return;
        const f = (this.list.fields || [])[i];
        if (!f) return;
        const srt = this.list.sort || {};
        const dir = srt.field === f && srt.dir === "desc" ? "asc" : "desc";
        this.props.onSort({ field: f, dir });
    }

    go(dir) {
        if (this.props.onPage) {
            this.props.onPage({
                offset: this.list.offset + dir * this.list.limit,
                sort: this.list.sort || {},
            });
        }
    }
    open(r) {
        if (this.props.onRecord) this.props.onRecord(r.id);
    }
}

/* ------------------------------------------------------------------ */
export class NovaTodo extends Component {
    static template = xml`
        <div class="nv-todo">
            <div class="nv-todo-lines">
                <label t-foreach="lines" t-as="l" t-key="l.id" class="nv-todo-line"
                       t-att-class="(l.done ? 'nv-done ' : '') + (props.motion ? 'nv-stagger' : '')"
                       t-att-style="'--i:' + l_index">
                    <input type="checkbox" t-att-checked="l.done"
                           t-on-change="() => this.toggle(l)"/>
                    <span class="nv-todo-check"><i class="fa fa-check"/></span>
                    <span class="nv-todo-text" t-esc="l.name"/>
                </label>
                <div t-if="!lines.length" class="nv-empty">Nothing here — add a task below</div>
            </div>
            <div class="nv-todo-add">
                <input type="text" placeholder="Add a task…" t-model="state.draft"
                       t-on-keydown="onKey"/>
                <button class="nv-icon-btn" t-on-click="add"><i class="fa fa-plus"/></button>
            </div>
        </div>`;
    static props = ["payload", "meta", "motion", "onToggle", "onAdd"];

    setup() {
        this.state = useState({ draft: "" });
    }
    get lines() {
        return (this.props.payload.todo || {}).lines || [];
    }
    toggle(l) {
        this.props.onToggle(l.id);
    }
    onKey(ev) {
        if (ev.key === "Enter") this.add();
    }
    add() {
        const name = this.state.draft.trim();
        if (!name) return;
        this.state.draft = "";
        this.props.onAdd(name);
    }
}

/* ------------------------------------------------------------------ */
export class NovaText extends Component {
    static template = xml`
        <div class="nv-text" t-out="html"/>`;
    static props = ["payload", "meta", "motion"];

    get html() {
        // text_content is an Odoo Html (sanitized) field — safe to inject.
        return (this.props.payload.text || {}).html || "";
    }
}
