// Host test for describeUpdate(): maps the agent's ota_status line and APU
// flash state (latest.json) to the on-screen update notice.
#include <QtTest>

#include "../UpdateNotice.h"

class TestUpdateNotice : public QObject
{
    Q_OBJECT
private slots:
    void idleShowsNothing()
    {
        QCOMPARE(describeUpdate(QString(), QString(), 0).kind, UpdateNotice::None);
        QCOMPARE(describeUpdate("idle", "idle", 0).kind, UpdateNotice::None);
        QCOMPARE(describeUpdate("idle", "done", 100).kind, UpdateNotice::None);
    }

    void downloading()
    {
        const UpdateNotice n = describeUpdate("downloading 1.2.67", "idle", 0);
        QCOMPARE(n.kind, UpdateNotice::Busy);
        QCOMPARE(n.title, QStringLiteral("Updating software to 1.2.67"));
        QCOMPARE(n.detail, QStringLiteral("Downloading…"));
    }

    void installing()
    {
        const UpdateNotice n = describeUpdate("installing 1.2.67", "idle", 0);
        QCOMPARE(n.kind, UpdateNotice::Busy);
        QCOMPARE(n.title, QStringLiteral("Updating software to 1.2.67"));
        QCOMPARE(n.detail, QStringLiteral("Installing…"));
    }

    void successMeansRestarting()
    {
        const UpdateNotice n = describeUpdate("success 1.2.67", "idle", 0);
        QCOMPARE(n.kind, UpdateNotice::Busy);
        QCOMPARE(n.detail, QStringLiteral("Restarting…"));
    }

    void installFailed()
    {
        const UpdateNotice n = describeUpdate("failed: install 1.2.67 (rc 1)", "idle", 0);
        QCOMPARE(n.kind, UpdateNotice::Failed);
        QCOMPARE(n.title, QStringLiteral("Software update to 1.2.67 failed"));
        QVERIFY(!n.key.isEmpty());
    }

    void downloadFailed()
    {
        const UpdateNotice n = describeUpdate("failed: download 1.2.67", "idle", 0);
        QCOMPARE(n.kind, UpdateNotice::Failed);
        QCOMPARE(n.title, QStringLiteral("Software update to 1.2.67 failed"));
    }

    void unknownStatusShowsNothing()
    {
        // Never block the screen on a status line we don't understand.
        QCOMPARE(describeUpdate("pending", "idle", 0).kind, UpdateNotice::None);
    }

    void apuFlashing()
    {
        const UpdateNotice n = describeUpdate("idle", "flashing", 42);
        QCOMPARE(n.kind, UpdateNotice::Busy);
        QCOMPARE(n.title, QStringLiteral("Updating APU controller"));
        QCOMPARE(n.detail, QStringLiteral("42% complete"));
    }

    void apuFailed()
    {
        const UpdateNotice n = describeUpdate("idle", "failed", 0);
        QCOMPARE(n.kind, UpdateNotice::Failed);
        QCOMPARE(n.title, QStringLiteral("APU controller update failed"));
    }

    void systemUpdateWinsOverApu()
    {
        const UpdateNotice n = describeUpdate("installing 1.2.67", "flashing", 10);
        QCOMPARE(n.title, QStringLiteral("Updating software to 1.2.67"));
    }

    void busyWinsOverFailed()
    {
        // An APU flash in progress matters more than an old system-update failure.
        QCOMPARE(describeUpdate("failed: download 1.2.67", "flashing", 5).kind, UpdateNotice::Busy);
    }
};

QTEST_GUILESS_MAIN(TestUpdateNotice)
#include "tst_updatenotice.moc"
