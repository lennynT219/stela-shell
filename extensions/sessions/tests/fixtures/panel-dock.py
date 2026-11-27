"""Locate the control by the actual Kitty placement/label, draft, menu and usage line; no border needed."""
import os
import re
import unicodedata
from activity_fixture import workspace
from terminal_fixture import Terminal, has


def cells(text):
    return sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in text)


def geometry(lines, width, kitty):
    footers = [i for i, s in enumerate(lines) if s.lstrip().startswith('Ctx ')]
    if len(footers) != 1:
        return None
    menu = next((i for i, s in enumerate(lines) if s.lstrip().startswith('→ ')), footers[0] + 1)
    for row, line in enumerate(lines):
        if kitty:
            m = re.search(r'\x1b_G[^;]*?c=(\d+),r=(\d+)', line)
            if not m:
                continue
            col, cols, rows = cells(line[:m.start()]), int(m[1]), int(m[2])
        else:
            if '[Panel]' not in line:
                continue
            col, cols, rows = cells(line.split('[Panel]', 1)[0]), len('[Panel]'), 1
        if row + rows <= menu and width - 9 <= col < col + cols <= width:
            return row, col, row + rows - 1
    return None


def click(t, row, col):
    for end in ('M', 'm'):
        t.key(f'\x1b[<0;{col + 1};{row + 1}{end}'.encode())


def check(protocol):
    kitty = protocol == 'kitty'
    with workspace() as (root, profile):
        env = {'HOME': str(root), 'TMPDIR': str(root), 'PATH': os.environ['PATH'], 'TERM': 'xterm-256color',
               'PI_OFFLINE': '1', 'PI_CODING_AGENT_DIR': str(profile), 'PI_IMAGE_PROTOCOL': protocol}
        t = Terminal(root, env, 'dock', 'Stela')
        width = 146

        def frame(draft, visual):
            return t.wait(lambda ls, d: d == draft and geometry(ls, width, kitty) and visual(ls), 'bottom dock: ' + repr(draft))

        try:
            frame('', lambda _: True)
            draft = 'A漢B · borrador'
            t.paste(draft)
            lines = frame(draft, lambda ls: has(ls, draft))
            anchor, _, end = geometry(lines, width, kitty)
            row = next(i for i, s in enumerate(lines) if draft in s)
            short_span = end - row
            assert anchor <= row <= end  # Short draft alongside the sprite/label, not above a new toolbar.
            click(t, row, cells(lines[row].split('B', 1)[0])); t.key(b'!')
            draft = 'A漢!B · borrador'
            frame(draft, lambda ls: has(ls, draft)); t.key(b'\x05')

            width = 38; t.size(width)
            dense = 'z' * 34 + '界'  # 36 cells fit Pi's native 38-column editor without rewrapping.
            more = '\n' + '─' * 32 + '\nsegunda\ntercera\n' + dense
            t.paste(more); draft += more
            lines = frame(draft, lambda ls: has(ls, dense) and has(ls, draft.split('\n')[0]))
            anchor, _, end = geometry(lines, width, kitty)
            first = next(i for i, s in enumerate(lines) if draft.split('\n')[0] in s)
            assert end - first > short_span and has(lines, '─' * 32)
            assert anchor > next(i for i, s in enumerate(lines) if dense in s)
            # Tapping the upper-right margin must not open the panel or move the cursor.
            click(t, first - 1, width - 2); t.key(b'!'); draft += '!'
            frame(draft, lambda ls: has(ls, dense + '!') and not has(ls, 'Panel · [Cerrar'))

            for start in (0, 7):
                add = ''.join('\nlinea-' + str(i) for i in range(start, start + 7))
                t.paste(add); draft += add
            lines = frame(draft, lambda ls: has(ls, '↑') and has(ls, 'linea-13'))
            _, col, end = geometry(lines, width, kitty)
            click(t, end, col + 1)
            t.wait(lambda ls, d: d == draft and has(ls, 'Panel · [Cerrar]'), 'open from the bottom of a scrolled editor')
            t.key(b'\x1b'); frame(draft, lambda ls: has(ls, 'linea-13'))
            for _ in range(16):
                t.key(b'\x1b[A')
            frame(draft, lambda ls: has(ls, '↓') and has(ls, dense))

            t.key(b'\x03'); frame('', lambda ls: not has(ls, dense))
            # At 20 columns even the text control needs space below this slash argument.
            width = 20; t.size(width); t.key(b'/model determ')
            lines = frame('/model determ', lambda ls: any(s.lstrip().startswith('→ ') for s in ls))
            _, _, end = geometry(lines, width, kitty)
            assert lines[end + 1].lstrip().startswith('→ ')
            click(t, end + 1, 3)
            frame('/model ss-fixture/deterministic', lambda ls: not any(s.lstrip().startswith('→ ') for s in ls))
        finally:
            t.close()


check('kitty'); check('none'); print('Dock verified with Kitty and text')
