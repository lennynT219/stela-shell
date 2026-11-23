"""Two offline Pi PTYs. Only helper execution and the Herdr CLI are synthetic here."""
import os
from pathlib import Path
import socket

from activity_fixture import workspace
from terminal_fixture import Terminal, has

F5, F6 = b'\x1b[15~', b'\x1b[17~'
TOGGLE, JUMP = b'\x1ba', b'\x1bj'
DRAFT = 'borrador sin enviar\nsegunda línea · 漢字'


with workspace() as (root, profile), socket.socket(socket.AF_UNIX) as core:
    core.bind(str(root / 'core.sock'))
    (root / 'bin').mkdir()
    hc = root / 'bin' / 'hc'
    hc.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
r = Path(os.environ['HOME'])
if sys.argv[1:] == ['get', 't2', '--json']:
    print(json.dumps({'address':'t2','state':'live','status':{'app':'pi','state':'blocked','kind':'permission'},'foreground':{'pid':int((r/'pid').read_text())}}))
elif sys.argv[1:] == ['attach', '--history', '0', 't2']:
    (r/'attached').write_text('t2')
else:
    raise SystemExit('unexpected hc operation')
''')
    hc.chmod(0o700)
    env = {'PATH': str(root/'bin') + ':' + os.environ['PATH'], 'HOME': str(root), 'TERM': 'xterm-256color',
           'TMPDIR': str(root), 'PI_OFFLINE': '1', 'NO_UPDATE_NOTIFIER': '1',
           'PI_CODING_AGENT_DIR': str(profile), 'HC_TERMINAL_SOCKET': str(root/'core.sock')}
    children = []
    try:
        left = Terminal(root, env, 't1', 'Trabajo'); children.append(left)
        right = Terminal(root, env, 't2', 'Docs'); children.append(right)
        (root/'pid').write_text(str(right.proc.pid))
        for t in children:
            t.wait(lambda l, d: bool(l) and not has(l, 'Sin tareas activas'), 'closed on start')

        left.paste(DRAFT)
        left.wait(lambda l, d: d == DRAFT and not has(l, 'Ver actividad'), 'clean chat')
        left.key(F5); left.key(F5)
        lines = left.wait(lambda l, d: has(l, '2 tareas en curso') and not has(l, 'Revisión 1'), 'two tasks, no panel')
        left.click(lines, 'Ver actividad')
        left.wait(lambda l, d: any(s.find('Actividad ·') >= 100 for s in l) and has(l, 'Revisión 2') and d == DRAFT,
                  'clicked notice opens a real right column, preserving focus and draft')
        left.key(F6)
        left.wait(lambda l, d: has(l, 'Sin tareas activas') and not has(l, 'Revisión 2'), 'open empty state')
        left.size(64)
        left.wait(lambda l, d: any(0 <= s.find('Sin tareas activas') < 8 for s in l) and d == DRAFT, 'narrow on resize')
        left.size(112)
        left.wait(lambda l, d: any(s.find('Actividad ·') >= 76 for s in l) and d == DRAFT, 'dock at 112 columns')
        left.size(111)
        lines = left.wait(lambda l, d: any(0 <= s.find('Sin tareas activas') < 8 for s in l), 'fold at 111 columns')
        left.click(lines, 'Cerrar')
        left.wait(lambda l, d: not has(l, 'Sin tareas activas') and d == DRAFT, 'close narrow list by click')
        left.size(64)
        left.key(TOGGLE)
        left.wait(lambda l, d: has(l, 'Sin tareas activas'), 'open narrow list')
        left.key(TOGGLE); left.key(F5)
        left.wait(lambda l, d: has(l, '1 tarea en curso') and not has(l, 'Cerrar'), 'closed while task runs')
        left.key(F6)
        left.wait(lambda l, d: not has(l, 'Ver actividad') and not has(l, 'Sin tareas activas'), 'last task ended while closed')

        answer = Path(str(right.frame) + '.answer')
        right.paste('/fixture-question'); right.key(b'\r')
        left.wait(lambda l, d: has(l, 'Docs necesita tu respuesta') and not has(l, 'Cerrar'), 'peer dialog without panel')
        left.key(JUMP)
        left.wait(lambda l, d: (root/'attached').exists() and has(l, 'Docs necesita tu respuesta') and d == DRAFT,
                  'manual jump did not dismiss the question')
        assert not answer.exists()
        right.key(b'\x1b')
        left.wait(lambda l, d: not has(l, 'Ver pregunta') and answer.exists() and d == DRAFT, 'withdraw on cancellation')
        assert answer.read_text() == 'false'
        answer.unlink()
        right.paste('/fixture-question'); right.key(b'\r')
        left.wait(lambda l, d: has(l, 'Ver pregunta'), 'next distinct question')
        right.key(b'\r')
        left.wait(lambda l, d: not has(l, 'Ver pregunta') and answer.exists() and d == DRAFT, 'withdraw on answer')
        assert answer.read_text() == 'true'
        left.paste('!')
        left.wait(lambda l, d: d == DRAFT + '!', 'editor kept keyboard focus')
        print('Wide split, narrow list, task counts, manual open and draft retention checked in two Pi terminals.')
    finally:
        for terminal in reversed(children):
            terminal.close()
