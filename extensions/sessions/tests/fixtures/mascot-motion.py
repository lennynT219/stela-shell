"""Use actual PNGs painted by offline Pi. The F8 witness and helper queue live only in this workspace."""
import json
import os
import re
import sys
import time
from pathlib import Path
from activity_fixture import HERE, pi_args, workspace
from terminal_fixture import Terminal, has

KITTY = re.compile(r'\x1b_G([^;]*);([A-Za-z0-9+/=]*)\x1b\\')
source = (HERE/'../../mascot-gesture-art.ts').read_text()
ART = {}
for key, items in re.findall(r'^  "([^"]+)": (\[.*?\]),', source, re.M | re.S):
    full, *bands = json.loads(items); ART[full,] = ART[tuple(bands)] = key
source = (HERE/'../../mascot-icon.ts').read_text()
floats, bands = [json.loads(re.search(rf'export const {name} = (.*?) as const;', source, re.S)[1]) for name in ('FLOAT_FRAMES','FLOAT_BANDS')]
for i, (png, strips) in enumerate(zip(floats, bands)):
    ART[png,] = ART[tuple(strips)] = f'float{i}'


def image(lines):
    payload, places = [], []
    for y, line in enumerate(lines):
        parts = list(KITTY.finditer(line))
        if parts and 'a=T,' in parts[0][1]:
            payload.append(''.join(p[2] for p in parts))
            cols, rows = map(int, re.search(r'c=(\d+),r=(\d+)', parts[0][1]).groups())
            places.append((parts[0].start(), y, cols, rows))
    if not places:
        return '', None
    x, y, w, h = places[0]
    if len(places) > 1:
        assert places == [(x,y+i,w,1) for i in range(4)], places
        h = 4
    return ART[tuple(payload)], (x, y, w, h)


def events(t):
    path = Path(str(t.frame) + '.events')
    return [json.loads(s) for s in path.read_text().splitlines()] if path.exists() else []


def settled(t):
    return [e for e in events(t) if e['type'] == 'settled']


def asleep_at_close(t, count, label):
    def check(lines, draft):
        if len(settled(t)) != count:
            return False
        pose = image(lines)[0]
        assert not pose.startswith('spin'), (label, pose)
        return pose in ('sleep','breathe') and not draft
    return t.wait(check, label)


def expect(t, poses, draft, label, notice=None):
    return t.wait(lambda ls,d: (draft is None or d == draft) and image(ls)[0].startswith(poses) and (not notice or has(ls, notice)), label)


def observe(t, duration, label, check):
    start = time.monotonic()
    def inspect(lines, draft):
        pose = image(lines)[0]
        if not pose:
            return False
        assert check(pose), (label, pose)
        return time.monotonic() - start >= duration
    t.wait(inspect, label)


def rect(lines):
    _, (x, y, w, h) = image(lines)
    foot = next(i for i,s in enumerate(lines) if s.lstrip().startswith('Ctx '))
    return x, y-foot, w, h


def check(scenario):
    with workspace() as (root, profile):
        if scenario != 'error':
            (root/'source.txt').write_text('synthetic evidence')
        env = {'PATH': os.environ['PATH'], 'HOME': str(root), 'TMPDIR': str(root), 'TERM': 'xterm-256color',
               'PI_CODING_AGENT_DIR': str(profile), 'PI_OFFLINE': '1', 'PI_IMAGE_PROTOCOL': 'kitty', 'SS_TEST_TASK_DETAIL': '1'}
        args = pi_args(*sys.argv[1:3], 'Stela') + ['-e', str(HERE/'mascot-events.ts')]
        if scenario == 'regular':
            args[args.index('fullscreen')] = 'regular'
        if scenario == 'abort':
            # Pi's native Esc interrupts streaming (including a held tool), not an already-ended loop.
            env['SS_SESSION_FIXTURE_ROLE'] = 'receiver'
            args[args.index('ss-fixture/deterministic')] = 'ss-session-fixture/deterministic'
            args.extend(['-e', str(HERE/'provider.ts'), '--tools', 'fixture_hold'])
        t = Terminal(root, env, 't1', 'Stela', args); other = None
        try:
            t.size(64)
            ls = expect(t, ('sleep','breathe'), '', 'sleeping in the empty editor'); position = rect(ls)
            assert position == (55,-3,8,4), position
            assert sum(bool(KITTY.search(s)) for s in ls) == (4 if scenario == 'regular' else 1)
            t.key(b'\x1b[D'); expect(t, ('sleep','breathe'), '', 'navigation does not start a draft')
            t.key(b'B'); ls = expect(t, ('opening','lift'), 'B', 'first real key wakes Stela before submit')
            assert rect(ls) == position and not events(t)
            if scenario == 'success':
                other = Terminal(root, env, 't2', 'Docs')
                expect(other, ('sleep','breathe'), '', 'second Pi ready')
                other.paste('/fixture-question'); other.key(b'\r')
                ls = expect(t, ('look','lean'), 'B', 'lean toward a genuine peer dialog', 'Docs necesita')
                assert rect(ls) == position
                expect(t, 'alert', 'B', 'single tilt has settled', 'Docs necesita')
                observe(t, .65, 'no repeated attention gesture', lambda p: p == 'alert')
                assert not Path(str(other.frame)+'.answer').exists()
                other.key(b'\x1b'); expect(t, 'float', 'B', 'withdrawal restores the draft')
            if scenario == 'abort':
                t.paste('USY'); expect(t, 'float', 'BUSY', 'prepare the held tool')
            t.key(b'\r')
            if scenario == 'abort':
                expect(t, 'float', '', 'tool is still running', 'fixture_hold')
                t.key(b'\x1b'); asleep_at_close(t, 1, 'native interrupt settles without a spin')
                assert settled(t)[0]['aborted']
            elif scenario == 'error':
                asleep_at_close(t, 1, 'failed tool settles without celebration')
                assert any(e.get('error') for e in events(t)) and not settled(t)[0]['aborted']
            else:
                # This loop has a final-looking assistant message, but Pi can still continue after the helper result.
                t.wait(lambda ls,d: has(ls,'1 tarea en curso') and any(e['type']=='end' for e in events(t)) and image(ls)[0].startswith('float'), 'waiting between agent loops')
                assert not settled(t)
                t.paste('próximo borrador'); expect(t, 'float', 'próximo borrador', 'working stays quiet even while drafting')
                t.key(b'\x1b[17~')  # finish only the isolated helper
                ls = expect(t, 'spin', 'próximo borrador', 'spin only after delivery and continuation', 'INTEGRATED')
                assert rect(ls) == position and settled(t) == [{'type':'settled','aborted':False}]
                assert sum(e['type']=='start' for e in events(t)) >= 2
                expect(t, 'float', 'próximo borrador', 'back to the untouched draft')
                observe(t, .85, 'not a looping spin', lambda p: p.startswith('float'))
                previous = events(t); t.key(b'\r')  # this next provider response uses no tools
                asleep_at_close(t, 2, 'conversation returns to sleep')
                assert all(e['type'] != 'tool' for e in events(t)[len(previous):])
            observe(t, .82, 'no celebration after failure, abort or plain chat', lambda p: p in ('sleep','breathe'))
        finally:
            if other: other.close()
            t.close()


for case in ('success','error','abort','regular'):
    check(case)
print('Verified live mascot gestures')
