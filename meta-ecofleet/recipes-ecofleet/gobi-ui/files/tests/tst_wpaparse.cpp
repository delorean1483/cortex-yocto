// Host tests for WpaParse: wpa_supplicant control-interface text, PSK hashing,
// validation, the merged network list, and internet-check classification.
#include <QtTest>
#include "../WpaParse.h"

using namespace wpa;

class TestWpaParse : public QObject
{
    Q_OBJECT
private slots:
    void decodeSsidHandlesEscapes()
    {
        QCOMPARE(decodeSsid("EcoFleet-Staff"), QStringLiteral("EcoFleet-Staff"));
        QCOMPARE(decodeSsid("Caf\\xc3\\xa9 \\\"Yard\\\""), QStringLiteral("Café \"Yard\""));
        QCOMPARE(decodeSsid("back\\\\slash"), QStringLiteral("back\\slash"));
        QCOMPARE(decodeSsid("tab\\there"), QStringLiteral("tab\there"));
    }

    void scanResults()
    {
        const QByteArray r =
            "bssid / frequency / signal level / flags / ssid\n"
            "0c:ea:14:23:2d:43\t5240\t-47\t[WPA2-PSK-CCMP][ESS]\tEcoFleet-Staff\n"
            "11:22:33:44:55:66\t2412\t-80\t[ESS]\tFree WiFi\n"
            "22:22:33:44:55:66\t2437\t-70\t[WPA2-PSK-CCMP][ESS]\t\n";
        const auto s = parseScanResults(r);
        QCOMPARE(s.size(), 3);
        QCOMPARE(s[0].bssid, QStringLiteral("0c:ea:14:23:2d:43"));
        QCOMPARE(s[0].freq, 5240);
        QCOMPARE(s[0].signal, -47);
        QCOMPARE(s[0].ssid, QStringLiteral("EcoFleet-Staff"));
        QCOMPARE(s[1].ssid, QStringLiteral("Free WiFi"));
        QCOMPARE(s[2].ssid, QString());   // hidden network
    }

    void listNetworks()
    {
        const QByteArray r =
            "network id / ssid / bssid / flags\n"
            "0\tEcoFleet-Staff\tany\t[CURRENT]\n"
            "1\tShop-Guest\tany\t\n"
            "2\tOld\tany\t[DISABLED]\n";
        const auto n = parseListNetworks(r);
        QCOMPARE(n.size(), 3);
        QCOMPARE(n[0].id, 0);
        QVERIFY(n[0].current);
        QCOMPARE(n[1].ssid, QStringLiteral("Shop-Guest"));
        QVERIFY(!n[1].current);
    }

    void keyValues()
    {
        const auto kv = parseKeyValues("wpa_state=COMPLETED\nssid=Caf\\xc3\\xa9\nip_address=192.168.0.206\nid=0\n");
        QCOMPARE(kv.value("wpa_state"), QStringLiteral("COMPLETED"));
        QCOMPARE(kv.value("ssid"), QStringLiteral("Café"));
        QCOMPARE(kv.value("ip_address"), QStringLiteral("192.168.0.206"));
    }

    void events()
    {
        Event e = parseEvent("CTRL-EVENT-CONNECTED - Connection to 0c:ea:14:23:2d:43 completed [id=3 id_str=]");
        QCOMPARE(e.type, Event::Connected);
        QCOMPARE(e.id, 3);
        e = parseEvent("CTRL-EVENT-SSID-TEMP-DISABLED id=4 ssid=\"x\" auth_failures=1 duration=10 reason=WRONG_KEY");
        QCOMPARE(e.type, Event::WrongKey);
        QCOMPARE(e.id, 4);
        e = parseEvent("CTRL-EVENT-SSID-TEMP-DISABLED id=4 ssid=\"x\" auth_failures=1 duration=10 reason=CONN_FAILED");
        QCOMPARE(e.type, Event::Other);
        QCOMPARE(parseEvent("CTRL-EVENT-DISCONNECTED bssid=0c:ea:14:23:2d:43 reason=3").type, Event::Disconnected);
        QCOMPARE(parseEvent("CTRL-EVENT-SCAN-RESULTS ").type, Event::ScanResults);
        QCOMPARE(parseEvent("CTRL-EVENT-BSS-ADDED 5 aa:bb").type, Event::Other);
    }

    void bars()
    {
        QCOMPARE(signalBars(-47), 4);
        QCOMPARE(signalBars(-55), 4);
        QCOMPARE(signalBars(-60), 3);
        QCOMPARE(signalBars(-70), 2);
        QCOMPARE(signalBars(-80), 1);
        QCOMPARE(signalBars(-90), 0);
    }

    void security()
    {
        QVERIFY(!isSecured("[ESS]"));
        QVERIFY(isSupported("[ESS]"));
        QVERIFY(isSecured("[WPA2-PSK-CCMP][ESS]"));
        QVERIFY(isSupported("[WPA2-PSK-CCMP][ESS]"));
        QVERIFY(isSupported("[WPA2-PSK+SAE-CCMP][ESS]"));       // WPA2/WPA3 transition
        QVERIFY(isSecured("[WPA2-SAE-CCMP][ESS]"));
        QVERIFY(!isSupported("[WPA2-SAE-CCMP][ESS]"));          // WPA3-only
        QVERIFY(!isSupported("[WPA2-EAP-CCMP][ESS]"));          // enterprise
        QVERIFY(!isSupported("[WEP][ESS]"));
        QVERIFY(isSupported("[WPA2-FT/PSK-CCMP][ESS]"));        // FT/PSK supported
        QVERIFY(isSupported("[WPA2-FT/PSK+FT/SAE-CCMP][ESS]")); // FT/PSK+FT/SAE supported
        QVERIFY(!isSupported("[WPA2-FT/EAP-CCMP][ESS]"));       // FT/EAP not supported
    }

    void ssidHexEncodesUtf8()
    {
        QCOMPARE(ssidHex(QStringLiteral("Café \"Yard\"")), QByteArray("436166c3a920225961726422"));
    }

    void pskMatchesWpaPassphrase()
    {
        QCOMPARE(pskHex("password", "IEEE"),
                 QByteArray("f42c6fc52df0ebef9ebb4b90b38a5f902e83fe1b135a70e23aed762e9710a12e"));
        QCOMPARE(pskHex("ThisIsAPassword", "ThisIsASSID"),
                 QByteArray("0dc0d6eb90555ed6419756b9a15ec3e3209b63df707dd508d14581f8982721af"));
        QCOMPARE(pskHex(QStringLiteral("pa\"ss word!"), QStringLiteral("Café \"Yard\"")),
                 QByteArray("5d8edb3da0ecfd482604d636a477b8cbe8db0142ad99c3639ec186e1a553d19a"));
    }

    void validation()
    {
        QVERIFY(validateSsid("").size() > 0);
        QVERIFY(validateSsid(QString(33, 'a')).size() > 0);
        QVERIFY(validateSsid(QString(11, QChar(0x00e9))).isEmpty());    // 22 bytes OK...
        QVERIFY(validateSsid(QString(16, QChar(0x00e9))).isEmpty());     // ...32 bytes OK
        QVERIFY(validateSsid(QString(17, QChar(0x00e9))).size() > 0);    // 34 bytes too long
        QVERIFY(validatePassword("1234567").size() > 0);
        QVERIFY(validatePassword("12345678").isEmpty());
        QVERIFY(validatePassword(" spaces ok ").isEmpty());
        QVERIFY(validatePassword(QString(63, 'x')).isEmpty());
        QVERIFY(validatePassword(QString(64, 'x')).size() > 0);
        QVERIFY(validatePassword(QStringLiteral("pässword")).size() > 0);
    }

    void buildListOrdersAndFlags()
    {
        const QList<ScanEntry> scan = {
            {"a", 2412, -80, "[ESS]", "Free"},
            {"b", 5240, -47, "[WPA2-PSK-CCMP][ESS]", "Yard"},
            {"c", 2437, -60, "[WPA2-PSK-CCMP][ESS]", "Shop"},
            {"d", 2437, -50, "[WPA2-PSK-CCMP][ESS]", "Strong"},
            {"e", 2437, -40, "[WPA2-PSK-CCMP][ESS]", ""},
        };
        const QList<SavedNet> saved = { {0, "Yard", true}, {1, "Shop", false}, {2, "Away", false} };
        const auto l = buildNetworkList(scan, saved, "Yard");
        QCOMPARE(l.size(), 4);   // hidden SSID dropped; saved-but-absent "Away" not listed
        const auto m0 = l[0].toMap(), m1 = l[1].toMap(), m2 = l[2].toMap(), m3 = l[3].toMap();
        QCOMPARE(m0["ssid"].toString(), QStringLiteral("Yard"));
        QVERIFY(m0["inUse"].toBool());
        QCOMPARE(m0["savedId"].toInt(), 0);
        QCOMPARE(m1["ssid"].toString(), QStringLiteral("Shop"));     // saved before unsaved
        QVERIFY(m1["saved"].toBool());
        QCOMPARE(m2["ssid"].toString(), QStringLiteral("Strong"));   // then by signal
        QCOMPARE(m3["ssid"].toString(), QStringLiteral("Free"));
        QVERIFY(!m3["secured"].toBool());
        QCOMPARE(m3["savedId"].toInt(), -1);
        QCOMPARE(m0["bars"].toInt(), 4);
    }

    void buildListCollapsesDuplicates()
    {
        const QList<ScanEntry> scan = {
            {"a", 2412, -78, "[WPA2-PSK-CCMP][ESS]", "Yard"},
            {"b", 5240, -52, "[WPA2-PSK-CCMP][ESS]", "Yard"},
        };
        const auto l = buildNetworkList(scan, {}, QString());
        QCOMPARE(l.size(), 1);
        QCOMPARE(l[0].toMap()["bars"].toInt(), 4);
    }

    void buildListDropsHiddenSsids()
    {
        const QList<ScanEntry> scan = {
            {"a", 2412, -50, "[WPA2-PSK-CCMP][ESS]", decodeSsid("\\x00\\x00\\x00\\x00")},
            {"b", 5240, -55, "[WPA2-PSK-CCMP][ESS]", "Visible"},
        };
        const auto l = buildNetworkList(scan, {}, QString());
        QCOMPARE(l.size(), 1);
        QCOMPARE(l[0].toMap()["ssid"].toString(), QStringLiteral("Visible"));
    }

    void classify()
    {
        QCOMPARE(classifyCheck(0, "204"), Internet::Online);
        QCOMPARE(classifyCheck(0, "200"), Internet::Portal);
        QCOMPARE(classifyCheck(0, "302"), Internet::Portal);
        QCOMPARE(classifyCheck(6, "000"), Internet::NoInternet);    // DNS failure
        QCOMPARE(classifyCheck(28, "000"), Internet::NoInternet);   // timeout
        QCOMPARE(internetName(Internet::Portal), QStringLiteral("portal"));
        QCOMPARE(internetName(Internet::NoInternet), QStringLiteral("no_internet"));
    }
};

QTEST_GUILESS_MAIN(TestWpaParse)
#include "tst_wpaparse.moc"
