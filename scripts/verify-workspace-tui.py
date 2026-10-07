import json, os, pty, re, select, signal, struct, subprocess, sys, fcntl, termios, time
fixture = json.load(open(sys.argv[1]))
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
p = subprocess.Popen(['pi', *fixture['args'], '--tui-mode', 'regular'], cwd=fixture['cwd'], env=fixture['env'], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
raw = b''
def plain(start=0):
    return re.sub(r'\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))', '', raw[start:].decode('utf8', 'replace'))
def wait(text, start=0):
    global raw
    deadline = time.time() + 20
    while text not in plain(start):
        if time.time() > deadline: raise AssertionError('TUI did not render ' + text + '\n' + plain()[-4000:])
        ready, _, _ = select.select([master], [], [], .1)
        if ready:
            data = os.read(master, 65536)
            if not data: raise AssertionError('TUI exited before ' + text)
            raw += data
        if p.poll() is not None: raise AssertionError('TUI exited before ' + text)
def command(text):
    os.write(master, (text + '\r').encode())
try:
    wait('Legion inactive')
    for prefix, completed in [('rese', 'reserve'), ('reco', 'reconcile'), ('wor', 'workspace')]:
        start = len(raw)
        os.write(master, ('\x15/legion ' + prefix).encode())
        wait('/legion ' + prefix, start)
        os.write(master, b'\t')
        wait('/legion ' + completed, start)
    os.write(master, b'\x15')
    command('/legion resume ' + fixture['owner'])
    wait('Legion is active.')
    command('/fixture-hold')
    start = len(raw)
    command('/legion reserve ' + fixture['task'] + '@1 --parent refs/heads/intended')
    wait('Task NOT YET RESERVED', start)
    wait('Receipt ', start)
    request = re.findall(r'Receipt ([0-9a-f-]{36})', plain(start))[-1]
    command('/legion workspace ' + request)
    wait('TEST-OWNED Git invocation held', start)
    stopping = len(raw)
    command('/legion off')
    wait('Legion is stopping. No new workspace operations will start.', stopping)
    wait('Legion stopping', stopping)
    command('/fixture-release')
    wait('Workspace execution authority is revoked.', stopping)
    wait('Legion inactive', stopping)
    print('passed real TUI reserve/reconcile/workspace completion, default-off, explicit resume, deferred result, stopping and retained reservation')
finally:
    open(os.path.join(fixture['root'], 'workspace-tui.txt'), 'w').write(plain())
    os.killpg(p.pid, signal.SIGTERM)
    p.wait()
    os.close(master)
