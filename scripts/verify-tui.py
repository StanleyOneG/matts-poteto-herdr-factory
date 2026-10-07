import json, os, pty, re, select, signal, struct, subprocess, sys, time, fcntl, termios
fixture = json.load(open(sys.argv[1]))
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
p = subprocess.Popen(['pi', '--no-context-files', '--tui-mode', 'regular'], cwd=fixture['cwd'], env=fixture['env'], stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
raw = b''
def plain(start=0):
    return re.sub(r'\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))', '', raw[start:].decode('utf8', 'replace'))
def wait(text, seconds=20, start=0):
    global raw
    deadline = time.time() + seconds
    while text not in plain(start):
        if time.time() > deadline: raise AssertionError('TUI did not render ' + text + '\n' + plain()[-4000:])
        ready, _, _ = select.select([master], [], [], .1)
        if ready:
            data = os.read(master, 65536)
            if not data: raise AssertionError('TUI exited')
            raw += data
try:
    wait('Legion inactive')
    os.write(master, b'/legion ')
    time.sleep(.2)
    os.write(master, b'\t')
    wait('doctor')
    os.write(master, b'\x15/legion r')
    time.sleep(.3)
    os.write(master, b'\t')
    wait('/legion resume')
    os.write(master, b'\x15/legion d')
    time.sleep(.3)
    os.write(master, b'\t')
    wait('/legion doctor')
    os.write(master, b'\r')
    wait('Observed Pi 1.0.4')
    os.write(master, b'/legion TUI greeting\r')
    wait('Emperor decision')
    wait('Recommendation. Use English')
    wait('Reply normally in chat')
    off_start = len(raw)
    os.write(master, b'/legion off\r')
    wait('Legion inactive. Reservations retained.', start=off_start)
    open(os.path.join(fixture['root'], 'tui-off'), 'w').write('off')
    wait('TUI inactive settlement.', start=off_start)
    inactive_start = len(raw)
    os.write(master, b'/legion off\r')
    wait('Legion inactive. Reservations retained.', start=inactive_start)
    assert 'Emperor decision' not in plain(off_start), 'Inactive off, settlement and refresh republished an unactionable question'
    legatus = re.findall(r'Legatus ([0-9a-f-]{36})', plain())[0]
    resume_start = len(raw)
    os.write(master, ('/legion resume ' + legatus + '\r').encode())
    wait('Legion is active.', start=resume_start)
    os.write(master, b'Use French, please.\r')
    wait('Intake recorded.', start=resume_start)
    status_start = len(raw)
    os.write(master, b'/legion status\r')
    wait('"eligibility":"admitted"', start=status_start)
    assert '"answer":"UseFrench,please."' in re.sub(r'\s+', '', plain(status_start)), 'Resumed ordinary answer must resolve the pending question'
    print('passed real TUI completion, diagnostics, off, inactive settlement, no duplicate questions, explicit resume, and ordinary answer')
finally:
    open(os.path.join(fixture['root'], 'tui.txt'), 'w').write(plain())
    os.killpg(p.pid, signal.SIGTERM)
    p.wait(timeout=10)
    os.close(master)
