#include <QtTest>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>

#include "../LedModel.h"

class TestLedModel : public QObject
{
    Q_OBJECT
    QTemporaryDir m_dir;
    QString cfg() const { return m_dir.filePath(QStringLiteral("led.json")); }
    QString cmd() const { return m_dir.filePath(QStringLiteral("command.json")); }

    static QJsonObject readJson(const QString &path)
    {
        QFile f(path);
        if (!f.open(QIODevice::ReadOnly)) return {};
        return QJsonDocument::fromJson(f.readAll()).object();
    }
    QList<int> sent() const
    {
        const QJsonArray a = readJson(cmd()).value(QStringLiteral("led_rgb")).toArray();
        QList<int> v;
        for (const auto &x : a) v << x.toInt();
        return v;
    }

private slots:
    void init()
    {
        QFile::remove(cfg());
        QFile::remove(cmd());
    }

    void test_defaults_without_file()
    {
        LedModel m(cfg(), cmd());
        QVERIFY(!m.hasColor());
        QCOMPARE(m.hue(), 0.0);
        QCOMPARE(m.saturation(), 1.0);
        QCOMPARE(m.brightness(), 1.0);
        QVERIFY(!QFile::exists(cmd()));
    }

    void test_pick_sets_hue_sat_rgb()
    {
        LedModel m(cfg(), cmd());
        m.pickAt(10, 0, 10);
        QCOMPARE(m.hue(), 90.0);
        QCOMPARE(m.saturation(), 1.0);
        QCOMPARE(m.r(), 128);
        QCOMPARE(m.g(), 255);
        QCOMPARE(m.b(), 0);
        QVERIFY(m.hasColor());
    }

    void test_center_keeps_hue()
    {
        LedModel m(cfg(), cmd());
        m.pickAt(10, 0, 10);
        m.pickAt(0, 0, 10);
        QCOMPARE(m.hue(), 90.0);
        QCOMPARE(m.saturation(), 0.0);
        QCOMPARE(m.r(), 255);
        QCOMPARE(m.g(), 255);
        QCOMPARE(m.b(), 255);
    }

    void test_brightness_zero_keeps_hue_sat()
    {
        LedModel m(cfg(), cmd());
        m.pickAt(10, 0, 10);
        m.setBrightness(0);
        QCOMPARE(m.r(), 0);
        QCOMPARE(m.g(), 0);
        QCOMPARE(m.b(), 0);
        QCOMPARE(m.hue(), 90.0);
        QCOMPARE(m.saturation(), 1.0);
        m.setBrightness(1);
        QCOMPARE(m.r(), 128);
        QCOMPARE(m.g(), 255);
        QCOMPARE(m.b(), 0);
    }

    void test_throttle_leading_and_trailing()
    {
        LedModel m(cfg(), cmd());
        m.pickAt(10, 0, 10);                       // A = (128,255,0)
        QCOMPARE(sent(), (QList<int>{128, 255, 0}));
        m.pickAt(0, 10, 10);                       // B = hue 180 -> (0,255,255)
        QCOMPARE(sent(), (QList<int>{128, 255, 0}));   // still A
        QTest::qWait(500);
        QCOMPARE(sent(), (QList<int>{0, 255, 255}));
    }

    void test_release_sends_final_and_saves()
    {
        LedModel m(cfg(), cmd());
        m.pickAt(10, 0, 10);                       // A
        m.pickAt(0, 10, 10);                       // B, throttled
        QVERIFY(!QFile::exists(cfg()));
        m.release();
        QCOMPARE(sent(), (QList<int>{0, 255, 255}));
        const QJsonObject o = readJson(cfg());
        QCOMPARE(o.value(QStringLiteral("r")).toInt(), 0);
        QCOMPARE(o.value(QStringLiteral("g")).toInt(), 255);
        QCOMPARE(o.value(QStringLiteral("b")).toInt(), 255);
        QCOMPARE(o.value(QStringLiteral("h")).toDouble(), 180.0);
        QCOMPARE(o.value(QStringLiteral("s")).toDouble(), 1.0);
        QCOMPARE(o.value(QStringLiteral("v")).toDouble(), 1.0);
        QVERIFY(QFileInfo(cfg()).permissions() & QFileDevice::ReadOther);
    }

    void test_flush_saves_only_when_dirty()
    {
        LedModel m(cfg(), cmd());
        m.flush();
        QVERIFY(!QFile::exists(cfg()));
        m.setBrightness(0.5);
        m.flush();
        QVERIFY(QFile::exists(cfg()));
    }

    void test_merges_with_existing_command()
    {
        {
            QFile f(cmd());
            QVERIFY(f.open(QIODevice::WriteOnly));
            f.write("{\"mode\":\"auto\"}");
        }
        LedModel m(cfg(), cmd());
        m.pickAt(10, 0, 10);
        const QJsonObject o = readJson(cmd());
        QCOMPARE(o.value(QStringLiteral("mode")).toString(), QStringLiteral("auto"));
        QVERIFY(o.contains(QStringLiteral("led_rgb")));
    }

    void test_load_restores()
    {
        {
            QFile f(cfg());
            QVERIFY(f.open(QIODevice::WriteOnly));
            f.write("{\"h\":90,\"s\":1,\"v\":1,\"r\":128,\"g\":255,\"b\":0}");
        }
        LedModel m(cfg(), cmd());
        QVERIFY(m.hasColor());
        QCOMPARE(m.hue(), 90.0);
        QCOMPARE(m.saturation(), 1.0);
        QCOMPARE(m.brightness(), 1.0);
        QCOMPARE(m.r(), 128);
        QCOMPARE(m.g(), 255);
        QCOMPARE(m.b(), 0);
    }
};

QTEST_MAIN(TestLedModel)
#include "tst_ledmodel.moc"
