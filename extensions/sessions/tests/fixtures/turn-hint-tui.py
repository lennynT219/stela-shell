"""Exercise actual steering and follow-ups while a deterministic Pi tool waits for release."""
import json
import os
import sys
from activity_fixture import HERE, workspace
from terminal_fixture import Terminal, has


def check(remap):
    with workspace() as (root, profile):
        if remap:
            (profile/'keybindings.json').write_text(json.dumps({'app.message.followUp': ['f4']}))
        args = [*sys.argv[1:3], '--offline', '--no-session', '--tui-mode', 'fullscreen', '--no-extensions',
                '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-mcp', '--approve',
                '-e', str(HERE/'../../index.ts'), '-e', str(HERE/'activity.ts'), '-e', str(HERE/'provider.ts'),
                '--model', 'ss-session-fixture/deterministic', '--tools', 'fixture_hold']
        external = root/'fixture-editor'
        external.write_text('#!/bin/sh\nprintf " revisada" >> "$1"\n'); external.chmod(0o700)
        env = {'VISUAL':str(external), 'PATH': os.environ['PATH'], 'HOME': str(root), 'TMPDIR': str(root), 'TERM': 'xterm-256color',
               'PI_OFFLINE':'1', 'PI_CODING_AGENT_DIR':str(profile), 'SS_SESSION_FIXTURE_ROLE':'receiver'}
        # Run the remapped case in Pi's other terminal layout as well.
        if remap: args[args.index('fullscreen')] = 'regular'
        term = Terminal(root, env, 't-test', 'Hint', args)
        hint = 'Intro: ahora · ' + ('F4' if remap else 'Alt+Intro') + ': después'
        def state(draft, show, pending=None):
            return term.wait(lambda lines,d: d==draft and ((any(s.strip()==hint for s in lines)) if show else not has(lines, ': ahora'))
                             and (not pending or has(lines,pending)), f'draft={draft}, hint={show}, pending={pending}')
        try:
            state('', False); term.paste('BUSY'); state('BUSY', False); term.key(b'\r')
            state('', False, 'fixture_hold')
            term.paste('/fixture-'); state('/fixture-', False); term.key(b'\x15'); state('', False)
            term.paste('!echo'); state('!echo', False); term.key(b'\x15'); state('', False)
            term.paste('orientación'); state('orientación', True); term.size(38); state('orientación', True)
            term.key(b'\x07'); lines=state('orientación revisada', True)
            assert not has(lines, 'Steering:') and not has(lines, 'Follow-up:')
            term.key(b'\r'); state('', False, 'Steering: orientación revisada')
            term.paste('revisión'); state('revisión', True); term.key(b'\x1bOS' if remap else b'\x1b\r')
            lines=state('', False, 'Follow-up: revisión'); assert has(lines, 'Steering: orientación')
            assert not has(lines, 'Este chat') and not has(lines, 'Destino:')
            term.paste('/fixture-release'); state('/fixture-release', False); term.key(b'\r'); state('',False,'HOLD_RELEASED')
            term.paste('otro borrador'); state('otro borrador',False,'UNEXPECTED_RECEIVER_INPUT')
        finally:
            term.close()

check(False); check(True)
print('Busy draft, both queue modes and rebound shortcut verified')
