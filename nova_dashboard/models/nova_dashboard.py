# -*- coding: utf-8 -*-
import json
import logging
from datetime import timedelta

from odoo import api, fields, models, _
from odoo.exceptions import UserError
from odoo.tools import file_open

from .nova_engine import DATE_PRESETS

_logger = logging.getLogger(__name__)

BLUEPRINT_FILES = [
    ('sales', 'sales_command_center.json'),
    ('crm', 'crm_pipeline_intelligence.json'),
]

THEMES = [
    ('aurora', 'Aurora (Dark Glass)'),
    ('nebula', 'Nebula (Deep Purple)'),
    ('carbon', 'Carbon (Mono Dark)'),
    ('daylight', 'Daylight (Light)'),
    ('solar', 'Solar (Warm Light)'),
]


class NovaDashboard(models.Model):
    _name = 'nova.dashboard'
    _description = 'NovaBoard Dashboard'
    _order = 'sequence, id'

    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    description = fields.Char(string="Subtitle", help="Shown under the dashboard title.")
    item_ids = fields.One2many('nova.dashboard.item', 'dashboard_id', string="Widgets", copy=True)
    item_count = fields.Integer(compute='_compute_item_count')

    theme = fields.Selection(THEMES, default='aurora', required=True)
    accent_color = fields.Char(default='#7C6CFF', help="Primary accent used by gradients and charts.")
    motion = fields.Boolean(string="Motion Effects", default=True,
                            help="Entrance animations, count-ups and ambient background.")

    layout_json = fields.Json(string="Layout", help="Grid positions {item_id: {x,y,w,h}}.")
    date_preset = fields.Selection(DATE_PRESETS, string="Default Date Filter", default='this_year')
    compare_previous = fields.Boolean(string="Compare to Previous Period", default=True)
    refresh_interval = fields.Selection(
        [('0', 'Never'), ('15', '15 s'), ('30', '30 s'), ('60', '1 min'),
         ('300', '5 min'), ('900', '15 min')],
        default='0', string="Auto Refresh")

    # n8n / automation bridge
    webhook_url = fields.Char(
        string="Webhook URL",
        help="POST this board's digest (KPIs, insights, anomalies) to any "
             "endpoint — drop an n8n Webhook node URL here to automate alerts.")
    webhook_interval = fields.Selection(
        [('off', 'Off'), ('hour', 'Every Hour'), ('day', 'Daily'), ('week', 'Weekly')],
        default='off', string="Push Frequency", required=True)
    webhook_last = fields.Datetime(string="Last Push", readonly=True)

    # constellation — boards that belong together, one click apart
    linked_board_ids = fields.Many2many(
        'nova.dashboard', 'nova_dashboard_link_rel', 'src_id', 'dst_id',
        string="Linked Dashboards",
        help="Pin sibling dashboards as quick-switch chips on top of this "
             "board — combine sales, CRM and finance into one constellation.")

    access_group_ids = fields.Many2many('res.groups', string="Restrict to Groups",
                                        help="Empty = visible to every NovaBoard user.")
    company_id = fields.Many2one('res.company', string="Company",
                                 default=lambda self: self.env.company)

    create_menu = fields.Boolean(string="Create Menu Entry", default=False,
                             help="Place this dashboard as a menu item anywhere "
                                  "in Odoo (e.g. inside Sales or Accounting).")
    menu_first = fields.Boolean(
        string="Module Landing Page", default=True,
        help="Pin the dashboard as the FIRST entry of the chosen app, so "
             "opening the app (e.g. clicking Sales) lands directly on it.")
    menu_parent_id = fields.Many2one(
        'ir.ui.menu', string="Parent Menu",
        default=lambda self: self.env.ref('nova_dashboard.menu_nova_boards',
                                          raise_if_not_found=False)
        or self.env.ref('nova_dashboard.menu_nova_root', raise_if_not_found=False))
    menu_id = fields.Many2one('ir.ui.menu', readonly=True, copy=False)
    client_action_id = fields.Many2one('ir.actions.client', readonly=True, copy=False)

    # ------------------------------------------------------------------ #
    def _compute_item_count(self):
        for rec in self:
            rec.item_count = len(rec.item_ids)

    def _layout_dict(self):
        self.ensure_one()
        val = self.layout_json
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except Exception:
                val = {}
        return val if isinstance(val, dict) else {}

    # ------------------------------------------------------------------ #
    # Menu lifecycle                                                      #
    # ------------------------------------------------------------------ #
    def _sync_menu(self):
        for rec in self:
            if rec.create_menu:
                if not rec.client_action_id:
                    rec.client_action_id = self.env['ir.actions.client'].sudo().create({
                        'name': rec.name,
                        'tag': 'nova_dashboard_action',
                        'params': {'dashboard_id': rec.id},
                    })
                else:
                    rec.client_action_id.sudo().write(
                        {'name': rec.name, 'params': {'dashboard_id': rec.id}})
                fallback = self.env.ref('nova_dashboard.menu_nova_boards',
                                        raise_if_not_found=False) \
                    or self.env.ref('nova_dashboard.menu_nova_root')
                vals = {
                    'name': rec.name,
                    'parent_id': rec.menu_parent_id.id or fallback.id,
                    'action': 'ir.actions.client,%s' % rec.client_action_id.id,
                    'sequence': 0 if rec.menu_first else (rec.sequence or 10),
                    'groups_id': [(6, 0, rec.access_group_ids.ids)] if rec.access_group_ids
                                 else [(6, 0, [self.env.ref('nova_dashboard.group_nova_user').id])],
                }
                if rec.menu_id:
                    rec.menu_id.sudo().write(vals)
                else:
                    rec.menu_id = self.env['ir.ui.menu'].sudo().create(vals)
            elif rec.menu_id:
                rec.menu_id.sudo().unlink()
                rec.menu_id = False

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        recs._sync_menu()
        return recs

    def write(self, vals):
        res = super().write(vals)
        if {'name', 'create_menu', 'menu_parent_id', 'sequence', 'access_group_ids'} & set(vals):
            self._sync_menu()
        return res

    def unlink(self):
        self.mapped('menu_id').sudo().unlink()
        self.mapped('client_action_id').sudo().unlink()
        return super().unlink()

    def copy(self, default=None):
        default = dict(default or {}, name=_("%s (copy)") % self.name)
        new = super().copy(default)
        # remap layout to the copied item ids (copy order is preserved)
        old_layout = self._layout_dict()
        mapping = dict(zip(self.item_ids.ids, new.item_ids.ids))
        new.layout_json = {str(mapping[int(k)]): v for k, v in old_layout.items()
                           if int(k) in mapping}
        return new

    # ------------------------------------------------------------------ #
    # Client API                                                          #
    # ------------------------------------------------------------------ #
    @api.model
    def web_list(self):
        boards = self.search([])
        return [{'id': b.id, 'name': b.name, 'theme': b.theme, 'count': b.item_count}
                for b in boards]

    @api.model
    def web_hub(self):
        """Everything the Hub landing needs: all boards + per-board widget mix."""
        can = self.env.user.has_group('nova_dashboard.group_nova_manager')
        boards = self.search([])
        mix = {}
        if boards:
            try:
                rows = self.env['nova.dashboard.item'].read_group(
                    [('dashboard_id', 'in', boards.ids)], ['__count'],
                    ['dashboard_id', 'item_type'], lazy=False)
                for r in rows:
                    mix.setdefault(r['dashboard_id'][0], []).append(
                        (r['item_type'], r.get('__count') or 0))
            except Exception:
                mix = {}
        out = []
        for b in boards:
            types = [t for t, _n in sorted(mix.get(b.id, []),
                                           key=lambda x: -x[1])[:3]]
            out.append({
                'id': b.id,
                'name': b.name,
                'description': b.description or '',
                'theme': b.theme,
                'accent': b.accent_color or '#7C6CFF',
                'count': b.item_count,
                'types': types,
                'webhook': bool(b.webhook_url and b.webhook_interval != 'off'),
                'menu': bool(b.menu_id),
                'refresh': int(b.refresh_interval or '0'),
                'links': len(b.linked_board_ids),
                'updated': fields.Date.to_string(b.write_date),
            })
        return {'can_manage': can, 'boards': out,
                'totals': {'boards': len(boards),
                           'widgets': sum(b.item_count for b in boards)}}

    @api.model
    def _relocate_menus(self):
        """Upgrade hook: the Hub is the single landing — dissolve auto-created
        per-board menus sitting under NovaBoard so 'Dashboards' opens the
        gallery directly (no dropdown). Boards placed inside OTHER apps'
        menus (Sales, Accounting…) are left untouched."""
        keep_out = [m.id for m in [
            self.env.ref('nova_dashboard.menu_nova_boards',
                         raise_if_not_found=False),
            self.env.ref('nova_dashboard.menu_nova_root',
                         raise_if_not_found=False)] if m]
        if not keep_out:
            return True
        for board in self.sudo().search([('menu_id', '!=', False)]):
            if board.menu_id.parent_id.id in keep_out:
                board.create_menu = False
            elif board.menu_first and board.menu_id.sequence != 0:
                # make it the app's landing entry
                board.menu_id.sudo().sequence = 0
        return True

    @api.model
    def web_search_menus(self, term=''):
        """Menu picker: place a dashboard anywhere in Odoo's menu tree.
        complete_name is non-stored, so match it in Python."""
        Menu = self.env['ir.ui.menu']
        term = (term or '').strip().lower()
        if term:
            menus = Menu.search([('name', 'ilike', term)], limit=40)
            if len(menus) < 40:
                pool = Menu.search([('id', 'not in', menus.ids)], limit=600)
                extra = pool.filtered(
                    lambda m: term in (m.complete_name or m.name or '').lower())
                menus |= extra[:40 - len(menus)]
        else:
            menus = Menu.search([], limit=40, order='sequence, id')
        rows = [{'id': m.id, 'name': m.complete_name or m.name} for m in menus]
        rows.sort(key=lambda r: r['name'])
        return rows

    # ------------------------------------------------------------------ #
    # NovaMind engine settings (Control Center)                           #
    # ------------------------------------------------------------------ #
    AI_PARAMS = {
        'provider': 'nova_dashboard.ai_provider',
        'key': 'nova_dashboard.ai_key',
        'model': 'nova_dashboard.ai_model',
        'endpoint': 'nova_dashboard.ai_endpoint',
    }

    @api.model
    def web_ai_engine(self):
        """Which brain answers — safe for every user (no key exposed)."""
        p = self.env['nova.ai']._ai_params()
        return {'provider': p['provider'], 'model': p['model'],
                'ready': p['provider'] != 'builtin' and bool(p['key'])}

    @api.model
    def web_ai_settings(self):
        if not self.env.user.has_group('nova_dashboard.group_nova_manager'):
            return {'allowed': False}
        ICP = self.env['ir.config_parameter'].sudo()
        key = ICP.get_param(self.AI_PARAMS['key']) or ''
        return {
            'allowed': True,
            'provider': ICP.get_param(self.AI_PARAMS['provider'], 'builtin'),
            'has_key': bool(key),
            'key_hint': ('••••••••' + key[-4:]) if key else '',
            'model': ICP.get_param(self.AI_PARAMS['model'], ''),
            'endpoint': ICP.get_param(self.AI_PARAMS['endpoint'], ''),
        }

    @api.model
    def web_save_ai_settings(self, provider, key=None, model='',
                             endpoint='', remove_key=False):
        if not self.env.user.has_group('nova_dashboard.group_nova_manager'):
            raise UserError(_("Only NovaBoard managers can configure NovaMind."))
        ICP = self.env['ir.config_parameter'].sudo()
        if provider not in ('builtin', 'openai', 'anthropic'):
            provider = 'builtin'
        ICP.set_param(self.AI_PARAMS['provider'], provider)
        ICP.set_param(self.AI_PARAMS['model'], (model or '').strip())
        ICP.set_param(self.AI_PARAMS['endpoint'], (endpoint or '').strip())
        if remove_key:
            ICP.set_param(self.AI_PARAMS['key'], '')
        elif key:
            ICP.set_param(self.AI_PARAMS['key'], key.strip())
        return True

    @api.model
    def web_ai_test(self):
        if not self.env.user.has_group('nova_dashboard.group_nova_manager'):
            raise UserError(_("Only NovaBoard managers can configure NovaMind."))
        ok, msg = self.env['nova.ai']._llm_ping()
        return {'ok': ok, 'message': msg}

    @api.model
    def web_admin_meta(self):
        """Control-center snapshot for the admin sidebar (managers only)."""
        if not self.env.user.has_group('nova_dashboard.group_nova_manager'):
            return {'allowed': False}
        ICP = self.env['ir.config_parameter'].sudo()
        boards = self.search([])
        rows = []
        for b in boards:
            rows.append({
                'id': b.id, 'name': b.name, 'theme': b.theme,
                'accent': b.accent_color or '#7C6CFF',
                'count': b.item_count, 'menu': bool(b.menu_id),
                'webhook': bool(b.webhook_url),
                'webhook_interval': b.webhook_interval,
                'webhook_last': b.webhook_last and
                    fields.Datetime.to_string(b.webhook_last) or False,
            })
        ai = self.env['nova.ai']._ai_params()
        linked = ai['provider'] != 'builtin' and bool(ai['key'])
        return {
            'allowed': True,
            'boards': rows,
            'totals': {'boards': len(boards),
                       'widgets': sum(b.item_count for b in boards)},
            'ai': {
                'llm': linked,
                'provider': ai['provider'],
                'model': ai['model'],
                'host': ai['endpoint'].split('//')[-1].split('/')[0],
            },
            'cron': bool(self.env.ref('nova_dashboard.cron_nova_webhooks',
                                      raise_if_not_found=False)),
        }

    @api.model
    def web_board_meta(self):
        """Option catalogs for the frontend board editor."""
        can_manage = self.env.user.has_group('nova_dashboard.group_nova_manager')
        return {
            'can_manage': can_manage,
            'boards': [{'id': b.id, 'name': b.name, 'theme': b.theme,
                        'accent': b.accent_color or '#7C6CFF'}
                       for b in self.search([])],
            'themes': [{'key': k, 'label': l} for k, l in THEMES],
            'presets': [{'key': k, 'label': l} for k, l in DATE_PRESETS
                        if k != 'custom'],
            'refresh': [{'key': k, 'label': l}
                        for k, l in self._fields['refresh_interval'].selection],
        }

    def web_config(self):
        """Everything the client needs to render the shell + skeletons."""
        self.ensure_one()
        layout = self._layout_dict()
        items = []
        for it in self.item_ids.sorted('sequence'):
            pos = layout.get(str(it.id)) or it._default_pos()
            items.append({
                'id': it.id,
                'name': it.name,
                'type': it.item_type,
                'icon': it.icon,
                'color': it.color or self.accent_color,
                'palette': it.chart_palette,
                'model': it.model_name,
                'pos': pos,
                'has_action': bool(it.show_records and it.model_id),
            })
        editable = self.env.user.has_group('nova_dashboard.group_nova_manager')
        links = [{'id': l.id, 'name': l.name, 'theme': l.theme,
                  'accent': l.accent_color or '#7C6CFF', 'count': l.item_count}
                 for l in self.linked_board_ids if l.exists()]
        return {
            'id': self.id,
            'name': self.name,
            'links': links,
            'description': self.description or '',
            'theme': self.theme,
            'accent': self.accent_color or '#7C6CFF',
            'motion': self.motion,
            'date_preset': self.date_preset or 'none',
            'compare': self.compare_previous,
            'refresh': int(self.refresh_interval or '0'),
            'items': items,
            'editable': editable,
            'presets': [{'key': k, 'label': l} for k, l in DATE_PRESETS],
        }

    def web_save_layout(self, layout):
        self.ensure_one()
        if isinstance(layout, dict):
            self.sudo().write({'layout_json': layout})
        return True

    def web_duplicate(self):
        """Deep-copy a board (widgets + layout), menu off by default."""
        self.ensure_one()
        if not self.env.user.has_group('nova_dashboard.group_nova_manager'):
            raise UserError(_("Only NovaBoard managers can duplicate dashboards."))
        new = self.copy({'name': _('%s (copy)') % self.name,
                         'create_menu': False})
        layout = self._layout_dict()
        new_layout = {}
        for old, fresh in zip(self.item_ids.sorted('sequence'),
                              new.item_ids.sorted('sequence')):
            pos = layout.get(str(old.id))
            if pos:
                new_layout[str(fresh.id)] = pos
        new.layout_json = new_layout
        return new.id

    def web_fetch_all(self, filters=None):
        """One round-trip for the whole board: [{id, payload}, …]."""
        self.ensure_one()
        return [{'id': it.id, 'payload': it.web_fetch(filters or {})}
                for it in self.item_ids.sorted('sequence')]

    @api.model
    def web_ai(self, dashboard_id, prompt, history=None):
        """NovaMind gateway — natural language → dashboards, widgets, answers."""
        return self.env['nova.ai'].chat(prompt or '', dashboard_id or False,
                                        history or [])

    def web_digest(self, filters=None):
        """Dashboard-level insight digest: collect the strongest stories."""
        self.ensure_one()
        out = []
        for it in self.item_ids:
            try:
                payload = it.web_fetch(filters or {})
                if payload.get('insight'):
                    out.append({'id': it.id, 'item': it.name, 'icon': it.icon,
                                'text': payload['insight'],
                                'anomaly': bool(payload.get('anomaly_count'))})
            except Exception:
                continue
        out.sort(key=lambda r: (not r['anomaly']))
        return out[:12]

    # ------------------------------------------------------------------ #
    # Export / Import                                                     #
    # ------------------------------------------------------------------ #
    ITEM_EXPORT_FIELDS = [
        'name', 'item_type', 'sequence', 'icon', 'color', 'chart_palette',
        'model_name', 'domain', 'date_field_name', 'date_preset_item',
        'measure_names', 'agg', 'group_field_name', 'group_granularity',
        'subgroup_field_name', 'subgroup_granularity',
        'record_limit', 'sort_dir', 'stacked', 'show_values',
        'show_legend', 'cumulative', 'fill_gaps', 'enable_forecast', 'forecast_periods',
        'detect_anomalies', 'compare_previous_item', 'target_value', 'value_style',
        'unit_label', 'use_currency', 'list_field_names', 'text_content', 'show_records',
    ]

    def web_export(self):
        self.ensure_one()
        items = []
        layout = self._layout_dict()
        for it in self.item_ids:
            data = {f: getattr(it, f) for f in self.ITEM_EXPORT_FIELDS}
            data['pos'] = layout.get(str(it.id)) or it._default_pos()
            items.append(data)
        return json.dumps({
            'nova_version': 1,
            'name': self.name,
            'description': self.description,
            'theme': self.theme,
            'accent_color': self.accent_color,
            'date_preset': self.date_preset,
            'items': items,
        }, default=str, indent=2)

    @api.model
    def web_import(self, payload):
        try:
            data = json.loads(payload) if isinstance(payload, str) else payload
        except Exception:
            raise UserError(_("Invalid NovaBoard JSON file."))
        if not isinstance(data, dict) or 'items' not in data:
            raise UserError(_("Invalid NovaBoard JSON file."))
        board = self.create({
            'name': data.get('name') or _('Imported Dashboard'),
            'description': data.get('description'),
            'theme': data.get('theme') if data.get('theme') in dict(THEMES) else 'aurora',
            'accent_color': data.get('accent_color') or '#7C6CFF',
            'date_preset': data.get('date_preset') or 'this_year',
        })
        Item = self.env['nova.dashboard.item']
        layout = {}
        for idata in data['items']:
            pos = idata.pop('pos', None)
            vals = {k: v for k, v in idata.items() if k in self.ITEM_EXPORT_FIELDS}
            vals['dashboard_id'] = board.id
            try:
                item = Item.create(Item._sanitize_import_vals(vals))
            except Exception:
                continue
            if pos:
                layout[str(item.id)] = pos
        board.layout_json = layout
        return board.id

    # ------------------------------------------------------------------ #
    # Blueprints — packaged boards in data/boards/*.json                  #
    # ------------------------------------------------------------------ #
    @api.model
    def _load_blueprint(self, key):
        """Import one packaged blueprint. Returns board id or False."""
        fname = dict(BLUEPRINT_FILES).get(key)
        if not fname:
            return False
        try:
            with file_open('nova_dashboard/data/boards/%s' % fname, 'r') as f:
                data = json.load(f)
        except Exception as e:
            _logger.warning("NovaBoard blueprint %s unreadable: %s", key, e)
            return False
        for model in data.get('requires', []):
            if model not in self.env:
                return False
        return self.web_import(data)

    @api.model
    def web_install_samples(self):
        """Frontend hook: install every blueprint whose models are present."""
        if not self.env.user.has_group('nova_dashboard.group_nova_manager'):
            raise UserError(_("Only NovaBoard managers can install sample dashboards."))
        created = []
        for key, _f in BLUEPRINT_FILES:
            bid = self._load_blueprint(key)
            if bid:
                created.append(bid)
        return created

    @api.model
    def _install_default_samples(self):
        """post_init: seed packaged boards once, silently."""
        try:
            if self.search_count([]):
                return
            for key, _f in BLUEPRINT_FILES:
                self._load_blueprint(key)
        except Exception as e:
            _logger.warning("NovaBoard sample install skipped: %s", e)

    # ------------------------------------------------------------------ #
    # Automation bridge (n8n & friends)                                   #
    # ------------------------------------------------------------------ #
    def _webhook_payload(self, filters=None):
        self.ensure_one()
        kpis, anomalies = [], 0
        for it in self.item_ids.sorted('sequence'):
            try:
                p = it.web_fetch(filters or {})
            except Exception:
                continue
            anomalies += int(p.get('anomaly_count') or 0)
            k = p.get('kpi')
            if isinstance(k, dict):
                kpis.append({
                    'widget': it.name, 'type': it.item_type,
                    'value': k.get('formatted'),
                    'raw': k.get('value'),
                    'delta_pct': k.get('delta'),
                    'trend': k.get('trend'),
                })
        return {
            'source': 'novaboard',
            'board': self.name,
            'board_id': self.id,
            'generated_at': fields.Datetime.now().isoformat(),
            'kpis': kpis,
            'anomaly_count': anomalies,
            'insights': self.web_digest(filters or {}),
        }

    def _push_webhook(self, filters=None):
        self.ensure_one()
        if not self.webhook_url:
            return False, _("No webhook URL configured.")
        try:
            import requests
            resp = requests.post(self.webhook_url,
                                 json=self._webhook_payload(filters),
                                 timeout=10)
            self.sudo().webhook_last = fields.Datetime.now()
            return resp.ok, _("Pushed — HTTP %s") % resp.status_code
        except Exception as e:
            return False, str(e)

    def web_webhook_test(self):
        self.ensure_one()
        ok, msg = self._push_webhook()
        return {'ok': ok, 'message': msg}

    @api.model
    def _cron_webhooks(self):
        DELTAS = {'hour': timedelta(hours=1), 'day': timedelta(days=1),
                  'week': timedelta(weeks=1)}
        now = fields.Datetime.now()
        boards = self.search([('webhook_interval', '!=', 'off'),
                              ('webhook_url', '!=', False)])
        for board in boards:
            delta = DELTAS.get(board.webhook_interval)
            if delta and board.webhook_last and board.webhook_last + delta > now:
                continue
            try:
                board._push_webhook()
            except Exception as e:
                _logger.warning("NovaBoard webhook %s failed: %s", board.id, e)

    # ------------------------------------------------------------------ #
    # Adaptive showcase                                                   #
    # ------------------------------------------------------------------ #
    def action_open(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.client',
            'tag': 'nova_dashboard_action',
            'name': self.name,
            'params': {'dashboard_id': self.id},
        }

    @api.model
    def action_create_showcase(self):
        """Build a showcase dashboard adapted to whatever apps are installed."""
        board = self.create({
            'name': _('Nova Command Center'),
            'description': _('Auto-generated showcase — adapted to your installed apps'),
            'theme': 'aurora',
            'date_preset': 'this_year',
            'create_menu': True,
        })
        Item = self.env['nova.dashboard.item'].with_context(nova_skip_checks=True)
        installed = lambda m: m in self.env and self.env[m]._auto  # noqa: E731
        layout, y = {}, 0

        def add(vals, w, h, x, yy):
            it = Item.create(dict(vals, dashboard_id=board.id))
            layout[str(it.id)] = {'x': x, 'y': yy, 'w': w, 'h': h}
            return it

        if installed('sale.order'):
            add({'name': _('Revenue'), 'item_type': 'kpi', 'icon': 'fa-line-chart',
                 'model_name': 'sale.order', 'domain': "[('state','in',('sale','done'))]",
                 'date_field_name': 'date_order', 'measure_names': 'amount_total',
                 'agg': 'sum', 'use_currency': True, 'compare_previous_item': True,
                 'enable_forecast': True, 'color': '#7C6CFF'}, 3, 5, 0, y)
            add({'name': _('Orders'), 'item_type': 'kpi', 'icon': 'fa-shopping-cart',
                 'model_name': 'sale.order', 'domain': "[('state','in',('sale','done'))]",
                 'date_field_name': 'date_order', 'agg': 'count',
                 'compare_previous_item': True, 'color': '#22C7A9'}, 3, 5, 3, y)
            add({'name': _('Avg Order Value'), 'item_type': 'kpi', 'icon': 'fa-tags',
                 'model_name': 'sale.order', 'domain': "[('state','in',('sale','done'))]",
                 'date_field_name': 'date_order', 'measure_names': 'amount_total',
                 'agg': 'avg', 'use_currency': True, 'compare_previous_item': True,
                 'color': '#FF7A9E'}, 3, 5, 6, y)
            add({'name': _('Quotations'), 'item_type': 'kpi', 'icon': 'fa-file-text-o',
                 'model_name': 'sale.order', 'domain': "[('state','in',('draft','sent'))]",
                 'date_field_name': 'date_order', 'agg': 'count', 'color': '#FFB35C'},
                3, 5, 9, y)
            y += 5
            add({'name': _('Revenue Trajectory'), 'item_type': 'area',
                 'model_name': 'sale.order', 'domain': "[('state','in',('sale','done'))]",
                 'date_field_name': 'date_order', 'measure_names': 'amount_total',
                 'agg': 'sum', 'group_field_name': 'date_order', 'group_granularity': 'month',
                 'fill_gaps': True, 'enable_forecast': True, 'forecast_periods': 3,
                 'detect_anomalies': True, 'use_currency': True}, 8, 8, 0, y)
            add({'name': _('Top Customers'), 'item_type': 'leaderboard',
                 'model_name': 'sale.order', 'domain': "[('state','in',('sale','done'))]",
                 'date_field_name': 'date_order', 'measure_names': 'amount_total',
                 'agg': 'sum', 'group_field_name': 'partner_id', 'record_limit': 8,
                 'sort_dir': 'desc', 'use_currency': True}, 4, 8, 8, y)
            y += 8
        if installed('crm.lead'):
            add({'name': _('Pipeline Funnel'), 'item_type': 'funnel',
                 'model_name': 'crm.lead', 'domain': "[('type','=','opportunity')]",
                 'date_field_name': 'create_date', 'measure_names': 'expected_revenue',
                 'agg': 'sum', 'group_field_name': 'stage_id', 'use_currency': True},
                4, 8, 0, y)
            add({'name': _('Win Rate'), 'item_type': 'gauge',
                 'model_name': 'crm.lead', 'domain': "[('probability','=',100)]",
                 'date_field_name': 'create_date', 'agg': 'count',
                 'target_value': 50, 'color': '#22C7A9'}, 4, 8, 4, y)
            add({'name': _('Lead Heatmap'), 'item_type': 'heatmap',
                 'model_name': 'crm.lead', 'date_field_name': 'create_date',
                 'agg': 'count', 'group_field_name': 'create_date',
                 'group_granularity': 'month', 'subgroup_field_name': 'team_id'},
                4, 8, 8, y)
            y += 8
        if not layout:  # vanilla DB — base-only showcase
            add({'name': _('Contacts'), 'item_type': 'kpi', 'icon': 'fa-users',
                 'model_name': 'res.partner', 'date_field_name': 'create_date',
                 'agg': 'count', 'compare_previous_item': True, 'enable_forecast': True},
                3, 5, 0, 0)
            add({'name': _('Companies'), 'item_type': 'kpi', 'icon': 'fa-building-o',
                 'model_name': 'res.partner', 'domain': "[('is_company','=',True)]",
                 'date_field_name': 'create_date', 'agg': 'count', 'color': '#22C7A9'},
                3, 5, 3, 0)
            add({'name': _('Active Users'), 'item_type': 'kpi', 'icon': 'fa-user-circle-o',
                 'model_name': 'res.users', 'date_field_name': 'create_date',
                 'agg': 'count', 'color': '#FF7A9E'}, 3, 5, 6, 0)
            add({'name': _('Installed Apps'), 'item_type': 'tile', 'icon': 'fa-cubes',
                 'model_name': 'ir.module.module', 'domain': "[('state','=','installed')]",
                 'agg': 'count', 'color': '#FFB35C'}, 3, 5, 9, 0)
            add({'name': _('Contact Growth'), 'item_type': 'area',
                 'model_name': 'res.partner', 'date_field_name': 'create_date',
                 'agg': 'count', 'group_field_name': 'create_date',
                 'group_granularity': 'month', 'fill_gaps': True,
                 'enable_forecast': True, 'detect_anomalies': True}, 8, 8, 0, 5)
            add({'name': _('Contacts by Country'), 'item_type': 'doughnut',
                 'model_name': 'res.partner', 'group_field_name': 'country_id',
                 'agg': 'count', 'record_limit': 7}, 4, 8, 8, 5)
        board.layout_json = layout
        return board.action_open()
