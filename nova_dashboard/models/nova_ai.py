# -*- coding: utf-8 -*-
"""NovaMind — the NovaBoard AI copilot.

Natural language in → dashboards, widgets, restyles and data answers out.
Two brains, one executor:

* **LLM brain** — plug any OpenAI-compatible endpoint via System Parameters
  (``nova_dashboard.ai_key`` / ``ai_endpoint`` / ``ai_model``). NovaMind
  hands it a strict JSON op-schema plus a live catalog of your models and
  fields, and executes the returned plan.
* **Built-in brain** — zero-config heuristic NLU that ships in the box:
  intent detection, fuzzy model & field resolution, date-phrase parsing.
  Works offline, instantly, on any database.

Every plan funnels through one audited executor, so the AI can only do what
the NovaBoard API allows — and only for users in the manager group.
"""
import json
import logging
import re

from odoo import api, models, _
from odoo.osv import expression

from .nova_engine import DATE_PRESETS
from .nova_dashboard import THEMES

_logger = logging.getLogger(__name__)

STOP = {'a', 'an', 'the', 'of', 'in', 'on', 'for', 'with', 'and', 'or', 'to',
        'by', 'me', 'my', 'our', 'per', 'show', 'add', 'create', 'build',
        'make', 'new', 'widget', 'chart', 'graph', 'please', 'can', 'you',
        'i', 'want', 'need', 'dashboard', 'board', 'this', 'that', 'from'}

MODEL_HINTS = [
    (('sale', 'sales', 'revenue', 'order', 'orders', 'quotation'), 'sale.order'),
    (('invoice', 'invoices', 'bill', 'billing', 'receivable'), 'account.move'),
    (('lead', 'leads', 'crm', 'opportunity', 'opportunities', 'pipeline'), 'crm.lead'),
    (('customer', 'customers', 'partner', 'partners', 'contact', 'contacts'), 'res.partner'),
    (('product', 'products', 'item', 'items', 'sku'), 'product.template'),
    (('purchase', 'purchases', 'vendor', 'supplier', 'po'), 'purchase.order'),
    (('stock', 'inventory', 'warehouse', 'move', 'moves'), 'stock.move'),
    (('employee', 'employees', 'staff', 'hr'), 'hr.employee'),
    (('task', 'tasks', 'project'), 'project.task'),
    (('ticket', 'tickets', 'helpdesk', 'support'), 'helpdesk.ticket'),
    (('expense', 'expenses'), 'hr.expense'),
    (('manufacturing', 'production', 'mrp'), 'mrp.production'),
    (('pos', 'point of sale'), 'pos.order'),
    (('attendance',), 'hr.attendance'),
    (('event', 'events'), 'event.event'),
    (('user', 'users'), 'res.users'),
]

TYPE_HINTS = [
    (('kpi', 'number', 'metric', 'counter', 'big number'), 'kpi'),
    (('tile',), 'tile'),
    (('gauge', 'progress', 'goal'), 'gauge'),
    (('bullet',), 'bullet'),
    (('horizontal bar', 'hbar', 'h-bar'), 'hbar'),
    (('bar',), 'bar'),
    (('line', 'trend', 'evolution', 'over time', 'timeline'), 'line'),
    (('area',), 'area'),
    (('waterfall',), 'waterfall'),
    (('radar', 'spider'), 'radar'),
    (('scatter',), 'scatter'),
    (('doughnut', 'donut'), 'doughnut'),
    (('pie', 'breakdown', 'split', 'share'), 'pie'),
    (('polar',), 'polar'),
    (('funnel', 'stages', 'conversion'), 'funnel'),
    (('heatmap', 'heat map', 'matrix'), 'heatmap'),
    (('leaderboard', 'top', 'ranking', 'best'), 'leaderboard'),
    (('list', 'table', 'records', 'recent'), 'list'),
    (('todo', 'to-do', 'tasks list', 'checklist'), 'todo'),
    (('note', 'text', 'markdown'), 'text'),
]

TYPE_ICONS = {
    'kpi': 'fa-bolt', 'tile': 'fa-square', 'gauge': 'fa-tachometer',
    'bullet': 'fa-arrows-h', 'bar': 'fa-bar-chart', 'hbar': 'fa-align-left',
    'line': 'fa-line-chart', 'area': 'fa-area-chart', 'waterfall': 'fa-signal',
    'radar': 'fa-bullseye', 'scatter': 'fa-braille', 'pie': 'fa-pie-chart',
    'doughnut': 'fa-circle-o-notch', 'polar': 'fa-dot-circle-o',
    'funnel': 'fa-filter', 'heatmap': 'fa-th', 'leaderboard': 'fa-trophy',
    'list': 'fa-table', 'todo': 'fa-check-square-o', 'text': 'fa-file-text-o',
}

PRESET_HINTS = [
    ('today', 'today'), ('yesterday', 'yesterday'),
    ('this week', 'this_week'), ('last week', 'last_week'),
    ('last 7', 'last_7'), ('last 30', 'last_30'), ('last 90', 'last_90'),
    ('last 365', 'last_365'), ('this month', 'this_month'),
    ('last month', 'last_month'), ('this quarter', 'this_quarter'),
    ('last quarter', 'last_quarter'), ('this year', 'this_year'),
    ('last year', 'last_year'), ('month to date', 'mtd'),
    ('quarter to date', 'qtd'), ('year to date', 'ytd'),
    ('all time', 'none'),
]

NEEDS_GROUP_AI = {'bar', 'hbar', 'line', 'area', 'waterfall', 'pie', 'doughnut',
                  'polar', 'radar', 'funnel', 'heatmap', 'leaderboard'}
TIME_DEFAULT = {'line', 'area', 'waterfall'}
MUTATING = {'create_board', 'add_widget', 'update_widget', 'remove_widget',
            'set_board', 'blueprint', 'samples'}


class NovaAI(models.AbstractModel):
    _name = 'nova.ai'
    _description = 'NovaMind AI Copilot'

    # ================================================================== #
    # Entry point                                                         #
    # ================================================================== #
    @api.model
    def chat(self, prompt, dashboard_id=False, history=None):
        prompt = (prompt or '').strip()
        board = self.env['nova.dashboard'].browse(dashboard_id) if dashboard_id else \
            self.env['nova.dashboard']
        if board and not board.exists():
            board = self.env['nova.dashboard']
        if not prompt:
            return {'reply': _("Tell me what to build — e.g. “build a sales "
                               "dashboard” or “add revenue by month”."),
                    'actions': [], 'reload': False, 'board_id': board.id or False}

        plan, llm_err = self._llm_plan(prompt, board, history or [])
        engine = 'llm'
        if not plan:
            plan = self._heuristic_plan(prompt, board)
            engine = 'nova'
        result = self._execute(plan, board)
        result['engine'] = engine
        if llm_err and engine == 'nova':
            result['reply'] = (result.get('reply') or '') + _(
                "\n⚠ LLM engine error — %s. I answered with the built-in "
                "brain; check Control Center → NovaMind engine.") % llm_err
        return result

    # ================================================================== #
    # Catalog helpers                                                     #
    # ================================================================== #
    def _installed(self, model):
        return model in self.env and getattr(self.env[model], '_auto', False)

    def _find_model(self, text):
        low = ' %s ' % text.lower()
        for keys, model in MODEL_HINTS:
            if any(' %s ' % k in low or low.strip().startswith(k) for k in keys):
                if self._installed(model):
                    return model
        words = [w for w in re.findall(r'[a-z_.]{4,}', low) if w not in STOP]
        for w in words:
            recs = self.env['ir.model'].search(
                [('transient', '=', False), ('model', 'not like', 'ir.%'),
                 '|', ('model', 'ilike', w), ('name', 'ilike', w)],
                limit=3, order='model')
            for r in recs:
                if self._installed(r.model):
                    return r.model
        return False

    def _fields_of(self, model):
        Model = self.env['ir.model'].search([('model', '=', model)], limit=1)
        rows = self.env['ir.model.fields'].search_read(
            [('model_id', '=', Model.id), ('store', '=', True)],
            ['name', 'field_description', 'ttype'])
        out = {'numeric': [], 'group': [], 'date': [], 'column': []}
        for f in rows:
            d = {'name': f['name'], 'label': f['field_description'],
                 'ttype': f['ttype']}
            if f['ttype'] in ('integer', 'float', 'monetary') and f['name'] != 'id':
                out['numeric'].append(d)
            if f['ttype'] in ('many2one', 'selection', 'boolean', 'char',
                              'date', 'datetime'):
                out['group'].append(d)
            if f['ttype'] in ('date', 'datetime'):
                out['date'].append(d)
            if f['ttype'] not in ('binary', 'one2many', 'many2many', 'html'):
                out['column'].append(d)
        return out

    def _score_field(self, field, tokens):
        score = 0
        name, label = field['name'].lower(), field['label'].lower()
        for tok in tokens:
            if tok == name:
                score += 100
            elif tok in name.split('_'):
                score += 70
            elif tok in name:
                score += 45
            if tok in label.split():
                score += 50
            elif tok in label:
                score += 25
        return score

    def _find_field(self, fields_, kind, phrase):
        tokens = [w for w in re.findall(r'[a-z_]{3,}', (phrase or '').lower())
                  if w not in STOP]
        if not tokens:
            return None
        best, best_score = None, 0
        for f in fields_[kind]:
            s = self._score_field(f, tokens)
            if f['ttype'] == 'monetary':
                s += 4
            if s > best_score:
                best, best_score = f, s
        return best if best_score >= 25 else None

    def _pick_measure(self, fields_):
        prefs = ['amount_total', 'expected_revenue', 'amount_untaxed',
                 'price_total', 'price_subtotal', 'total', 'amount']
        by_name = {f['name']: f for f in fields_['numeric']}
        for p in prefs:
            if p in by_name:
                return by_name[p]
        for f in fields_['numeric']:
            if f['ttype'] == 'monetary':
                return f
        return fields_['numeric'][0] if fields_['numeric'] else None

    def _pick_group(self, fields_):
        prefs = ['user_id', 'partner_id', 'stage_id', 'team_id', 'state',
                 'category_id', 'company_id']
        by_name = {f['name']: f for f in fields_['group']}
        for p in prefs:
            if p in by_name:
                return by_name[p]
        for f in fields_['group']:
            if f['ttype'] in ('many2one', 'selection'):
                return f
        return fields_['group'][0] if fields_['group'] else None

    def _pick_date(self, fields_):
        prefs = ['date_order', 'date', 'invoice_date', 'date_deadline',
                 'create_date']
        by_name = {f['name']: f for f in fields_['date']}
        for p in prefs:
            if p in by_name:
                return by_name[p]
        return fields_['date'][0] if fields_['date'] else None

    def _preset_from(self, text):
        low = text.lower()
        for phrase, key in PRESET_HINTS:
            if phrase in low:
                return key
        return None

    # ================================================================== #
    # Built-in brain                                                      #
    # ================================================================== #
    def _heuristic_plan(self, prompt, board):
        t = ' %s ' % re.sub(r'\s+', ' ', prompt.lower().strip())
        ops, say = [], []

        # ---- install packaged samples -------------------------------- #
        if 'sample' in t and ('install' in t or 'load' in t or 'dashboard' in t):
            return {'say': _("Installing the packaged sample dashboards…"),
                    'ops': [{'op': 'samples'}]}

        # ---- theme / accent ------------------------------------------ #
        theme_words = {'aurora': 'aurora', 'nebula': 'nebula', 'carbon': 'carbon',
                       'daylight': 'daylight', 'solar': 'solar',
                       'blossom': 'blossom', 'pink': 'blossom', 'rose': 'blossom',
                       'dark': 'aurora', 'light': 'daylight', 'purple': 'nebula',
                       'mono': 'carbon', 'warm': 'solar'}
        if 'theme' in t or 'switch to' in t:
            for w, key in theme_words.items():
                if ' %s ' % w in t and key in dict(THEMES):
                    ops.append({'op': 'set_board', 'vals': {'theme': key}})
                    say.append(_("Switched the theme to %s.") % key.title())
                    break
        hexm = re.search(r'#([0-9a-fA-F]{6})\b', prompt)
        if hexm and ('accent' in t or 'color' in t or 'colour' in t):
            ops.append({'op': 'set_board',
                        'vals': {'accent_color': '#' + hexm.group(1)}})
            say.append(_("Accent set to #%s.") % hexm.group(1))
        if ops and not any(v in t for v in (' add ', ' build ', ' create ',
                                            ' make ', ' generate ')):
            return {'say': ' '.join(say), 'ops': ops}

        # ---- rename --------------------------------------------------- #
        ren = re.search(r'rename (?:the )?(?:board|dashboard)?\s*(?:to|as)\s+(.+)$',
                        prompt, re.I)
        if ren:
            ops.append({'op': 'set_board', 'vals': {'name': ren.group(1).strip(' "\'.')}} )
            return {'say': _("Renamed the dashboard."), 'ops': ops}

        # ---- remove a widget ------------------------------------------ #
        rem = re.search(r'(?:remove|delete)\s+(?:the\s+)?(.+?)\s*(?:widget|card|chart)?\s*$',
                        prompt, re.I)
        if rem and ('remove' in t or 'delete' in t) and board:
            return {'say': '', 'ops': [{'op': 'remove_widget',
                                        'target': rem.group(1).strip()}]}

        lk = re.search(r'(?:link|connect|combine)(?:\s+(?:this|it|me))?'
                       r'(?:\s+board)?\s+(?:with|to|and)\s+(.+)$', prompt, re.I)
        if lk and board:
            targets = re.split(r'\s*(?:,|and|&)\s*', lk.group(1))
            return {'say': _("Linking the boards into one constellation…"),
                    'ops': [{'op': 'link_boards',
                             'targets': [x.strip(' ."\'') for x in targets if x.strip()]}]}

        build_verb = any(v in t for v in (' build ', ' create ', ' generate ',
                                          ' make ', ' setup ', ' set up '))
        wants_board = 'dashboard' in t or 'board' in t

        # ---- full dashboard builds ------------------------------------ #
        if build_verb and wants_board:
            if any(w in t for w in (' sale', ' sales', ' revenue')) and \
                    self._installed('sale.order'):
                return {'say': _("Building the Sales Command Center from my "
                                 "packaged blueprint…"),
                        'ops': [{'op': 'blueprint', 'key': 'sales'}]}
            if any(w in t for w in (' crm', ' pipeline', ' lead',
                                    ' opportunit')) and self._installed('crm.lead'):
                return {'say': _("Building the CRM Pipeline Intelligence board…"),
                        'ops': [{'op': 'blueprint', 'key': 'crm'}]}
            model = self._find_model(t)
            if model:
                return self._auto_board_plan(model, prompt)
            return {'say': _("I can build a board for any model — tell me "
                             "which data, e.g. “build a dashboard for "
                             "invoices” or “for project tasks”."), 'ops': []}

        # ---- data question (no build verb) ----------------------------- #
        asks = ('how many', 'how much', "what's", 'what is', 'total ', 'count ',
                'average ', 'avg ', 'sum of', 'who are', 'which ')
        if any(a in t for a in asks) and not build_verb and ' add ' not in t:
            return self._query_plan(prompt, board)

        # ---- single widget --------------------------------------------- #
        if ' add ' in t or build_verb or any(
                k in t for hints, _ty in TYPE_HINTS for k in hints):
            plan = self._widget_plan(prompt, board)
            if plan:
                return plan

        # ---- fallback help ---------------------------------------------- #
        return {'say': _(
            "I'm NovaMind — your dashboard copilot. Try:\n"
            "• “Build a sales dashboard” / “build a dashboard for invoices”\n"
            "• “Add a line chart of revenue by month, with forecast”\n"
            "• “Top 10 customers by revenue this year”\n"
            "• “How many orders this month?”\n"
            "• “Switch theme to daylight” · “Install sample dashboards”"),
            'ops': []}

    # ------------------------------------------------------------------ #
    def _phrase_after(self, prompt, markers, stoppers):
        low = prompt.lower()
        for m in markers:
            i = low.find(m)
            if i < 0:
                continue
            seg = prompt[i + len(m):]
            cut = len(seg)
            for s in stoppers:
                j = seg.lower().find(s)
                if 0 <= j < cut:
                    cut = j
            return seg[:cut].strip(' ,.')
        return ''

    def _widget_plan(self, prompt, board):
        t = ' %s ' % prompt.lower()
        itype = None
        for keys, ty in TYPE_HINTS:
            if any(k in t for k in keys):
                itype = ty
                break
        topm = re.search(r'\btop\s+(\d{1,3})\b', t)
        if topm and itype in (None, 'leaderboard', 'list'):
            itype = 'leaderboard'
        if not itype:
            itype = 'kpi'

        if itype in ('todo', 'text'):
            vals = {'name': _('Notes') if itype == 'text' else _('To-Do'),
                    'item_type': itype, 'icon': TYPE_ICONS[itype]}
            return {'say': _("Added a %s card.") % itype,
                    'ops': [{'op': 'add_widget', 'vals': vals}]}

        model = False
        tail = self._phrase_after(prompt, [' in ', ' from ', ' for '],
                                  [' by ', ' of ', ' this ', ' last ', ' with '])
        if tail:
            model = self._find_model(tail)
        if not model:
            model = self._find_model(t)
        if not model and board:
            names = [m for m in board.item_ids.mapped('model_name') if m]
            model = max(set(names), key=names.count) if names else False
        if not model:
            return {'say': _("Which data should this widget read? Name a "
                             "model, e.g. “…of sales orders” or “…from "
                             "invoices”."), 'ops': []}

        fields_ = self._fields_of(model)
        measure = None
        mp = self._phrase_after(prompt, [' of ', ' sum of ', ' total '],
                                [' by ', ' per ', ' in ', ' from ', ' this ',
                                 ' last ', ' for '])
        if mp:
            measure = self._find_field(fields_, 'numeric', mp)
        count_words = ('count', 'number of', 'how many', 'orders', 'records',
                       'leads', 'tickets', 'tasks')
        agg = 'count'
        if measure:
            agg = 'avg' if ('average' in t or ' avg ' in t) else 'sum'
        elif not any(w in t for w in count_words):
            measure = self._pick_measure(fields_)
            if measure and any(w in t for w in ('revenue', 'amount', 'value',
                                                'sales', 'total')):
                agg = 'sum'
            else:
                measure = None

        group = None
        gp = self._phrase_after(prompt, [' by ', ' per ', ' grouped by '],
                                [' in ', ' from ', ' this ', ' last ',
                                 ' with ', ' for '])
        if gp:
            if any(w in gp.lower() for w in ('month', 'week', 'day', 'quarter',
                                             'year', 'date', 'time')):
                group = self._pick_date(fields_)
            else:
                group = self._find_field(fields_, 'group', gp)
        if not group and itype in NEEDS_GROUP_AI:
            group = (self._pick_date(fields_) if itype in TIME_DEFAULT
                     else self._pick_group(fields_))
        gran = 'month'
        for g, k in (('hour', 'hour'), ('daily', 'day'), ('day', 'day'),
                     ('week', 'week'), ('quarter', 'quarter'), ('year', 'year')):
            if ' %s' % g in (gp or '').lower() or ' per %s' % g in t:
                gran = k
                break

        date_f = self._pick_date(fields_)
        preset = self._preset_from(t)

        vals = {
            'item_type': itype, 'icon': TYPE_ICONS.get(itype, 'fa-bolt'),
            'model_name': model, 'agg': agg,
        }
        if measure:
            vals['measure_names'] = measure['name']
            if measure['ttype'] == 'monetary':
                vals['use_currency'] = True
        if group:
            vals['group_field_name'] = group['name']
            if group['ttype'] in ('date', 'datetime'):
                vals['group_granularity'] = gran
        if date_f:
            vals['date_field_name'] = date_f['name']
        if preset:
            vals['date_preset_item'] = preset
        if topm:
            vals['record_limit'] = int(topm.group(1))
            vals['sort_dir'] = 'desc'
        elif itype in ('pie', 'doughnut', 'polar', 'leaderboard'):
            vals['record_limit'] = 8
            vals['sort_dir'] = 'desc'
        if 'forecast' in t or 'predict' in t:
            vals['enable_forecast'] = True
        al = re.search(r'(?:blink|pulse|alert|flash)[^.]*?(above|below|over|under)\s+([\d,.]+)', t)
        if al:
            vals['alert_rule'] = 'above' if al.group(1) in ('above', 'over') else 'below'
            try:
                vals['alert_value'] = float(al.group(2).replace(',', ''))
            except ValueError:
                vals['alert_value'] = 0.0
            cm = re.search(r'#([0-9a-fA-F]{6})', prompt)
            colors = {'red': '#FF5470', 'green': '#2BD9A8', 'orange': '#FF9D3C',
                      'yellow': '#FFD23C', 'blue': '#4CC2FF', 'purple': '#B06CFF'}
            vals['alert_color'] = ('#' + cm.group(1)) if cm else next(
                (v for k, v in colors.items() if k in t), '#FF5470')
        if 'compare' in t or 'previous' in t or ' vs ' in t:
            vals['compare_previous_item'] = True
        if itype == 'list':
            cols = [f['name'] for f in fields_['column'][:5]]
            vals['list_field_names'] = ','.join(cols)
            vals['record_limit'] = vals.get('record_limit') or 8

        mlabel = measure['label'] if measure else _('Count')
        vals['name'] = ('%s by %s' % (mlabel, group['label'])) if group else \
            ('%s — %s' % (mlabel, model.split('.')[-1].title()))
        say = _("Added “%s” (%s on %s).") % (vals['name'], itype, model)
        return {'say': say, 'ops': [{'op': 'add_widget', 'vals': vals}]}

    def _query_plan(self, prompt, board):
        t = prompt.lower()
        model = self._find_model(t)
        if not model and board:
            names = [m for m in board.item_ids.mapped('model_name') if m]
            model = max(set(names), key=names.count) if names else False
        if not model:
            return {'say': _("Which model should I query? e.g. “how many "
                             "sale orders this month?”"), 'ops': []}
        fields_ = self._fields_of(model)
        agg, measure = 'count', None
        if any(w in t for w in ('how much', 'total', 'sum', 'revenue', 'value',
                                'amount')):
            mp = self._phrase_after(prompt, [' of '], [' by ', ' per ',
                                                       ' this ', ' last '])
            measure = (self._find_field(fields_, 'numeric', mp) if mp else None) \
                or self._pick_measure(fields_)
            if measure:
                agg = 'avg' if ('average' in t or ' avg' in t) else 'sum'
        gp = self._phrase_after(prompt, [' by ', ' per '],
                                [' this ', ' last ', ' in ', ' from '])
        group = None
        if gp or any(w in t for w in ('who are', 'which ', 'top ')):
            group = (self._find_field(fields_, 'group', gp) if gp else None) \
                or self._pick_group(fields_)
        topm = re.search(r'\btop\s+(\d{1,3})\b', t)
        limit = int(topm.group(1)) if topm else 10
        preset = self._preset_from(t) or 'this_year'
        op = {'op': 'query', 'model': model, 'agg': agg,
              'measure': measure['name'] if measure else False,
              'monetary': bool(measure and measure['ttype'] == 'monetary'),
              'group': group['name'] if group else False,
              'group_ttype': group['ttype'] if group else False,
              'preset': preset, 'limit': limit}
        return {'say': '', 'ops': [op]}

    def _auto_board_plan(self, model, prompt):
        """Compose a full board for ANY model from pure introspection."""
        fields_ = self._fields_of(model)
        Model = self.env['ir.model'].search([('model', '=', model)], limit=1)
        title = (Model.name or model).strip()
        measure = self._pick_measure(fields_)
        group = self._pick_group(fields_)
        date_f = self._pick_date(fields_)
        money = bool(measure and measure['ttype'] == 'monetary')

        ops = [{'op': 'create_board',
                'vals': {'name': _('%s Intelligence') % title,
                         'description': _('Auto-composed by NovaMind'),
                         'theme': 'aurora', 'date_preset': 'this_year'}}]

        def add(vals, x, y, w, h):
            v = dict(vals, model_name=model)
            if date_f:
                v.setdefault('date_field_name', date_f['name'])
            ops.append({'op': 'add_widget', 'vals': v,
                        'pos': {'x': x, 'y': y, 'w': w, 'h': h}})

        add({'name': _('Total %s') % title, 'item_type': 'kpi',
             'icon': 'fa-bolt', 'agg': 'count', 'compare_previous_item': True,
             'enable_forecast': bool(date_f)}, 0, 0, 3, 5)
        if measure:
            add({'name': measure['label'], 'item_type': 'kpi',
                 'icon': 'fa-line-chart', 'agg': 'sum',
                 'measure_names': measure['name'], 'use_currency': money,
                 'compare_previous_item': True, 'color': '#22C7A9'}, 3, 0, 3, 5)
            add({'name': _('Average %s') % measure['label'], 'item_type': 'tile',
                 'icon': 'fa-tags', 'agg': 'avg',
                 'measure_names': measure['name'], 'use_currency': money,
                 'color': '#FF7A9E'}, 6, 0, 3, 5)
        if group:
            add({'name': _('Latest additions'), 'item_type': 'kpi',
                 'icon': 'fa-clock-o', 'agg': 'count',
                 'date_preset_item': 'last_30', 'color': '#FFB35C'}, 9, 0, 3, 5)
        if date_f:
            add({'name': _('%s over time') % (measure['label'] if measure
                                              else _('Volume')),
                 'item_type': 'area', 'agg': 'sum' if measure else 'count',
                 'measure_names': measure['name'] if measure else False,
                 'group_field_name': date_f['name'], 'group_granularity': 'month',
                 'enable_forecast': True, 'detect_anomalies': True,
                 'use_currency': money}, 0, 5, 8, 9)
        if group:
            add({'name': _('By %s') % group['label'], 'item_type': 'leaderboard',
                 'agg': 'sum' if measure else 'count',
                 'measure_names': measure['name'] if measure else False,
                 'group_field_name': group['name'], 'record_limit': 8,
                 'sort_dir': 'desc', 'use_currency': money}, 8, 5, 4, 9)
            add({'name': _('Distribution'), 'item_type': 'doughnut',
                 'agg': 'sum' if measure else 'count',
                 'measure_names': measure['name'] if measure else False,
                 'group_field_name': group['name'], 'record_limit': 7,
                 'sort_dir': 'desc', 'chart_palette': 'vivid'}, 0, 14, 4, 9)
        cols = [f['name'] for f in fields_['column'][:5]]
        if cols:
            add({'name': _('Recent records'), 'item_type': 'list',
                 'list_field_names': ','.join(cols), 'record_limit': 8},
                4, 14, 8, 9)
        return {'say': _("Composed a full “%s Intelligence” board from the "
                         "model's own structure.") % title, 'ops': ops}

    # ================================================================== #
    # LLM brain (optional, OpenAI-compatible)                             #
    # ================================================================== #
    def _ai_params(self):
        ICP = self.env['ir.config_parameter'].sudo()
        key = ICP.get_param('nova_dashboard.ai_key') or ''
        provider = ICP.get_param('nova_dashboard.ai_provider', '') or ''
        endpoint = ICP.get_param('nova_dashboard.ai_endpoint', '') or ''
        model = ICP.get_param('nova_dashboard.ai_model', '') or ''
        if provider not in ('builtin', 'openai', 'anthropic'):
            # auto-detect for installs configured before the provider param
            blob = (endpoint + ' ' + model).lower()
            provider = 'anthropic' if ('anthropic' in blob or 'claude' in blob) \
                else ('openai' if key else 'builtin')
        if provider == 'anthropic':
            endpoint = endpoint or 'https://api.anthropic.com/v1/messages'
            model = model or 'claude-3-5-haiku-latest'
        else:
            endpoint = endpoint or 'https://api.openai.com/v1/chat/completions'
            model = model or 'gpt-4o-mini'
        return {'provider': provider, 'key': key,
                'endpoint': endpoint, 'model': model}

    def _llm_complete(self, sys, messages, params):
        """One raw completion. Speaks both Anthropic (Claude) and any
        OpenAI-compatible chat endpoint. Returns the text content."""
        import requests
        if params['provider'] == 'anthropic':
            resp = requests.post(
                params['endpoint'],
                headers={'x-api-key': params['key'],
                         'anthropic-version': '2023-06-01',
                         'content-type': 'application/json'},
                json={'model': params['model'],
                      'max_tokens': 4000,
                      'temperature': 0.1,
                      'system': sys,
                      'messages': [m for m in messages
                                   if m['role'] in ('user', 'assistant')]},
                timeout=30)
            data = resp.json()
            if data.get('error'):
                raise ValueError(data['error'].get('message', 'Claude error'))
            return ''.join(b.get('text', '') for b in data.get('content', []))
        resp = requests.post(
            params['endpoint'],
            headers={'Authorization': 'Bearer %s' % params['key'],
                     'Content-Type': 'application/json'},
            json={'model': params['model'],
                  'messages': [{'role': 'system', 'content': sys}] + messages,
                  'temperature': 0.1, 'max_tokens': 3000},
            timeout=30)
        data = resp.json()
        if data.get('error'):
            raise ValueError(data['error'].get('message', 'LLM error'))
        return data['choices'][0]['message']['content']

    def _llm_ping(self):
        """Connectivity test for the Control Center."""
        params = self._ai_params()
        if params['provider'] == 'builtin':
            return True, _("Built-in brain active — no API needed. "
                           "Pick a provider to link an LLM.")
        if not params['key']:
            return False, _("No API key saved yet.")
        try:
            txt = self._llm_complete(
                "Reply with exactly one word: pong", 
                [{'role': 'user', 'content': 'ping'}], params)
            return True, _("Connected to %(m)s — replied “%(t)s”") % {
                'm': params['model'], 't': (txt or '').strip()[:40]}
        except Exception as e:
            return False, str(e)[:200]

    def _llm_context(self, prompt, board):
        """Deep ORM grounding: candidate models with field catalogs,
        selection values, record counts — everything a 20-line brief needs."""
        models_ctx, seen, candidates = [], set(), []
        if board:
            candidates += [m for m in board.item_ids.mapped('model_name') if m]
        low = ' %s ' % prompt.lower()
        for keys, model in MODEL_HINTS:
            if any(k in low for k in keys):
                candidates.append(model)
        # free-form nouns → ir.model lookups (multi-hit, not just the first)
        for w in set(re.findall(r'[a-z][a-z_.]{3,}', low)) - STOP:
            recs = self.env['ir.model'].search(
                [('transient', '=', False), ('model', 'not like', 'ir.%'),
                 '|', ('model', 'ilike', w), ('name', 'ilike', w)], limit=2)
            candidates += [r.model for r in recs]
        for model in candidates:
            if model in seen or not self._installed(model):
                continue
            seen.add(model)
            f = self._fields_of(model)
            Model = self.env[model]
            # selection values are gold for accurate domains
            selections = {}
            try:
                fg = Model.fields_get(attributes=['selection', 'type', 'store'])
                for fname, meta in fg.items():
                    sel = meta.get('selection')
                    if meta.get('type') == 'selection' and sel and len(sel) <= 12:
                        selections[fname] = [k for k, _l in sel][:12]
                    if len(selections) >= 6:
                        break
            except Exception:
                pass
            try:
                count = Model.search_count([])
            except Exception:
                count = 0
            models_ctx.append({
                'model': model,
                'records': count,
                'numeric': [(x['name'], x['label']) for x in f['numeric'][:40]],
                'group': [(x['name'], x['label'], x['ttype'])
                          for x in f['group'][:50]],
                'date': [(x['name'], x['label']) for x in f['date'][:10]],
                'selection_values': selections,
            })
            if len(models_ctx) >= 5:
                break
        return models_ctx

    def _llm_plan(self, prompt, board, history):
        params = self._ai_params()
        if params['provider'] == 'builtin' or not params['key']:
            return None, None
        try:
            schema = {
                'say': 'short friendly summary for the user',
                'ops': [
                    {'op': 'create_board', 'vals': {'name': '…', 'theme': 'aurora|nebula|carbon|daylight|solar|blossom', 'description': '…'}},
                    {'op': 'add_widget', 'vals': {'name': '…', 'item_type': 'kpi|tile|gauge|bullet|bar|hbar|line|area|waterfall|pie|doughnut|polar|radar|funnel|heatmap|leaderboard|list|todo|text', 'model_name': 'technical.model', 'agg': 'count|sum|avg|min|max', 'measure_names': 'field_name', 'group_field_name': 'field_name', 'group_granularity': 'day|week|month|quarter|year', 'subgroup_field_name': 'field_name', 'date_field_name': 'field_name', 'date_preset_item': 'dashboard|this_month|this_year|last_30|…', 'domain': "[('state','=','sale')]", 'record_limit': 10, 'sort_dir': 'desc', 'use_currency': True, 'enable_forecast': True, 'compare_previous_item': True, 'list_field_names': 'a,b,c'}, 'pos': {'x': 0, 'y': 0, 'w': 6, 'h': 8}},
                    {'op': 'update_widget', 'target': 'widget name', 'vals': {}},
                    {'op': 'remove_widget', 'target': 'widget name'},
                    {'op': 'set_board', 'vals': {'name': '…', 'theme': '…', 'accent_color': '#7C6CFF', 'date_preset': 'this_year'}},
                    {'op': 'blueprint', 'key': 'sales|crm'},
                    {'op': 'query', 'model': 'technical.model', 'agg': 'count|sum|avg', 'measure': 'field|false', 'group': 'field|false', 'preset': 'this_year', 'limit': 10},
                    {'op': 'link_boards', 'targets': ['other board name', '…']},
                ],
            }
            schema['ops'][1]['vals'].update({
                'alert_rule': 'off|above|below', 'alert_value': 1000.0,
                'alert_color': '#FF5470',
            })
            presets = [k for k, _l in DATE_PRESETS]
            company = self.env.company
            board_ctx = {
                'today': str(self.env.cr.now().date()),
                'company': company.name,
                'currency': company.currency_id.symbol,
                'all_boards': self.env['nova.dashboard'].search([]).mapped('name')[:20],
                'current_board': board.name if board else None,
                'widgets': [{'name': i.name, 'type': i.item_type,
                             'model': i.model_name,
                             'measures': i.measure_field_ids.mapped('name'),
                             'group': i.group_field_id.name or False}
                            for i in (board.item_ids if board else [])][:30],
            }
            sys = (
                "You are NovaMind, the AI copilot inside NovaBoard (an Odoo "
                "dashboard builder). Convert the user's request into a JSON "
                "plan. Respond with ONLY valid JSON shaped as "
                "{\"say\": str, \"ops\": [...]} — no markdown, no prose.\n"
                "Op schema (examples of every op):\n" + json.dumps(schema) +
                "\nRules: use ONLY technical model/field names from the "
                "catalog below; omit keys you don't need; domains are Odoo "
                "domain strings; valid date presets: " + ','.join(presets) +
                "; grid is 12 columns wide, KPI≈3x5, charts≈6x9; 'top N' → "
                "leaderboard with record_limit+sort_dir desc; create_board "
                "first when the user asks for a whole dashboard, then "
                "add_widget ops with pos; you may emit up to 25 ops and "
                "fully honour multi-line briefs (themes, domains using the "
                "provided selection_values, alerts, linking, layout); "
                "alert_rule makes a value card pulse in alert_color when the "
                "threshold trips; link_boards pins sibling boards as "
                "quick-switch chips.\n"
                "Catalog: " + json.dumps(self._llm_context(prompt, board)) +
                "\nContext: " + json.dumps(board_ctx)
            )
            messages = [{'role': 'system', 'content': sys}]
            for h in (history or [])[-10:]:
                if h.get('role') in ('user', 'assistant') and h.get('content'):
                    messages.append({'role': h['role'],
                                     'content': str(h['content'])[:600]})
            messages.append({'role': 'user', 'content': prompt})
            content = self._llm_complete(sys, messages[1:], params)
            content = re.sub(r'^```(?:json)?|```$', '',
                             content.strip(), flags=re.M).strip()
            plan = json.loads(content)
            if not isinstance(plan, dict) or not isinstance(plan.get('ops'), list):
                return None, _("model returned an unusable plan")
            plan['ops'] = plan['ops'][:25]
            plan.setdefault('say', '')
            return plan, None
        except Exception as e:
            _logger.info("NovaMind LLM fallback to built-in brain: %s", e)
            return None, str(e)[:160]

    # ================================================================== #
    # Executor                                                            #
    # ================================================================== #
    def _execute(self, plan, board):
        Board = self.env['nova.dashboard']
        Item = self.env['nova.dashboard.item']
        ops = plan.get('ops') or []
        manager = self.env.user.has_group('nova_dashboard.group_nova_manager')
        if not manager and any(o.get('op') in MUTATING for o in ops):
            return {'reply': _("You'd need the NovaBoard Manager group for me "
                               "to build or modify dashboards — I can still "
                               "answer data questions."),
                    'actions': [], 'reload': False,
                    'board_id': board.id or False, 'table': None}

        actions, reload_, table = [], False, None
        target = board
        new_layout = {}
        say = plan.get('say') or ''

        for op in ops:
            kind = op.get('op')
            try:
                if kind == 'create_board':
                    vals = {k: v for k, v in (op.get('vals') or {}).items()
                            if k in ('name', 'description', 'theme',
                                     'accent_color', 'date_preset')}
                    if vals.get('theme') not in dict(THEMES):
                        vals.pop('theme', None)
                    vals.setdefault('name', _('NovaMind Board'))
                    target = Board.create(vals)
                    new_layout = {}
                    actions.append(_("Created dashboard “%s”") % target.name)
                    reload_ = True

                elif kind == 'add_widget':
                    if not target:
                        target = Board.create({'name': _('NovaMind Board')})
                        reload_ = True
                    vals = Item._sanitize_import_vals(
                        dict(op.get('vals') or {}, dashboard_id=target.id))
                    item = Item.create(vals)
                    pos = op.get('pos')
                    if isinstance(pos, dict) and {'x', 'y', 'w', 'h'} <= set(pos):
                        new_layout[str(item.id)] = {k: int(pos[k])
                                                    for k in ('x', 'y', 'w', 'h')}
                    actions.append(_("Added %s “%s”") % (item.item_type, item.name))
                    reload_ = True

                elif kind == 'update_widget' and target:
                    it = self._match_item(target, op.get('target'))
                    if it:
                        vals = Item._sanitize_import_vals(dict(op.get('vals') or {}))
                        vals.pop('dashboard_id', None)
                        it.write(vals)
                        actions.append(_("Updated “%s”") % it.name)
                        reload_ = True

                elif kind == 'remove_widget' and target:
                    it = self._match_item(target, op.get('target'))
                    if it:
                        actions.append(_("Removed “%s”") % it.name)
                        it.unlink()
                        reload_ = True
                    else:
                        actions.append(_("Couldn't find a widget matching "
                                         "“%s”") % (op.get('target') or ''))

                elif kind == 'set_board' and target:
                    vals = {k: v for k, v in (op.get('vals') or {}).items()
                            if k in ('name', 'theme', 'accent_color',
                                     'date_preset', 'description')}
                    if 'theme' in vals and vals['theme'] not in dict(THEMES):
                        vals.pop('theme')
                    if vals:
                        target.write(vals)
                        actions.append(_("Updated board settings"))
                        reload_ = True

                elif kind == 'blueprint':
                    bid = Board._load_blueprint(op.get('key'))
                    if bid:
                        target = Board.browse(bid)
                        actions.append(_("Built “%s” from blueprint") % target.name)
                        reload_ = True
                    else:
                        actions.append(_("That blueprint needs an app that "
                                         "isn't installed here."))

                elif kind == 'samples':
                    ids = Board.web_install_samples()
                    if ids:
                        target = Board.browse(ids[0])
                        actions.append(_("Installed %s sample dashboard(s)") % len(ids))
                        reload_ = True
                    else:
                        actions.append(_("Samples need the Sales or CRM app."))

                elif kind == 'link_boards' and target:
                    names = [str(n).strip().lower()
                             for n in (op.get('targets') or []) if n]
                    sibs = Board.search([('id', '!=', target.id)])
                    hits = sibs.filtered(
                        lambda b: b.name.lower() in names or
                        any(n in b.name.lower() for n in names))
                    if hits:
                        target.linked_board_ids = [(4, b.id) for b in hits]
                        for b in hits:
                            b.linked_board_ids = [(4, target.id)]
                        actions.append(_("Linked with %s") %
                                       ', '.join(hits.mapped('name')))
                        reload_ = True
                    else:
                        actions.append(_("Couldn't find boards to link."))

                elif kind == 'query':
                    answer, table = self._run_query(op)
                    say = (say + '\n' + answer).strip() if say else answer

            except Exception as e:
                _logger.warning("NovaMind op %s failed: %s", kind, e)
                actions.append(_("Skipped one step (%s)") % str(e)[:80])

        if new_layout and target:
            layout = target._layout_dict()
            layout.update(new_layout)
            target.layout_json = layout

        if not say and actions:
            say = _("Done.")
        return {'reply': say or _("Nothing to do — try rephrasing?"),
                'actions': actions, 'reload': reload_,
                'board_id': (target.id if target else False), 'table': table}

    def _match_item(self, board, needle):
        if not needle:
            return None
        needle = str(needle).strip().lower()
        if needle.isdigit():
            it = board.item_ids.filtered(lambda i: i.id == int(needle))
            if it:
                return it[0]
        exact = board.item_ids.filtered(lambda i: i.name.lower() == needle)
        if exact:
            return exact[0]
        part = board.item_ids.filtered(lambda i: needle in i.name.lower())
        return part[0] if part else None

    def _run_query(self, op):
        model = op.get('model')
        if not model or not self._installed(model):
            return _("I couldn't resolve that model."), None
        Model = self.env[model]
        eng = self.env['nova.engine']
        fields_ = self._fields_of(model)
        date_f = self._pick_date(fields_)
        rng, _prev = eng.date_range(op.get('preset') or 'this_year')
        dom = []
        if rng and date_f:
            frec = self.env['ir.model.fields'].search(
                [('model', '=', model), ('name', '=', date_f['name'])], limit=1)
            if frec:
                dom = eng._range_domain(frec, rng)

        agg = op.get('agg') or 'count'
        measure = op.get('measure')
        monetary = bool(op.get('monetary'))
        if measure and measure not in {f['name'] for f in fields_['numeric']}:
            measure = None
        spec = ['%s:%s' % (measure, agg)] if (measure and agg != 'count') else ['__count']
        group = op.get('group')
        if group and group not in {f['name'] for f in fields_['group']}:
            group = None
        gtt = op.get('group_ttype')
        gspec = []
        if group:
            gspec = ['%s:month' % group] if gtt in ('date', 'datetime') else [group]

        currency = self.env.company.currency_id if monetary else None
        label = dict(DATE_PRESETS).get(op.get('preset') or 'this_year', '')

        order_field = measure if (measure and agg != 'count') else '__count'
        rows = Model.read_group(dom, spec, gspec,
                                limit=op.get('limit') or 10,
                                orderby=('%s desc' % order_field) if gspec else False,
                                lazy=False)
        def val_of(r):
            if measure and agg != 'count':
                return r.get(measure) or 0.0
            return r.get('__count') or 0

        if not gspec:
            v = val_of(rows[0]) if rows else 0
            disp = eng.fmt_value(v, 'compact', currency, '')
            what = (_('%s of %s') % (agg, measure)) if measure and agg != 'count' \
                else _('count')
            return _("%(model)s — %(what)s, %(period)s: **%(val)s**") % {
                'model': Model._description or model, 'what': what,
                'period': label, 'val': disp}, None

        gkey = gspec[0]
        table_rows = []
        for r in rows:
            raw = r.get(gkey)
            if isinstance(raw, tuple):
                glabel = raw[1]
            elif raw is False or raw is None:
                glabel = _('Undefined')
            else:
                glabel = str(raw)
            table_rows.append([glabel,
                               eng.fmt_value(val_of(r), 'compact', currency, '')])
        head = group.replace('_', ' ').title()
        answer = _("Here's %(model)s by %(group)s (%(period)s):") % {
            'model': Model._description or model, 'group': head,
            'period': label}
        return answer, {'headers': [head, _('Value')], 'rows': table_rows}
