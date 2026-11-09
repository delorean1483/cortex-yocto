#!/usr/bin/env python3
"""Run shell commands on R1 over its USB-C login console (stdlib only).

Usage: r1sh.py PORT 'cmd' ['cmd' ...]
Logs in as root (empty password) if it sees a login prompt, then runs each
command and prints its output, delimited by a marker.
  '@put LOCAL REMOTE'  copies a file in base64 chunks and checks its md5
  '@MACNOW@'           in a command becomes the Mac's epoch time when sent
  R1SH_TIMEOUT         seconds to wait for each command (default 60)
"""
import base64, hashlib, os, select, sys, termios, time

port, cmds = sys.argv[1], sys.argv[2:]
fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
a = termios.tcgetattr(fd)
a[0] = a[1] = a[3] = 0
a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
a[4] = a[5] = termios.B115200
a[6][termios.VMIN] = a[6][termios.VTIME] = 0
termios.tcsetattr(fd, termios.TCSANOW, a)


def read_until(pats, timeout):
    buf, end = b"", time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                buf += os.read(fd, 4096)
            except BlockingIOError:
                pass
            for p in pats:
                if p in buf:
                    return buf, p
    return buf, None


def send(s):
    os.write(fd, s.encode())


send("\r")
buf, hit = read_until([b"login: ", b"# "], 5)
if hit == b"login: ":
    send("root\r")
    buf, hit = read_until([b"Password: ", b"# "], 5)
    if hit == b"Password: ":
        send("\r")
        buf, hit = read_until([b"# "], 5)
if hit != b"# ":
    sys.stdout.write(buf.decode(errors="replace"))
    sys.exit("no shell prompt")

send("stty -echo; export PS1='# ' TERM=dumb\r")
read_until([b"# "], 3)
time.sleep(0.3)
termios.tcflush(fd, termios.TCIFLUSH)

TIMEOUT = float(os.environ.get("R1SH_TIMEOUT", "60"))
n = 0


def run(c, show=True):
    global n
    mark = f"__END{n}__"
    n += 1
    send(f"{c}; echo {mark}\r")
    out, hit = read_until([mark.encode() + b"\r\n", mark.encode() + b"\n"], TIMEOUT)
    text = out.decode(errors="replace").replace("\r", "").split(mark)[0].strip()
    if show:
        print(f"$ {c}\n{text}\n")
        if hit is None:
            print("(timed out)")
    return text


def put(local, remote):
    data = open(local, "rb").read()
    b64 = base64.b64encode(data).decode()
    run(f"rm -f {remote}.b64", show=False)
    for i in range(0, len(b64), 400):
        run(f"printf %s '{b64[i:i + 400]}' >> {remote}.b64", show=False)
    got = run(f"base64 -d {remote}.b64 > {remote} && rm {remote}.b64 && md5sum {remote}", show=False)
    want = hashlib.md5(data).hexdigest()
    if want not in got:
        sys.exit(f"@put {local}: md5 mismatch on R1 ({got!r}, want {want})")
    print(f"@put {local} -> {remote}: {len(data)} bytes, md5 ok\n")


for c in cmds:
    if c.startswith("@put "):
        put(*c.split()[1:3])
    else:
        run(c.replace("@MACNOW@", str(int(time.time()))))
os.close(fd)
