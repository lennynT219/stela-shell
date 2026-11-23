"""Real Pi TUI and Codex adapter; speed.ts intercepts the wire request before I/O."""
import base64
import json
import os
import subprocess
import sys
import time
from activity_fixture import workspace, pi_args, HERE
from terminal_fixture import Terminal, has

with workspace() as (root, profile):
    model = 'gpt-5.6-luna'
    args = pi_args(*sys.argv[1:3], 'Velocidad')
    args.extend(['--extension',str(HERE/'speed.ts')])
    args[args.index('--model')+1] = 'openai-codex/' + model
    args[args.index('--thinking')+1] = 'high'
    trace = root / 'requests'
    env = {'HOME':str(root), 'TMPDIR':str(root), 'PATH':os.environ['PATH'], 'TERM':'xterm-256color', 'PI_CODING_AGENT_DIR':str(profile),
           'PI_OFFLINE':'1', 'CODEX_HOME':str(root/'codex'), 'SS_SPEED_TRACE':str(trace), 'HTTPS_PROXY':'http://127.0.0.1:1', 'HTTP_PROXY':'http://127.0.0.1:1'}
    home = root/'codex'; home.mkdir()
    # Start from the binary's offline schema template, not a recorded account or a production model allowlist.
    raw = subprocess.check_output([sys.argv[3],'debug','models','--bundled'],cwd=root,env=env,stderr=subprocess.DEVNULL)
    template = json.loads(raw)['models'][0]
    template.update(slug=model,display_name='Fixture',visibility='list',supported_in_api=True,additional_speed_tiers=[],
                    service_tiers=[{'id':'priority','name':'Fast','description':'Fixture priority'}])
    (root/'catalog.json').write_text(json.dumps({'models':[template]}))
    (home/'config.toml').write_text('model_catalog_json = '+json.dumps(str(root/'catalog.json'))+'\n')
    claims = {'https://api.openai.com/auth':{'chatgpt_account_id':'fixture'}}
    token = 'fixture.'+base64.b64encode(json.dumps(claims).encode()).decode()+'.fixture'
    (profile/'auth.json').write_text(json.dumps({'openai-codex':{'type':'oauth','access':token,'refresh':'unused','expires':int(time.time()*1000)+3600000}}))
    (profile/'settings.json').write_text(json.dumps({'transport':'sse'}))
    t = Terminal(root,env,'speed','Velocidad',args)
    try:
        def footer(fast):
            tail = model+' · high'+(' · fast' if fast else '')
            return lambda lines,draft:not has(lines,'Mayor velocidad') and any('Ctx ' in line and line.strip().endswith(tail) for line in lines)
        def menu():
            t.paste('/ss-speed'); t.key(b'\r'); t.wait(lambda l,d:has(l,'Estándar') and has(l,'Mayor velocidad'),'speed selector')
        def highlight_fast():
            t.key(b'\x1b[B'); t.wait(lambda l,d:has(l,'→ Fast'),'Fast highlighted, not submitted')
        t.wait(footer(False),'standard footer'); menu(); highlight_fast(); t.key(b'\x1b'); t.wait(footer(False),'cancel without activation')
        menu(); highlight_fast(); t.key(b'\r'); t.wait(footer(True),'fast footer after explicit choice')
        assert not trace.exists(), 'choosing speed must not generate a request'
        t.paste('ejemplo uno'); t.key(b'\r'); t.wait(lambda l,d:has(l,'Respuesta local 1'),'first simulated response')
        menu(); t.key(b'\r'); t.wait(footer(False),'standard after explicit reset')
        t.paste('ejemplo dos'); t.key(b'\r'); t.wait(lambda l,d:has(l,'Respuesta local 2'),'second simulated response')
        menu(); highlight_fast(); t.key(b'\r'); t.wait(footer(True),'Fast reselected')
        t.paste('/model ss-fixture/deterministic'); t.key(b'\r'); t.wait(lambda l,d:any('Ctx ' in s and s.strip().endswith('deterministic') for s in l),'other provider has no speed suffix')
        t.paste('/model openai-codex/'+model); t.key(b'\r'); t.wait(lambda l,d:any('Ctx ' in s and model in s and ' · fast' not in s for s in l),'returning to Codex does not restore Fast')
        assert [json.loads(s) for s in trace.read_text().splitlines()] == [{'model':model,'tier':'priority'},{'model':model,'tier':None}]
    finally:
        t.close()
