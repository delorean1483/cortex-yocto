#include "WifiModel.h"

#include <QVariantMap>

WifiModel::WifiModel(const QString &socketPath, QObject *parent)
    : QObject(parent), m_ctrl(socketPath)
{
    m_retry.setInterval(5000);
    m_poll.setInterval(5000);
    m_joinTimer.setSingleShot(true);
    m_joinTimer.setInterval(30000);
    m_netCheck.setInterval(120000);
    m_scanTimer.setSingleShot(true);
    m_scanTimer.setInterval(10000);
    connect(&m_scanTimer, &QTimer::timeout, this, [this] { m_scanning = false; emit changed(); });

    connect(&m_retry, &QTimer::timeout, this, &WifiModel::tryOpen);
    connect(&m_poll, &QTimer::timeout, this, &WifiModel::refresh);
    connect(&m_netCheck, &QTimer::timeout, this, &WifiModel::runInternetCheck);
    connect(&m_joinTimer, &QTimer::timeout, this, [this] {
        finishJoin(false, QStringLiteral("Couldn't connect to %1.").arg(m_pending.ssid));
    });
    connect(&m_ctrl, &WpaCtrl::wpaEvent, this, &WifiModel::onEvent);
    connect(&m_ctrl, &WpaCtrl::lost, this, &WifiModel::onLost);
    connect(&m_check, &QProcess::finished, this, [this](int exitCode, QProcess::ExitStatus st) {
        const QByteArray code = m_check.readAllStandardOutput();
        if (m_checkSsid != m_ssid) {         // result is for a network we've left
            m_internet = wpa::Internet::Unknown;
            emit changed();
            runInternetCheck();
            return;
        }
        m_internet = m_connected
            ? wpa::classifyCheck(st == QProcess::NormalExit ? exitCode : -1, code)
            : wpa::Internet::Unknown;
        emit changed();
    });
}

void WifiModel::setTimings(int retryMs, int pollMs, int joinTimeoutMs, int netCheckMs)
{
    m_retry.setInterval(retryMs);
    m_poll.setInterval(pollMs);
    m_joinTimer.setInterval(joinTimeoutMs);
    m_netCheck.setInterval(netCheckMs);
}

void WifiModel::setInternetCheck(const QString &program, const QStringList &args)
{
    m_checkProgram = program;
    m_checkArgs = args;
}

void WifiModel::start() { tryOpen(); }

QString WifiModel::state() const
{
    if (!m_open) return QStringLiteral("unavailable");
    if (m_pending.active) return QStringLiteral("connecting");
    if (m_connected) return QStringLiteral("connected");
    static const QStringList busy = { "ASSOCIATING", "ASSOCIATED", "AUTHENTICATING",
                                      "4WAY_HANDSHAKE", "GROUP_HANDSHAKE" };
    if (busy.contains(m_wpaState)) return QStringLiteral("connecting");
    return QStringLiteral("idle");
}

QVariantList WifiModel::saved() const
{
    QVariantList out;
    for (const wpa::SavedNet &s : m_saved) {
        QVariantMap m;
        m["id"] = s.id;
        m["ssid"] = s.ssid;
        m["inUse"] = m_connected && s.ssid == m_ssid;
        out << m;
    }
    return out;
}

void WifiModel::tryOpen()
{
    if (m_ctrl.open()) {
        m_open = true;
        m_retry.stop();
        m_poll.start();
        m_netCheck.start();
        emit changed();
        refresh();
        scan();
    } else {
        m_open = false;
        if (!m_retry.isActive()) m_retry.start();
        emit changed();
    }
}

void WifiModel::onLost()
{
    const bool hadJoin = m_pending.active;
    const QString joinSsid = m_pending.ssid;
    m_pending = Pending();
    m_joinTimer.stop();
    m_open = false;
    m_connected = false;
    m_scanning = false;
    m_scanTimer.stop();
    m_internet = wpa::Internet::Unknown;
    m_scan.clear();
    m_saved.clear();
    m_networks.clear();
    m_poll.stop();
    m_netCheck.stop();
    m_retry.start();
    if (hadJoin) {
        setError(QStringLiteral("WiFi unavailable"));
        emit joinFailed(joinSsid, m_lastError);
    }
    emit changed();
}

void WifiModel::refresh()
{
    m_ctrl.request("STATUS", [this](bool ok, const QByteArray &r) {
        if (!ok) return;
        const auto kv = wpa::parseKeyValues(r);
        const bool wasConnected = m_connected;
        const QString prevSsid = m_ssid;
        m_wpaState = kv.value("wpa_state");
        m_connected = m_wpaState == QLatin1String("COMPLETED");
        m_ssid = kv.value("ssid");
        m_ip = kv.value("ip_address");
        if (!m_connected) m_internet = wpa::Internet::Unknown;
        if (m_connected && wasConnected && m_ssid != prevSsid) m_internet = wpa::Internet::Unknown;
        if (m_connected && (!wasConnected || m_ssid != prevSsid)) runInternetCheck();
        rebuild();
    });
    m_ctrl.request("LIST_NETWORKS", [this](bool ok, const QByteArray &r) {
        if (!ok) return;
        m_saved = wpa::parseListNetworks(r);
        rebuild();
    });
    m_ctrl.request("SIGNAL_POLL", [this](bool ok, const QByteArray &r) {
        if (!ok) return;
        const auto kv = wpa::parseKeyValues(r);
        if (kv.contains("RSSI")) m_rssi = kv.value("RSSI").toInt();
        rebuild();
    });
}

void WifiModel::rebuild()
{
    m_networks = wpa::buildNetworkList(m_scan, m_saved, m_connected ? m_ssid : QString());
    emit changed();
}

void WifiModel::scan()
{
    m_scanning = true;
    m_scanTimer.start();
    emit changed();
    m_ctrl.request("SCAN", [this](bool ok, const QByteArray &r) {
        if (!ok || r.startsWith("FAIL")) { m_scanning = false; m_scanTimer.stop(); emit changed(); return; }
        // Results arrive with CTRL-EVENT-SCAN-RESULTS; also read what's cached now.
        m_ctrl.request("SCAN_RESULTS", [this](bool ok2, const QByteArray &r) {
            if (ok2) m_scan = wpa::parseScanResults(r);
            rebuild();
        });
    });
}

void WifiModel::onEvent(const QByteArray &line)
{
    const wpa::Event e = wpa::parseEvent(line);
    switch (e.type) {
    case wpa::Event::ScanResults:
        m_ctrl.request("SCAN_RESULTS", [this](bool ok, const QByteArray &r) {
            if (ok) m_scan = wpa::parseScanResults(r);
            m_scanning = false;
            m_scanTimer.stop();
            rebuild();
        });
        break;
    case wpa::Event::Connected:
        if (m_pending.active && (e.id < 0 || e.id == m_pending.id)) finishJoin(true, QString());
        else refresh();
        break;
    case wpa::Event::WrongKey:
        if (m_pending.active && e.id == m_pending.id) finishJoin(false, QStringLiteral("Wrong password."));
        break;
    case wpa::Event::Disconnected:
        refresh();
        break;
    default:
        break;
    }
}

/* Runs cmds one after another. By default stops at the first FAIL; with
 * bestEffort every command is sent even after a FAIL reply (a transport
 * failure — wpa_supplicant gone — still ends it). done(true) = all succeeded. */
void WifiModel::runSequence(const QList<QByteArray> &cmds, std::function<void(bool)> done,
                            bool bestEffort)
{
    if (cmds.isEmpty()) { done(true); return; }
    const QByteArray head = cmds.first();
    const QList<QByteArray> rest = cmds.mid(1);
    m_ctrl.request(head, [this, rest, done, bestEffort](bool ok, const QByteArray &r) {
        const bool failed = r.startsWith("FAIL");
        if (!ok || (failed && !bestEffort)) { done(false); return; }
        if (!failed) { runSequence(rest, done, bestEffort); return; }
        runSequence(rest, [done](bool) { done(false); }, bestEffort);
    });
}

/* Best-effort sequence that keeps the model busy until it has finished. */
void WifiModel::runTracked(const QList<QByteArray> &cmds)
{
    ++m_inflight;
    runSequence(cmds, [this](bool) {
        --m_inflight;
        refresh();
    }, true);
}

bool WifiModel::inScan(const QString &ssid) const
{
    for (const wpa::ScanEntry &e : m_scan)
        if (e.ssid == ssid) return true;
    return false;
}

void WifiModel::setError(const QString &e)
{
    m_lastError = e;
    emit changed();
}

void WifiModel::clearError() { setError(QString()); }

void WifiModel::join(const QString &ssid, const QString &password)
{
    if (busy()) return;
    QString err = wpa::validateSsid(ssid);
    if (err.isEmpty() && !password.isEmpty()) err = wpa::validatePassword(password);
    if (err.isEmpty() && !inScan(ssid)) err = QStringLiteral("%1 is out of range.").arg(ssid);
    if (!err.isEmpty()) { setError(err); return; }
    beginJoin(ssid, password, false);
}

void WifiModel::addHidden(const QString &ssid, bool secured, const QString &password)
{
    if (busy()) return;
    QString err = wpa::validateSsid(ssid);
    if (err.isEmpty() && secured) err = wpa::validatePassword(password);
    if (!err.isEmpty()) { setError(err); return; }
    beginJoin(ssid, secured ? password : QString(), true);
}

void WifiModel::beginJoin(const QString &ssid, const QString &password, bool hidden)
{
    m_lastError.clear();
    m_pending = { true, -1, ssid, true };
    emit changed();
    m_ctrl.request("ADD_NETWORK", [this, ssid, password, hidden](bool ok, const QByteArray &r) {
        bool isNum = false;
        const int id = r.trimmed().toInt(&isNum);
        if (!ok || !isNum) { finishJoin(false, QStringLiteral("Couldn't connect to %1.").arg(ssid)); return; }
        m_pending.id = id;
        const QByteArray sid = QByteArray::number(id);
        QList<QByteArray> cmds = { "SET_NETWORK " + sid + " ssid " + wpa::ssidHex(ssid) };
        if (password.isEmpty()) {
            cmds << "SET_NETWORK " + sid + " key_mgmt NONE";
        } else {
            cmds << "SET_NETWORK " + sid + " psk " + wpa::pskHex(password, ssid)
                 << "SET_NETWORK " + sid + " key_mgmt WPA-PSK FT-PSK";
        }
        if (hidden) cmds << "SET_NETWORK " + sid + " scan_ssid 1";
        cmds << "SELECT_NETWORK " + sid;
        runSequence(cmds, [this, ssid](bool okSeq) {
            if (!okSeq) { finishJoin(false, QStringLiteral("Couldn't connect to %1.").arg(ssid)); return; }
            m_joinTimer.start();
        });
    });
}

void WifiModel::joinSaved(int id)
{
    if (busy()) return;
    QString ssid;
    for (const wpa::SavedNet &s : m_saved)
        if (s.id == id) ssid = s.ssid;
    if (ssid.isEmpty()) return;
    if (!inScan(ssid)) { setError(QStringLiteral("%1 is out of range.").arg(ssid)); return; }
    m_lastError.clear();
    m_pending = { true, id, ssid, false };
    emit changed();
    runSequence({ "SELECT_NETWORK " + QByteArray::number(id) }, [this, ssid](bool ok) {
        if (!ok) { finishJoin(false, QStringLiteral("Couldn't connect to %1.").arg(ssid)); return; }
        m_joinTimer.start();
    });
}

void WifiModel::finishJoin(bool ok, const QString &error)
{
    if (!m_pending.active) return;
    m_joinTimer.stop();
    const Pending p = m_pending;
    m_pending = Pending();

    QList<QByteArray> cmds;
    if (ok) {
        cmds << "ENABLE_NETWORK all";
        if (p.isNew) {
            for (const wpa::SavedNet &s : m_saved)          // replace an older entry for this SSID
                if (s.ssid == p.ssid && s.id != p.id) cmds << "REMOVE_NETWORK " + QByteArray::number(s.id);
            cmds << "SAVE_CONFIG";
        }
    } else {
        if (p.isNew && p.id >= 0) cmds << "REMOVE_NETWORK " + QByteArray::number(p.id);
        cmds << "ENABLE_NETWORK all";
    }
    runTracked(cmds);

    if (ok) {
        m_lastError.clear();
        emit joined(p.ssid);
    } else {
        m_lastError = error;
        emit joinFailed(p.ssid, error);
    }
    emit changed();
}

void WifiModel::forget(int id)
{
    if (busy()) return;
    runTracked({ "REMOVE_NETWORK " + QByteArray::number(id), "SAVE_CONFIG" });
}

void WifiModel::runInternetCheck()
{
    if (!m_connected || m_check.state() != QProcess::NotRunning) return;
    m_checkSsid = m_ssid;
    m_check.start(m_checkProgram, m_checkArgs);
}
