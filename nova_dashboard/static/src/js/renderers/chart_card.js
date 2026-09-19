/** NovaChart — Chart.js v4 renderer (uses Odoo's own bundled chartjs, no vendored libs). */
import { Component, useRef, onMounted, onWillUnmount, onWillUpdateProps, xml } from "@odoo/owl";
import { loadBundle } from "@web/core/assets";
import { paletteFor, hexToRgba, compact } from "../nova_utils";

export class NovaChart extends Component {
    static template = xml`
        <div class="nv-chart-wrap">
            <canvas t-ref="canvas"/>
        </div>`;
    static props = ["payload", "meta", "motion", "onSlice?"];

    setup() {
        this.canvasRef = useRef("canvas");
        this.chart = null;
        onMounted(async () => {
            await loadBundle("web.chartjs_lib");
            this.render(this.props);
        });
        onWillUpdateProps((next) => {
            if (window.Chart) {
                this.render(next);
            }
        });
        onWillUnmount(() => this.destroy());
    }

    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }

    cssVar(name, fallback) {
        const root = this.canvasRef.el?.closest(".nv-root");
        const v = root ? getComputedStyle(root).getPropertyValue(name).trim() : "";
        return v || fallback;
    }

    render(props) {
        const canvas = this.canvasRef.el;
        if (!canvas || !window.Chart) return;
        this.destroy();
        const { payload, meta, motion } = props;
        const data = payload.chart || {};
        const type = payload.type;
        const palette = paletteFor(meta.palette, meta.color);
        const ink = this.cssVar("--nv-ink-soft", "#9aa3b5");
        const gridCol = this.cssVar("--nv-grid-line", "rgba(148,163,184,.12)");
        const ctx = canvas.getContext("2d");
        const fmt = (v) =>
            (data.currency || "") +
            (data.value_style === "full" ? Number(v).toLocaleString() : compact(v));

        const cfg =
            type === "scatter"
                ? this.scatterConfig(data, palette, ink, gridCol)
                : type === "radar"
                ? this.radarConfig(data, palette, ink, gridCol, fmt)
                : ["pie", "doughnut", "polar"].includes(type)
                ? this.circleConfig(type, data, palette, ink, fmt)
                : this.axisConfig(type, data, palette, ink, gridCol, ctx, canvas, fmt);

        cfg.options.animation = motion
            ? { duration: 900, easing: "easeOutQuart" }
            : false;
        cfg.options.responsive = true;
        cfg.options.maintainAspectRatio = false;
        cfg.options.onClick = (ev, els) => {
            if (!els.length || !props.onSlice) return;
            const idx = els[0].index;
            props.onSlice(idx);
        };
        cfg.options.onHover = (ev, els) => {
            ev.native.target.style.cursor =
                els.length && props.onSlice ? "pointer" : "default";
        };
        this.chart = new window.Chart(ctx, cfg);
    }

    // ------------------------------------------------------------------ //
    axisConfig(type, data, palette, ink, gridCol, ctx, canvas, fmt) {
        const horizontal = type === "hbar";
        const isLine = type === "line" || type === "area";
        const isWaterfall = type === "waterfall";
        const labels = [...(data.labels || [])];
        const fc = data.forecast;
        if (fc) labels.push(...fc.labels);
        const n = (data.labels || []).length;

        const datasets = (data.datasets || []).map((ds, i) => {
            const base = palette[i % palette.length];
            const grad = ctx.createLinearGradient(0, 0, 0, canvas.height || 280);
            grad.addColorStop(0, hexToRgba(base, isLine ? 0.35 : 0.95));
            grad.addColorStop(1, hexToRgba(base, isLine ? 0.02 : 0.55));
            const out = {
                label: ds.label,
                data: fc ? [...ds.data, ...fc.labels.map(() => null)] : ds.data,
                borderColor: base,
                backgroundColor: isLine ? grad : isWaterfall ? undefined : grad,
                borderWidth: isLine ? 2.5 : 0,
                borderRadius: isLine ? 0 : 7,
                borderSkipped: false,
                tension: 0.38,
                fill: type === "area",
                pointRadius: isLine ? 2.5 : 0,
                pointHoverRadius: 5,
                pointBackgroundColor: base,
                maxBarThickness: 46,
            };
            if (isWaterfall && ds.wf_colors) {
                const C = {
                    pos: this.cssVar("--nv-good", "#22C7A9"),
                    neg: this.cssVar("--nv-bad", "#FF6B8A"),
                    total: palette[0],
                };
                out.backgroundColor = ds.wf_colors.map((c) => hexToRgba(C[c], 0.9));
                out.borderColor = ds.wf_colors.map((c) => C[c]);
                out.borderWidth = 1;
            }
            // anomaly highlighting on the primary dataset
            if (i === 0 && (data.anomalies || []).length && isLine) {
                const bad = this.cssVar("--nv-bad", "#FF6B8A");
                out.pointRadius = ds.data.map((_, j) =>
                    data.anomalies.includes(j) ? 6 : 2.5
                );
                out.pointBackgroundColor = ds.data.map((_, j) =>
                    data.anomalies.includes(j) ? bad : base
                );
                out.pointBorderColor = out.pointBackgroundColor;
            }
            return out;
        });

        if (data.previous) {
            datasets.push({
                label: data.previous.label,
                data: fc
                    ? [...data.previous.data, ...fc.labels.map(() => null)]
                    : data.previous.data,
                borderColor: hexToRgba(ink, 0.65),
                backgroundColor: "transparent",
                borderWidth: 2,
                borderDash: [6, 5],
                tension: 0.38,
                pointRadius: 0,
                type: "line",
                fill: false,
            });
        }

        if (fc) {
            const base = palette[0];
            const pad = (arr) => [...Array(n - 1).fill(null),
                datasets[0]?.data?.[n - 1] ?? null, ...arr];
            datasets.push(
                {
                    label: "Forecast",
                    data: pad(fc.points),
                    borderColor: base,
                    borderWidth: 2.5,
                    borderDash: [7, 6],
                    pointRadius: 3,
                    pointStyle: "rectRot",
                    pointBackgroundColor: base,
                    backgroundColor: "transparent",
                    tension: 0.3,
                    type: "line",
                    fill: false,
                },
                {
                    label: "_band_hi",
                    data: pad(fc.upper),
                    borderColor: "transparent",
                    pointRadius: 0,
                    backgroundColor: hexToRgba(base, 0.12),
                    tension: 0.3,
                    type: "line",
                    fill: "+1",
                },
                {
                    label: "_band_lo",
                    data: pad(fc.lower),
                    borderColor: "transparent",
                    pointRadius: 0,
                    backgroundColor: "transparent",
                    tension: 0.3,
                    type: "line",
                    fill: false,
                }
            );
        }

        const valueAxis = {
            grid: { color: gridCol, drawBorder: false },
            ticks: { color: ink, font: { size: 11 }, callback: (v) => fmt(v) },
            border: { display: false },
            stacked: data.stacked,
        };
        const catAxis = {
            grid: { display: false },
            ticks: {
                color: ink,
                font: { size: 11 },
                autoSkip: true,
                maxRotation: 38,
            },
            border: { display: false },
            stacked: data.stacked,
        };

        return {
            type: isLine ? "line" : "bar",
            data: { labels, datasets },
            options: {
                indexAxis: horizontal ? "y" : "x",
                interaction: { mode: "index", intersect: false },
                scales: horizontal
                    ? { x: valueAxis, y: catAxis }
                    : { x: catAxis, y: valueAxis },
                plugins: this.pluginOpts(data, ink, fmt, isWaterfall),
            },
        };
    }

    circleConfig(type, data, palette, ink, fmt) {
        const ds = (data.datasets || [])[0] || { data: [] };
        return {
            type: type === "polar" ? "polarArea" : type,
            data: {
                labels: data.labels || [],
                datasets: [
                    {
                        data: ds.data,
                        backgroundColor: (data.labels || []).map((_, i) =>
                            hexToRgba(palette[i % palette.length], 0.88)
                        ),
                        borderColor: this.cssVar("--nv-card-bg", "rgba(20,22,38,.6)"),
                        borderWidth: 2,
                        hoverOffset: 10,
                    },
                ],
            },
            options: {
                cutout: type === "doughnut" ? "62%" : undefined,
                scales:
                    type === "polar"
                        ? { r: { ticks: { display: false }, grid: { color: "rgba(148,163,184,.15)" } } }
                        : {},
                plugins: this.pluginOpts(data, ink, fmt, false, true),
            },
        };
    }

    radarConfig(data, palette, ink, gridCol, fmt) {
        return {
            type: "radar",
            data: {
                labels: data.labels || [],
                datasets: (data.datasets || []).map((ds, i) => {
                    const c = palette[i % palette.length];
                    return {
                        label: ds.label,
                        data: ds.data,
                        borderColor: c,
                        backgroundColor: hexToRgba(c, 0.18),
                        pointBackgroundColor: c,
                        pointRadius: 3,
                        borderWidth: 2,
                    };
                }),
            },
            options: {
                scales: {
                    r: {
                        grid: { color: gridCol },
                        angleLines: { color: gridCol },
                        pointLabels: { color: ink, font: { size: 11 } },
                        ticks: { color: ink, backdropColor: "transparent",
                                 callback: (v) => fmt(v) },
                    },
                },
                plugins: this.pluginOpts(data, ink, fmt, false),
            },
        };
    }

    scatterConfig(data, palette, ink, gridCol) {
        return {
            type: "scatter",
            data: {
                datasets: (data.datasets || []).map((ds, i) => ({
                    label: ds.label,
                    data: ds.data,
                    backgroundColor: hexToRgba(palette[i % palette.length], 0.75),
                    borderColor: palette[i % palette.length],
                    pointRadius: 4.5,
                    pointHoverRadius: 7,
                })),
            },
            options: {
                scales: {
                    x: {
                        title: { display: !!data.x_label, text: data.x_label, color: ink },
                        grid: { color: gridCol }, ticks: { color: ink },
                        border: { display: false },
                    },
                    y: {
                        title: { display: !!data.y_label, text: data.y_label, color: ink },
                        grid: { color: gridCol }, ticks: { color: ink },
                        border: { display: false },
                    },
                },
                plugins: {
                    legend: {
                        display: data.show_legend && (data.datasets || []).length > 1,
                        labels: { color: ink, usePointStyle: true, boxWidth: 8 },
                    },
                },
            },
        };
    }

    pluginOpts(data, ink, fmt, isWaterfall, isCircle = false) {
        return {
            legend: {
                display: !!data.show_legend &&
                    (isCircle || (data.datasets || []).length + (data.previous ? 1 : 0) > 1),
                position: isCircle ? "right" : "top",
                labels: {
                    color: ink, usePointStyle: true, boxWidth: 8,
                    font: { size: 11 },
                    filter: (it) => !String(it.text).startsWith("_band"),
                },
            },
            tooltip: {
                backgroundColor: "rgba(12,14,26,.92)",
                borderColor: "rgba(148,163,184,.25)",
                borderWidth: 1,
                padding: 10,
                cornerRadius: 10,
                titleColor: "#fff",
                bodyColor: "#dbe2f0",
                filter: (it) => !String(it.dataset.label || "").startsWith("_band"),
                callbacks: {
                    label: (c) => {
                        let v = c.raw;
                        if (isWaterfall && Array.isArray(v)) v = v[1] - v[0];
                        if (v && typeof v === "object") return ` ${c.dataset.label}`;
                        return ` ${c.dataset.label || c.label}: ${fmt(v ?? 0)}`;
                    },
                },
            },
        };
    }
}
