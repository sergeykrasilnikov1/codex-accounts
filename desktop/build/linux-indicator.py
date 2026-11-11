#!/usr/bin/python3
"""Native Ubuntu AppIndicator. Menu data/actions travel over private stdio pipes."""
import json
import os
import sys
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('AyatanaAppIndicator3', '0.1')
from gi.repository import Gtk, GLib, AyatanaAppIndicator3

indicator = AyatanaAppIndicator3.Indicator.new(
    'codex-accounts', sys.argv[1], AyatanaAppIndicator3.IndicatorCategory.APPLICATION_STATUS)
indicator.set_title('Codex Accounts')
indicator.set_status(AyatanaAppIndicator3.IndicatorStatus.ACTIVE)


def activated(_item, generation, identifier):
    print(json.dumps({'generation': generation, 'id': identifier}), flush=True)


def update(message):
    menu = Gtk.Menu()
    for index, item in enumerate(message['items']):
        if item.get('type') == 'separator':
            widget = Gtk.SeparatorMenuItem()
        elif item.get('type') == 'checkbox':
            widget = Gtk.CheckMenuItem.new_with_label(item.get('label', ''))
            widget.set_active(bool(item.get('checked')))
        else:
            widget = Gtk.MenuItem.new_with_label(item.get('label', ''))
        widget.set_sensitive(item.get('enabled', True))
        if item.get('type') != 'separator':
            widget.connect('activate', activated, message['generation'], index)
        menu.append(widget)
    menu.show_all()
    indicator.set_menu(menu)


pending = b''
os.set_blocking(sys.stdin.fileno(), False)


def read_input(_source, condition):
    global pending
    if condition & (GLib.IO_HUP | GLib.IO_ERR):
        Gtk.main_quit()
        return False
    chunk = os.read(sys.stdin.fileno(), 65536)
    if not chunk:
        Gtk.main_quit()
        return False
    pending += chunk
    while b'\n' in pending:
        line, pending = pending.split(b'\n', 1)
        try:
            update(json.loads(line))
        except (ValueError, KeyError, TypeError):
            pass
    return True


# A usable initial menu also covers the short interval before the parent sends data.
update({'generation': 0, 'items': [{'label': 'Codex Accounts', 'enabled': False}]})
GLib.io_add_watch(sys.stdin, GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, read_input)
Gtk.main()
