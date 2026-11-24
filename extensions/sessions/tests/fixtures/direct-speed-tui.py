"""Test a subscription in Pi's native openai adapter. No Codex or outside service is used."""
import json
import os
import sys
import time
from activity_fixture import workspace, pi_args, HERE
from terminal_fixture import Terminal, has

with workspace() as (root, profile):
    args = pi_args(*sys.argv[1:3], 'OpenAI directo') + ['--extension', str(HERE/'speed.ts')]
    args[args.index('--model')+1] = 'openai/gpt-4.1'
    trace = root/'requests'
    env = {'HOME':str(root), 'TMPDIR':str(root), 'PATH':os.environ['PATH'], 'TERM':'xterm-256color', 'PI_CODING_AGENT_DIR':str(profile),
           'PI_OFFLINE':'1', 'CODEX_HOME':str(root/'no-codex-login'), 'SS_SPEED_TRACE':str(trace),'SS_DIRECT_SPEED_FIXTURE':'1',
           'HTTPS_PROXY':'http://127.0.0.1:1','HTTP_PROXY':'http://127.0.0.1:1'}
    (profile/'auth.json').write_text(json.dumps({'openai':{'type':'oauth','access':'fixture-direct','refresh':'unused',
            'scopes':['chatgpt.tokens.use.direct'],'clientId':'synthetic','expires':int(time.time()*1000)+3600000}}))
    t = Terminal(root,env,'speed-direct','OpenAI directo',args)
    def submit(s):
        t.paste(s); t.key(b'\r')
    def footer(model, speed=None):
        def match(lines,d):
            return any('Ctx ' in s and model in s and (s.strip().endswith(' · '+speed) if speed else not (' · fast' in s or ' · ultrafast' in s)) for s in lines)
        t.wait(match, 'footer '+model+' '+str(speed))
    def rows():
        return [json.loads(s) for s in trace.read_text().splitlines()] if trace.exists() else []
    def menu(heading):
        submit('/ss-speed'); return t.wait(lambda l,d:has(l,heading) and has(l,'Estándar'),'speed selector: '+heading)
    try:
        footer('gpt-4.1'); assert rows()==[]
        for i,(model,label,expected) in enumerate([('gpt-4.1','Fast','priority'),('gpt-5.2','Ultrafast','ultrafast')]):
            if i:
                submit('/model openai/'+model); footer(model)
            before=rows(); lines=menu('Mayor velocidad'); assert has(lines,label)
            t.key(b'\x1b[B'); t.wait(lambda l,d:has(l,'→ '+label),'highlight '+label); t.key(b'\r'); footer(model,label.lower())
            assert rows()==before+[{'catalog':True}], 'menu must make only a catalog GET'
            if not i:
                submit('/reload')
                t.wait(lambda l,d:has(l,'Reloaded keybindings') and any('Ctx ' in s and model in s and s.strip().endswith(' · fast') for s in l),
                       'the direct login restores the same speed after reload')
                assert rows()==before+[{'catalog':True},{'catalog':True}], 'reload only rechecks the catalog'
            submit('Turno de prueba'); t.wait(lambda l,d:has(l,'Respuesta local '+str(i+1)),'simulated response')
            assert rows()[-1]=={'model':model,'tier':expected}
        # Only an explicit reset drops the tier for the same model; a model with no tiers has no paid choice.
        menu('Mayor velocidad'); t.key(b'\r'); footer('gpt-5.2'); submit('Respuesta estándar')
        t.wait(lambda l,d:has(l,'Respuesta local 3'),'standard response'); assert rows()[-1]=={'model':'gpt-5.2','tier':None}
        submit('/model openai/gpt-4o'); footer('gpt-4o'); lines=menu('Sin velocidad adicional anunciada')
        assert not any(s.strip() in ('Fast','Ultrafast','→ Fast','→ Ultrafast') for s in lines); t.key(b'\x1b')
        assert sum('model' in r for r in rows())==3
    finally:
        t.close()
