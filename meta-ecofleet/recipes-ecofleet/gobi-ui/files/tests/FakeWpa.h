#pragma once
// A stand-in wpa_supplicant control socket for host tests: binds a Unix
// datagram socket, records every command, replies via `handler` (default
// "OK\n"), and can push "<3>"-prefixed events to an ATTACHed client.
#include <QObject>
#include <QSocketNotifier>
#include <functional>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <fcntl.h>
#include <cstring>

class FakeWpa : public QObject
{
public:
    std::function<QByteArray(const QByteArray &)> handler = [](const QByteArray &) { return QByteArray("OK\n"); };
    QList<QByteArray> commands;
    bool mute = false;

    explicit FakeWpa(const QString &path) : m_path(path.toLocal8Bit())
    {
        m_fd = ::socket(AF_UNIX, SOCK_DGRAM, 0);
        ::fcntl(m_fd, F_SETFL, O_NONBLOCK);
        sockaddr_un a{}; a.sun_family = AF_UNIX;
        std::strncpy(a.sun_path, m_path.constData(), sizeof(a.sun_path) - 1);
        ::unlink(m_path.constData());
        ::bind(m_fd, reinterpret_cast<sockaddr *>(&a), sizeof(a));
        m_n = new QSocketNotifier(m_fd, QSocketNotifier::Read, this);
        connect(m_n, &QSocketNotifier::activated, this, [this] { onRead(); });
    }
    ~FakeWpa() override { stop(); }

    bool attached() const { return m_monLen > 0; }

    void sendEvent(const QByteArray &line)
    {
        const QByteArray msg = "<3>" + line;
        ::sendto(m_fd, msg.constData(), msg.size(), 0, reinterpret_cast<sockaddr *>(&m_mon), m_monLen);
    }

    void stop()
    {
        if (m_fd < 0) return;
        delete m_n; m_n = nullptr;
        ::close(m_fd); m_fd = -1;
        ::unlink(m_path.constData());
    }

private:
    void onRead()
    {
        char buf[4096];
        sockaddr_un from{}; socklen_t len = sizeof(from);
        const ssize_t n = ::recvfrom(m_fd, buf, sizeof(buf), 0, reinterpret_cast<sockaddr *>(&from), &len);
        if (n <= 0) return;
        const QByteArray cmd(buf, int(n));
        commands << cmd;
        QByteArray reply;
        if (cmd == "ATTACH") { m_mon = from; m_monLen = len; reply = "OK\n"; }
        else reply = handler(cmd);
        if (!mute)
            ::sendto(m_fd, reply.constData(), reply.size(), 0, reinterpret_cast<sockaddr *>(&from), len);
    }

    QByteArray m_path;
    int m_fd = -1;
    QSocketNotifier *m_n = nullptr;
    sockaddr_un m_mon{};
    socklen_t m_monLen = 0;
};
