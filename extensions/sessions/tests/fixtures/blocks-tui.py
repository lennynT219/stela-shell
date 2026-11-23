"""Real Pi in a private Linux PTY. Check semantic rows, ANSI family colors, image delivery and replay."""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time
from activity_fixture import HERE, workspace

ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)')


class Term:
    def __init__(self, root, profile, name='', truecolor=True):
        self.frame = root/('frame'+name+'.json'); self.log = b''
        self.fd, slave = pty.openpty()
        self.resize(116)
        env = {'HOME': str(root), 'PATH': os.environ['PATH'], 'TMPDIR': str(root), 'TERM': 'xterm-256color',
               'PI_OFFLINE': '1', 'PI_CODING_AGENT_DIR': str(profile), 'PI_TRUE_COLOR': '1' if truecolor else '0', 'PI_IMAGE_PROTOCOL': 'kitty',
               'SS_BLOCK_FRAME': str(self.frame), 'SS_BLOCK_NAME': name, 'NO_UPDATE_NOTIFIER': '1'}
        self.p = subprocess.Popen([*sys.argv[1:3], '--offline', '--session', str(root/('trial'+name+'.jsonl')), *(['--name', name] if name else []), '--tui-mode', 'fullscreen',
            '--no-approve', '--no-mcp', '--no-extensions', '--no-context-files', '--no-skills', '--no-prompt-templates',
            '-e', 'builtin:codemode', '-e', str(HERE/'../../index.ts'), '-e', str(HERE/'blocks.ts'),
            '--tools', '+codemode,+ss_knowledge_update', '--model', 'ss-blocks/test'], cwd=root, env=env,
            stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)

    def resize(self, width, height=100):
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', height, width, 0, 0))
        if hasattr(self, 'p'): self.p.send_signal(signal.SIGWINCH)

    def send(self, key): os.write(self.fd, key)

    def click_row(self, raw, prefix):
        y=next(i+1 for i,s in enumerate(raw.splitlines()) if ANSI.sub('',s).strip().startswith(prefix))
        for suffix in ('M','m'): self.send(f'\x1b[<0;4;{y}{suffix}'.encode())

    def drain(self, timeout=.025):
        if select.select([self.fd], [], [], timeout)[0]: self.log = (self.log + os.read(self.fd, 120000))[-2000000:]

    def output(self, word):
        end = time.monotonic()+10
        while time.monotonic()<end and self.p.poll() is None:
            self.drain()
            if word in ANSI.sub('', self.log.decode(errors='replace')): return
        raise AssertionError('missing output: '+word+'\n'+ANSI.sub('', self.log.decode(errors='replace'))[-5000:])

    def snapshot(self, predicate, what):
        end = time.monotonic()+9; clean=''
        while time.monotonic()<end and self.p.poll() is None:
            self.send(b'\x1b[19~'); sent=time.monotonic()
            while time.monotonic()-sent < .14:
                self.drain(.012)
                if self.frame.exists():
                    data=json.loads(self.frame.read_text()); self.frame.unlink()
                    raw='\n'.join(data['lines']); clean='\n'.join(x.rstrip() for x in ANSI.sub('', raw).splitlines() if x.strip())
                    if predicate(clean):
                        self.native = data['native']
                        return raw,clean,data['draft']
                    break
        raise AssertionError(what+'\n'+clean[-8000:])

    def close(self):
        if self.p.poll() is None: os.killpg(self.p.pid, signal.SIGTERM)
        try: self.p.wait(3)
        except subprocess.TimeoutExpired: os.killpg(self.p.pid, signal.SIGKILL); self.p.wait()
        os.close(self.fd)


def colors(ansi, layer):
    """Decode the colors Pi actually painted, independently of the extension's palette."""
    result = []
    for spec in re.findall(r'\x1b\['+str(layer)+r';(2;\d+;\d+;\d+|5;\d+)m', ansi):
        mode,*v = map(int,spec.split(';'))
        if mode == 2: result.append(tuple(v)); continue
        n, = v; assert 16 <= n <= 255, n
        cube = [0,95,135,175,215,255]; i = n-16
        result.append((8+10*(n-232),)*3 if n >= 232 else (cube[i//36],cube[i//6%6],cube[i%6]))
    return result


def luminance(rgb):
    def linear(n):
        v=n/255
        return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
    return sum(w*linear(v) for w,v in zip((.2126,.7152,.0722),rgb))


def set_theme(profile, name):
    settings = profile/'settings.json'
    values = json.loads(settings.read_text()) if settings.exists() else {}
    settings.write_text(json.dumps({**values, 'theme':name}))


def verify_fold(raw, native, narrow=False):
    truecolor = native['mode']=='truecolor'
    reference = colors(native['panel'],48)
    if native['panel']=='\x1b[49m':  # The PTY intentionally never answers color queries.
        reference = [(222,233,225) if native['appearance']=='light' else (37,65,49)]
    assert reference, native
    def near_native(fill):
        assert abs(luminance(fill)-luminance(reference[0])) < (.035 if truecolor else .14), (fill,native)

    lines = [ANSI.sub('', line).rstrip() for line in raw.splitlines()]
    ansi = raw.splitlines()
    text = '\n'.join(lines)
    assert text.count('📄 Leer ×2') == 2, text  # One direct group plus one inside an actual script.
    for s in ['✗', 'Parcial', 'Permiso denegado','anterior.txt · Escrito','Falló la ejecución','Guardado sin confirmar','Sin guardar']:
        assert s in text, (s,text)
    assert 'CONTENIDO_NOTA_INTERNO' not in text and 'SALIDA_FILTRADA' not in text and 'await tools.' not in text
    assert '{} Lote' not in text and 'Falló el lote' not in text
    tag = next(i for i,s in enumerate(lines) if s.lstrip().startswith('6 acciones'))
    margin = len(lines[tag]) - len(lines[tag].lstrip())
    yellow, = set(colors(ansi[tag],48)); near_native(yellow)
    assert min(yellow[:2]) > yellow[2] and yellow != (255,212,0), (yellow,native)
    # Five visible child rows after the header, even when one contains a denial. Titles keep their family ink.
    families = ['header','files','files','knowledge','web','files']; inks = {}
    for off,family in enumerate(families):
        i=tag+off
        assert len(lines[i])-len(lines[i].lstrip())==margin and '│' not in lines[i], lines[tag:tag+6]
        assert yellow in colors(ansi[i],48), (i,repr(ansi[i]))
        ink = colors(ansi[i],38)[0]
        assert inks.setdefault(family,ink)==ink
    if truecolor: assert len(set(inks.values()))==len(inks)
    assert yellow not in colors(ansi[tag+6],48), 'a child wrapped into a second yellow line'
    assert lines[tag+1].strip()=='📄 Leer ×2' and 'Parcial' in lines[tag+4] and 'Permiso denegado' in lines[tag+5]
    assert all(yellow in colors(ansi[i],48) for i,s in enumerate(lines) if s.strip()=='📄 Leer ×2')
    fills = {}
    for title,detail,family in [('📚 Listar','1 nota','knowledge'),('📚 Actualizar','Árbol de diseño · Actualizada','knowledge'),('🖼 Generar','vista 1 · Sin guardar','images'),('🧠 Guardar','! Guardado sin confirmar','memory')]:
        i = next(i for i,line in enumerate(lines) if line.strip()==title)
        assert lines[i+1].strip()==detail, (title,lines[i:i+3])
        ink=colors(ansi[i],38)[0]; assert inks.setdefault(family,ink)==ink
        fill, = set(colors(ansi[i],48)); near_native(fill)
        assert fills.setdefault(family,fill)==fill and fill in colors(ansi[i+1],48)
        if not lines[i+2].strip(): assert fill not in colors(ansi[i+2],48), title+' should occupy two rows'
    if truecolor:
        assert len(set(fills.values()))==3
        r,g,b=fills['knowledge']; assert b>g>r
        r,g,b=fills['images']; assert r>b>g
        r,g,b=fills['memory']; assert b>r>g
    if not narrow:
        for s in ['ausente.txt','📚 Leer · Árbol de diseño','lote.txt · Escrito','no.txt · ✗']:
            assert s in text,(s,text)


def verify_expanded(raw, folded):
    lines=raw.splitlines(); old=folded.splitlines()
    def words(s): return ANSI.sub('',s).strip()
    def surface(name):
        line=next(l for l in old if words(l).startswith(name)); color,=set(colors(line,48)); return color
    def block(header,old_title,contains=None):
        for i,line in enumerate(lines):
            if not words(line).startswith(header): continue
            j=i+1
            # A blank unpainted line separates Pi tool components. Blank content lines inside the card keep its fill.
            while j<len(lines) and (words(lines[j]) or colors(lines[j],48)): j+=1
            part=lines[i:j]; text='\n'.join(words(l) for l in part)
            if contains and contains not in text: continue
            expected=surface(old_title)
            for l in part:
                assert set(colors(l,48))=={expected},(header,repr(l),expected)
                # A reset in the middle of a styled source line must not uncover any following text.
                active=None
                for frag in re.split(r'(\x1b\[[0-9;]*m)',l):
                    if re.fullmatch(r'\x1b\[[0-9;]*m',frag):
                        new=colors(frag,48)
                        if new: active=new[-1]
                        elif frag in ('\x1b[0m','\x1b[m','\x1b[49m'): active=None
                    elif words(frag): assert active==expected,(header,repr(frag),repr(l))
            return text
        raise AssertionError('missing expanded '+header+'\n'+'\n'.join(words(l) for l in lines)[-8500:])
    read=block('📄 Leer · read','📄 Leer ×2','TEXTO_ALFA'); assert 'Entrada' in read and 'Resultado' in read
    assert 'TEXTO_BETA' in block('📄 Leer · read','📄 Leer ×2','TEXTO_BETA')
    batch=block('6 acciones · codemode','6 acciones'); assert batch.count('6 acciones')==1
    assert batch.count('📄 Leer · read')==3 and batch.count('📄 Escribir · write')==1,batch
    assert '✓ read {' not in batch and '\ncodemode\n' not in batch and all(s in batch for s in ['Permiso denegado','Código','Salida','SALIDA_FILTRADA']),batch
    assert batch.index('📄 Leer') < batch.index('\nCódigo\n') < batch.index('\nSalida\n')
    output = batch.split('\nSalida\n',1)[1]; assert 'Primera línea\nSegunda línea' in output,output
    mem=block('🧠 Guardar','🧠 Guardar'); assert 'ss_memory_save' in mem and mem.count('🧠 Guardar')==1
    assert all(s in mem for s in ['Motivo del ensayo','Entrada','Resultado','save_unconfirmed']),mem
    cmd=block('>_ Ejecutar · bash','>_ Ejecutar'); assert cmd.count('>_ Ejecutar')==1 and 'Comando' in cmd and 'Salida' in cmd
    assert cmd.count("printf 'RESULTADO_")==1 and 'RESULTADO_TERMINAL' in cmd,cmd
    diff=block('📄 Editar · edit','📄 Editar'); applied=diff.split('Cambios aplicados',1)[1]
    assert re.search(r'-\s*1 texto antiguo',applied) and re.search(r'\+\s*1 texto nuevo',applied),applied


with workspace() as (root, profile):
    (root/'a.txt').write_text('TEXTO_ALFA'); (root/'b.txt').write_text('TEXTO_BETA'); (root/'cambio.txt').write_text('texto antiguo\n')
    set_theme(profile,'dark'); t=Term(root,profile)
    try:
        t.output('[Extensions]'); t.send(b'\x1b[200~probar\x1b[201~\r')
        t.output('¿Autorizar lectura en la prueba?'); t.send(b'\x1b'); t.output('FIN_DE_BLOQUES')
        raw,_,_=t.snapshot(lambda s:'FIN_DE_BLOQUES' in s,'final folded frame'); assert t.native['name']=='dark'; verify_fold(raw,t.native)
        assert b'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' in t.log and b'\x1b_G' in t.log, 'missing native Kitty transmission of the fixture PNG'
        assert (root/'lote.txt').read_text()=='OK' and (root/'anterior.txt').read_text()=='SE CONSERVA' and not (root/'no.txt').exists()
        calls_path=Path(str(t.frame)+'.calls'); calls=calls_path.read_bytes(); assert calls.splitlines().count(b'write')==2
        # Click only the direct group's leader: its still-folded sibling becomes visible but neither changes color.
        t.click_row(raw,'📄 Leer ×2'); clicked,_,_=t.snapshot(lambda s:'TEXTO_ALFA' in s and 'TEXTO_BETA' not in s,'open one direct read by mouse')
        yellow=next(colors(l,48)[0] for l in raw.splitlines() if ANSI.sub('',l).strip()=='📄 Leer ×2')
        for marker in ['TEXTO_ALFA','📄 Leer · b.txt']:
            assert any(marker in ANSI.sub('',l) and yellow in colors(l,48) for l in clicked.splitlines()),marker
        t.click_row(clicked,'📄 Leer · read'); t.snapshot(lambda s:'TEXTO_ALFA' not in s and s.count('📄 Leer ×2')==2,'collapse direct read by mouse')
        t.send(b'\x1b[200~borrador\x1b[201~'); t.resize(38)
        raw,_,d=t.snapshot(lambda s:'Parcial' in s and 'Falló la ejecución' in s and '─'*80 not in s,'narrow terminal'); assert d=='borrador'; verify_fold(raw,t.native,narrow=True)
        folded=raw; t.resize(116,270); t.send(b'\x0f')
        raw,_,d=t.snapshot(lambda s:'Cambios aplicados' in s and 'SALIDA_FILTRADA' in s and 'TEXTO_BETA' in s and '─'*80 in s,'expanded details'); verify_expanded(raw,folded); assert d=='borrador'
        t.resize(38,330); raw,_,d=t.snapshot(lambda s:'TEXTO_BETA' in s and 'RESULTADO_TERMINAL' in s and 'Cambios aplicados' in s and '─'*80 not in s,'expanded narrow'); verify_expanded(raw,folded); assert d=='borrador'
        t.send(b'\x0f'); t.resize(116)
        raw,_,d=t.snapshot(lambda s:'SALIDA_FILTRADA' not in s and 'FIN_DE_BLOQUES' in s and '─'*80 in s,'folded again'); verify_fold(raw,t.native); assert d=='borrador'
    finally: t.close()
    # Open the same fixture branch in another process; titles and partials may not be reconstructed from script text.
    for name,truecolor in [('light',True),('light',False),('dark',False),('system',True)]:
        set_theme(profile,name); t=Term(root,profile,truecolor=truecolor)
        try:
            t.output('FIN_DE_BLOQUES'); raw,_,_=t.snapshot(lambda s:'FIN_DE_BLOQUES' in s,'reopened with '+name)
            assert t.native['name']==name and (t.native['mode']=='truecolor')==truecolor,t.native
            verify_fold(raw,t.native)
            if name=='light' and not truecolor:
                folded=raw; t.resize(116,270); t.send(b'\x0f')
                raw,_,_=t.snapshot(lambda s:'Cambios aplicados' in s and 'TEXTO_ALFA' in s,'expanded after reopen with indexed colors'); verify_expanded(raw,folded)
        finally: t.close()
    assert calls_path.read_bytes()==calls, 'expanding or reopening must not execute any calls'
    print('Terminal colors, native permission and image, folded/expanded rows and session replay verified.')

with workspace() as (root, profile):
    a=Term(root,profile,'Desarrollo')
    try:
        b=Term(root,profile,'Diseño')
        try:
            for t in (a,b): t.output('[Extensions]')
            a.send(b'\x1b[200~Lista las sesiones\x1b[201~\r')
            a.output('Sesiones disponibles: Diseño')
            a.send('\x1b[200~Envía saludo\x1b[201~\r'.encode())
            a.output('FIN_DEL_ENVÍO'); b.output('LLEGÓ_EL_MENSAJE')
            _,sender,_=a.snapshot(lambda s:'Aceptado para entrega' in s,'sender display name')
            closed,receiver,_=b.snapshot(lambda s:re.search(r'💬 Recibido de\s*\n\s*Desarrollo',s),'receiver display name')
            assert re.search(r'💬 Enviar\s*\n\s*→ Diseño · Aceptado para entrega',sender) and 'Sesiones disponibles: Diseño' in sender
            assert 'Saludos desde la prueba' not in receiver
            for s in (sender,receiver): assert not re.search(r'\b[a-f0-9]{32}\b', s), s
            b.send(b'\x0f'); opened,_,_=b.snapshot(lambda s:'Saludos desde la prueba' in s and 'From activation:' in s,'expanded peer protocol')
            tint=next(colors(l,48)[0] for l in closed.splitlines() if '💬 Recibido de' in ANSI.sub('',l))
            for marker in ['💬 Recibido de','From activation:','Saludos desde la prueba']:
                assert any(marker in ANSI.sub('',l) and tint in colors(l,48) for l in opened.splitlines()),marker
        finally: b.close()
    finally: a.close()
    print('Named sender and receiver, requested list and expanded peer message verified.')
