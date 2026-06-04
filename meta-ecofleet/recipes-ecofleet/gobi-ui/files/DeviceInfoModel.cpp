#include "DeviceInfoModel.h"

#include <QFile>
#include <QTextStream>
#include <QNetworkInterface>
#include <QAbstractSocket>

#include <unistd.h>  /* gethostname */

static constexpr int  NETWORK_POLL_MS   = 5000;
static constexpr const char *SERIAL_FILE  = "/etc/ecofleet/unit-serial";
static constexpr const char *FW_VERSION   = "/etc/ecofleet/firmware-version";
static constexpr const char *OS_RELEASE   = "/etc/os-release";

DeviceInfoModel::DeviceInfoModel(QObject *parent) : QObject(parent)
{
    /* ── Unit serial ── */
    m_serial = readFirstLine(QString::fromLatin1(SERIAL_FILE));
    if (m_serial.isEmpty())
        m_serial = QStringLiteral("Unknown");

    /* ── Hostname ── */
    char hbuf[256] = {};
    if (gethostname(hbuf, sizeof(hbuf) - 1) == 0)
        m_hostname = QString::fromLatin1(hbuf);
    if (m_hostname.isEmpty())
        m_hostname = QStringLiteral("Unknown");

    /* ── Firmware version ── */
    m_fw = readFirstLine(QString::fromLatin1(FW_VERSION));
    if (m_fw.isEmpty())
        m_fw = parseOsRelease(QStringLiteral("VERSION_ID"));
    if (m_fw.isEmpty())
        m_fw = QStringLiteral("Unknown");

    /* ── Initial network read + recurring poll ── */
    refreshNetwork();
    m_timer = new QTimer(this);
    connect(m_timer, &QTimer::timeout, this, &DeviceInfoModel::refreshNetwork);
    m_timer->start(NETWORK_POLL_MS);
}

void DeviceInfoModel::refreshNetwork()
{
    QString ip, mac;
    bool linked = false;

    const auto ifaces = QNetworkInterface::allInterfaces();
    for (const auto &iface : ifaces) {
        if (iface.flags().testFlag(QNetworkInterface::IsLoopBack))
            continue;
        /* Skip virtual/bridge interfaces */
        const QString name = iface.name();
        if (name.startsWith(u"vir") || name.startsWith(u"docker") ||
            name.startsWith(u"br") || name.startsWith(u"veth"))
            continue;

        if (mac.isEmpty())
            mac = iface.hardwareAddress();

        const bool up = iface.flags().testFlag(QNetworkInterface::IsUp) &&
                        iface.flags().testFlag(QNetworkInterface::IsRunning);
        if (up) {
            linked = true;
            for (const auto &entry : iface.addressEntries()) {
                if (entry.ip().protocol() == QAbstractSocket::IPv4Protocol &&
                    !entry.ip().isLoopback() && ip.isEmpty()) {
                    ip = entry.ip().toString();
                }
            }
        }

        if (linked && !ip.isEmpty())
            break;
    }

    const QString newIp  = ip.isEmpty()  ? QStringLiteral("No IP")    : ip;
    const QString newMac = mac.isEmpty() ? QStringLiteral("Unknown")  : mac;

    if (newIp != m_ip || newMac != m_mac || linked != m_linked) {
        m_ip     = newIp;
        m_mac    = newMac;
        m_linked = linked;
        emit networkChanged();
    }
}

QString DeviceInfoModel::readFirstLine(const QString &path)
{
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text))
        return {};
    return QString::fromLatin1(f.readLine()).trimmed();
}

QString DeviceInfoModel::parseOsRelease(const QString &key)
{
    QFile f(QString::fromLatin1(OS_RELEASE));
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text))
        return {};
    QTextStream in(&f);
    const QString prefix = key + u'=';
    while (!in.atEnd()) {
        QString line = in.readLine();
        if (line.startsWith(prefix)) {
            QString val = line.mid(prefix.length());
            /* Strip surrounding quotes if present */
            if (val.length() >= 2 && val.front() == u'"' && val.back() == u'"')
                val = val.mid(1, val.length() - 2);
            return val;
        }
    }
    return {};
}
