# -*- coding: utf-8 -*-
"""NovaBoard analytics engine.

Pure-Python intelligence layer: timezone-correct date bucketing, temporal gap
filling, least-squares forecasting with confidence bands, z-score anomaly
detection and natural-language insight generation. Zero external dependencies.
"""
import calendar
import math
from datetime import datetime, date, time, timedelta

import pytz

from odoo import api, fields, models, _
from odoo.osv import expression
from odoo.tools.safe_eval import safe_eval


GRAN_DELTAS = {
    'hour': timedelta(hours=1),
    'day': timedelta(days=1),
    'week': timedelta(weeks=1),
}

DATE_PRESETS = [
    ('none', 'No Filter'),
    ('today', 'Today'),
    ('yesterday', 'Yesterday'),
    ('this_week', 'This Week'),
    ('last_week', 'Last Week'),
    ('last_7', 'Last 7 Days'),
    ('last_30', 'Last 30 Days'),
    ('last_90', 'Last 90 Days'),
    ('last_365', 'Last 365 Days'),
    ('this_month', 'This Month'),
    ('last_month', 'Last Month'),
    ('this_quarter', 'This Quarter'),
    ('last_quarter', 'Last Quarter'),
    ('this_year', 'This Year'),
    ('last_year', 'Last Year'),
    ('mtd', 'Month to Date'),
    ('qtd', 'Quarter to Date'),
    ('ytd', 'Year to Date'),
    ('custom', 'Custom Range'),
]


def _month_add(d, months):
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


class NovaEngine(models.AbstractModel):
    _name = 'nova.engine'
    _description = 'NovaBoard Analytics Engine'

    # ------------------------------------------------------------------ #
    # Date intelligence                                                   #
    # ------------------------------------------------------------------ #
    @api.model
    def _user_tz(self):
        try:
            return pytz.timezone(self.env.user.tz or 'UTC')
        except Exception:
            return pytz.UTC

    @api.model
    def _today_local(self):
        return datetime.now(self._user_tz()).date()

    @api.model
    def date_range(self, preset, start=None, end=None):
        """Return ((start_d, end_d), (prev_start_d, prev_end_d)) local dates,
        end exclusive. prev = immediately preceding window of equal length,
        snapped to the natural previous period for calendar presets."""
        today = self._today_local()
        s = e = ps = pe = None
        if preset in (False, None, 'none'):
            return None, None
        if preset == 'custom':
            if not (start and end):
                return None, None
            s = fields.Date.to_date(start)
            e = fields.Date.to_date(end) + timedelta(days=1)
            span = (e - s).days
            ps, pe = s - timedelta(days=span), s
        elif preset == 'today':
            s, e = today, today + timedelta(days=1)
            ps, pe = s - timedelta(days=1), s
        elif preset == 'yesterday':
            s, e = today - timedelta(days=1), today
            ps, pe = s - timedelta(days=1), s
        elif preset in ('this_week', 'last_week'):
            s = today - timedelta(days=today.weekday())
            if preset == 'last_week':
                s -= timedelta(weeks=1)
            e = s + timedelta(weeks=1)
            ps, pe = s - timedelta(weeks=1), s
        elif preset in ('last_7', 'last_30', 'last_90', 'last_365'):
            n = int(preset.split('_')[1])
            e = today + timedelta(days=1)
            s = e - timedelta(days=n)
            ps, pe = s - timedelta(days=n), s
        elif preset in ('this_month', 'last_month'):
            s = today.replace(day=1)
            if preset == 'last_month':
                s = _month_add(s, -1)
            e = _month_add(s, 1)
            ps, pe = _month_add(s, -1), s
        elif preset in ('this_quarter', 'last_quarter'):
            qm = 3 * ((today.month - 1) // 3) + 1
            s = date(today.year, qm, 1)
            if preset == 'last_quarter':
                s = _month_add(s, -3)
            e = _month_add(s, 3)
            ps, pe = _month_add(s, -3), s
        elif preset in ('this_year', 'last_year'):
            y = today.year - (1 if preset == 'last_year' else 0)
            s, e = date(y, 1, 1), date(y + 1, 1, 1)
            ps, pe = date(y - 1, 1, 1), s
        elif preset == 'mtd':
            s, e = today.replace(day=1), today + timedelta(days=1)
            ps = _month_add(s, -1)
            pe = min(ps + (e - s), s)
        elif preset == 'qtd':
            qm = 3 * ((today.month - 1) // 3) + 1
            s, e = date(today.year, qm, 1), today + timedelta(days=1)
            ps = _month_add(s, -3)
            pe = min(ps + (e - s), s)
        elif preset == 'ytd':
            s, e = date(today.year, 1, 1), today + timedelta(days=1)
            ps = date(today.year - 1, 1, 1)
            pe = min(ps + (e - s), s)
        else:
            return None, None
        return (s, e), (ps, pe)

    @api.model
    def _range_domain(self, field_rec, rng):
        """Build a timezone-correct domain for a (start, end-exclusive) local
        date range against a date or datetime field."""
        if not rng or not field_rec:
            return []
        s, e = rng
        fname, ftype = field_rec.name, field_rec.ttype
        if ftype == 'datetime':
            tz = self._user_tz()
            sdt = tz.localize(datetime.combine(s, time.min)).astimezone(pytz.UTC).replace(tzinfo=None)
            edt = tz.localize(datetime.combine(e, time.min)).astimezone(pytz.UTC).replace(tzinfo=None)
            return [(fname, '>=', fields.Datetime.to_string(sdt)),
                    (fname, '<', fields.Datetime.to_string(edt))]
        return [(fname, '>=', fields.Date.to_string(s)),
                (fname, '<', fields.Date.to_string(e - timedelta(days=1)))]

    # ------------------------------------------------------------------ #
    # Domain helpers                                                      #
    # ------------------------------------------------------------------ #
    @api.model
    def safe_domain(self, dom_str):
        if not dom_str:
            return []
        try:
            ctx = {
                'uid': self.env.user.id,
                'user': self.env.user,
                'company_id': self.env.company.id,
                'allowed_company_ids': self.env.companies.ids,
                'context_today': fields.Date.context_today,
                'datetime': datetime, 'date': date, 'timedelta': timedelta,
                'True': True, 'False': False,
            }
            dom = safe_eval(dom_str, ctx)
            return dom if isinstance(dom, list) else []
        except Exception:
            return []

    # ------------------------------------------------------------------ #
    # Bucketing / temporal fill                                           #
    # ------------------------------------------------------------------ #
    @api.model
    def _bucket_meta(self, group, gran):
        """Extract (sort_key_date, label) from a read_group row for a date
        groupby, robust to missing __range."""
        key = group.get('__range', {})
        rng = None
        for k, v in key.items():
            if isinstance(v, dict) and v.get('from'):
                rng = v['from']
                break
        if rng:
            d = fields.Date.to_date(rng[:10])
        else:
            d = None
        return d

    @api.model
    def _next_bucket(self, d, gran):
        if gran in GRAN_DELTAS:
            return d + GRAN_DELTAS[gran]
        if gran == 'month':
            return _month_add(d, 1)
        if gran == 'quarter':
            return _month_add(d, 3)
        if gran == 'year':
            return date(d.year + 1, 1, 1)
        return d + timedelta(days=1)

    @api.model
    def _bucket_label(self, d, gran):
        try:
            if gran == 'hour':
                return d.strftime('%d %b %H:00')
            if gran == 'day':
                return d.strftime('%d %b %Y')
            if gran == 'week':
                return 'W%s %s' % (d.isocalendar()[1], d.year)
            if gran == 'month':
                return d.strftime('%b %Y')
            if gran == 'quarter':
                return 'Q%s %s' % ((d.month - 1) // 3 + 1, d.year)
            if gran == 'year':
                return str(d.year)
        except Exception:
            pass
        return str(d)

    # ------------------------------------------------------------------ #
    # Statistics: forecast / anomalies / trend                            #
    # ------------------------------------------------------------------ #
    @api.model
    def forecast(self, values, periods=3):
        """Least-squares linear regression. Returns dict with predicted points,
        upper/lower confidence band (±1.96·RMSE) and R²."""
        n = len(values)
        if n < 3 or periods <= 0:
            return None
        xs = list(range(n))
        mx = sum(xs) / n
        my = sum(values) / n
        sxx = sum((x - mx) ** 2 for x in xs)
        if not sxx:
            return None
        sxy = sum((xs[i] - mx) * (values[i] - my) for i in range(n))
        slope = sxy / sxx
        intercept = my - slope * mx
        fit = [slope * x + intercept for x in xs]
        ss_res = sum((values[i] - fit[i]) ** 2 for i in range(n))
        ss_tot = sum((v - my) ** 2 for v in values) or 1.0
        r2 = max(0.0, 1 - ss_res / ss_tot)
        rmse = math.sqrt(ss_res / n)
        band = 1.96 * rmse
        pred = [slope * (n + i) + intercept for i in range(periods)]
        return {
            'points': [round(p, 4) for p in pred],
            'upper': [round(p + band, 4) for p in pred],
            'lower': [round(p - band, 4) for p in pred],
            'r2': round(r2, 3),
            'slope': round(slope, 6),
        }

    @api.model
    def anomalies(self, values, threshold=2.2):
        """Indices of z-score outliers (|z| > threshold)."""
        n = len(values)
        if n < 5:
            return []
        mean = sum(values) / n
        var = sum((v - mean) ** 2 for v in values) / n
        sd = math.sqrt(var)
        if sd < 1e-9:
            return []
        return [i for i, v in enumerate(values) if abs((v - mean) / sd) > threshold]

    @api.model
    def trend(self, values):
        """Classify momentum from the regression slope, normalized by mean."""
        fc = self.forecast(values, 1)
        if not fc:
            return 'flat', 0.0
        mean = (sum(abs(v) for v in values) / len(values)) or 1.0
        norm = fc['slope'] / mean
        if norm > 0.05:
            return 'rising', norm
        if norm < -0.05:
            return 'falling', norm
        return 'flat', norm

    @api.model
    def pct_change(self, cur, prev):
        if prev in (None, 0):
            return None
        try:
            return round((cur - prev) / abs(prev) * 100.0, 1)
        except Exception:
            return None

    # ------------------------------------------------------------------ #
    # Narrative insights                                                  #
    # ------------------------------------------------------------------ #
    @api.model
    def insight_for_series(self, name, labels, values, measure_label, fc=None, anomaly_idx=None):
        bits = []
        if values:
            total = sum(values)
            peak_i = max(range(len(values)), key=lambda i: values[i])
            bits.append(_("%(m)s peaked at %(v)s in %(l)s",
                          m=measure_label, v=self.compact(values[peak_i]),
                          l=labels[peak_i] if peak_i < len(labels) else '?'))
            t, norm = self.trend(values)
            if t == 'rising':
                bits.append(_("momentum is rising (+%s%% per period)") % round(norm * 100, 1))
            elif t == 'falling':
                bits.append(_("momentum is falling (%s%% per period)") % round(norm * 100, 1))
            if len(values) >= 2 and values[-2]:
                d = self.pct_change(values[-1], values[-2])
                if d is not None:
                    bits.append(_("last period moved %s%%") % (('+%s' % d) if d >= 0 else d))
        if fc and fc.get('points'):
            conf = _('high') if fc['r2'] >= 0.7 else _('moderate') if fc['r2'] >= 0.4 else _('low')
            bits.append(_("projected next period: %(v)s (R²=%(r)s, %(c)s confidence)",
                          v=self.compact(fc['points'][0]), r=fc['r2'], c=conf))
        if anomaly_idx:
            lbl = ', '.join(labels[i] for i in anomaly_idx[:3] if i < len(labels))
            bits.append(_("anomalies detected at %s") % lbl)
        return ' · '.join(bits[:4]) if bits else False

    @api.model
    def insight_for_kpi(self, name, value, prev, delta, target, target_pct, trend_dir):
        bits = []
        if delta is not None:
            word = _('up') if delta >= 0 else _('down')
            bits.append(_("%(n)s is %(w)s %(d)s%% vs previous period", n=name, w=word, d=abs(delta)))
        if target and target_pct is not None:
            if target_pct >= 100:
                bits.append(_("target achieved (%s%%)") % round(target_pct, 1))
            else:
                bits.append(_("%s%% of target reached") % round(target_pct, 1))
        if trend_dir == 'rising':
            bits.append(_("trajectory is positive"))
        elif trend_dir == 'falling':
            bits.append(_("trajectory needs attention"))
        return ' · '.join(bits[:3]) if bits else False

    # ------------------------------------------------------------------ #
    # Formatting                                                          #
    # ------------------------------------------------------------------ #
    @api.model
    def compact(self, value, digits=1):
        try:
            v = float(value)
        except Exception:
            return str(value)
        sign = '-' if v < 0 else ''
        v = abs(v)
        for unit, div in (('T', 1e12), ('B', 1e9), ('M', 1e6), ('K', 1e3)):
            if v >= div:
                num = round(v / div, digits)
                if num == int(num):
                    num = int(num)
                return '%s%s%s' % (sign, num, unit)
        if v == int(v):
            return '%s%s' % (sign, int(v))
        return '%s%s' % (sign, round(v, 2))

    @api.model
    def fmt_value(self, value, style='compact', currency=None, unit=''):
        if style == 'compact':
            txt = self.compact(value)
        else:
            try:
                txt = '{:,.2f}'.format(float(value)).rstrip('0').rstrip('.')
            except Exception:
                txt = str(value)
        if currency:
            return ('%s %s' % (currency.symbol, txt)) if currency.position == 'before' \
                else ('%s %s' % (txt, currency.symbol))
        if unit:
            return '%s %s' % (txt, unit)
        return txt
