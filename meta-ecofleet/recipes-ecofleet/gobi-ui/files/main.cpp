#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>

#include "TelemetryModel.h"

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("gobi-ui"));
    app.setOrganizationName(QStringLiteral("EcoFleet"));

    TelemetryModel model;

    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty(QStringLiteral("telemetry"), &model);
    engine.load(QUrl(QStringLiteral("qrc:/qt/qml/GobiUI/main.qml")));

    if (engine.rootObjects().isEmpty())
        return 1;

    return app.exec();
}
