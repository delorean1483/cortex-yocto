#pragma once

#include <QObject>
#include <QProcess>
#include <QStringList>
#include <QTimer>
#include <QVariantList>
#include <functional>

#include "WpaCtrl.h"
#include "WpaParse.h"

/* The WiFi screen's model: talks to wpa_supplicant (WpaCtrl), keeps status,
 * signal, the merged network list and saved networks current, runs joins
 * (a network is saved only after it connects; a wrong password or timeout
 * removes it again), and checks whether the connection reaches the internet.
 * Everything is asynchronous; nothing here blocks the UI thread. */
class WifiModel : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString state READ state NOTIFY changed)
    Q_PROPERTY(bool scanning READ scanning NOTIFY changed)
    Q_PROPERTY(QString ssid READ ssid NOTIFY changed)
    Q_PROPERTY(int signalDbm READ signalDbm NOTIFY changed)
    Q_PROPERTY(int signalBars READ signalBars NOTIFY changed)
    Q_PROPERTY(QString ip READ ip NOTIFY changed)
    Q_PROPERTY(QString internet READ internet NOTIFY changed)
    Q_PROPERTY(QVariantList networks READ networks NOTIFY changed)
    Q_PROPERTY(QVariantList saved READ saved NOTIFY changed)
    Q_PROPERTY(QString lastError READ lastError NOTIFY changed)
    Q_PROPERTY(QString pendingSsid READ pendingSsid NOTIFY changed)

public:
    explicit WifiModel(const QString &socketPath = QStringLiteral("/run/wpa_supplicant/wlan0"),
                       QObject *parent = nullptr);

    void start();
    void setTimings(int retryMs, int pollMs, int joinTimeoutMs, int netCheckMs);
    void setInternetCheck(const QString &program, const QStringList &args);

    QString state() const;
    bool scanning() const { return m_scanning; }
    QString ssid() const { return m_connected ? m_ssid : QString(); }
    int signalDbm() const { return m_connected ? m_rssi : 0; }
    int signalBars() const { return m_connected ? wpa::signalBars(m_rssi) : 0; }
    QString ip() const { return m_connected ? m_ip : QString(); }
    QString internet() const { return wpa::internetName(m_internet); }
    QVariantList networks() const { return m_networks; }
    QVariantList saved() const;
    QString lastError() const { return m_lastError; }
    QString pendingSsid() const { return m_pending.active ? m_pending.ssid : QString(); }

    Q_INVOKABLE void scan();
    Q_INVOKABLE void join(const QString &ssid, const QString &password);
    Q_INVOKABLE void joinSaved(int id);
    Q_INVOKABLE void forget(int id);
    Q_INVOKABLE void addHidden(const QString &ssid, bool secured, const QString &password);
    Q_INVOKABLE void clearError();

signals:
    void changed();
    void joined(const QString &ssid);
    void joinFailed(const QString &ssid, const QString &error);

private:
    struct Pending { bool active = false; int id = -1; QString ssid; bool isNew = false; };

    void tryOpen();
    void onLost();
    void onEvent(const QByteArray &line);
    void refresh();
    void rebuild();
    void fetchBss(bool endsScan);
    void pageBss(const QByteArray &cmd, int gen);
    void runSequence(const QList<QByteArray> &cmds, std::function<void(bool)> done,
                     bool bestEffort = false);
    void runTracked(const QList<QByteArray> &cmds);
    bool busy() const { return m_pending.active || m_inflight > 0; }
    void beginJoin(const QString &ssid, const QString &password, bool hidden);
    void finishJoin(bool ok, const QString &error);
    void runInternetCheck();
    bool inScan(const QString &ssid) const;
    void setError(const QString &e);

    WpaCtrl m_ctrl;
    QTimer m_retry, m_poll, m_joinTimer, m_netCheck, m_scanTimer;
    QProcess m_check;
    QString m_checkProgram = QStringLiteral("curl");
    QStringList m_checkArgs = {
        QStringLiteral("-s"), QStringLiteral("-o"), QStringLiteral("/dev/null"),
        QStringLiteral("-w"), QStringLiteral("%{http_code}"),
        QStringLiteral("--interface"), QStringLiteral("wlan0"),
        QStringLiteral("--max-time"), QStringLiteral("8"),
        QStringLiteral("http://connectivitycheck.gstatic.com/generate_204") };

    int m_inflight = 0;          // cleanup/forget sequences still running
    QString m_checkSsid;         // ssid the running internet check started for
    bool m_open = false;
    bool m_connected = false;
    QString m_wpaState;
    bool m_scanning = false;
    QString m_ssid, m_ip;
    int m_rssi = 0;
    wpa::Internet m_internet = wpa::Internet::Unknown;
    QList<wpa::ScanEntry> m_scan;
    // BSS-table paging (BSS FIRST, BSS NEXT-<id>...): one at a time; a request
    // while one runs is folded into a single rerun when it ends.
    static constexpr int kMaxBss = 512;      // loop guard
    QList<wpa::ScanEntry> m_bssAcc;
    bool m_bssBusy = false, m_bssAgain = false, m_bssEndsScan = false;
    int m_bssGen = 0;
    QList<wpa::SavedNet> m_saved;
    QVariantList m_networks;
    QString m_lastError;
    Pending m_pending;
};
