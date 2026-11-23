"""Disposable profile and POSIX socket directory shared by the Linux activity fixtures."""
from contextlib import contextmanager
from hashlib import sha256
import os
from pathlib import Path
import shutil
import tempfile

HERE = Path(__file__).resolve().parent


@contextmanager
def workspace():
    with tempfile.TemporaryDirectory(prefix='ss-activity-') as tmp:
        root = Path(tmp).resolve()
        profile = root / 'profile'
        profile.mkdir(mode=0o700)
        (root / 'sample.txt').write_text('synthetic reference')
        # Corresponds to endpointName(profile, id). Only remove our freshly allocated profile's directory.
        digest = sha256(os.fsencode(profile)).hexdigest()[:32]
        sockets = Path('/tmp').resolve() / f'stela-{os.getuid()}-{digest}'
        assert not sockets.exists()
        try:
            yield root, profile
        finally:
            if sockets.exists():
                shutil.rmtree(sockets)


def pi_args(node, cli, name):
    return [node, cli, '--offline', '--tui-mode', 'fullscreen', '--no-session',
            '--no-extensions', '--no-mcp', '--no-context-files', '--no-skills',
            '--no-prompt-templates', '--no-approve',
            '--extension', str(HERE / '../../../subagents/tests/fixtures/provider.ts'),
            '--extension', str(HERE / '../../index.ts'), '--extension', str(HERE / 'activity.ts'),
            '--model', 'ss-fixture/deterministic', '--thinking', 'off', '--name', name]
