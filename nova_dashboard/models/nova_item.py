# -*- coding: utf-8 -*-
import json
from datetime import timedelta

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError
from odoo.osv import expression

from .nova_engine import DATE_PRESETS

ITEM_TYPES = [
    ('kpi', 'KPI Card'),
    ('tile', 'Tile'),
    ('gauge', 'Gauge'),
    ('bullet', 'Bullet'),
    ('bar', 'Bar Chart'),
    ('hbar', 'Horizontal Bar'),
    ('line', 'Line Chart'),
    ('area', 'Area Chart'),
    ('waterfall', 'Waterfall'),
    ('pie', 'Pie Chart'),
    ('doughnut', 'Doughnut'),
    ('polar', 'Polar Area'),
    ('radar', 'Radar'),
    ('scatter', 'Scatter Plot'),
    ('funnel', 'Funnel'),
    ('heatmap', 'Heatmap'),
    ('leaderboard', 'Leaderboard'),
    ('list', 'Record List'),
    ('todo', 'To-Do'),
    ('text', 'Text / Note'),
]
CHART_TYPES = ('bar', 'hbar', 'line', 'area', 'waterfall', 'pie', 'doughnut',
               'polar', 'radar')
CIRCLE_TYPES = ('pie', 'doughnut', 'polar')
VALUE_TYPES = ('kpi', 'tile', 'gauge', 'bullet')
NEEDS_GROUP = CHART_TYPES + ('funnel', 'heatmap', 'leaderboard')

PALETTES = [
    ('theme', 'Theme Default'), ('vivid', 'Vivid'), ('ocean', 'Ocean'),
    ('sunset', 'Sunset'), ('forest', 'Forest'), ('candy', 'Candy'), ('mono', 'Mono'),
]
GRANS = [('hour', 'Hour'), ('day', 'Day'), ('week', 'Week'),
         ('month', 'Month'), ('quarter', 'Quarter'), ('year', 'Year')]

ITEM_PRESETS = [('dashboard', 'Follow Dashboard Filter')] + [
    p for p in DATE_PRESETS if p[0] != 'custom']


class NovaDashboardItem(models.Model):
    _name = 'nova.dashboard.item'
    _description = 'NovaBoard Widget'
    _order = 'sequence, id'

    dashboard_id = fields.Many2one('nova.dashboard', required=True, ondelete='cascade',
                                   index=True)
    name = fields.Char(required=True, default=lambda s: _('New Widget'))
    sequence = fields.Integer(default=10)
    item_type = fields.Selection(ITEM_TYPES, required=True, default='kpi')
    icon = fields.Char(default='fa-bolt', help="FontAwesome class, e.g. fa-rocket")
    color = fields.Char(string="Accent Color")
    chart_palette = fields.Selection(PALETTES, default='theme', required=True)

    # ------------ data source ------------
    model_id = fields.Many2one('ir.model', string="Model", ondelete='cascade',
                               domain=[('transient', '=', False),
                                       ('model', 'not like', 'ir.%')])
    model_name = fields.Char(compute='_compute_names', inverse='_inverse_model_name',
                             store=True, string="Model Name")
    domain = fields.Char(string="Filter Domain")
    date_field_id = fields.Many2one(
        'ir.model.fields', string="Date Field", ondelete='cascade',
        domain="[('model_id','=',model_id),('ttype','in',('date','datetime')),('store','=',True)]")
    date_field_name = fields.Char(compute='_compute_names', inverse='_inverse_date_field',
                                  store=True)
    date_preset_item = fields.Selection(ITEM_PRESETS, string="Date Scope",
                                        default='dashboard', required=True)

    # ------------ measures ------------
    agg = fields.Selection([('count', 'Count'), ('sum', 'Sum'), ('avg', 'Average'),
                            ('min', 'Minimum'), ('max', 'Maximum')],
                           string="Aggregation", default='count', required=True)
    measure_field_ids = fields.Many2many(
        'ir.model.fields', 'nova_item_measure_rel', 'item_id', 'field_id',
        string="Measures",
        domain="[('model_id','=',model_id),('ttype','in',('integer','float','monetary')),"
               "('store','=',True),('name','!=','id')]")
    measure_names = fields.Char(compute='_compute_names', inverse='_inverse_measures',
                                store=True)
    scatter_x_field_id = fields.Many2one(
        'ir.model.fields', string="X Measure", ondelete='set null',
        domain="[('model_id','=',model_id),('ttype','in',('integer','float','monetary')),('store','=',True)]")
    scatter_y_field_id = fields.Many2one(
        'ir.model.fields', string="Y Measure", ondelete='set null',
        domain="[('model_id','=',model_id),('ttype','in',('integer','float','monetary')),('store','=',True)]")

    # ------------ grouping ------------
    group_field_id = fields.Many2one(
        'ir.model.fields', string="Group By", ondelete='cascade',
        domain="[('model_id','=',model_id),('store','=',True),"
               "('ttype','in',('many2one','selection','boolean','char','date','datetime'))]")
    group_field_name = fields.Char(compute='_compute_names', inverse='_inverse_group_field',
                                   store=True)
    group_ttype = fields.Char(compute='_compute_ttypes')
    group_granularity = fields.Selection(GRANS, default='month')
    subgroup_field_id = fields.Many2one(
        'ir.model.fields', string="Sub Group By", ondelete='set null',
        domain="[('model_id','=',model_id),('store','=',True),('id','!=',group_field_id),"
               "('ttype','in',('many2one','selection','boolean','char','date','datetime'))]")
    subgroup_field_name = fields.Char(compute='_compute_names', inverse='_inverse_subgroup_field',
                                      store=True)
    subgroup_ttype = fields.Char(compute='_compute_ttypes')
    subgroup_granularity = fields.Selection(GRANS, default='month')

    record_limit = fields.Integer(string="Limit", default=0,
                                  help="0 = no limit. Pie family folds the rest into 'Other'.")
    sort_dir = fields.Selection([('none', 'Natural'), ('desc', 'Value ↓'), ('asc', 'Value ↑')],
                                default='none', required=True, string="Sort")

    # ------------ presentation ------------
    stacked = fields.Boolean(string="Stacked")
    show_values = fields.Boolean(string="Show Data Labels")
    show_legend = fields.Boolean(string="Show Legend", default=True)
    cumulative = fields.Boolean(string="Cumulative")
    fill_gaps = fields.Boolean(string="Fill Time Gaps", default=True)
    value_style = fields.Selection([('compact', 'Compact (1.2M)'), ('full', 'Full (1,200,000)')],
                                   default='compact', required=True, string="Number Style")
    unit_label = fields.Char(string="Unit", size=8)
    use_currency = fields.Boolean(string="Currency")
    show_records = fields.Boolean(string="Click to Open Records", default=True)

    # ------------ intelligence ------------
    enable_forecast = fields.Boolean(string="Forecast", help="Project future periods with a confidence band.")
    forecast_periods = fields.Integer(default=3)
    detect_anomalies = fields.Boolean(string="Detect Anomalies", default=True)
    compare_previous_item = fields.Boolean(string="Compare Previous Period")
    target_value = fields.Float(string="Target")

    # pulse alert — the card blinks in alert_color when the rule trips
    alert_rule = fields.Selection(
        [('off', 'Off'), ('above', 'Value above'), ('below', 'Value below')],
        default='off', required=True, string="Pulse Alert")
    alert_value = fields.Float(string="Alert Threshold")
    alert_color = fields.Char(default='#FF5470', string="Alert Color")

    # ------------ list / todo / text ------------
    list_field_ids = fields.Many2many(
        'ir.model.fields', 'nova_item_list_rel', 'item_id', 'field_id',
        string="Columns", domain="[('model_id','=',model_id),('store','=',True)]")
    list_field_names = fields.Char(compute='_compute_names', inverse='_inverse_list_fields',
                                   store=True)
    todo_ids = fields.One2many('nova.dashboard.item.todo', 'item_id', string="Tasks")
    text_content = fields.Html(string="Content", sanitize=True)

    company_id = fields.Many2one(related='dashboard_id.company_id', store=True)

    # ================================================================== #
    # Name mirrors (export / import / programmatic creation)             #
    # ================================================================== #
    @api.depends('model_id', 'date_field_id', 'group_field_id', 'subgroup_field_id',
                 'measure_field_ids', 'list_field_ids')
    def _compute_names(self):
        for rec in self:
            rec.model_name = rec.model_id.model or False
            rec.date_field_name = rec.date_field_id.name or False
            rec.group_field_name = rec.group_field_id.name or False
            rec.subgroup_field_name = rec.subgroup_field_id.name or False
            rec.measure_names = ','.join(rec.measure_field_ids.mapped('name')) or False
            rec.list_field_names = ','.join(rec.list_field_ids.mapped('name')) or False

    def _field_rec(self, fname):
        if not (self.model_id and fname):
            return False
        return self.env['ir.model.fields'].search(
            [('model_id', '=', self.model_id.id), ('name', '=', fname)], limit=1)

    def _inverse_model_name(self):
        for rec in self:
            rec.model_id = self.env['ir.model'].search(
                [('model', '=', rec.model_name)], limit=1) if rec.model_name else False

    def _inverse_date_field(self):
        for rec in self:
            rec.date_field_id = rec._field_rec(rec.date_field_name)

    def _inverse_group_field(self):
        for rec in self:
            rec.group_field_id = rec._field_rec(rec.group_field_name)

    def _inverse_subgroup_field(self):
        for rec in self:
            rec.subgroup_field_id = rec._field_rec(rec.subgroup_field_name)

    def _inverse_measures(self):
        for rec in self:
            names = [n.strip() for n in (rec.measure_names or '').split(',') if n.strip()]
            recs = [rec._field_rec(n) for n in names]
            rec.measure_field_ids = [(6, 0, [r.id for r in recs if r])]

    def _inverse_list_fields(self):
        for rec in self:
            names = [n.strip() for n in (rec.list_field_names or '').split(',') if n.strip()]
            recs = [rec._field_rec(n) for n in names]
            rec.list_field_ids = [(6, 0, [r.id for r in recs if r])]

    @api.model
    def _resolve_name_vals(self, vals):
        """Allow create()/import with *_name keys instead of ids."""
        Model = self.env['ir.model']
        Field = self.env['ir.model.fields']
        model = None
        if vals.get('model_name') and not vals.get('model_id'):
            model = Model.search([('model', '=', vals.pop('model_name'))], limit=1)
            vals['model_id'] = model.id or False
        elif vals.get('model_id'):
            model = Model.browse(vals['model_id'])
        if not model:
            return vals

        def fid(name):
            f = Field.search([('model_id', '=', model.id), ('name', '=', name)], limit=1)
            return f.id or False

        for key, target in (('date_field_name', 'date_field_id'),
                            ('group_field_name', 'group_field_id'),
                            ('subgroup_field_name', 'subgroup_field_id')):
            if vals.get(key) and not vals.get(target):
                vals[target] = fid(vals.pop(key))
            vals.pop(key, None)
        for key, target in (('measure_names', 'measure_field_ids'),
                            ('list_field_names', 'list_field_ids')):
            if vals.get(key) and not vals.get(target):
                ids = [fid(n.strip()) for n in vals.pop(key).split(',') if n.strip()]
                vals[target] = [(6, 0, [i for i in ids if i])]
            vals.pop(key, None)
        return vals

    @api.model
    def _sanitize_import_vals(self, vals):
        vals = dict(vals)
        if vals.get('item_type') not in dict(ITEM_TYPES):
            vals['item_type'] = 'kpi'
        return self._resolve_name_vals(vals)

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = [self._resolve_name_vals(dict(v)) for v in vals_list]
        return super().create(vals_list)

    @api.onchange('model_id')
    def _onchange_model(self):
        self.update({
            'date_field_id': False, 'group_field_id': False, 'subgroup_field_id': False,
            'measure_field_ids': [(5,)], 'list_field_ids': [(5,)], 'domain': False,
            'scatter_x_field_id': False, 'scatter_y_field_id': False,
        })

    @api.depends('group_field_id', 'subgroup_field_id')
    def _compute_ttypes(self):
        for rec in self:
            rec.group_ttype = rec.group_field_id.ttype or False
            rec.subgroup_ttype = rec.subgroup_field_id.ttype or False

    @api.constrains('item_type', 'model_id', 'group_field_id')
    def _check_config(self):
        if self.env.context.get('nova_skip_checks'):
            return
        for rec in self:
            if rec.item_type in ('text', 'todo'):
                continue
            if not rec.model_id:
                raise ValidationError(_("Widget '%s': pick a model.") % rec.name)
            if rec.item_type in NEEDS_GROUP and not rec.group_field_id:
                raise ValidationError(_("Widget '%s': '%s' widgets need a Group By field.")
                                      % (rec.name, rec.item_type))

    def _default_pos(self):
        self.ensure_one()
        w, h = (3, 5) if self.item_type in VALUE_TYPES else (6, 8)
        if self.item_type in ('text', 'todo'):
            w, h = 4, 6
        return {'x': 0, 'y': 1000 + self.sequence, 'w': w, 'h': h}

    # ================================================================== #
    # Data pipeline                                                      #
    # ================================================================== #
    def _eng(self):
        return self.env['nova.engine']

    def _currency(self):
        return self.env.company.currency_id if self.use_currency else None

    def _fmt(self, v):
        return self._eng().fmt_value(v, self.value_style, self._currency(), self.unit_label or '')

    def _ranges(self, filters):
        """Resolve effective (range, prev_range) from item scope + dashboard filters."""
        filters = filters or {}
        if self.date_preset_item and self.date_preset_item != 'dashboard':
            return self._eng().date_range(self.date_preset_item)
        preset = filters.get('preset') or 'none'
        return self._eng().date_range(preset, filters.get('start'), filters.get('end'))

    def _base_domain(self, rng):
        dom = self._eng().safe_domain(self.domain)
        if rng and self.date_field_id:
            dom = expression.AND([dom, self._eng()._range_domain(self.date_field_id, rng)])
        return dom

    def _measures(self):
        if self.agg == 'count' or not self.measure_field_ids:
            return [('__count', _('Count'))]
        return [(f.name, f.field_description) for f in self.measure_field_ids]

    def _agg_spec(self, fname):
        if fname == '__count':
            return None
        return '%s:%s' % (fname, self.agg if self.agg != 'count' else 'sum')

    def _group_spec(self, field_rec, gran):
        if field_rec.ttype in ('date', 'datetime'):
            return '%s:%s' % (field_rec.name, gran or 'month')
        return field_rec.name

    def _label_of(self, raw, field_rec):
        if isinstance(raw, tuple):
            return raw[1] or _('Undefined')
        if raw is False or raw is None:
            return _('Undefined')
        if field_rec and field_rec.ttype == 'selection':
            try:
                sel = dict(self.env[self.model_id.model]._fields[field_rec.name]
                           ._description_selection(self.env))
                return sel.get(raw, str(raw))
            except Exception:
                return str(raw)
        if raw is True:
            return _('Yes')
        return str(raw)

    def _read_grouped(self, domain, groupbys, measures):
        fields_spec = [self._agg_spec(m[0]) for m in measures if self._agg_spec(m[0])]
        return self.env[self.model_id.model].read_group(
            domain, fields_spec, groupbys, lazy=False)

    def _extract(self, row, fname):
        if fname == '__count':
            return float(row.get('__count') or 0)
        v = row.get(fname)
        return float(v) if isinstance(v, (int, float)) else 0.0

    # ------------------------------------------------------------------ #
    def web_fetch(self, filters=None):
        """Single entry point: returns the full render payload for this widget."""
        self.ensure_one()
        self = self.with_context(allowed_company_ids=self.env.companies.ids)
        try:
            return self._dispatch(filters or {})
        except Exception as e:
            return {'id': self.id, 'type': self.item_type, 'error': str(e)}

    def _dispatch(self, filters):
        t = self.item_type
        if t == 'text':
            return {'id': self.id, 'type': t, 'text': {'html': self.text_content or ''}}
        if t == 'todo':
            return {'id': self.id, 'type': t, 'todo': {
                'lines': [{'id': l.id, 'name': l.name, 'done': l.done}
                          for l in self.todo_ids.sorted(lambda r: (r.done, r.sequence))]}}
        rng, prev = self._ranges(filters)
        compare = self.compare_previous_item or filters.get('compare')
        if t in VALUE_TYPES:
            return self._payload_value(rng, prev, compare)
        if t == 'scatter':
            return self._payload_scatter(rng)
        if t == 'funnel':
            return self._payload_funnel(rng)
        if t == 'heatmap':
            return self._payload_heatmap(rng)
        if t == 'leaderboard':
            return self._payload_leaderboard(rng, prev, compare)
        if t == 'list':
            return self._payload_list(rng, filters)
        return self._payload_chart(rng, prev, compare)

    # ------------------------------------------------------------------ #
    def _aggregate_scalar(self, domain):
        m = self._measures()[0][0]
        if m == '__count':
            return float(self.env[self.model_id.model].search_count(domain))
        rows = self.env[self.model_id.model].read_group(
            domain, ['%s:%s' % (m, self.agg)], [], lazy=False)
        return float(rows[0].get(m) or 0) if rows else 0.0

    def _sparkline(self, rng, domain_no_range):
        if not (rng and self.date_field_id):
            return [], []
        span = (rng[1] - rng[0]).days
        gran = 'day' if span <= 31 else 'week' if span <= 180 else 'month'
        eng = self._eng()
        dom = expression.AND([domain_no_range, eng._range_domain(self.date_field_id, rng)])
        rows = self._read_grouped(dom, [self._group_spec(self.date_field_id, gran)],
                                  self._measures()[:1])
        pts, dates = [], []
        for r in rows:
            d = eng._bucket_meta(r, gran)
            pts.append(self._extract(r, self._measures()[0][0]))
            dates.append(d)
        return pts, [eng._bucket_label(d, gran) if d else '' for d in dates]

    def _payload_value(self, rng, prev, compare):
        eng = self._eng()
        dom_base = eng.safe_domain(self.domain)
        value = self._aggregate_scalar(self._base_domain(rng))
        prev_val = delta = None
        if compare and prev and self.date_field_id:
            prev_dom = expression.AND([dom_base, eng._range_domain(self.date_field_id, prev)])
            prev_val = self._aggregate_scalar(prev_dom)
            delta = eng.pct_change(value, prev_val)
        spark, spark_labels = self._sparkline(rng, dom_base)
        trend_dir, _n = eng.trend(spark) if len(spark) >= 3 else ('flat', 0)
        fc = eng.forecast(spark, 1) if (self.enable_forecast and len(spark) >= 4) else None
        target_pct = None
        if self.target_value:
            target_pct = round(value / self.target_value * 100.0, 1) if self.target_value else None
        gauge_max = self.target_value * 4 / 3.0 if self.target_value else (max(value, 1) * 4 / 3.0)
        insight = eng.insight_for_kpi(self.name, value, prev_val, delta,
                                      self.target_value, target_pct, trend_dir)
        alert = None
        if self.alert_rule != 'off' and value is not None:
            tripped = (value > self.alert_value if self.alert_rule == 'above'
                       else value < self.alert_value)
            alert = {'active': bool(tripped),
                     'color': self.alert_color or '#FF5470',
                     'rule': self.alert_rule,
                     'threshold': self._fmt(self.alert_value)}
        return {
            'id': self.id, 'type': self.item_type,
            'alert': alert,
            'kpi': {
                'value': value, 'formatted': self._fmt(value),
                'prev': prev_val,
                'prev_formatted': self._fmt(prev_val) if prev_val is not None else None,
                'delta': delta, 'trend': trend_dir,
                'spark': spark, 'spark_labels': spark_labels,
                'target': self.target_value or None,
                'target_formatted': self._fmt(self.target_value) if self.target_value else None,
                'target_pct': target_pct,
                'gauge_max': gauge_max,
                'forecast_next': eng.compact(fc['points'][0]) if fc else None,
            },
            'insight': insight,
        }

    # ------------------------------------------------------------------ #
    def _payload_chart(self, rng, prev, compare):
        eng = self._eng()
        gf = self.group_field_id
        is_date = gf.ttype in ('date', 'datetime')
        gran = self.group_granularity or 'month'
        measures = self._measures()
        domain = self._base_domain(rng)
        gspecs = [self._group_spec(gf, gran)]
        if self.subgroup_field_id:
            gspecs.append(self._group_spec(self.subgroup_field_id,
                                           self.subgroup_granularity or 'month'))
        rows = self._read_grouped(domain, gspecs, measures)

        # ---- collect primary buckets ----
        buckets, bdates = [], {}
        for r in rows:
            raw = r.get(gspecs[0])
            lbl = self._label_of(raw, gf)
            if lbl not in bdates:
                buckets.append(lbl)
                bdates[lbl] = eng._bucket_meta(r, gran) if is_date else None
        if is_date:
            buckets.sort(key=lambda l: (bdates.get(l) is None, bdates.get(l)))
            if self.fill_gaps and len(buckets) > 1 and all(bdates.get(b) for b in buckets):
                filled, d, last = [], bdates[buckets[0]], bdates[buckets[-1]]
                guard = 0
                while d <= last and guard < 500:
                    filled.append(d)
                    d = eng._next_bucket(d, gran)
                    guard += 1
                buckets = [eng._bucket_label(d, gran) for d in filled]
                bdates = {eng._bucket_label(d, gran): d for d in filled}
        idx = {b: i for i, b in enumerate(buckets)}

        # ---- datasets ----
        datasets, label_domains = [], [[] for _ in buckets]
        for r in rows:
            i = idx.get(self._label_of(r.get(gspecs[0]), gf))
            if i is not None and not label_domains[i]:
                label_domains[i] = r.get('__domain') or []
        if self.subgroup_field_id:
            subs, data_map = [], {}
            for r in rows:
                s = self._label_of(r.get(gspecs[1]), self.subgroup_field_id)
                if s not in subs:
                    subs.append(s)
                i = idx.get(self._label_of(r.get(gspecs[0]), gf))
                if i is not None:
                    data_map.setdefault(s, [0.0] * len(buckets))[i] = \
                        self._extract(r, measures[0][0])
            datasets = [{'label': s, 'data': data_map.get(s, [0.0] * len(buckets))}
                        for s in subs[:12]]
        else:
            for mname, mlabel in measures[:6]:
                data = [0.0] * len(buckets)
                for r in rows:
                    i = idx.get(self._label_of(r.get(gspecs[0]), gf))
                    if i is not None:
                        data[i] = self._extract(r, mname)
                datasets.append({'label': mlabel, 'data': data})

        # ---- sort & limit (single dataset, non-date) ----
        if datasets and not is_date and not self.subgroup_field_id:
            order = list(range(len(buckets)))
            if self.sort_dir in ('asc', 'desc'):
                order.sort(key=lambda i: datasets[0]['data'][i],
                           reverse=self.sort_dir == 'desc')
            limit = self.record_limit or 0
            kept = order[:limit] if limit else order
            rest = order[limit:] if limit else []
            new_buckets = [buckets[i] for i in kept]
            new_domains = [label_domains[i] for i in kept]
            original = [list(ds['data']) for ds in datasets]
            for di, ds in enumerate(datasets):
                ds['data'] = [original[di][i] for i in kept]
            if rest and self.item_type in CIRCLE_TYPES:
                new_buckets.append(_('Other'))
                new_domains.append([])
                for di, ds in enumerate(datasets):
                    ds['data'].append(sum(original[di][i] for i in rest))
            buckets, label_domains = new_buckets, new_domains

        # ---- cumulative ----
        if self.cumulative:
            for ds in datasets:
                run = 0.0
                ds['data'] = [(run := run + v) for v in ds['data']]

        # ---- intelligence on first dataset ----
        primary = datasets[0]['data'] if datasets else []
        anomaly_idx = eng.anomalies(primary) if self.detect_anomalies else []
        fc = None
        forecast_labels = []
        if (self.enable_forecast and is_date and len(datasets) == 1
                and len(primary) >= 4 and not self.cumulative):
            fc = eng.forecast(primary, max(1, min(self.forecast_periods or 3, 12)))
            if fc:
                last = bdates.get(buckets[-1]) if buckets else None
                d = last
                for _i in range(len(fc['points'])):
                    if d:
                        d = eng._next_bucket(d, gran)
                        forecast_labels.append(eng._bucket_label(d, gran))
                    else:
                        forecast_labels.append('+%s' % (_i + 1))

        # ---- previous-period overlay ----
        prev_ds = None
        if compare and prev and is_date and len(datasets) == 1 and self.date_field_id:
            pdom = expression.AND([eng.safe_domain(self.domain),
                                   eng._range_domain(self.date_field_id, prev)])
            prows = self._read_grouped(pdom, [gspecs[0]], measures[:1])
            pvals = []
            for r in sorted(prows, key=lambda r: (eng._bucket_meta(r, gran) is None,
                                                  eng._bucket_meta(r, gran))):
                pvals.append(self._extract(r, measures[0][0]))
            if pvals:
                pvals = (pvals + [None] * len(buckets))[:len(buckets)]
                prev_ds = {'label': _('Previous period'), 'data': pvals}

        # ---- waterfall transform ----
        chart_kind = self.item_type
        if chart_kind == 'waterfall' and datasets:
            run, float_data, colors = 0.0, [], []
            for v in datasets[0]['data']:
                float_data.append([run, run + v])
                colors.append('pos' if v >= 0 else 'neg')
                run += v
            float_data.append([0, run])
            colors.append('total')
            buckets = buckets + [_('Total')]
            label_domains.append([])
            datasets = [{'label': datasets[0]['label'], 'data': float_data,
                         'wf_colors': colors}]

        insight = eng.insight_for_series(self.name, buckets, primary,
                                         datasets[0]['label'] if datasets else '',
                                         fc, anomaly_idx)
        return {
            'id': self.id, 'type': chart_kind,
            'chart': {
                'labels': buckets,
                'datasets': datasets,
                'previous': prev_ds,
                'forecast': dict(fc, labels=forecast_labels) if fc else None,
                'anomalies': anomaly_idx,
                'stacked': self.stacked,
                'show_values': self.show_values,
                'show_legend': self.show_legend,
                'currency': self.env.company.currency_id.symbol if self.use_currency else '',
                'value_style': self.value_style,
                'is_time': is_date,
            },
            'label_domains': label_domains if self.show_records else [],
            'insight': insight,
            'anomaly_count': len(anomaly_idx),
        }

    # ------------------------------------------------------------------ #
    def _payload_scatter(self, rng):
        if not (self.scatter_x_field_id and self.scatter_y_field_id):
            return {'id': self.id, 'type': 'scatter', 'error': _('Pick X and Y measures.')}
        domain = self._base_domain(rng)
        flds = [self.scatter_x_field_id.name, self.scatter_y_field_id.name]
        gf = self.group_field_id if self.group_field_id and \
            self.group_field_id.ttype in ('many2one', 'selection', 'boolean') else None
        if gf:
            flds.append(gf.name)
        recs = self.env[self.model_id.model].search_read(
            domain, flds, limit=min(self.record_limit or 400, 1000))
        series = {}
        for r in recs:
            key = self._label_of(r.get(gf.name), gf) if gf else self.name
            series.setdefault(key, []).append(
                {'x': r.get(flds[0]) or 0, 'y': r.get(flds[1]) or 0})
        return {
            'id': self.id, 'type': 'scatter',
            'chart': {
                'datasets': [{'label': k, 'data': v} for k, v in list(series.items())[:10]],
                'x_label': self.scatter_x_field_id.field_description,
                'y_label': self.scatter_y_field_id.field_description,
                'show_legend': self.show_legend,
            },
            'insight': _('%s records plotted') % len(recs),
        }

    def _payload_funnel(self, rng):
        eng = self._eng()
        rows = self._read_grouped(self._base_domain(rng),
                                  [self._group_spec(self.group_field_id, 'month')],
                                  self._measures()[:1])
        stages = []
        for r in rows:
            stages.append({
                'label': self._label_of(r.get(self._group_spec(self.group_field_id, 'month')),
                                        self.group_field_id),
                'value': self._extract(r, self._measures()[0][0]),
                'domain': r.get('__domain') or [],
            })
        if self.sort_dir == 'desc':
            stages.sort(key=lambda s: -s['value'])
        top = stages[0]['value'] if stages and stages[0]['value'] else 0
        for s in stages:
            s['pct'] = round(s['value'] / top * 100.0, 1) if top else 0
            s['formatted'] = self._fmt(s['value'])
        conv = round(stages[-1]['value'] / top * 100.0, 1) if top and len(stages) > 1 else None
        insight = (_('End-to-end conversion: %s%%') % conv) if conv is not None else False
        return {'id': self.id, 'type': 'funnel',
                'funnel': {'stages': stages[:9]},
                'insight': insight}

    def _payload_heatmap(self, rng):
        eng = self._eng()
        if not self.subgroup_field_id:
            return {'id': self.id, 'type': 'heatmap',
                    'error': _('Heatmap needs Group By and Sub Group By.')}
        gx = self._group_spec(self.group_field_id, self.group_granularity or 'month')
        gy = self._group_spec(self.subgroup_field_id, self.subgroup_granularity or 'month')
        rows = self._read_grouped(self._base_domain(rng), [gx, gy], self._measures()[:1])
        xs, ys, cells, doms = [], [], {}, {}
        x_is_date = self.group_field_id.ttype in ('date', 'datetime')
        xdates = {}
        for r in rows:
            xl = self._label_of(r.get(gx), self.group_field_id)
            yl = self._label_of(r.get(gy), self.subgroup_field_id)
            if xl not in xs:
                xs.append(xl)
                if x_is_date:
                    xdates[xl] = eng._bucket_meta(r, self.group_granularity or 'month')
            if yl not in ys:
                ys.append(yl)
            cells[(xl, yl)] = self._extract(r, self._measures()[0][0])
            doms[(xl, yl)] = r.get('__domain') or []
        if x_is_date:
            xs.sort(key=lambda l: (xdates.get(l) is None, xdates.get(l)))
        xs, ys = xs[:24], ys[:14]
        matrix = [[cells.get((x, y), 0.0) for x in xs] for y in ys]
        domains = ([[doms.get((x, y), []) for x in xs] for y in ys]
                   if self.show_records else [])
        flat = [v for row in matrix for v in row]
        hottest = None
        if flat and max(flat):
            mi = flat.index(max(flat))
            hottest = (ys[mi // len(xs)], xs[mi % len(xs)])
        insight = (_('Hottest cell: %(y)s × %(x)s', y=hottest[0], x=hottest[1])
                   if hottest else False)
        return {'id': self.id, 'type': 'heatmap',
                'heatmap': {'x': xs, 'y': ys, 'matrix': matrix,
                            'max': max(flat) if flat else 0,
                            'domains': domains},
                'insight': insight}

    def _payload_leaderboard(self, rng, prev, compare):
        eng = self._eng()
        gspec = self._group_spec(self.group_field_id, 'month')
        rows = self._read_grouped(self._base_domain(rng), [gspec], self._measures()[:1])
        entries = []
        for r in rows:
            entries.append({
                'label': self._label_of(r.get(gspec), self.group_field_id),
                'value': self._extract(r, self._measures()[0][0]),
                'domain': r.get('__domain') or [],
            })
        entries.sort(key=lambda e: -e['value'])
        limit = self.record_limit or 10
        entries = entries[:limit]
        prev_map = {}
        if compare and prev and self.date_field_id:
            pdom = expression.AND([eng.safe_domain(self.domain),
                                   eng._range_domain(self.date_field_id, prev)])
            for r in self._read_grouped(pdom, [gspec], self._measures()[:1]):
                prev_map[self._label_of(r.get(gspec), self.group_field_id)] = \
                    self._extract(r, self._measures()[0][0])
        top = entries[0]['value'] if entries and entries[0]['value'] else 1
        for i, e in enumerate(entries):
            e['rank'] = i + 1
            e['pct'] = round(e['value'] / top * 100.0, 1) if top else 0
            e['formatted'] = self._fmt(e['value'])
            d = eng.pct_change(e['value'], prev_map.get(e['label']))
            e['delta'] = d
        insight = False
        if len(entries) >= 2 and entries[0]['value']:
            share = entries[0]['value'] / (sum(e['value'] for e in entries) or 1) * 100
            insight = _('%(l)s leads with %(s)s%% share of the top %(n)s',
                        l=entries[0]['label'], s=round(share, 1), n=len(entries))
        return {'id': self.id, 'type': 'leaderboard',
                'board': {'entries': entries}, 'insight': insight}

    def _payload_list(self, rng, filters):
        flds = self.list_field_ids
        if not flds:
            return {'id': self.id, 'type': 'list', 'error': _('Pick columns to display.')}
        domain = self._base_domain(rng)
        order = '%s desc' % self.date_field_id.name if self.date_field_id else 'id desc'
        srt = filters.get('sort') or {}
        by_name = {f.name: f for f in flds}
        applied_sort = {}
        if isinstance(srt, dict) and srt.get('field') in by_name and \
                srt.get('dir') in ('asc', 'desc'):
            order = '%s %s, id desc' % (srt['field'], srt['dir'])
            applied_sort = {'field': srt['field'], 'dir': srt['dir']}
        limit = self.record_limit or 12
        offset = int(filters.get('offset', 0) or 0)
        Model = self.env[self.model_id.model]
        total = Model.search_count(domain)
        num_flds = [f for f in flds if f.ttype in ('integer', 'float', 'monetary')]
        totals = []
        if num_flds and total:
            spec = ['%s:sum' % f.name for f in num_flds]
            try:
                agg = Model.read_group(domain, spec, [], lazy=False)
                agg = agg[0] if agg else {}
            except Exception:
                agg = {}
            for f in flds:
                if f.ttype in ('integer', 'float', 'monetary'):
                    totals.append(self._eng().fmt_value(
                        agg.get(f.name) or 0.0, 'full',
                        self._currency() if f.ttype == 'monetary' else None))
                else:
                    totals.append('')
        recs = Model.search_read(domain, [f.name for f in flds],
                                 limit=limit, offset=offset, order=order)
        headers = [f.field_description for f in flds]
        rows = []
        for r in recs:
            row = {'id': r['id'], 'cells': []}
            for f in flds:
                v = r.get(f.name)
                if isinstance(v, tuple):
                    v = v[1]
                elif f.ttype == 'boolean':
                    v = '✓' if v else '✗'
                elif f.ttype in ('float', 'monetary') and isinstance(v, (int, float)):
                    v = self._eng().fmt_value(v, 'full',
                                              self._currency() if f.ttype == 'monetary' else None)
                elif v is False or v is None:
                    v = ''
                row['cells'].append(str(v))
            rows.append(row)
        return {'id': self.id, 'type': 'list',
                'list': {'headers': headers, 'rows': rows,
                         'fields': [f.name for f in flds],
                         'sort': applied_sort,
                         'totals': totals if any(totals) else False,
                         'total': total, 'limit': limit, 'offset': offset}}

    # ------------------------------------------------------------------ #
    # Drill-down                                                          #
    # ------------------------------------------------------------------ #
    def web_record_action(self, extra_domain=None, res_id=None):
        self.ensure_one()
        if not self.model_id:
            return False
        action = {
            'type': 'ir.actions.act_window',
            'name': self.name,
            'res_model': self.model_id.model,
            'target': 'current',
        }
        if res_id:
            action.update({'res_id': res_id, 'views': [(False, 'form')]})
            return action
        rng, _prev = self._ranges({})
        domain = self._eng().safe_domain(self.domain)
        if isinstance(extra_domain, list) and extra_domain:
            domain = expression.AND([domain, extra_domain])
        action.update({'domain': domain, 'views': [(False, 'list'), (False, 'form')]})
        return action

    def web_toggle_todo(self, todo_id):
        self.ensure_one()
        todo = self.todo_ids.filtered(lambda t: t.id == todo_id)
        if todo:
            todo.done = not todo.done
        return True

    def web_add_todo(self, name):
        self.ensure_one()
        if name and name.strip():
            self.env['nova.dashboard.item.todo'].create(
                {'item_id': self.id, 'name': name.strip()})
        return True

    def web_inspect(self):
        """Everything the Inspector sidebar shows about this widget."""
        self.ensure_one()
        scope = dict(ITEM_PRESETS).get(self.date_preset_item, self.date_preset_item)
        return {
            'id': self.id,
            'name': self.name,
            'type': self.item_type,
            'type_label': dict(ITEM_TYPES).get(self.item_type, self.item_type),
            'icon': self.icon,
            'color': self.color or False,
            'palette': dict(PALETTES).get(self.chart_palette, self.chart_palette),
            'model_label': self.model_id.name or False,
            'model_tech': self.model_name or False,
            'date_field': self.date_field_id.field_description or False,
            'scope': scope,
            'agg': dict(self._fields['agg'].selection).get(self.agg, self.agg),
            'measures': self.measure_field_ids.mapped('field_description'),
            'group': self.group_field_id.field_description or False,
            'group_gran': self.group_granularity if
                self.group_field_id.ttype in ('date', 'datetime') else False,
            'subgroup': self.subgroup_field_id.field_description or False,
            'domain': self.domain or False,
            'limit': self.record_limit or 0,
            'sort': dict(self._fields['sort_dir'].selection).get(self.sort_dir),
            'flags': {
                'forecast': self.enable_forecast,
                'anomalies': self.detect_anomalies,
                'compare': self.compare_previous_item,
                'currency': self.use_currency,
                'target': self.target_value or 0,
            },
            'has_action': bool(self.show_records and self.model_id),
        }

    # ------------------------------------------------------------------ #
    # Studio (frontend authoring)                                         #
    # ------------------------------------------------------------------ #
    @api.model
    def web_search_models(self, term='', limit=60):
        """m2o-grade model catalog for the Studio source selector."""
        dom = [('transient', '=', False), ('model', 'not like', 'ir.%'),
               ('model', 'not like', 'base_%'),
               ('model', 'not like', 'bus.%'),
               ('model', 'not like', 'mail.tracking%')]
        if term:
            dom = expression.AND([dom, ['|', ('name', 'ilike', term),
                                        ('model', 'ilike', term)]])
        recs = self.env['ir.model'].search(dom, limit=int(limit) or 60,
                                           order='name')
        count = self.env['ir.model'].search_count(dom)
        return {'total': count,
                'rows': [{'id': r.id, 'model': r.model, 'name': r.name}
                         for r in recs]}

    @api.model
    def web_model_fields(self, model_id):
        """Categorized field catalog for one model, ready for Studio pickers."""
        if not model_id:
            return {'measures': [], 'groups': [], 'dates': [], 'columns': []}
        rows = self.env['ir.model.fields'].search_read(
            [('model_id', '=', int(model_id)), ('store', '=', True)],
            ['name', 'field_description', 'ttype'],
            order='field_description')

        def pack(f):
            return {'id': f['id'], 'name': f['name'],
                    'label': f['field_description'], 'ttype': f['ttype']}

        groupable = ('many2one', 'selection', 'boolean', 'char', 'date', 'datetime')
        return {
            'measures': [pack(f) for f in rows
                         if f['ttype'] in ('integer', 'float', 'monetary')
                         and f['name'] != 'id'],
            'groups': [pack(f) for f in rows if f['ttype'] in groupable],
            'dates': [pack(f) for f in rows if f['ttype'] in ('date', 'datetime')],
            'columns': [pack(f) for f in rows
                        if f['ttype'] not in ('binary', 'one2many', 'many2many', 'html')],
        }

    @api.model
    def web_preview(self, vals, filters=None):
        """Stateless live preview: compute a full payload from an unsaved config."""
        vals = {k: v for k, v in dict(vals or {}).items() if k in self._fields}
        vals = self._resolve_name_vals(vals)
        item_type = vals.get('item_type') or 'kpi'
        if item_type not in ('text', 'todo') and not vals.get('model_id'):
            return {'id': 0, 'type': item_type,
                    'error': _('Pick a data model to see a live preview.')}
        if item_type in NEEDS_GROUP and not vals.get('group_field_id'):
            return {'id': 0, 'type': item_type,
                    'error': _('Pick a Group By field to see a live preview.')}
        try:
            rec = self.with_context(nova_skip_checks=True).new(vals)
            rec = rec.with_context(allowed_company_ids=self.env.companies.ids)
            payload = rec._dispatch(filters or {})
        except Exception as e:
            payload = {'type': item_type, 'error': str(e)}
        payload['id'] = 0
        return payload


class NovaDashboardItemTodo(models.Model):
    _name = 'nova.dashboard.item.todo'
    _description = 'NovaBoard To-Do Line'
    _order = 'sequence, id'

    item_id = fields.Many2one('nova.dashboard.item', required=True, ondelete='cascade')
    sequence = fields.Integer(default=10)
    name = fields.Char(required=True)
    done = fields.Boolean()
