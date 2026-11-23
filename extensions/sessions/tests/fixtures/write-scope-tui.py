"""Offline Pi with an actual linked destination, real file tools and a private rule store."""
import os
import sys
import time
from activity_fixture import HERE, workspace
from terminal_fixture import ANSI, Terminal, has

with workspace() as (root, profile):
    project=root/'work'; project.mkdir(); external=root/'outside'; external.mkdir(); (project/'enlace').symlink_to(external, target_is_directory=True)
    config=external/'config.fish'; config.write_text('original')
    args=[*sys.argv[1:3],'--offline','--no-session','--tui-mode','fullscreen','--no-extensions','--no-mcp','--no-context-files','--no-skills','--no-prompt-templates','--approve',
          '-e','builtin:codemode','-e',str(HERE/'../../index.ts'),'-e',str(HERE/'activity.ts'),'-e',str(HERE/'provider.ts'),
          '--model','ss-session-fixture/deterministic','--tools','+codemode']
    env={'HOME':str(root),'TMPDIR':str(root),'PATH':os.environ['PATH'],'TERM':'xterm-256color','PI_OFFLINE':'1',
         'PI_CODING_AGENT_DIR':str(profile),'SS_SESSION_FIXTURE_ACTION':'write-scope'}
    def launch():
        t=Terminal(project,env,'scope','Permisos',args)
        try: t.wait(lambda lines,d:bool(lines) and d=='','started'); return t
        except Exception as exc:
            t.close(); raise AssertionError(ANSI.sub('',t.log)[-1500:]) from exc
    def send(t,token):
        t.log=''; t.paste(token); t.key(b'\r')
    def output(t,words):
        end=time.monotonic()+8
        while time.monotonic()<end:
            t.drain(.05)
            if all(w in ANSI.sub('',t.log) for w in words): return
        raise AssertionError('missing '+str(words)+': '+ANSI.sub('',t.log)[-2500:])
    def finish(t,token): t.wait(lambda lines,d:has(lines,'FIN_'+token),'completed '+token)
    t=launch()
    try:
        send(t,'INTERNO'); finish(t,'INTERNO'); assert (project/'local.txt').read_text()=='ok'
        send(t,'CANCELAR'); output(t,['Escribir fuera del proyecto',str(config),'Permitir y recordar']); assert config.read_text()=='original'
        t.key(b'\x1b'); finish(t,'CANCELAR'); assert config.read_text()=='original'
        send(t,'RECORDAR'); output(t,['Editar fuera del proyecto',str(config)]); t.key(b'\x1b[B\x1b[B\r')
        output(t,['Recordar para',str(external/'*.fish')]); assert config.read_text()=='original'; t.key(b'\x1b[B\x1b[B\r'); finish(t,'RECORDAR'); assert config.read_text()=='actualizado'
    finally: t.close()
    t=launch()
    try:
        send(t,'OTRO'); finish(t,'OTRO'); assert (external/'otro.fish').read_text()=='otro'
        send(t,'/ss-permissions'); output(t,['Revocar un permiso',str(external/'*.fish')]); t.key(b'\x1b[B\r'); output(t,['Permiso revocado'])
        send(t,'CANCELAR'); output(t,['Escribir fuera del proyecto',str(config)]); t.key(b'\x1b'); finish(t,'CANCELAR'); assert config.read_text()=='actualizado'
    finally: t.close()
    print('Linux file tool permissions verified in two Pi processes')
