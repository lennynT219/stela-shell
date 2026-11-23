"""Pi's real session projection, fullscreen footer, rail and narrow sheet; no operator profile."""
import json
import os
from pathlib import Path
import re
import sys
from activity_fixture import workspace, pi_args, HERE
from terminal_fixture import Terminal, has

with workspace() as (root,profile):
    env={'HOME':str(root),'TMPDIR':str(root),'PATH':os.environ['PATH'],'TERM':'xterm-256color','PI_CODING_AGENT_DIR':str(profile),'PI_OFFLINE':'1',
         'CODEX_HOME':str(root/'codex'),'SS_PANEL_QUOTA_TRACE':str(root/'opens'),'HTTPS_PROXY':'http://127.0.0.1:1','HTTP_PROXY':'http://127.0.0.1:1'}
    (root/'codex').mkdir()
    session=root/'usage.jsonl'
    # 11,800 input and 360 output at $30/$180 per million. 12,160 / 32,000 = 38%; rounded cost = $0.42.
    input_tokens,output_tokens=11800,360
    costs={'input':input_tokens*30/1e6,'output':output_tokens*180/1e6,'cacheRead':0,'cacheWrite':0};costs['total']=sum(costs.values())
    ref='2026-01-01T00:00:00.000Z';sid='13333333-1111-4111-8111-111111111111'
    entries=[{'type':'session','version':3,'id':sid,'timestamp':ref,'cwd':str(root)},
             {'type':'message','id':'00000001','parentId':None,'timestamp':ref,'message':{'role':'user','content':[{'type':'text','text':'example'}],'timestamp':1}},
             {'type':'message','id':'00000002','parentId':'00000001','timestamp':ref,'message':{'role':'assistant','content':[{'type':'text','text':'example answer'}],
              'model':'deterministic','provider':'ss-fixture','api':'ss-fixture-api','stopReason':'stop','timestamp':2,'usage':{'input':input_tokens,'output':output_tokens,'cacheRead':0,'cacheWrite':0,'totalTokens':input_tokens+output_tokens,'cost':costs}}}]
    expected='Ctx 38% · US$0.42 · deterministic'; draft='borrador 漢字';toggle=b'\x1ba'
    for fake in [False,True]:
        session.write_text('\n'.join(map(json.dumps,entries))+'\n');args=pi_args(*sys.argv[1:3],'Consumo');i=args.index('--no-session');args[i:i+1]=['--session',str(session)]
        if fake: args[args.index(str(HERE/'../../index.ts'))]=str(HERE/'usage-panel.ts')
        env['SS_FIXTURE_REASONING']='0' if fake else '1'
        if not fake: args[args.index('--thinking')+1]='medium'
        t=Terminal(root,env,'quota','Consumo',args)
        try:
            initial=expected if fake else expected+' · medium'
            t.wait(lambda l,d:any(s.strip()==initial for s in l) and not has(l,'Reinicio'),'footer reflects model capabilities and selected level')
            t.paste(draft); t.wait(lambda l,d:d==draft,'draft captured')
            if not fake:
                t.key(b'\x1b[Z')  # Shift+Tab: native Pi action; no model turn
                t.wait(lambda l,d:any(s.strip()==expected+' · high' for s in l) and d==draft,'level changed in place')
            t.key(toggle)
            if not fake:
                t.wait(lambda l,d:has(l,'Codex · Inicia sesión') and d==draft,'bundled binary, no login, no fake zeros');continue
            def quota(l):return has(l,'Reinicio') and all(any(re.search(p,s) for s in l) for p in [r'5 h\s+64%',r'7 d\s+28%'])
            t.wait(lambda l,d:quota(l) and has(l,expected) and d==draft,'wide rail shows both account windows separately from chat')
            t.size(38);t.wait(lambda l,d:quota(l) and not has(l,expected) and d==draft,'narrow panel covers footer without discarding draft')
            t.key(toggle);t.wait(lambda l,d:has(l,expected) and not quota(l) and d==draft,'close panel restores compact chat')
            t.key(toggle);t.wait(lambda l,d:has(l,'Consultando'),'pending request');t.key(toggle);t.wait(lambda l,d:not has(l,'Consultando') and has(l,expected),'pending read cancelled')
            t.key(toggle);t.wait(lambda l,d:quota(l) and not has(l,'99%'),'reopen refreshes and never shows stale result')
            assert (root/'opens').read_text().splitlines()==['open 1','open 2','abort 2','open 3']
        finally:t.close()
