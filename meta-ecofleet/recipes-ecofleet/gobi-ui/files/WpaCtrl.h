#pragma once

#include <QByteArray>
#include <QObject>
#include <QQueue>
#include <QTimer>
#include <functional>

class QSocketNotifier;

/* Minimal, non-blocking client for wpa_supplicant's control interface (the
 * protocol wpa_cli speaks): one Unix datagram socket for request/reply, one
 * ATTACHed for unsolicited events. Requests are queued and sent one at a time;
 * each has a timeout. A timeout or send failure means wpa_supplicant is gone:
 * the client closes, fails every pending request and emits lost() — the owner
 * reopens later. */
class WpaCtrl : public QObject
{
    Q_OBJECT
public:
    using Reply = std::function<void(bool ok, const QByteArray &reply)>;

    explicit WpaCtrl(const QString &serverPath, QObject *parent = nullptr);
    ~WpaCtrl() override;

    bool open();
    void close();
    bool isOpen() const { return m_cmdFd >= 0; }
    void request(const QByteArray &cmd, Reply cb);
    void setTimeoutMs(int ms) { m_timeoutMs = ms; }

signals:
    void wpaEvent(const QByteArray &line);
    void lost();

private:
    struct Pending { QByteArray cmd; Reply cb; };
    int openSocket(const QByteArray &localPath);
    void closeSockets();
    void sendHead();
    void onCmdReadable();
    void onMonReadable();
    void fail();

    QByteArray m_server;
    QByteArray m_cmdLocal, m_monLocal;
    int m_cmdFd = -1, m_monFd = -1;
    QSocketNotifier *m_cmdN = nullptr, *m_monN = nullptr;
    QQueue<Pending> m_queue;
    bool m_inFlight = false;
    QTimer m_timer;
    int m_timeoutMs = 2000;
    int m_generation = 0;
};
