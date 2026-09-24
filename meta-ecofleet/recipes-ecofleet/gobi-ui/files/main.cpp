#include <QDir>
#include <QFont>
#include <QFontDatabase>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>

#include "TelemetryModel.h"
#include "DeviceInfoModel.h"
#include "WeatherModel.h"

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("gobi-ui"));
    app.setOrganizationName(QStringLiteral("EcoFleet"));

    // UI typeface: the bundled Inter weights become the app-wide default font, so
    // every QML Text picks it up without naming a family. Tabular figures keep
    // live readings from jittering sideways as digits change. If the fonts are
    // missing the UI still runs on the system default (Liberation Sans).
    const QString fontDir = QStringLiteral("/usr/share/gobi-ui/fonts");
    QString family;
    for (const QString &file : QDir(fontDir).entryList({QStringLiteral("*.ttf")})) {
        const int id = QFontDatabase::addApplicationFont(fontDir + QLatin1Char('/') + file);
        if (id >= 0 && family.isEmpty())
            family = QFontDatabase::applicationFontFamilies(id).value(0);
    }
    if (!family.isEmpty()) {
        QFont font(family);
        font.setFeature(QFont::Tag("tnum"), 1);
        app.setFont(font);
    }

    TelemetryModel  telemetry;
    DeviceInfoModel devinfo;
    WeatherModel    weather;

    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty(QStringLiteral("telemetry"), &telemetry);
    engine.rootContext()->setContextProperty(QStringLiteral("devinfo"),   &devinfo);
    engine.rootContext()->setContextProperty(QStringLiteral("weather"),   &weather);
    engine.load(QUrl::fromLocalFile(QStringLiteral("/usr/share/gobi-ui/qml/main.qml")));

    if (engine.rootObjects().isEmpty())
        return 1;

    return app.exec();
}
