"""Measure padding and the real usage row from painted cells in disposable Pi screens."""
import json
import os
import re
import sys
import time
from activity_fixture import pi_args, workspace
from terminal_fixture import ANSI, F8, Terminal, has

BG = re.compile(r'\x1b\[48;(2;\d+;\d+;\d+|5;\d+)m')
KITTY = re.compile(r'\x1b_G[^;]*?c=(\d+),r=(\d+)[^;]*;[^\x1b]*\x1b\\')
FOOTER = 'Ctx 0% · US$0.00 · deterministic'
WIDTH = 54


def capture(t, draft, needle):
    t.wait(lambda lines, d: d == draft and has(lines, needle), 'presented: ' + needle)
    t.key(F8); end = time.monotonic() + 4
    while not t.frame.exists() and time.monotonic() < end:
        t.drain(.02)
    data = json.loads(t.frame.read_text()); t.frame.unlink()
    assert data['draft'] == draft
    return data['lines']


def plain(line):
    return ANSI.sub('', KITTY.sub('', line))


def measure(lines, draft, width, short, kitty, gap):
    text = [plain(s) for s in lines]
    start, end = (next(i for i, s in enumerate(text) if word in s) for word in (draft.split('\n')[0], draft.split('\n')[-1]))
    # Use the text and its contiguous fill, not the editor implementation's coordinates.
    top, bottom = start, end
    while top and BG.search(lines[top - 1]):
        top -= 1
    while bottom + 1 < len(lines) and BG.search(lines[bottom + 1]):
        bottom += 1
    fills = []
    for s in lines[top:bottom + 1]:
        m = BG.search(s); assert m and not plain(s[:m.start()]), repr(s)
        close = re.search(r'\x1b\[(?:0|49)m', s[m.end():]); assert close
        # These fixture drafts are ASCII, so character count equals displayed cells.
        assert len(plain(s[m.end():m.end() + close.start()])) == width, repr(s)
        fills.append(m[1])
    assert len(set(fills)) == 1
    pad = 2 if kitty and not short else 1  # The three-row sprite needs two shaded rows and one exposed row.
    assert (start - top, bottom - end) == (pad, pad), (start - top, bottom - end, draft)
    foot = [i for i, s in enumerate(text) if s.strip() == FOOTER]
    assert len(foot) == 1 and foot[0] - bottom - 1 == gap, (foot, bottom, gap)
    assert '─' * width not in '\n'.join(text[top:foot[0] + 1])
    target = None
    if kitty:
        row, m = next((i, m) for i in range(top, bottom + 1) if (m := KITTY.search(lines[i])))
        col = len(plain(lines[row][:m.start()])); exposed = row + int(m[2]) - 1
        assert exposed == bottom + 1 and (exposed != foot[0] or len(FOOTER) < col)
        target = (exposed, col + int(m[1]) // 2)
    else:
        assert has(text[top:bottom + 1], '[Panel]')
    return fills[0], target


def mouse(t, code, row, col, suffix):
    t.key(f'\x1b[<{code};{col + 1};{row + 1}{suffix}'.encode())


def check(theme, kitty, rgb, no_color=False):
    with workspace() as (root, profile):
        (profile/'settings.json').write_text(json.dumps({'theme': theme, 'fullscreenCopyOnSelect': False}))
        env = {'HOME': str(root), 'TMPDIR': str(root), 'PATH': os.environ['PATH'], 'TERM': 'xterm-256color',
               'PI_OFFLINE': '1', 'PI_CODING_AGENT_DIR': str(profile), 'PI_IMAGE_PROTOCOL': 'kitty' if kitty else 'none',
               'PI_TRUE_COLOR': '1' if rgb else '0', 'COLORFGBG': '15;0'}
        if no_color:
            env['NO_COLOR'] = '1'
        # Exercise a third-party belowEditor widget; never let the compact footer jump over it.
        widget = root/'widget.ts'
        widget.write_text('export default pi => { let on = false; pi.registerShortcut("f3", {description:"Fixture widget", '
                          'handler: ctx => ctx.ui.setWidget("below", (on = !on) ? ["BELOW-FIXTURE"] : undefined, {placement:"belowEditor"})}); };')
        t = Terminal(root, env, 'surface', 'Stela', pi_args(*sys.argv[1:3], 'Stela') + ['--extension', str(widget)])
        try:
            t.size(WIDTH); t.wait(lambda ls, d: has(ls, '\x1b_G' if kitty else '[Panel]'), 'ready')
            draft = 'Primera linea.'; t.paste(draft); lines = capture(t, draft, draft)
            if no_color:
                row = next(i for i, s in enumerate(lines) if draft in s)
                foot = next(i for i, s in enumerate(lines) if FOOTER in plain(s))
                assert not any(BG.search(s) for s in lines[row - 1:foot + 1])
                return
            spec, _ = measure(lines, draft, WIDTH, True, kitty, 0)
            if rgb:
                mode, r, g, b = map(int, spec.split(';')); assert mode == 2 and 40 <= r <= g <= b <= 75 and b - r <= 20, spec
            else:
                mode, index = map(int, spec.split(';')); assert mode == 5 and index in range(253, 256), spec
            for add in ('\nSegunda linea.', '\n\nFinal sin enviar.'):
                t.paste(add); draft += add
                lines = capture(t, draft, draft.split('\n')[-1]); _, target = measure(lines, draft, WIDTH, True, kitty, 0)
            if target:
                for end in ('M', 'm'):
                    mouse(t, 0, *target, end)
                t.wait(lambda ls, d: has(ls, 'Panel · [Cerrar]') and d == draft, 'click exposed pixels beside footer')
                t.key(b'\x1b'); lines = capture(t, draft, 'Final sin enviar.')
                row = next(i for i, s in enumerate(lines) if 'Final sin enviar.' in plain(s))
                mouse(t, 0, row, 0, 'M'); mouse(t, 32, row, 4, 'M')
                selected = capture(t, draft, 'Primera linea.')
                assert re.search(r'\x1b\[7mFinal', selected[row]) and not KITTY.search(selected[row])
                mouse(t, 0, row, 4, 'm'); mouse(t, 0, row, 1, 'M'); mouse(t, 0, row, 1, 'm'); t.key(b'\x05')
                t.key(b'\x1bOR'); with_widget = capture(t, draft, 'BELOW-FIXTURE')
                words = [plain(s).strip() for s in with_widget]
                assert words.count(FOOTER) == 1 and words.index(FOOTER) > words.index('BELOW-FIXTURE') > row
                t.key(b'\x1bOR'); t.wait(lambda ls, d: not has(ls, 'BELOW-FIXTURE'), 'widget removed')
                t.size(38); narrow = capture(t, draft, FOOTER); measure(narrow, draft, 38, True, kitty, 1); t.size(WIDTH)
            dense = 'X' * (WIDTH - 3); t.paste('\n' + dense); draft += '\n' + dense
            lines = capture(t, draft, dense); measure(lines, draft, WIDTH, False, kitty, 0)
            t.key(b'\x03'); t.wait(lambda ls, d: not d, 'clear'); t.key(b'/model determ')
            menu = capture(t, '/model determ', '→ deterministic'); text = [plain(s).strip() for s in menu]
            row = next(i for i, s in enumerate(text) if s.startswith('→ deterministic'))
            assert ('\x1b[48;' + spec + 'm') not in menu[row] and text.count(FOOTER) == 1 and row < text.index(FOOTER)
        finally:
            t.close()


check('system', True, True); check('light', False, False); check('dark', True, True, no_color=True)
print('Surface and exposed hit target verified')
