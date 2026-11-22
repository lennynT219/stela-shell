"""Terminal interaction only. The caller supplies a temporary profile, synthetic images and a fake generator."""
import fcntl, os, pty, re, select, signal, struct, subprocess, sys, termios, time
from pathlib import Path

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 54, 148, 0, 0))
pi = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
ansi = re.compile(rb'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)')

def expect(*words):
    buf = b''
    deadline = time.monotonic() + 8
    while True:
        screen = ansi.sub(b'', buf).decode('utf-8', errors='replace')
        if all(word in screen for word in words):
            return
        left = deadline - time.monotonic()
        if left <= 0 or not select.select([master], [], [], left)[0]:
            raise RuntimeError('Did not see %r; last fixture output: %r' % (words, screen[-2200:]))
        buf = (buf + os.read(master, 65536))[-120000:]

def submit(text):
    os.write(master, b'\x1b[200~' + text.encode() + b'\x1b[201~')
    os.write(master, b'\r')

home = Path.home()
prompt = 'Usa el contorno de la primera y el color de la segunda.'
message = '\n'.join(['Genera un icono nuevo. ' + prompt, *(str(home / f'pi-clipboard-12345678-0000-4000-8000-00000000000{n}.png') for n in [1, 2])])
try:
    expect('[Extensions]')  # Pi binds the submit handler before printing loaded resources.
    assert not (home / 'codex' / 'generated_images').exists()
    submit(message)
    expect('Vista 1', 'Fin de la prueba.')
    assert not Path('media').exists()
    submit('guarda la vista 1 como sello.png')
    expect('Guardada: media/images/sello.png')
finally:
    if pi.poll() is None: os.killpg(pi.pid, signal.SIGTERM)
    try: pi.wait(2)
    except subprocess.TimeoutExpired: os.killpg(pi.pid, signal.SIGKILL); pi.wait()
    os.close(master)
