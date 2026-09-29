// Host test for DisplayModel: a temp dir stands in for /sys/class/backlight/<x>
// and the config file, and short idle timings replace the minute-scale ones.
#include <QtTest>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMouseEvent>
#include <QSignalSpy>
#include <QTemporaryDir>

#include "../DisplayModel.h"

static QString readFile(const QString &path)
{
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly)) return QString();
    return QString::fromLatin1(f.readAll()).trimmed();
}

static void writeFile(const QString &path, const QByteArray &data)
{
    QFile f(path);
    QVERIFY(f.open(QIODevice::WriteOnly | QIODevice::Truncate));
    f.write(data);
}

class TestDisplayModel : public QObject
{
    Q_OBJECT
    QTemporaryDir *m_tmp = nullptr;
    QString bl() const { return m_tmp->path() + QStringLiteral("/bl"); }
    QString cfg() const { return m_tmp->path() + QStringLiteral("/display.json"); }
    QString brightness() const { return readFile(bl() + QStringLiteral("/brightness")); }
    QString blPower() const { return readFile(bl() + QStringLiteral("/bl_power")); }

    static bool press(DisplayModel &m, QObject *target)
    {
        QMouseEvent ev(QEvent::MouseButtonPress, QPointF(5, 5), QPointF(5, 5),
                       Qt::LeftButton, Qt::LeftButton, Qt::NoModifier);
        return m.eventFilter(target, &ev);
    }
    static bool release(DisplayModel &m, QObject *target)
    {
        QMouseEvent ev(QEvent::MouseButtonRelease, QPointF(5, 5), QPointF(5, 5),
                       Qt::LeftButton, Qt::NoButton, Qt::NoModifier);
        return m.eventFilter(target, &ev);
    }

private slots:
    void init()
    {
        m_tmp = new QTemporaryDir;
        QVERIFY(QDir().mkpath(bl()));
        writeFile(bl() + QStringLiteral("/max_brightness"), "100\n");
        writeFile(bl() + QStringLiteral("/brightness"), "80\n");
        writeFile(bl() + QStringLiteral("/bl_power"), "0\n");
    }
    void cleanup() { delete m_tmp; m_tmp = nullptr; }

    void defaultsWithoutConfig()
    {
        DisplayModel m(bl(), cfg());
        QCOMPARE(m.brightness(), 80);        // DT default read from sysfs
        QCOMPARE(m.sleepMinutes(), 10);
        QCOMPARE(m.state(), QStringLiteral("on"));
    }

    void loadsConfigAndAppliesBrightness()
    {
        writeFile(cfg(), R"({"brightness":55,"sleep_minutes":5})");
        DisplayModel m(bl(), cfg());
        QCOMPARE(m.brightness(), 55);
        QCOMPARE(m.sleepMinutes(), 5);
        QCOMPARE(brightness(), QStringLiteral("55"));
        QCOMPARE(blPower(), QStringLiteral("0"));
    }

    void brightnessClampsToFloorAndMax()
    {
        DisplayModel m(bl(), cfg());
        m.setBrightness(2);
        QCOMPARE(m.brightness(), 10);
        QCOMPARE(brightness(), QStringLiteral("10"));
        m.setBrightness(250);
        QCOMPARE(m.brightness(), 100);
    }

    void settingsPersist()
    {
        {
            DisplayModel m(bl(), cfg());
            m.setBrightness(42);
            m.setSleepMinutes(30);
        }   // destructor flushes the debounced save
        const QJsonObject o = QJsonDocument::fromJson(readFile(cfg()).toUtf8()).object();
        QCOMPARE(o.value(QStringLiteral("brightness")).toInt(), 42);
        QCOMPARE(o.value(QStringLiteral("sleep_minutes")).toInt(), 30);
    }

    void dimsThenSleeps()
    {
        DisplayModel m(bl(), cfg());
        m.setBrightness(70);
        m.setIdleTimings(50, 50);
        QTRY_COMPARE_WITH_TIMEOUT(m.state(), QStringLiteral("dim"), 500);
        QCOMPARE(brightness(), QStringLiteral("20"));
        QTRY_COMPARE_WITH_TIMEOUT(m.state(), QStringLiteral("off"), 500);
        QCOMPARE(blPower(), QStringLiteral("4"));
    }

    void dimNeverBrighterThanUserLevel()
    {
        DisplayModel m(bl(), cfg());
        m.setBrightness(12);
        m.setIdleTimings(30, 5000);
        QTRY_COMPARE_WITH_TIMEOUT(m.state(), QStringLiteral("dim"), 500);
        QCOMPARE(brightness(), QStringLiteral("12"));
    }

    void touchWhileOnRestartsTimerAndPassesThrough()
    {
        DisplayModel m(bl(), cfg());
        m.setIdleTimings(150, 5000);
        QObject target;
        for (int i = 0; i < 4; ++i) {
            QTest::qWait(80);
            QVERIFY(!press(m, &target));   // delivered, not swallowed
            QVERIFY(!release(m, &target));
        }
        QCOMPARE(m.state(), QStringLiteral("on"));
    }

    void tapWhileAsleepWakesAndIsSwallowed()
    {
        DisplayModel m(bl(), cfg());
        m.setBrightness(65);
        m.setIdleTimings(20, 20);
        QTRY_COMPARE_WITH_TIMEOUT(m.state(), QStringLiteral("off"), 500);
        QObject target;
        QVERIFY(press(m, &target));        // swallowed
        QCOMPARE(m.state(), QStringLiteral("on"));
        QCOMPARE(blPower(), QStringLiteral("0"));
        QCOMPARE(brightness(), QStringLiteral("65"));
        QVERIFY(release(m, &target));      // its release too
        QVERIFY(!press(m, &target));       // next tap is a normal tap
    }

    void keepAwakeBlocksSleepAndWakes()
    {
        DisplayModel m(bl(), cfg());
        m.setIdleTimings(20, 20);
        QTRY_COMPARE_WITH_TIMEOUT(m.state(), QStringLiteral("off"), 500);
        m.setKeepAwake(true);              // e.g. a fault just appeared
        QCOMPARE(m.state(), QStringLiteral("on"));
        QTest::qWait(150);
        QCOMPARE(m.state(), QStringLiteral("on"));
        m.setKeepAwake(false);             // fault cleared → idle countdown resumes
        QTRY_COMPARE_WITH_TIMEOUT(m.state(), QStringLiteral("off"), 500);
    }

    void sleepNeverDisablesTimer()
    {
        DisplayModel m(bl(), cfg());
        m.setSleepMinutes(0);
        QCOMPARE(m.dimAfterMs(), -1);
        QCOMPARE(m.state(), QStringLiteral("on"));
    }

    void minuteTimingsDimThirtySecondsEarly()
    {
        DisplayModel m(bl(), cfg());
        m.setSleepMinutes(10);
        QCOMPARE(m.dimAfterMs(), 10 * 60000 - 30000);
        QCOMPARE(m.offAfterMs(), 30000);
    }

    void missingBacklightIsHarmless()
    {
        DisplayModel m(m_tmp->path() + QStringLiteral("/nope"), cfg());
        m.setBrightness(50);
        QCOMPARE(m.brightness(), 50);
    }
};

QTEST_MAIN(TestDisplayModel)
#include "tst_displaymodel.moc"
