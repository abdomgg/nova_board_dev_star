# -*- coding: utf-8 -*-
{
    'name': 'NovaBoard — Intelligent Dashboard Studio',
    'summary': """
NovaBoard is a next-generation analytics studio for Odoo 18: cinematic motion design,
glassmorphism themes, 20+ widget types, built-in forecasting, anomaly detection and
natural-language insights — with zero external dependencies. Dashboard, KPI, Charts,
Funnel, Gauge, Heatmap, Waterfall, Bullet, Smart Insights, Predictive Analytics,
TV Mode, Dashboard Builder, Dashboard Studio.
""",
    'description': """
NovaBoard v18.0 — Intelligent Dashboard Studio
==============================================
* 20+ live widget types rendered with hardware-accelerated motion
* Built-in analytics brain: linear-regression forecasting with confidence bands,
  z-score anomaly detection, automatic narrative insights, period-over-period deltas
* 5 cinematic themes (Aurora, Daylight, Nebula, Carbon, Solar) + per-board accent color
* Custom collision-aware drag & resize grid engine — no gridstack, no jQuery
* Charts powered by Odoo's own bundled Chart.js — no third-party JS shipped
* Smart date intelligence: 18 presets, custom ranges, previous-period comparison,
  temporal gap filling, timezone-correct bucketing
* NovaMind AI copilot: build entire dashboards, add widgets, restyle and ask
  data questions in plain language — built-in offline brain, optional
  OpenAI-compatible LLM via System Parameters (nova_dashboard.ai_key)
* Packaged blueprint dashboards (Sales Command Center, CRM Pipeline
  Intelligence) auto-installed when the apps are present
* n8n automation bridge: scheduled webhook pushes of KPIs, insights and
  anomaly digests + one-click test
* Single round-trip batch loading for whole boards
* One-click adaptive Showcase generator (detects installed apps)
* Auto menu creation, group-based access, multi-company aware
* JSON export / import, per-widget PNG & CSV export, TV / fullscreen mode,
  auto-refresh intervals, drill-down click-through to records
* Zero external Python dependencies. Installs anywhere.
""",
    'author': 'Abdulfattah',
    "support": "abdogabr354@gmail.com",
    "price": 249.00,
    "currency": "USD",
    'license': 'LGPL-3',
    'category': 'Productivity/Dashboards',
    'version': '18.0.1.0.0',
    'depends': ['web', 'base_setup'],
    'data': [
        'security/nova_security.xml',
        'security/ir.model.access.csv',
        'data/nova_cron.xml',
        'views/nova_item_views.xml',
        'views/nova_dashboard_views.xml',
        'views/nova_menus.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'nova_dashboard/static/src/scss/nova.scss',
            'nova_dashboard/static/src/js/**/*.js',
        ],
    },
    "images": ["static/description/banner.png"],
    'post_init_hook': 'post_init_hook',
    'uninstall_hook': 'uninstall_hook',
    'application': True,
    'installable': True,
}
