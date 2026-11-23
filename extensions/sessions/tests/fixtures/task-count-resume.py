"""Real Pi admission, result and reopening, using only a disposable session and offline provider."""
import json
import os
import sys
from activity_fixture import workspace, pi_args
from terminal_fixture import Terminal, has

with workspace() as (root,profile):
    (root/'source.txt').write_text('synthetic evidence')
    env={'HOME':str(root),'PATH':os.environ['PATH'],'TMPDIR':str(root),'TERM':'xterm-256color','PI_OFFLINE':'1',
         'PI_CODING_AGENT_DIR':str(profile),'SS_FIXTURE_REAL_CHILD':'1'}
    session=root/'test.jsonl'
    args=pi_args(*sys.argv[1:3],'Contador'); i=args.index('--no-session'); args[i:i+1]=['--session',str(session)]
    for fresh in [True,False]:
        t=Terminal(root,env,'fresh' if fresh else 'resume','Contador',args)
        try:
            t.wait(lambda l,d:bool(l),'startup')
            if fresh:
                t.paste('Find the synthetic evidence'); t.key(b'\r')
                t.wait(lambda l,d:has(l,'INTEGRATED'),'real helper result delivered')
            t.key(b'\x1ba'); t.wait(lambda l,d:has(l,'Subagentes · 1 lanzado') and not any('│' in s and 'Source evidence' in s.split('│')[-1] for s in l),'one admission, no active row')
        finally: t.close()
        rows=[json.loads(l) for l in session.read_text().splitlines()]
        ids=[r['data'] for r in rows if r.get('customType')=='stela-subagent-admitted']
        assert len(ids)==1 and list(ids[0])==['taskId'] and any(r.get('customType')=='stela-subagent-result' and r.get('details',{}).get('taskId')==ids[0]['taskId'] for r in rows)
print('Admission and resume checked in two Pi terminals')
