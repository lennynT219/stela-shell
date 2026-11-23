"""One disposable Linux PTY with a fixture-owned F8 screen snapshot."""
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time

from activity_fixture import pi_args

ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)')
F8 = b'\x1b[19~'


class Terminal:
    def __init__(self, root, env, addr, name, args=None):
        self.frame = root / (addr + '.json')
        self.fd, slave = pty.openpty()
        self.size(146)
        self.proc = subprocess.Popen(args or pi_args(*sys.argv[1:3], name), cwd=root,
            env={**env, 'HC_TERMINAL_ID': addr, 'SS_FIXTURE_SCREEN': str(self.frame)},
            stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        self.log = ''

    def size(self, width):
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', 38, width, 0, 0))
        if hasattr(self, 'proc'):
            self.proc.send_signal(signal.SIGWINCH)

    def key(self, data):
        os.write(self.fd, data)

    def paste(self, text):
        self.key(b'\x1b[200~' + text.encode() + b'\x1b[201~')

    def click(self, lines, word):
        row, col = next((i, s.index(word)) for i, s in enumerate(lines) if word in s)
        for suffix in ('M', 'm'):
            self.key(f'\x1b[<0;{col+1};{row+1}{suffix}'.encode())

    def drain(self, delay):
        if select.select([self.fd], [], [], delay)[0]:
            self.log = (self.log + os.read(self.fd, 120000).decode(errors='replace'))[-16000:]

    def wait(self, check, label):
        deadline = time.monotonic() + 8
        result = None
        while time.monotonic() < deadline and self.proc.poll() is None:
            self.key(F8)
            frame_deadline = time.monotonic() + .13
            while time.monotonic() < frame_deadline:
                self.drain(.015)
                if self.frame.exists():
                    result = json.loads(self.frame.read_text())
                    self.frame.unlink()
                    lines = [ANSI.sub('', s) for s in result['lines']]
                    if check(lines, result['draft']):
                        return lines
                    break
        raise AssertionError(f'{label}; last frame={result}; log={ANSI.sub("", self.log)[-1500:]}')

    def close(self):
        if self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGTERM)
        try:
            self.proc.wait(2)
        except subprocess.TimeoutExpired:
            os.killpg(self.proc.pid, signal.SIGKILL)
            self.proc.wait()
        os.close(self.fd)


def has(lines, word):
    return any(word in s for s in lines)
