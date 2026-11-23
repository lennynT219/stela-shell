"""The editor button, Kitty placement and focus transitions, in disposable Pi terminals."""
import os
import re
from activity_fixture import workspace
from terminal_fixture import ANSI, Terminal, has

DRAFT='borrador reservado · 漢字'

def check(protocol):
    with workspace() as (root,profile):
        env={'HOME':str(root),'TMPDIR':str(root),'PATH':os.environ['PATH'],'TERM':'xterm-256color',
             'PI_OFFLINE':'1','PI_CODING_AGENT_DIR':str(profile),'PI_IMAGE_PROTOCOL':protocol,'SS_TEST_PANEL_DIALOG':'1'}
        t=Terminal(root,env,'panel','Stela')
        def target(lines):
            return next(((row,s) for row,s in enumerate(lines) if ('\x1b_G' in s if protocol=='kitty' else '[Panel]' in s)),None)
        def hit(lines, far=False):
            row,s=target(lines)
            if protocol=='kitty':
                # Absolute column of the graphics placement: click its colored region OR the reserved right padding.
                col=len(s.split('\x1b_G')[0]); match=re.search(r'\x1b_G[^;]*?c=(\d+),r=(\d+)',s); assert match, repr(s)[:500]
                assert int(match[1])>=2 and int(match[2])>=2
                if far: col+=6; row+=int(match[2])-1
            else: col=s.index('[Panel]')+(6 if far else 1)
            for m in ['M','m']: t.key(f'\x1b[<0;{col+1};{row+1}{m}'.encode())
        try:
            t.wait(lambda l,d:target(l),'visible at rest'); t.paste(DRAFT)
            lines=t.wait(lambda l,d:target(l) and d==DRAFT,'draft before click'); hit(lines,True)
            lines=t.wait(lambda l,d:target(l) and has(l,'Panel · [Cerrar') and has(l,DRAFT),'wide rail and mascot coexist'); hit(lines)
            t.wait(lambda l,d:not has(l,'Panel · [Cerrar') and d==DRAFT,'second tap closes rail')
            t.size(38); lines=t.wait(lambda l,d:target(l) and len(target(l)[1].split('\x1b_G')[0])<=38 and d==DRAFT and not has(l,'Sin tareas activas'),'narrow editor'); hit(lines)
            lines=t.wait(lambda l,d:has(l,'Panel · [Cerrar]') and not has(l,DRAFT) and not target(l) and d==DRAFT,'full screen with no editor or image bleed')
            t.paste('NO INSERTAR'); t.wait(lambda l,d:d==DRAFT and has(l,'Sin tareas activas'),'sheet owns focus'); t.click(lines,'Cerrar')
            t.wait(lambda l,d:has(l,DRAFT) and target(l) and d==DRAFT,'close by tap'); t.key(b'\x1ba')
            t.wait(lambda l,d:has(l,'Panel · [Cerrar]'),'keyboard opens sheet')
            # While browsing, a real native confirmation must remain visible and own the keyboard.
            t.key(b'\x1b[21~'); t.wait(lambda l,d:has(l,'Pregunta de prueba') and not has(l,'Panel · [Cerrar]'),'native dialog not covered')
            t.key(b'\x1b'); t.wait(lambda l,d:has(l,'Panel · [Cerrar]') and not has(l,'Pregunta de prueba'),'independent dialog dismissed'); t.key(b'\x1b')
            t.wait(lambda l,d:target(l) and has(l,DRAFT) and d==DRAFT,'escape restores editor'); t.paste('!')
            t.wait(lambda l,d:d==DRAFT+'!','editor regains input')
        finally: t.close()

check('kitty'); check('none'); print('Mascot and fallback checked in two Pi terminals')
