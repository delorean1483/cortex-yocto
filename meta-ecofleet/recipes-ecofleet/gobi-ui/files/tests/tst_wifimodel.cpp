// Host tests for WifiModel against FakeWpa: status/scan refresh, join success
// and failure paths, forgetting, and losing wpa_supplicant.
#include <QtTest>
#include <QSignalSpy>
#include <QTemporaryDir>
#include "FakeWpa.h"
#include "../WifiModel.h"

struct Bss { QByteArray bssid; int freq; int level; QByteArray flags; QByteArray ssid; };
static const QList<Bss> kScan = {
    { "0c:ea:14:23:2d:43", 5240, -47, "[WPA2-PSK-CCMP][ESS]", "Yard" },
    { "11:22:33:44:55:66", 2412, -70, "[WPA2-PSK-CCMP][ESS]", "Shop" },
    { "22:22:33:44:55:66", 2412, -60, "[ESS]", "Free" },
};

/* A small scriptable wpa_supplicant: tracks networks so ADD/REMOVE/LIST agree. */
struct Script {
    QString state = "DISCONNECTED";
    QString ssid;
    QMap<int, QString> nets;     // id -> ssid
    int nextId = 0;
    int current = -1;
    QList<Bss> bss = kScan;      // the BSS table; id = index
    QByteArray bssReply(int i) const
    {
        if (i < 0 || i >= bss.size()) return QByteArray();   // past the end: empty reply
        const Bss &b = bss[i];
        return "id=" + QByteArray::number(i) + "\nbssid=" + b.bssid + "\nfreq=" + QByteArray::number(b.freq)
             + "\nlevel=" + QByteArray::number(b.level) + "\nflags=" + b.flags + "\nssid=" + b.ssid + "\n";
    }
    QByteArray operator()(const QByteArray &c)
    {
        if (c == "STATUS") {
            QByteArray r = "wpa_state=" + state.toLatin1() + "\n";
            if (state == "COMPLETED") r += "ssid=" + ssid.toUtf8() + "\nid=" + QByteArray::number(current) + "\nip_address=192.168.0.206\n";
            return r;
        }
        if (c == "LIST_NETWORKS") {
            QByteArray r = "network id / ssid / bssid / flags\n";
            for (auto it = nets.begin(); it != nets.end(); ++it)
                r += QByteArray::number(it.key()) + "\t" + it.value().toUtf8() + "\tany\t"
                   + (it.key() == current ? "[CURRENT]" : "") + "\n";
            return r;
        }
        if (c == "BSS FIRST MASK=0x1887") return bssReply(0);
        if (c.startsWith("BSS NEXT-") && c.endsWith(" MASK=0x1887")) return bssReply(c.mid(9).split(' ')[0].toInt() + 1);
        if (c.startsWith("BSS") || c.startsWith("SCAN_RESULTS")) return "FAIL\n";
        if (c == "SIGNAL_POLL") return "RSSI=-47\nLINKSPEED=600\n";
        if (c == "ADD_NETWORK") { nets.insert(nextId, QString()); return QByteArray::number(nextId++) + "\n"; }
        if (c.startsWith("SET_NETWORK ")) {
            const QList<QByteArray> p = c.split(' ');
            if (p.size() >= 4 && p[2] == "ssid") nets[p[1].toInt()] = QString::fromUtf8(QByteArray::fromHex(p[3]));
            return "OK\n";
        }
        if (c.startsWith("REMOVE_NETWORK ")) { nets.remove(c.mid(15).toInt()); return "OK\n"; }
        return "OK\n";
    }
};

class TestWifiModel : public QObject
{
    Q_OBJECT
    QTemporaryDir m_dir;
    QString path() const { return m_dir.path() + "/wlan0"; }

    static void fast(WifiModel &m) { m.setTimings(100, 60000, 500, 60000); m.setInternetCheck("sh", {"-c", "printf 204"}); }
    static int count(const FakeWpa &f, const QByteArray &prefix)
    { int n = 0; for (const auto &c : f.commands) if (c.startsWith(prefix)) ++n; return n; }

private slots:
    void unavailableWithoutServer()
    {
        WifiModel m(m_dir.path() + "/missing");
        fast(m);
        m.start();
        QCOMPARE(m.state(), QStringLiteral("unavailable"));
    }

    void refreshShowsConnectedNetwork()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Yard"}}; s.nextId = 1; s.current = 0;
        s.state = "COMPLETED"; s.ssid = "Yard";
        f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.state(), QStringLiteral("connected"));
        QTRY_COMPARE(m.ssid(), QStringLiteral("Yard"));
        QTRY_COMPARE(m.ip(), QStringLiteral("192.168.0.206"));
        QTRY_COMPARE(m.signalBars(), 4);
        QTRY_COMPARE(m.networks().size(), 3);
        QCOMPARE(m.networks()[0].toMap()["ssid"].toString(), QStringLiteral("Yard"));
        QVERIFY(m.networks()[0].toMap()["inUse"].toBool());
        QTRY_COMPARE(m.internet(), QStringLiteral("online"));
        QCOMPARE(m.saved().size(), 1);
    }

    void joinSendsHexSsidAndPsk()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        QVERIFY(f.commands.contains("SET_NETWORK 0 ssid " + QByteArray("Shop").toHex()));
        QVERIFY(f.commands.contains("SET_NETWORK 0 psk " + wpa::pskHex("password1", "Shop")));
        QVERIFY(f.commands.contains("SET_NETWORK 0 key_mgmt WPA-PSK FT-PSK WPA-PSK-SHA256"));
        for (const auto &c : f.commands) QVERIFY(!c.contains("password1"));   // never sent in plaintext
        QCOMPARE(m.state(), QStringLiteral("connecting"));
        QCOMPARE(m.pendingSsid(), QStringLiteral("Shop"));
    }

    void joinSuccessSaves()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy ok(&m, &WifiModel::joined);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        s.state = "COMPLETED"; s.ssid = "Shop"; s.current = 0;
        f.sendEvent("CTRL-EVENT-CONNECTED - Connection to 11:22:33:44:55:66 completed [id=0 id_str=]");
        QTRY_COMPARE(ok.count(), 1);
        QTRY_VERIFY(f.commands.contains("SAVE_CONFIG"));
        QVERIFY(f.commands.contains("ENABLE_NETWORK all"));
        QTRY_COMPARE(m.state(), QStringLiteral("connected"));
        QCOMPARE(m.lastError(), QString());
    }

    void wrongPasswordRemovesAndDoesNotSave()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy bad(&m, &WifiModel::joinFailed);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "wrongpass");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        f.sendEvent("CTRL-EVENT-SSID-TEMP-DISABLED id=0 ssid=\"Shop\" auth_failures=1 duration=10 reason=WRONG_KEY");
        QTRY_COMPARE(bad.count(), 1);
        QCOMPARE(bad[0][1].toString(), QStringLiteral("Wrong password."));
        QTRY_VERIFY(f.commands.contains("REMOVE_NETWORK 0"));
        QTRY_VERIFY(f.commands.contains("ENABLE_NETWORK all"));   // follows REMOVE after a round-trip
        QVERIFY(!f.commands.contains("SAVE_CONFIG"));
        QCOMPARE(m.lastError(), QStringLiteral("Wrong password."));
    }

    void timeoutFails()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy bad(&m, &WifiModel::joinFailed);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Free", "");
        QTRY_COMPARE(bad.count(), 1);   // joinTimeoutMs = 500 in fast()
        QCOMPARE(bad[0][1].toString(), QStringLiteral("Couldn't connect to Free."));
        QVERIFY(f.commands.contains("SET_NETWORK 0 key_mgmt NONE"));
        QTRY_VERIFY(f.commands.contains("REMOVE_NETWORK 0"));
    }

    void outOfRangeAndValidation()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Gone", "password1");
        QCOMPARE(m.lastError(), QStringLiteral("Gone is out of range."));
        m.join("Shop", "short");
        QCOMPARE(m.lastError(), QStringLiteral("Password must be at least 8 characters."));
        QCOMPARE(count(f, "ADD_NETWORK"), 0);
    }

    void secondJoinIgnoredWhilePending()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        m.join("Shop", "password1");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        QCOMPARE(count(f, "ADD_NETWORK"), 1);
    }

    void rejoinReplacesOldEntry()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Shop"}}; s.nextId = 1; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.saved().size(), 1);
        m.join("Shop", "newpassword");   // password changed: add as new
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 1"));
        s.state = "COMPLETED"; s.ssid = "Shop"; s.current = 1;
        f.sendEvent("CTRL-EVENT-CONNECTED - Connection to 11:22:33:44:55:66 completed [id=1 id_str=]");
        QTRY_VERIFY(f.commands.contains("REMOVE_NETWORK 0"));
        QTRY_VERIFY(f.commands.contains("SAVE_CONFIG"));
        QTRY_COMPARE(m.saved().size(), 1);
    }

    void joinSavedSelectsWithoutAdding()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Shop"}}; s.nextId = 1; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.saved().size(), 1);
        m.joinSaved(0);
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        QCOMPARE(count(f, "ADD_NETWORK"), 0);
    }

    void forgetRemovesAndSaves()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Shop"}}; s.nextId = 1; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.saved().size(), 1);
        m.forget(0);
        QTRY_VERIFY(f.commands.contains("SAVE_CONFIG"));
        QVERIFY(f.commands.contains("REMOVE_NETWORK 0"));
        QTRY_COMPARE(m.saved().size(), 0);
    }

    void addHiddenSetsScanSsid()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 3);
        m.addHidden("Secret", true, "password1");   // not in scan: allowed for hidden
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        QVERIFY(f.commands.contains("SET_NETWORK 0 scan_ssid 1"));
    }

    void portalAndNoInternet()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Yard"}}; s.nextId = 1; s.current = 0;
        s.state = "COMPLETED"; s.ssid = "Yard"; f.handler = std::ref(s);
        WifiModel m(path()); m.setTimings(100, 60000, 500, 60000);
        m.setInternetCheck("sh", {"-c", "printf 302"});
        m.start();
        QTRY_COMPARE(m.internet(), QStringLiteral("portal"));

        WifiModel n(path()); n.setTimings(100, 60000, 500, 60000);
        n.setInternetCheck("sh", {"-c", "printf 000; exit 6"});
        n.start();
        QTRY_COMPARE(n.internet(), QStringLiteral("no_internet"));
    }

    void serverLossFailsJoinAndRecovers()
    {
        auto *f = new FakeWpa(path()); Script s; f->handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy bad(&m, &WifiModel::joinFailed);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        QTRY_VERIFY(f->commands.contains("SELECT_NETWORK 0"));
        delete f;                                   // wpa_supplicant goes away
        m.scan();                                   // next request notices
        QTRY_COMPARE(m.state(), QStringLiteral("unavailable"));
        QTRY_COMPARE(bad.count(), 1);
        QCOMPARE(m.lastError(), QStringLiteral("WiFi unavailable"));
        QCOMPARE(m.networks().size(), 0);
        QCOMPARE(m.saved().size(), 0);
        QVERIFY(!m.scanning());
        FakeWpa back(path()); Script s2; back.handler = std::ref(s2);
        QTRY_COMPARE(m.state(), QStringLiteral("idle"));   // retry every 100 ms
    }

    void forgetIgnoredWhileJoinPending()
    {
        FakeWpa f(path()); Script s; s.nets = {{5, "Old"}}; s.nextId = 6; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 6"));
        m.forget(5);
        QTest::qWait(150);
        QCOMPARE(count(f, "REMOVE_NETWORK"), 0);
        QCOMPARE(count(f, "SAVE_CONFIG"), 0);
    }

    void joinIgnoredWhileCleanupInFlight()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy ok(&m, &WifiModel::joined);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        s.state = "COMPLETED"; s.ssid = "Shop"; s.current = 0;
        f.sendEvent("CTRL-EVENT-CONNECTED - Connection to 11:22:33:44:55:66 completed [id=0 id_str=]");
        QTRY_COMPARE(ok.count(), 1);
        m.join("Free", "");          // cleanup (ENABLE/SAVE_CONFIG) still in flight
        QTRY_VERIFY(f.commands.contains("SAVE_CONFIG"));
        QTest::qWait(100);
        QCOMPARE(count(f, "ADD_NETWORK"), 1);
    }

    void cleanupContinuesPastFail()
    {
        FakeWpa f(path()); Script s; f.handler = [&s](const QByteArray &c) {
            return c.startsWith("REMOVE_NETWORK") ? QByteArray("FAIL\n") : s(c); };
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy bad(&m, &WifiModel::joinFailed);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "wrongpass");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        f.sendEvent("CTRL-EVENT-SSID-TEMP-DISABLED id=0 ssid=\"Shop\" auth_failures=1 duration=10 reason=WRONG_KEY");
        QTRY_COMPARE(bad.count(), 1);
        QTRY_VERIFY(f.commands.contains("ENABLE_NETWORK all"));
    }

    void scanFailClearsScanning()
    {
        FakeWpa f(path()); Script s;
        f.handler = [&s](const QByteArray &c) { return c == "SCAN" ? QByteArray("FAIL-BUSY\n") : s(c); };
        WifiModel m(path()); fast(m); m.start();
        QTRY_VERIFY(f.commands.contains("SCAN"));
        QTRY_VERIFY(!m.scanning());
    }

    void scanWithoutResultsTimesOut()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_VERIFY(m.scanning());
        QTRY_VERIFY_WITH_TIMEOUT(!m.scanning(), 13000);
    }

    void internetRechecksOnNetworkChange()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Yard"}}; s.nextId = 1; s.current = 0;
        s.state = "COMPLETED"; s.ssid = "Yard"; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.internet(), QStringLiteral("online"));
        m.setInternetCheck("sh", {"-c", "printf 302"});
        s.ssid = "Shop";
        f.sendEvent("CTRL-EVENT-DISCONNECTED bssid=11:22:33:44:55:66 reason=3");
        QTRY_COMPARE(m.ssid(), QStringLiteral("Shop"));
        QTRY_COMPARE(m.internet(), QStringLiteral("portal"));
    }

    void connectedEventForOtherIdDoesNotFinishJoin()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy ok(&m, &WifiModel::joined);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "password1");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        f.sendEvent("CTRL-EVENT-CONNECTED - Connection to 11:22:33:44:55:66 completed [id=7 id_str=]");
        QTest::qWait(100);
        QCOMPARE(ok.count(), 0);
        QCOMPARE(m.state(), QStringLiteral("connecting"));
        QCOMPARE(count(f, "SAVE_CONFIG"), 0);
    }

    void bssPagingListsEveryNetwork()
    {
        // 80 BSSs (+1 duplicate SSID) would overflow SCAN_RESULTS' ~4 KB reply.
        FakeWpa f(path()); Script s; s.bss.clear();
        for (int i = 0; i < 80; ++i)
            s.bss << Bss{ "02:00:00:00:00:" + QByteArray::number(i, 16).rightJustified(2, '0'), 2412,
                          -40 - i / 2, "[WPA2-PSK-CCMP][ESS]", "Site-" + QByteArray::number(i) };
        s.bss << Bss{ "02:00:00:00:01:00", 5180, -30, "[WPA2-PSK-CCMP][ESS]", "Site-79" };
        f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 80);
        QCOMPARE(count(f, "SCAN_RESULTS"), 0);
        QVERIFY(f.commands.contains("BSS NEXT-80 MASK=0x1887"));     // paged to the end
        for (const QVariant &v : m.networks())
            if (v.toMap()["ssid"].toString() == QLatin1String("Site-79"))
                QCOMPARE(v.toMap()["signal"].toInt(), -30);          // strongest kept
    }

    void bssPagingIsCapped()
    {
        FakeWpa f(path()); Script s;
        f.handler = [&s](const QByteArray &c) {                      // a table that never ends
            return c.startsWith("BSS ") ? s.bssReply(0) : s(c); };
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 1);
        QTest::qWait(200);
        QVERIFY(count(f, "BSS ") <= 2 * 512);                        // initial read + scan-event read at most
        QVERIFY(count(f, "BSS ") >= 512);
    }

    void bssPagingsDoNotInterleave()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_VERIFY(f.attached());
        f.sendEvent("CTRL-EVENT-SCAN-RESULTS ");
        f.sendEvent("CTRL-EVENT-SCAN-RESULTS ");
        QTRY_VERIFY(!m.scanning());
        QTest::qWait(100);
        QList<QByteArray> bss;
        for (const auto &c : f.commands) if (c.startsWith("BSS ")) bss << c;
        QVERIFY(bss.size() >= 8);                                    // at least two full pagings
        for (int i = 0; i < bss.size(); ++i) {
            const QByteArray want = (i % 4 == 0) ? QByteArray("BSS FIRST MASK=0x1887")
                                  : "BSS NEXT-" + QByteArray::number(i % 4 - 1) + " MASK=0x1887";
            QCOMPARE(bss[i], want);                                  // FIRST, NEXT-0, NEXT-1, NEXT-2, FIRST, ...
        }
        QCOMPARE(m.networks().size(), 3);
    }

    void openReEnablesAllNetworks()
    {
        // A join interrupted by a gobi-ui restart leaves the others disabled.
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_VERIFY(f.commands.contains("STATUS"));
        const int en = f.commands.indexOf("ENABLE_NETWORK all");
        QVERIFY(en >= 0);
        QVERIFY(en < f.commands.indexOf("STATUS"));
    }

    void forgetReEnablesBeforeSaving()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Shop"}}; s.nextId = 1; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.saved().size(), 1);
        f.commands.clear();
        m.forget(0);
        QTRY_VERIFY(f.commands.contains("SAVE_CONFIG"));
        const int rm = f.commands.indexOf("REMOVE_NETWORK 0");
        const int en = f.commands.indexOf("ENABLE_NETWORK all");
        const int sv = f.commands.indexOf("SAVE_CONFIG");
        QVERIFY(rm >= 0 && rm < en && en < sv);
    }

    void securedJoinNeedsPassword()
    {
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Shop", "");                       // Shop is WPA2: must not join as open
        QCOMPARE(m.lastError(), QStringLiteral("Password must be at least 8 characters."));
        QTest::qWait(50);
        QCOMPARE(count(f, "ADD_NETWORK"), 0);
    }

    void timeoutChecksStatusFirst()
    {
        // CONNECTED event missed, but wpa_supplicant is on the network: success.
        FakeWpa f(path()); Script s; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy ok(&m, &WifiModel::joined);
        QSignalSpy bad(&m, &WifiModel::joinFailed);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Free", "");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 0"));
        s.state = "COMPLETED"; s.ssid = "Free"; s.current = 0;
        QTRY_COMPARE(ok.count(), 1);              // after joinTimeoutMs = 500
        QCOMPARE(bad.count(), 0);
        QTRY_VERIFY(f.commands.contains("SAVE_CONFIG"));
        QVERIFY(!f.commands.contains("REMOVE_NETWORK 0"));
    }

    void timeoutOnOtherNetworkStillFails()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Yard"}}; s.nextId = 1; f.handler = std::ref(s);
        WifiModel m(path()); fast(m); m.start();
        QSignalSpy bad(&m, &WifiModel::joinFailed);
        QTRY_COMPARE(m.networks().size(), 3);
        m.join("Free", "");
        QTRY_VERIFY(f.commands.contains("SELECT_NETWORK 1"));
        s.state = "COMPLETED"; s.ssid = "Yard"; s.current = 0;    // fell back to another network
        QTRY_COMPARE(bad.count(), 1);
        QTRY_VERIFY(f.commands.contains("REMOVE_NETWORK 1"));
    }

    void internetCheckThatCannotStart()
    {
        FakeWpa f(path()); Script s; s.nets = {{0, "Yard"}}; s.nextId = 1; s.current = 0;
        s.state = "COMPLETED"; s.ssid = "Yard"; f.handler = std::ref(s);
        WifiModel m(path()); m.setTimings(100, 60000, 500, 60000);
        m.setInternetCheck(m_dir.path() + "/no-such-program", {});
        m.start();
        QTRY_COMPARE(m.state(), QStringLiteral("connected"));
        QTRY_COMPARE(m.internet(), QStringLiteral("no_internet"));
    }
};

QTEST_GUILESS_MAIN(TestWifiModel)
#include "tst_wifimodel.moc"
