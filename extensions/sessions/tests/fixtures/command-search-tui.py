"""Real slash menu, project handler and dialogs; deterministic status-only Brain, private Linux PTY."""
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time
from activity_fixture import HERE, workspace

ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)')
with workspace() as (root,profile):
    work=root/'work'; work.mkdir(); vault=root/'vault'; vault.mkdir()
    cfg=root/'.config/brain'; cfg.mkdir(parents=True); (cfg/'config.toml').write_text('config_version = 1\nvault_path = '+json.dumps(str(vault))+'\n')
    brain=root/'brain'; brain.write_text('''#!/usr/bin/env python3
import json,sys
from pathlib import Path
home=Path.home(); req=json.load(sys.stdin); op=req['operation']
with (home/'calls').open('a') as f: print(sys.argv[1],op,file=f)
assert sys.argv[1:]==['projects'] and op=='status'
print(json.dumps(dict(protocol_version=1,request_id=req['request_id'],operation=op,result=dict(status='unbound',binding='none',allow_write=False,principal=None,expected=dict(vault_directory=str(home/'vault'),marker=None,legacy_marker=None,memory={'status':'unbound'})))))
'''); brain.chmod(0o700)
    frame=root/'frame'; calls=root/'calls'; fd,slave=pty.openpty()
    def resize(w): fcntl.ioctl(fd,termios.TIOCSWINSZ,struct.pack('HHHH',46,w,0,0))
    resize(124)
    extensions=HERE.parents[2]
    args=[*sys.argv[1:3],'--offline','--no-session','--approve','--no-extensions','--no-skills','--no-mcp','--no-prompt-templates','--no-context-files','--tui-mode','fullscreen',
          '--model','ss-fixture/deterministic','--tools','+ss_memory_read,+ss_memory_save']
    for path in [extensions/'sessions/index.ts',extensions/'knowledge/index.ts',extensions/'memory/index.ts',extensions/'subagents/tests/fixtures/provider.ts',HERE/'activity.ts']:
        args+=['-e',str(path)]
    proc=subprocess.Popen(args,cwd=work,env={'HOME':str(root),'PATH':os.environ['PATH'],'TMPDIR':str(root),'TERM':'xterm-256color',
        'PI_OFFLINE':'1','PI_CODING_AGENT_DIR':str(profile),'BRAIN_BIN':str(brain),'SS_FIXTURE_SCREEN':str(frame)},stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
    os.close(slave); log=bytearray()
    def key(data): os.write(fd,data)
    def drain():
        if select.select([fd],[],[],.02)[0]: log.extend(os.read(fd,100000))
    def snapshot(check):
        end=time.monotonic()+6; last=''
        while time.monotonic()<end and proc.poll() is None:
            key(b'\x1b[19~'); pause=time.monotonic()+.14
            while time.monotonic()<pause:
                drain()
                if frame.exists():
                    v=json.loads(frame.read_text()); frame.unlink(); last='\n'.join(ANSI.sub('',s).rstrip() for s in v['lines'])
                    if check(last,v['draft']): return last
                    break
        raise AssertionError('Missing fixture screen: '+last+'\n'+ANSI.sub('',log.decode(errors='replace'))[-1000:])
    def wait_output(s):
        end=time.monotonic()+7
        while time.monotonic()<end and proc.poll() is None:
            drain()
            if s in ANSI.sub('',log.decode(errors='replace')): return
        raise AssertionError('Missing '+s+' in '+ANSI.sub('',log.decode(errors='replace'))[-2000:])
    try:
        wait_output('[Extensions]'); key(b'/proyecto')
        snapshot(lambda s,d:d=='/proyecto' and re.search(r'→ ss-project\s+.*Elegir o crear el proyecto',s)); assert not calls.exists()
        key(b'\t'); snapshot(lambda s,d:d=='/ss-project ' and '→ ss-project' not in s); assert not calls.exists()
        key(b'\x15'); key(b'/atajos'); snapshot(lambda s,d:d=='/atajos' and 'Ver los atajos de teclado activos' in s)
        key(b'\x1b'); snapshot(lambda s,d:d=='/atajos' and '→ hotkeys' not in s); assert not calls.exists()
        key(b'\t'); snapshot(lambda s,d:d=='/atajos' and '→ hotkeys' in s); assert not calls.exists()
        key(b'\x1b'); snapshot(lambda s,d:d=='/atajos' and '→ hotkeys' not in s)
        key(b'\x15'); snapshot(lambda s,d:d==''); resize(38); os.kill(proc.pid,signal.SIGWINCH); key(b'/proyecto')
        snapshot(lambda s,d:d=='/proyecto' and 'ss-project · Elegir o crear' in s)
        resize(124); os.kill(proc.pid,signal.SIGWINCH); key(b'\r'); wait_output('Proyecto de esta carpeta: sin vincular')
        key(b'\x1b[B'); wait_output('Crear un Project nuevo'); key(b'\x1b'); snapshot(lambda s,d:'Proyecto de esta carpeta:' not in s and d=='')
        assert calls.read_text().splitlines()==['projects status']; assert not (work/'.brain.toml').exists() and not list(vault.iterdir())
        key(b'/model determ'); snapshot(lambda s,d:d=='/model determ' and re.search(r'→ .*deterministic',s) and '→ ss-project' not in s)
        key(b'\r'); snapshot(lambda s,d:d.startswith('/model ') and 'deterministic' in d and '→ ' not in s)
        key(b'\x15'); snapshot(lambda s,d:d=='')
        key(b'/atajos'); snapshot(lambda s,d:d=='/atajos' and '→ hotkeys' in s); key(b'\r'); wait_output('Read synthetic fixture frame')
        key(b'\x10'); wait_output('Only one model')
        print('project search verified')
    finally:
        if proc.poll() is None: os.killpg(proc.pid,signal.SIGTERM)
        try: proc.wait(3)
        except subprocess.TimeoutExpired: os.killpg(proc.pid,signal.SIGKILL); proc.wait()
        os.close(fd)
