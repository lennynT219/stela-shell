"""Inline Caps with a synthetic loadout and quota, never callable from this view."""
import os
from activity_fixture import workspace, pi_args, HERE
from terminal_fixture import Terminal, has
import sys

DRAFT = 'borrador de prueba · 漢字'
ALT_A = b'\x1ba'
ALT_C = b'\x1bc'

def check(mode):
    with workspace() as (root, profile):
        trace = root/'opens'
        env = {'HOME': str(root), 'TMPDIR': str(root), 'TERM': 'xterm-256color', 'PATH': os.environ['PATH'],
               'PI_OFFLINE': '1', 'PI_CODING_AGENT_DIR': str(profile), 'PI_IMAGE_PROTOCOL': 'none', 'SS_PANEL_QUOTA_TRACE': str(trace)}
        args = pi_args(*sys.argv[1:3], 'Capacidades')
        args[args.index('--tui-mode')+1] = mode
        args[args.index(str(HERE/'../../index.ts'))] = str(HERE/'usage-panel.ts')
        args += ['--extension', str(HERE/'capabilities.ts')]
        t = Terminal(root, env, mode, 'Capacidades', args)
        def rows(lines, web=True):
            clean = [l.rsplit('│ ', 1)[-1].strip() for l in lines]
            return all(l in clean for l in ['✓ Web' if web else 'Web', 'Imágenes', 'Memoria' if web else '✓ Memoria', 'Conocimiento', 'Codemode'])
        def toggle():
            t.key(ALT_A)
        def unfolded(lines, draft):
            return has(lines,'▾ Capacidades') and has(lines,'Subagentes') and draft==DRAFT
        try:
            t.wait(lambda l,d:bool(l),'startup'); t.paste(DRAFT)
            t.wait(lambda l,d:d==DRAFT,'typed draft')
            toggle()
            lines = t.wait(lambda l,d:has(l,'▸ Capacidades') and has(l,'64%') and not has(l,'✓ Web') and d==DRAFT,'collapsed below quota by default')
            if mode == 'fullscreen':
                assert next(i for i,l in enumerate(lines) if '▸ Capacidades' in l) > next(i for i,l in enumerate(lines) if 'Reinicio' in l)
                t.click(lines,'▸ Capacidades')
            else:
                t.key(ALT_C)
            t.wait(lambda l,d:unfolded(l,d) and rows(l) and has(l,'28%'),'expanded inline, only complete capabilities checked')
            if mode == 'fullscreen':
                t.key(b'\x1b[21~') # F10: replace active tools without re-opening the section.
                t.wait(lambda l,d:unfolded(l,d) and rows(l,False) and not has(l,'✓ Web'),'expanded rows use current selection')
                t.size(38)
                t.wait(lambda l,d:unfolded(l,d) and rows(l,False) and not has(l,DRAFT),'narrow sheet preserves expanded section and draft')
                t.key(b'\r'); t.wait(lambda l,d:has(l,'▸ Capacidades') and not has(l,'✓ Memoria') and d==DRAFT,'fold with keyboard in narrow Panel')
                t.key(b'\r'); t.wait(unfolded,'expand again with keyboard')
            assert trace.read_text().splitlines()==['open 1'], 'expanding and folding did not reload quota or invoke anything'
            toggle(); t.wait(lambda l,d:not has(l,'▾ Capacidades') and d==DRAFT,'close Panel without changing draft')
            toggle(); t.wait(unfolded,'reopening leaves section expanded until explicitly folded')
            t.key(ALT_C); t.wait(lambda l,d:has(l,'▸ Capacidades') and d==DRAFT,'explicitly fold again')
            toggle(); t.wait(lambda l,d:not has(l,'▸ Capacidades') and d==DRAFT,'back to editor')
            t.paste('!'); t.wait(lambda l,d:d==DRAFT+'!','input focus restored')
            assert trace.read_text().splitlines()==['open 1','open 2','abort 2']
            if mode == 'fullscreen':
                t.size(146)
                t.key(b'\x1b[15~') # Fixture F5: queue one local helper from the editor.
                t.wait(lambda l,d:has(l,'1 tarea en curso'),'active task notice')
                toggle(); t.wait(lambda l,d:has(l,'› ') and has(l,'Revisión 1') and has(l,'▸ Capacidades'),'task and collapsed capabilities coexist')
                t.key(b'\x1b[B'); t.wait(lambda l,d:has(l,'› ▸ Capacidades'),'arrow down reaches heading after the last task')
                t.key(b'\r'); t.wait(lambda l,d:has(l,'▾ Capacidades') and has(l,'Revisión 1'),'enter expands without opening task details')
                t.key(b'\x1b[A'); t.wait(lambda l,d:any('› ' in s and 'Revisión 1' in s for s in l),'arrow up returns to task')
                t.key(b'\r'); t.wait(lambda l,d:has(l,'Objetivo: Fixture 1'),'enter inspects the selected task')
                t.key(b'\x1b'); t.wait(lambda l,d:has(l,'▾ Capacidades') and not has(l,'Objetivo:'),'return leaves section expanded')
        finally:
            t.close()

check('fullscreen')
check('regular')
