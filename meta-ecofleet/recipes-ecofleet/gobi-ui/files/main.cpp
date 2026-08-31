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
