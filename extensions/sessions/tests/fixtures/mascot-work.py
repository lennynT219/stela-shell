"""Check the actual Kitty frames for text-only work and a held tool, in disposable Pi sessions."""
import hashlib
import json
import os
import re
import sys
from activity_fixture import HERE, pi_args, workspace
from terminal_fixture import Terminal, has

TAGS = json.loads(os.environ['SS_TEST_WORK_POSES'])
KITTY = re.compile(r'\x1b_G([^;]*);([A-Za-z0-9+/=]*)\x1b\\')
DRAFT = 'mi siguiente pregunta'


def sprite(lines):
    rows, pngs = [], []
    for y, line in enumerate(lines):
        parts = list(KITTY.finditer(line))
        if parts and 'a=T,' in parts[0][1]:
            w, h = map(int, re.search(r'c=(\d+),r=(\d+)',parts[0][1]).groups())
            rows.append((parts[0].start(), y, w, h)); pngs.append(''.join(p[2] for p in parts))
    if not rows: return '', None
    x,y,w,h = rows[0]
    if len(rows)>1:
        assert rows == [(x,y+i,w,1) for i in range(4)], rows
        h = len(rows)
    foot = next(i for i,s in enumerate(lines) if s.lstrip().startswith('Ctx '))
    return TAGS[hashlib.sha256('\n'.join(pngs).encode()).hexdigest()], (x, y-foot, w, h, len(rows))


def check(mode):
    with workspace() as (root,profile):
        env = {'PATH':os.environ['PATH'], 'HOME':str(root), 'TMPDIR':str(root), 'TERM':'xterm-256color',
               'PI_CODING_AGENT_DIR':str(profile), 'PI_OFFLINE':'1', 'PI_IMAGE_PROTOCOL':'kitty', 'SS_TEST_TASK_DETAIL':'1'}
        args = pi_args(*sys.argv[1:3], 'Trabajo') + ['-e', str(HERE/'mascot-events.ts')]
        args[args.index('fullscreen')] = mode
        text = mode == 'fullscreen'
        args[args.index('ss-fixture/deterministic')] = 'ss-work-fixture/text' if text else 'ss-session-fixture/deterministic'
        args.extend(['-e', str(HERE/('mascot-work-stream.ts' if text else 'provider.ts'))])
        if not text:
            args.extend(['--tools','read,fixture_hold']); env['SS_SESSION_FIXTURE_ROLE'] = 'receiver'
        t = Terminal(root,env,'t1','Trabajo',args)
        try:
            t.size(64)
            def see(prefix, draft, word=''):
                return t.wait(lambda ls,d: d==draft and (not word or has(ls,word)) and sprite(ls)[0].startswith(prefix), str((mode,prefix,draft,word)))
            see(('sleep','breathe'),''); t.paste('TEXTO' if text else 'BUSY'); t.key(b'\r')
            label = 'TEXTO_EN_CURSO' if text else 'fixture_hold'
            a = see('work8','',label); assert sprite(a)[1] == (55,-3,8,4,1 if text else 4)
            t.paste(DRAFT); b = see('work-8',DRAFT,label); assert sprite(b)[1] == sprite(a)[1]
            def events():
                return [json.loads(s) for s in (root/'t1.json.events').read_text().splitlines()]
            if text:
                t.key(b'\x1bOR')
                def returned(lines,draft):
                    if draft != DRAFT or not any(e['type']=='settled' for e in events()): return False
                    tag = sprite(lines)[0]; assert not tag.startswith('spin'), tag
                    return tag.startswith('float')
                t.wait(returned,'text-only reply returned to the draft, without a ready spin')
            else:
                t.key(b'\x1b[15~'); see('work8',DRAFT,'1 tarea en curso')  # A parallel helper isn't a wait.
                t.key(b'\x15'); t.paste('/fixture-release'); t.key(b'\r')
                see('float-watch-left','','1 tarea en curso'); t.paste(DRAFT)
                t.key(b'\x1b[17~'); see('spin',DRAFT); see('float',DRAFT)
            observed = events()
            assert any(e['type']=='tool' for e in observed) == (not text), observed
            assert [e for e in observed if e['type']=='settled'] == [{'type':'settled','aborted':False}], observed
        finally:
            t.close()


check('fullscreen'); check('regular'); print('Working crown verified in both layouts')
