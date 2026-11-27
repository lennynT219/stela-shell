"""Read actual Kitty rectangles in both Pi renderers; never invoke a provider or an image converter."""
import os
import re
import sys
from activity_fixture import pi_args, workspace
from terminal_fixture import Terminal

PLACE = re.compile(r'\x1b_G[^;]*?c=(\d+),r=(\d+)[^;]*;[^\x1b]*\x1b\\')
FOOTER = 'Ctx 0% · US$0.00 · deterministic'
WIDTH = 54


def check(mode):
    with workspace() as (root, profile):
        env = {'PATH': os.environ['PATH'], 'HOME': str(root), 'TMPDIR': str(root), 'TERM': 'xterm-256color',
               'PI_OFFLINE': '1', 'PI_CODING_AGENT_DIR': str(profile), 'PI_IMAGE_PROTOCOL': 'kitty'}
        args = pi_args(*sys.argv[1:3], 'Stela'); args[args.index('fullscreen')] = mode
        t = Terminal(root, env, 'size', 'Stela', args)
        try:
            t.size(WIDTH)
            t.wait(lambda ls, d: any(PLACE.search(s) and len(PLACE.sub('', s)) == WIDTH for s in ls), 'initial size')
            draft = ''
            for addition, large, margin in [('First.', True, 1), ('Second.', True, 1),
                                            ('X' * 51, False, 2), ('After dense.', False, 1), ('Free again.', True, 1)]:
                addition = ('\n' if draft else '') + addition
                t.paste(addition); draft += addition
                def ready(lines, value):
                    if value != draft:
                        return False
                    text = [PLACE.sub('', s).rstrip() for s in lines]
                    return text.count(FOOTER) == 1 and all(s in text for s in draft.splitlines())
                lines = t.wait(ready, mode + ': ' + repr(addition))
                text = [PLACE.sub('', s).rstrip() for s in lines]
                foot = text.index(FOOTER); last = text.index(draft.splitlines()[-1])
                assert foot == last + margin + 1, (foot, last, margin)
                places = [(m.start(), y, int(m[1]), int(m[2])) for y, s in enumerate(lines) if (m := PLACE.search(s))]
                # Independent of the editor's hit rectangle: same right edge and footer baseline in all cases.
                width, rows = (8, 4) if large else (6, 3)
                assert all(x + w == WIDTH - 1 and w == width for x, _, w, _ in places), places
                if large and mode == 'regular':
                    assert [(y, h) for _, y, _, h in places] == [(y, 1) for y in range(foot-3, foot+1)], places
                else:
                    assert [(y, h) for _, y, _, h in places] == [(foot-rows+1, rows)], places
                # Neither an occupied last line nor an occupied penultimate line may be under the sprite.
                if not large:
                    assert text.index('X'*51) < places[0][1]
        finally:
            t.close()


check('fullscreen'); check('regular'); print('Both layouts verified')
