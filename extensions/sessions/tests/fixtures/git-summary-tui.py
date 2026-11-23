"""Render in Pi's actual 34-cell activity rail. The synthetic upstream never contacts a server."""
import os
import re
import subprocess
from activity_fixture import workspace
from terminal_fixture import Terminal, has, ANSI

with workspace() as (root,profile):
    env={'HOME':str(root),'PATH':os.environ['PATH'],'TMPDIR':str(root),'TERM':'xterm-256color','PI_CODING_AGENT_DIR':str(profile),'PI_OFFLINE':'1','PI_TRUE_COLOR':'1'}
    t=Terminal(root,env,'git-rail','Actividad')
    def git(*args): subprocess.run(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgSign=false',*args],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
    def has_row(lines): return any('↑' in s and '↓' in s and '+' in s and '−' in s for s in lines)
    branch='feature/actividad-con-un-nombre-muy-largo'
    try:
        t.wait(lambda l,d:bool(l),'started'); t.key(b'\x1ba'); t.wait(lambda l,d:has(l,'Sin tareas activas') and not has_row(l),'open panel without repo')
        git('init','-qb',branch); f=root/'data'; f.write_text('keep\nremove\n'); git('add','data'); git('commit','-qm','base'); git('branch','local-base'); git('branch','--set-upstream-to=local-base'); git('commit','--allow-empty','-qm','ahead')
        f.write_text('keep\nfirst\nsecond\n'); t.paste('borrador')
        def row(l): return any(s.find('feature/')>=110 and re.search(r'↑1 ↓0  \+2 −1',s) for s in l)
        t.wait(lambda l,d:d=='borrador' and row(l),'colored counters in narrow dock after live refresh')
        # Read the actual colored frame, not the presentation model. ANSI removed only for locating the row.
        import json,time
        t.key(b'\x1b[19~'); end=time.monotonic()+2
        while not t.frame.exists() and time.monotonic()<end: t.drain(.02)
        data=json.loads(t.frame.read_text()); t.frame.unlink(); raw=next(s for s in data['lines'] if '↑1' in ANSI.sub('',s) and '−1' in ANSI.sub('',s))
        inks=[re.search(r'\x1b\[(38;(?:2;\d+;\d+;\d+|5;\d+))m'+re.escape(word),raw) for word in ['↑1','↓0','+2','−1']]; assert all(inks) and len({m[1] for m in inks})==4,repr(raw)
        t.size(38); t.wait(lambda l,d:has(l,'↑1 ↓0  +2 −1') and d=='borrador','narrow fallback')
        t.key(b'\x1ba'); t.wait(lambda l,d:d=='borrador' and not has_row(l),'closed and draft retained')
    finally: t.close()
    print('Git rail verified')
