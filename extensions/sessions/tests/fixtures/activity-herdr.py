"""Opt-in Linux integration: never reuse the operator's Herdr core, terminal, profile or account."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

from activity_fixture import pi_args, workspace

node, cli, hc = sys.argv[1:4]


def wait(check, label):
    deadline = time.monotonic() + 8
    last = None
    while time.monotonic() < deadline:
        ok, last = check()
        if ok:
            return
        time.sleep(.06)
    raise RuntimeError(f'{label}: {str(last)[-1800:]}')


with workspace() as (root, profile):
    sock = root / 'core.sock'
    env = {'HOME': str(root), 'PATH': str(Path(hc).parent) + ':' + os.environ['PATH'], 'TMPDIR': str(root),
           'HC_SOCKET': str(sock), 'HC_SESSION': 'fixture-' + root.name, 'TERM': 'xterm-256color', 'SHELL': '/bin/sh',
           'PI_CODING_AGENT_DIR': str(profile), 'PI_OFFLINE': '1', 'NO_UPDATE_NOTIFIER': '1'}
    for key in ['CONFIG_HOME', 'RUNTIME_DIR', 'STATE_HOME', 'CACHE_HOME', 'DATA_HOME']:
        path = root / key
        path.mkdir(mode=0o700)
        env['XDG_' + key] = str(path)

    def call(*args):
        return subprocess.check_output([hc, *args], env=env, cwd=root, text=True, stderr=subprocess.STDOUT, timeout=5)

    def capture(addr):
        return call('read', '--lines', '0', addr)

    def contains(addr, text):
        screen = capture(addr)
        return text in screen, screen

    def launch(name):
        data = json.loads(call('run', '--json', '--bg', '--no-parent', '--no-notify', '--rm', '--cwd', str(root), '--',
            '/usr/bin/env', 'HOME=' + str(root), 'PI_CODING_AGENT_DIR=' + str(profile), 'TMPDIR=' + str(root),
            'PI_OFFLINE=1', 'SS_FIXTURE_SCREEN=' + str(root/name), *pi_args(node, cli, name)))
        addr = data['address']
        assert re.fullmatch(r't[0-9a-z]+', addr), data
        wait(lambda: contains(addr, '[Extensions]'), name + ' Pi startup')
        return addr

    assert not sock.exists()
    initial = json.loads(call('server', 'start', '--json'))
    assert sock.is_socket() and initial['live'] == 0 and initial['finished'] == 0, 'Not a pristine private test core'
    identity = initial['core']['id']
    try:
        src = launch('Trabajo'); dest = launch('Docs')
        assert src != dest
        call('keys', src, 'z'); call('keys', dest, 'f7')
        wait(lambda: contains(dest, '¿Conservar el borrador sintético?'), 'native destination dialog')
        wait(lambda: contains(src, 'Docs necesita tu respuesta'), 'notice from real Herdr peer')
        assert '[Ver pregunta' in capture(src)
        call('keys', src, 'alt+j')
        wait(lambda: contains(src, '¿Conservar el borrador sintético?'), 'attached to the exact destination')
        answer = root / 'Docs.answer'
        assert not answer.exists(), 'navigation must not answer the prompt'
        # Only this synthetic user acts in the source dialog; the extension never sends these keys.
        call('keys', src, 'esc')
        wait(lambda: (answer.exists(), 'no answer yet'), 'user cancellation')
        assert answer.read_text() == 'false'
        def hidden_block():
            status = json.loads(call('get', dest, '--json'))['status']
            return status.get('state') == 'blocked' and status.get('msg') == 'Fixture hidden', status
        wait(hidden_block, 'Herdr still reports blocked for a hidden custom overlay')
        call('keys', src, 'ctrl+\\'); call('keys', src, 'f8')
        wait(lambda: ((root/'Trabajo').exists(), capture(src)), 'return to original Pi')
        assert json.loads((root/'Trabajo').read_text())['draft'] == 'z'
        wait(lambda: ('Docs necesita tu respuesta' not in capture(src), 'still displaying question'), 'no notice for a hidden overlay')
        call('keys', dest, 'f9')
        print('Real Herdr attach, cancellation at origin and return to the original draft checked in two Pi terminals.')
    finally:
        if sock.is_socket() and json.loads(call('server', 'status', '--json'))['core']['id'] == identity:
            call('server', 'stop', '--json')
