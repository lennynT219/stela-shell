"""Observe a genuine parent tool overlapping a controlled helper, then the actual settlement wait."""
import hashlib
import json
import os
import re
import sys
from activity_fixture import HERE, pi_args, workspace
from terminal_fixture import Terminal, has

TAGS = json.loads(os.environ['SS_TEST_POSE_TAGS'])
KITTY = re.compile(r'\x1b_G([^;]*);([A-Za-z0-9+/=]*)\x1b\\')
DRAFT = 'sigo escribiendo'


def pose(lines):
    rows, pngs = [], []
    for y, line in enumerate(lines):
        chunks = list(KITTY.finditer(line))
        if chunks and 'a=T,' in chunks[0][1]:
            pngs.append(''.join(c[2] for c in chunks))
            rows.append(y)
    if not pngs: return ''
    assert len(rows)==1 or rows==list(range(rows[0],rows[0]+4)), rows
    tag = TAGS.get(hashlib.sha256('\n'.join(pngs).encode()).hexdigest())
    assert tag, ('unrecognized visible pose', rows)
    return tag


def see(t, kind, draft, text=None):
    return t.wait(lambda lines,d: d==draft and pose(lines).startswith(kind) and (not text or has(lines,text)), str((kind,draft,text)))


def check(mode):
    with workspace() as (root, profile):
        (root/'source.txt').write_text('synthetic evidence')
        env = {'PATH': os.environ['PATH'], 'HOME': str(root), 'TMPDIR': str(root), 'TERM': 'xterm-256color',
               'PI_CODING_AGENT_DIR': str(profile), 'PI_OFFLINE': '1', 'PI_IMAGE_PROTOCOL': 'kitty', 'SS_TEST_TASK_DETAIL': '1'}
        args = pi_args(*sys.argv[1:3], 'Stela')
        args[args.index('fullscreen')] = mode
        if mode == 'fullscreen':
            # F5 admits a helper locally. BUSY submits a real tool call in this Pi while the helper is still running.
            args[args.index('ss-fixture/deterministic')] = 'ss-session-fixture/deterministic'
            args += ['-e', str(HERE/'provider.ts'), '--tools', 'read,fixture_hold']
            env['SS_SESSION_FIXTURE_ROLE'] = 'receiver'
        t = Terminal(root, env, 't1', 'Stela', args); peer = None
        try:
            see(t, ('sleep','breathe'), '')
            if mode == 'fullscreen':
                t.key(b'\x1b[15~'); see(t, ('sleep','breathe'), '', '1 tarea en curso')
                t.paste('BUSY'); t.key(b'\r'); see(t, 'normal', '', 'fixture_hold')
                t.paste('yo redacto'); see(t, 'normal', 'yo redacto', '1 tarea en curso')
                t.key(b'\x15'); t.paste('/fixture-release'); t.key(b'\r')
            else:
                # The normal model-facing delegate tool, independent continuation and result integration.
                t.size(64); t.paste('consulta'); t.key(b'\r')
            see(t, 'float-watch-left', '', '1 tarea en curso'); t.paste(DRAFT)
            ls = see(t, 'float-watch-left-up', DRAFT, '1 tarea en curso')
            if mode == 'fullscreen':
                t.click(ls,'Ver actividad'); see(t, 'float-watch-right', DRAFT, 'Subagentes · 1 lanzado')
                ls = see(t, 'float-watch-right-down', DRAFT, 'Cerrar'); t.click(ls,'Cerrar')
                see(t, 'float-watch-left', DRAFT, '1 tarea en curso')
                peer = Terminal(root, env, 't2', 'Docs'); see(peer, ('sleep','breathe'), '')
                peer.paste('/fixture-question'); peer.key(b'\r')
                see(t, ('lean','look'), DRAFT, 'Docs necesita'); see(t, 'alert', DRAFT, 'Docs necesita')
                peer.key(b'\x1b'); see(t,'float-watch-left',DRAFT,'1 tarea en curso')
            t.key(b'\x1b[17~'); see(t, 'spin', DRAFT)
            ls = see(t, 'normal', DRAFT); assert not has(ls,'1 tarea en curso')
        finally:
            if peer: peer.close()
            t.close()


check('fullscreen'); check('regular'); print('Verified helper wait in both layouts')
