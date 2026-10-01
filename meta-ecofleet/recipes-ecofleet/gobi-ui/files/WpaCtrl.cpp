#include "WpaCtrl.h"

#include <QDir>
#include <QSocketNotifier>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

static int s_counter = 0;

WpaCtrl::WpaCtrl(const QString &serverPath, QObject *parent)
    : QObject(parent), m_server(serverPath.toLocal8Bit())
{
    m_timer.setSingleShot(true);
    connect(&m_timer, &QTimer::timeout, this, &WpaCtrl::fail);
}

WpaCtrl::~WpaCtrl() { close(); }

int WpaCtrl::openSocket(const QByteArray &local)
{
    const int fd = ::socket(AF_UNIX, SOCK_DGRAM, 0);
    if (fd < 0) return -1;
    ::fcntl(fd, F_SETFD, FD_CLOEXEC);
    ::fcntl(fd, F_SETFL, O_NONBLOCK);
    sockaddr_un la{}; la.sun_family = AF_UNIX;
    std::strncpy(la.sun_path, local.constData(), sizeof(la.sun_path) - 1);
    ::unlink(local.constData());
    sockaddr_un ra{}; ra.sun_family = AF_UNIX;
    std::strncpy(ra.sun_path, m_server.constData(), sizeof(ra.sun_path) - 1);
    if (::bind(fd, reinterpret_cast<sockaddr *>(&la), sizeof(la)) < 0
        || ::connect(fd, reinterpret_cast<sockaddr *>(&ra), sizeof(ra)) < 0) {
        ::close(fd);
        ::unlink(local.constData());
        return -1;
    }
    return fd;
}

bool WpaCtrl::open()
{
    close();
    const QByteArray base = QDir::tempPath().toLocal8Bit() + "/gobi-wpa-"
                          + QByteArray::number(::getpid()) + "-" + QByteArray::number(s_counter++);
    m_cmdLocal = base + "-c";
    m_monLocal = base + "-m";
    m_cmdFd = openSocket(m_cmdLocal);
    m_monFd = m_cmdFd >= 0 ? openSocket(m_monLocal) : -1;
    if (m_cmdFd < 0 || m_monFd < 0) { close(); return false; }

    m_cmdN = new QSocketNotifier(m_cmdFd, QSocketNotifier::Read, this);
    connect(m_cmdN, &QSocketNotifier::activated, this, &WpaCtrl::onCmdReadable);
    m_monN = new QSocketNotifier(m_monFd, QSocketNotifier::Read, this);
    connect(m_monN, &QSocketNotifier::activated, this, &WpaCtrl::onMonReadable);

    if (::send(m_monFd, "ATTACH", 6, 0) < 0) { close(); return false; }
    return true;
}

void WpaCtrl::close()
{
    m_timer.stop();
    m_inFlight = false;
    delete m_cmdN; m_cmdN = nullptr;
    delete m_monN; m_monN = nullptr;
    if (m_cmdFd >= 0) { ::close(m_cmdFd); m_cmdFd = -1; ::unlink(m_cmdLocal.constData()); }
    if (m_monFd >= 0) { ::close(m_monFd); m_monFd = -1; ::unlink(m_monLocal.constData()); }
    // Fail whatever was queued (callbacks may enqueue more; those fail too).
    QQueue<Pending> pending;
    pending.swap(m_queue);
    for (const Pending &p : pending) p.cb(false, QByteArray());
}

void WpaCtrl::request(const QByteArray &cmd, Reply cb)
{
    if (!isOpen()) {
        QTimer::singleShot(0, this, [cb] { cb(false, QByteArray()); });
        return;
    }
    m_queue.enqueue({cmd, std::move(cb)});
    if (!m_inFlight) sendHead();
}

void WpaCtrl::sendHead()
{
    if (m_queue.isEmpty() || !isOpen()) return;
    const QByteArray &cmd = m_queue.head().cmd;
    if (::send(m_cmdFd, cmd.constData(), size_t(cmd.size()), 0) < 0) {
        QTimer::singleShot(0, this, &WpaCtrl::fail);
        return;
    }
    m_inFlight = true;
    m_timer.start(m_timeoutMs);
}

void WpaCtrl::onCmdReadable()
{
    char buf[16384];
    const ssize_t n = ::recv(m_cmdFd, buf, sizeof(buf), 0);
    if (n < 0) { if (errno != EAGAIN && errno != EWOULDBLOCK) fail(); return; }
    if (!m_inFlight || m_queue.isEmpty()) return;
    m_timer.stop();
    m_inFlight = false;
    const Pending p = m_queue.dequeue();
    p.cb(true, QByteArray(buf, int(n)));
    if (!m_inFlight) sendHead();
}

void WpaCtrl::onMonReadable()
{
    char buf[4096];
    const ssize_t n = ::recv(m_monFd, buf, sizeof(buf), 0);
    if (n <= 0) return;
    QByteArray msg(buf, int(n));
    if (!msg.startsWith('<')) return;              // ATTACH's "OK"
    const int end = msg.indexOf('>');
    emit event(end > 0 ? msg.mid(end + 1) : msg);
}

void WpaCtrl::fail()
{
    const bool wasOpen = isOpen();
    close();
    if (wasOpen) emit lost();
}
