// Host test for the LED color wheel math (plain C++ library, QtTest harness).
#include <QtTest>

#include "../LedColor.h"

class TestLedColor : public QObject
{
    Q_OBJECT
private slots:
    void hsvToRgb_data()
    {
        QTest::addColumn<double>("hue");
        QTest::addColumn<double>("sat");
        QTest::addColumn<double>("val");
        QTest::addColumn<int>("r");
        QTest::addColumn<int>("g");
        QTest::addColumn<int>("b");

        QTest::newRow("red")         << 0.0   << 1.0 << 1.0 << 255 << 0   << 0;
        QTest::newRow("yellow")      << 60.0  << 1.0 << 1.0 << 255 << 255 << 0;
        QTest::newRow("green")       << 120.0 << 1.0 << 1.0 << 0   << 255 << 0;
        QTest::newRow("cyan")        << 180.0 << 1.0 << 1.0 << 0   << 255 << 255;
        QTest::newRow("blue")        << 240.0 << 1.0 << 1.0 << 0   << 0   << 255;
        QTest::newRow("magenta")     << 300.0 << 1.0 << 1.0 << 255 << 0   << 255;
        QTest::newRow("orange-half") << 30.0  << 1.0 << 1.0 << 255 << 128 << 0;
        QTest::newRow("white")       << 200.0 << 0.0 << 1.0 << 255 << 255 << 255;
        QTest::newRow("black")       << 200.0 << 1.0 << 0.0 << 0   << 0   << 0;
        QTest::newRow("hue-360")     << 360.0 << 1.0 << 1.0 << 255 << 0   << 0;
    }
    void hsvToRgb()
    {
        QFETCH(double, hue);
        QFETCH(double, sat);
        QFETCH(double, val);
        QFETCH(int, r);
        QFETCH(int, g);
        QFETCH(int, b);
        const ledcolor::Rgb c = ledcolor::hsvToRgb(hue, sat, val);
        QCOMPARE(c.r, r);
        QCOMPARE(c.g, g);
        QCOMPARE(c.b, b);
    }

    void hueFromPoint_data()
    {
        QTest::addColumn<double>("dx");
        QTest::addColumn<double>("dy");
        QTest::addColumn<double>("prev");
        QTest::addColumn<double>("hue");

        QTest::newRow("top")    << 0.0   << -10.0 << 0.0   << 0.0;
        QTest::newRow("right")  << 10.0  << 0.0   << 0.0   << 90.0;
        QTest::newRow("bottom") << 0.0   << 10.0  << 0.0   << 180.0;
        QTest::newRow("left")   << -10.0 << 0.0   << 0.0   << 270.0;
        QTest::newRow("center") << 0.0   << 0.0   << 123.0 << 123.0;
    }
    void hueFromPoint()
    {
        QFETCH(double, dx);
        QFETCH(double, dy);
        QFETCH(double, prev);
        QFETCH(double, hue);
        QVERIFY(qAbs(ledcolor::hueFromPoint(dx, dy, prev) - hue) < 1e-9);
    }

    void satFromPoint_data()
    {
        QTest::addColumn<double>("dx");
        QTest::addColumn<double>("dy");
        QTest::addColumn<double>("radius");
        QTest::addColumn<double>("sat");

        QTest::newRow("half")    << 5.0  << 0.0 << 10.0 << 0.5;
        QTest::newRow("capped")  << 20.0 << 0.0 << 10.0 << 1.0;
        QTest::newRow("center")  << 0.0  << 0.0 << 10.0 << 0.0;
    }
    void satFromPoint()
    {
        QFETCH(double, dx);
        QFETCH(double, dy);
        QFETCH(double, radius);
        QFETCH(double, sat);
        QVERIFY(qAbs(ledcolor::satFromPoint(dx, dy, radius) - sat) < 1e-9);
    }
};

QTEST_APPLESS_MAIN(TestLedColor)
#include "tst_ledcolor.moc"
