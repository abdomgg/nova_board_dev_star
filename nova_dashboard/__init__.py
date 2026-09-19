# -*- coding: utf-8 -*-
from . import models


def post_init_hook(env):
    """Seed packaged blueprint dashboards (Sales / CRM) on first install."""
    env['nova.dashboard']._install_default_samples()


def uninstall_hook(env):
    """Clean programmatically created menus / client actions."""
    actions = env['ir.actions.client'].sudo().search([('tag', '=', 'nova_dashboard_action')])
    menus = env['ir.ui.menu'].sudo().search([('action', 'in', ['ir.actions.client,%s' % a.id for a in actions])])
    menus.unlink()
    actions.unlink()
