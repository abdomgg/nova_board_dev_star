/** NovaGrid — collision-aware drag & resize grid engine (gridstack replacement). */
import { Component, useRef, useState, onMounted, onWillUpdateProps, onWillUnmount, xml } from "@odoo/owl";

const COLS = 12;
const ROW_H = 26;
const GAP = 14;

export class NovaGrid extends Component {
    static template = xml`
        <div class="nv-grid" t-ref="root" t-att-class="props.editMode ? 'nv-grid-edit' : ''"
             t-att-style="gridStyle()">
            <div t-if="props.editMode and state.ghost" class="nv-ghost" t-att-style="ghostStyle()"/>
            <t t-foreach="props.items" t-as="item" t-key="item.id">
                <div class="nv-cell" t-att-data-item="item.id"
                     t-att-class="cellClass(item)"
                     t-att-style="cellStyle(item)">
                    <div t-if="props.editMode" class="nv-drag-bar" title="Drag to move"
                         t-on-pointerdown="(ev) => this.startDrag(ev, item.id)">
                        <i class="fa fa-arrows"/>
                    </div>
                    <t t-slot="cell" item="item"/>
                    <div t-if="props.editMode" class="nv-resize"
                         t-on-pointerdown="(ev) => this.startResize(ev, item.id)">
                        <i class="fa fa-caret-down fa-rotate-315"/>
                    </div>
                </div>
            </t>
        </div>`;
    static props = ["items", "layout", "editMode", "onLayoutChange", "slots", "motion"];

    setup() {
        this.rootRef = useRef("root");
        this.state = useState({ ghost: null, activeId: null, tick: 0 });
        this.layout = {}; // id -> {x,y,w,h}
        this.drag = null;
        this._onMove = this.onPointerMove.bind(this);
        this._onUp = this.onPointerUp.bind(this);
        this.syncLayout(this.props.layout);
        onMounted(() => {
            this.syncLayout(this.props.layout);
            this.state.tick++;
        });
        onWillUpdateProps((next) => {
            this.syncLayout(next.layout, next.items);
            this.state.tick++;
        });
        onWillUnmount(() => this.unbind());
    }

    syncLayout(layout, items = this.props.items) {
        const incoming = layout || {};
        const fresh = {};
        for (const item of items) {
            const pos = incoming[String(item.id)] || this.layout[item.id] ||
                { x: 0, y: 9999, w: 4, h: 6 };
            fresh[item.id] = {
                x: Math.max(0, Math.min(COLS - 1, pos.x | 0)),
                y: Math.max(0, pos.y | 0),
                w: Math.max(2, Math.min(COLS, pos.w | 0)),
                h: Math.max(3, pos.h | 0),
            };
            if (fresh[item.id].x + fresh[item.id].w > COLS) {
                fresh[item.id].x = COLS - fresh[item.id].w;
            }
        }
        this.layout = fresh;
        this.compact();
    }

    // ----- geometry --------------------------------------------------- //
    cellW() {
        const el = this.rootRef.el;
        const width = el ? el.clientWidth : 1200;
        return (width - GAP * (COLS - 1)) / COLS;
    }
    pxX(x) { return x * (this.cellW() + GAP); }
    pxY(y) { return y * (ROW_H + GAP); }
    pxW(w) { return w * this.cellW() + (w - 1) * GAP; }
    pxH(h) { return h * ROW_H + (h - 1) * GAP; }

    totalRows() {
        let max = 0;
        for (const id in this.layout) {
            const p = this.layout[id];
            max = Math.max(max, p.y + p.h);
        }
        return max + (this.props.editMode ? 8 : 0);
    }

    gridStyle() {
        this.state.tick; // reactive dep
        return `height:${this.pxY(this.totalRows()) + ROW_H}px;`;
    }

    cellStyle(item) {
        this.state.tick;
        const p = this.layout[item.id];
        if (!p) return "";
        const dragging = this.state.activeId === item.id && this.drag && this.drag.px;
        if (dragging) {
            return `transform:translate(${this.drag.px.x}px,${this.drag.px.y}px);` +
                   `width:${this.drag.px.w}px;height:${this.drag.px.h}px;z-index:50;` +
                   `transition:none;`;
        }
        return `transform:translate(${this.pxX(p.x)}px,${this.pxY(p.y)}px);` +
               `width:${this.pxW(p.w)}px;height:${this.pxH(p.h)}px;`;
    }

    cellClass(item) {
        const cls = [];
        if (this.state.activeId === item.id) cls.push("nv-cell-active");
        if (this.props.motion) cls.push("nv-cell-motion");
        return cls.join(" ");
    }

    ghostStyle() {
        const g = this.state.ghost;
        if (!g) return "display:none";
        return `transform:translate(${this.pxX(g.x)}px,${this.pxY(g.y)}px);` +
               `width:${this.pxW(g.w)}px;height:${this.pxH(g.h)}px;`;
    }

    // ----- collisions -------------------------------------------------- //
    overlaps(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    /** Push colliding items down, cascading. */
    resolve(movedId) {
        const ids = Object.keys(this.layout)
            .sort((a, b) => this.layout[a].y - this.layout[b].y || this.layout[a].x - this.layout[b].x);
        let guard = 0;
        let changed = true;
        while (changed && guard++ < 200) {
            changed = false;
            for (const id of ids) {
                if (id === String(movedId)) continue;
                const p = this.layout[id];
                for (const other of ids) {
                    if (other === id) continue;
                    const q = this.layout[other];
                    const otherIsMoved = other === String(movedId);
                    if (this.overlaps(p, q) && (otherIsMoved || q.y <= p.y)) {
                        p.y = q.y + q.h;
                        changed = true;
                    }
                }
            }
        }
    }

    /** Gravity: pull everything up into the first free slot. */
    compact() {
        const ids = Object.keys(this.layout)
            .sort((a, b) => this.layout[a].y - this.layout[b].y || this.layout[a].x - this.layout[b].x);
        for (const id of ids) {
            const p = this.layout[id];
            while (p.y > 0) {
                const test = { ...p, y: p.y - 1 };
                const hit = ids.some((o) => o !== id && this.overlaps(test, this.layout[o]));
                if (hit) break;
                p.y -= 1;
            }
        }
    }

    // ----- interactions ------------------------------------------------ //
    bind() {
        window.addEventListener("pointermove", this._onMove);
        window.addEventListener("pointerup", this._onUp, { once: true });
    }
    unbind() {
        window.removeEventListener("pointermove", this._onMove);
        window.removeEventListener("pointerup", this._onUp);
    }

    startDrag(ev, id) {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const p = this.layout[id];
        this.drag = {
            mode: "move", id,
            startX: ev.clientX, startY: ev.clientY,
            orig: { ...p },
            px: { x: this.pxX(p.x), y: this.pxY(p.y), w: this.pxW(p.w), h: this.pxH(p.h) },
        };
        this.state.activeId = id;
        this.state.ghost = { ...p };
        this.bind();
    }

    startResize(ev, id) {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        const p = this.layout[id];
        this.drag = {
            mode: "resize", id,
            startX: ev.clientX, startY: ev.clientY,
            orig: { ...p },
            px: { x: this.pxX(p.x), y: this.pxY(p.y), w: this.pxW(p.w), h: this.pxH(p.h) },
        };
        this.state.activeId = id;
        this.state.ghost = { ...p };
        this.bind();
    }

    onPointerMove(ev) {
        if (!this.drag) return;
        const dx = ev.clientX - this.drag.startX;
        const dy = ev.clientY - this.drag.startY;
        const o = this.drag.orig;
        if (this.drag.mode === "move") {
            this.drag.px = {
                x: this.pxX(o.x) + dx, y: Math.max(0, this.pxY(o.y) + dy),
                w: this.pxW(o.w), h: this.pxH(o.h),
            };
            const gx = Math.round(this.drag.px.x / (this.cellW() + GAP));
            const gy = Math.round(this.drag.px.y / (ROW_H + GAP));
            this.placeGhost(gx, gy, o.w, o.h);
        } else {
            this.drag.px = {
                x: this.pxX(o.x), y: this.pxY(o.y),
                w: Math.max(this.pxW(2), this.pxW(o.w) + dx),
                h: Math.max(this.pxH(3), this.pxH(o.h) + dy),
            };
            const gw = Math.max(2, Math.round((this.drag.px.w + GAP) / (this.cellW() + GAP)));
            const gh = Math.max(3, Math.round((this.drag.px.h + GAP) / (ROW_H + GAP)));
            this.placeGhost(o.x, o.y, gw, gh);
        }
        this.state.tick++;
    }

    placeGhost(x, y, w, h) {
        w = Math.max(2, Math.min(COLS, w));
        x = Math.max(0, Math.min(COLS - w, x));
        y = Math.max(0, y);
        const g = this.state.ghost;
        if (g && g.x === x && g.y === y && g.w === w && g.h === h) return;
        this.state.ghost = { x, y, w, h };
        this.layout[this.drag.id] = { x, y, w, h };
        this.resolve(this.drag.id);
        this.compact();
        // keep dragged item where the ghost decided after compaction
        this.layout[this.drag.id] = { ...this.state.ghost, y: this.layout[this.drag.id].y };
        this.state.ghost = { ...this.layout[this.drag.id] };
    }

    onPointerUp() {
        if (!this.drag) return;
        this.unbind();
        this.drag = null;
        this.state.activeId = null;
        this.state.ghost = null;
        this.compact();
        this.state.tick++;
        const snapshot = {};
        for (const id in this.layout) snapshot[id] = { ...this.layout[id] };
        this.props.onLayoutChange(snapshot);
    }
}
