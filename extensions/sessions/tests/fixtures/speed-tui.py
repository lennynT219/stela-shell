"""Real Pi TUI with only one Codex grant in Pi; all HTTP I/O is synthetic."""
import base64
import json
import os
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
    home = root/'codex'  # Deliberately absent: the CLI cannot contribute auth or a catalog.
    claims = {'https://api.openai.com/auth':{'chatgpt_account_id':'fixture'}}
    token = 'fixture.'+base64.b64encode(json.dumps(claims).encode()).decode()+'.fixture'
    env['SS_FIXTURE_CODEX_AUTH'] = 'Bearer '+token
    auth = json.dumps({'openai-codex':{'type':'oauth','access':token,'accountId':'fixture','refresh':'unused','expires':int(time.time()*1000)+3600000}})
    (profile/'auth.json').write_text(auth)
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
        def rows():
            return [json.loads(s) for s in trace.read_text().splitlines()] if trace.exists() else []
        t.wait(footer(False),'standard footer'); assert rows() == []
        t.key(b'\x1ba'); t.wait(lambda l,d:has(l,'Reinicio') and has(l,'64%') and has(l,'28%'),'Panel quota using only Pi login')
        t.key(b'\x1ba'); t.wait(lambda l,d:not has(l,'Reinicio'),'close Panel')
        menu(); highlight_fast(); t.key(b'\x1b'); t.wait(footer(False),'cancel without activation')
        menu(); highlight_fast(); t.key(b'\r'); t.wait(footer(True),'fast footer after explicit choice')
        assert rows() == [{'quota':True},{'catalog':True},{'catalog':True}], 'only read-only GETs until a user turn'
        t.paste('/reload'); t.key(b'\r')
        t.wait(lambda l,d:has(l,'Reloaded keybindings') and footer(True)(l,d),'reload revalidates and restores Fast in the same chat')
        assert rows() == [{'quota':True},{'catalog':True},{'catalog':True},{'catalog':True}], 'reload did one catalog GET, not a turn'
        t.paste('ejemplo uno'); t.key(b'\r'); t.wait(lambda l,d:has(l,'Respuesta local 1'),'first simulated response')
        menu(); t.key(b'\r'); t.wait(footer(False),'standard after explicit reset')
        t.paste('ejemplo dos'); t.key(b'\r'); t.wait(lambda l,d:has(l,'Respuesta local 2'),'second simulated response')
        menu(); highlight_fast(); t.key(b'\r'); t.wait(footer(True),'Fast reselected')
        t.paste('/model ss-fixture/deterministic'); t.key(b'\r'); t.wait(lambda l,d:any('Ctx ' in s and s.strip().endswith('deterministic') for s in l),'other provider has no speed suffix')
        t.paste('/model openai-codex/'+model); t.key(b'\r'); t.wait(lambda l,d:any('Ctx ' in s and model in s and ' · fast' not in s for s in l),'returning to Codex does not restore Fast')
        assert [r for r in rows() if 'model' in r] == [{'model':model,'tier':'priority'},{'model':model,'tier':None}]
        menu(); highlight_fast(); t.key(b'\r')
        t.wait(lambda l,d:not has(l,'Mayor velocidad') and any('Ctx ' in s and model in s and s.strip().endswith(' · fast') for s in l),'Fast before leaving this chat')
        before = rows()
        t.paste('/new'); t.key(b'\r')
        t.wait(lambda l,d:not has(l,'Respuesta local') and any('Ctx ' in s and model in s and ' · fast' not in s for s in l),'a new chat starts in Standard')
        assert rows() == before, 'a new chat does not revalidate the previous speed'
        assert (profile/'auth.json').read_text() == auth and not home.exists(), 'no second login or another credential store'
    finally:
        t.close()
