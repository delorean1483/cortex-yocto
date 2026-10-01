// Host tests for WpaCtrl against FakeWpa: request/reply ordering, events,
// timeouts, and behaviour when the server is absent or goes away.
#include <QtTest>
#include <QSignalSpy>
#include <QTemporaryDir>
#include "FakeWpa.h"
#include "../WpaCtrl.h"

class TestWpaCtrl : public QObject
{
    Q_OBJECT
    QTemporaryDir m_dir;
    QString path() const { return m_dir.path() + "/wlan0"; }

private slots:
    void openFailsWithoutServer()
    {
        WpaCtrl c(m_dir.path() + "/nope");
        QVERIFY(!c.open());
        QVERIFY(!c.isOpen());
        bool called = false, okv = true;
        c.request("PING", [&](bool ok, const QByteArray &) { called = true; okv = ok; });
        QTRY_VERIFY(called);
        QVERIFY(!okv);
    }

    void repliesInOrder()
    {
        FakeWpa f(path());
        f.handler = [](const QByteArray &c) { return c == "PING" ? QByteArray("PONG\n") : QByteArray("OK\n"); };
        WpaCtrl c(path());
        QVERIFY(c.open());
        QStringList got;
        c.request("PING", [&](bool ok, const QByteArray &r) { QVERIFY(ok); got << QString::fromLatin1(r); });
        c.request("SCAN", [&](bool ok, const QByteArray &r) { QVERIFY(ok); got << QString::fromLatin1(r); });
        QTRY_COMPARE(got.size(), 2);
        QCOMPARE(got[0], QStringLiteral("PONG\n"));
        QCOMPARE(got[1], QStringLiteral("OK\n"));
        QCOMPARE(f.commands.last(), QByteArray("SCAN"));
    }

    void eventsArriveWithoutPrefix()
    {
        FakeWpa f(path());
        WpaCtrl c(path());
        QSignalSpy spy(&c, &WpaCtrl::wpaEvent);
        QVERIFY(c.open());
        QTRY_VERIFY(f.attached());
        f.sendEvent("CTRL-EVENT-SCAN-RESULTS ");
        QTRY_COMPARE(spy.count(), 1);
        QCOMPARE(spy[0][0].toByteArray(), QByteArray("CTRL-EVENT-SCAN-RESULTS "));
    }

    void timeoutFailsRequestAndReportsLost()
    {
        FakeWpa f(path());
        WpaCtrl c(path());
        c.setTimeoutMs(200);
        QSignalSpy lost(&c, &WpaCtrl::lost);
        QVERIFY(c.open());
        QTRY_VERIFY(f.attached());
        f.mute = true;
        bool called = false, okv = true;
        c.request("STATUS", [&](bool ok, const QByteArray &) { called = true; okv = ok; });
        QTRY_VERIFY(called);
        QVERIFY(!okv);
        QCOMPARE(lost.count(), 1);
        QVERIFY(!c.isOpen());
    }

    void serverGoneReportsLost()
    {
        FakeWpa f(path());
        WpaCtrl c(path());
        QSignalSpy lost(&c, &WpaCtrl::lost);
        QVERIFY(c.open());
        f.stop();
        bool called = false, okv = true;
        c.request("STATUS", [&](bool ok, const QByteArray &) { called = true; okv = ok; });
        QTRY_VERIFY(called);
        QVERIFY(!okv);
        QTRY_COMPARE(lost.count(), 1);
    }

    void callbackEnqueuesNextRequest()
    {
        FakeWpa f(path());
        f.handler = [](const QByteArray &c) { return c == "FIRST" ? QByteArray("A\n") : QByteArray("B\n"); };
        WpaCtrl c(path());
        QVERIFY(c.open());
        QStringList got;
        c.request("FIRST", [&](bool ok, const QByteArray &r) {
            QVERIFY(ok);
            got << QString::fromLatin1(r);
            c.request("SECOND", [&](bool ok2, const QByteArray &r2) {
                QVERIFY(ok2);
                got << QString::fromLatin1(r2);
            });
        });
        QTRY_COMPARE(got.size(), 2);
        QCOMPARE(got[0], QStringLiteral("A\n"));
        QCOMPARE(got[1], QStringLiteral("B\n"));
    }

    void multipleRequestsTimeoutTogether()
    {
        FakeWpa f(path());
        WpaCtrl c(path());
        c.setTimeoutMs(200);
        QVERIFY(c.open());
        QTRY_VERIFY(f.attached());
        f.mute = true;
        int okCount = 0;
        for (int i = 0; i < 3; ++i) {
            c.request("REQ" + QByteArray::number(i), [&](bool ok, const QByteArray &) {
                if (!ok) ++okCount;
            });
        }
        QTRY_COMPARE(okCount, 3);
        QVERIFY(!c.isOpen());
    }

    void destructorDoesNotCallCallbacks()
    {
        bool callbackRan = false;
        {
            FakeWpa f(path());
            auto *c = new WpaCtrl(path());
            QVERIFY(c->open());
            c->request("PING", [&](bool, const QByteArray &) { callbackRan = true; });
            delete c;
        }
        QCoreApplication::processEvents();
        QVERIFY(!callbackRan);
    }

    void reopenAfterLost()
    {
        FakeWpa f(path());
        WpaCtrl c(path());
        c.setTimeoutMs(200);
        QVERIFY(c.open());
        QTRY_VERIFY(f.attached());
        f.mute = true;
        bool timedOut = false;
        c.request("STATUS", [&](bool ok, const QByteArray &) { if (!ok) timedOut = true; });
        QTRY_VERIFY(timedOut);
        QVERIFY(!c.isOpen());

        f.mute = false;
        QVERIFY(c.open());
        bool replied = false;
        c.request("PING", [&](bool ok, const QByteArray &) { if (ok) replied = true; });
        QTRY_VERIFY(replied);
        QVERIFY(c.isOpen());
    }

    void closeBeforeSendFailureDoesNotEmitLost()
    {
        FakeWpa f(path());
        WpaCtrl c(path());
        QVERIFY(c.open());
        // Don't connect to server, cause send to fail, but immediately close+reopen
        // The deferred fail() should not affect the new connection
        c.close();
        c.open();
        QSignalSpy lost(&c, &WpaCtrl::lost);
        bool replied = false;
        c.request("PING", [&](bool ok, const QByteArray &) { if (ok) replied = true; });
        QTRY_VERIFY(replied);
        QCOMPARE(lost.count(), 0);
        QVERIFY(c.isOpen());
    }
};

QTEST_GUILESS_MAIN(TestWpaCtrl)
#include "tst_wpactrl.moc"
