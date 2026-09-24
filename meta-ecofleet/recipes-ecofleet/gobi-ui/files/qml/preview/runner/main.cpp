// Preview runner: same app-font setup as gobi-ui's main.cpp, mocks as context
// properties, loads a harness QML that screenshots itself and quits.
#include <QGuiApplication>
#include <QQmlEngine>
#include <QQmlComponent>
#include <QQmlContext>
#include <QQuickView>
#include <QFontDatabase>
#include <QDir>
#include <QQmlApplicationEngine>
#include <QQuickWindow>
#include <QTimer>
int main(int argc, char **argv) {
    QGuiApplication app(argc, argv);
    const QString qmlDir = argv[1], fontDir = argv[2], outDir = argv[3], harness = argv[4];
    if (fontDir != "-") {
        QString fam;
        for (const QString &f : QDir(fontDir).entryList({"*.ttf"})) {
            int id = QFontDatabase::addApplicationFont(fontDir + "/" + f);
            if (id >= 0 && fam.isEmpty()) fam = QFontDatabase::applicationFontFamilies(id).value(0);
        }
        QFont font(fam); font.setFeature(QFont::Tag("tnum"), 1); app.setFont(font);
        qWarning() << "app font" << fam;
    }
    // Window mode: a harness ending in main.qml is the real app root (an
    // ApplicationWindow) — load it as the device does and save frames at
    // 400ms (splash up) and 3000ms (splash gone), then quit.
    if (harness.endsWith(QStringLiteral("main.qml"))) {
        QQmlApplicationEngine engine;
        QQmlComponent mc(&engine, QUrl::fromLocalFile(qmlDir + "/preview/Mocks.qml"));
        QObject *mocks = mc.create();
        if (!mocks) { qWarning() << mc.errors(); return 1; }
        engine.rootContext()->setContextProperty("telemetry", mocks->property("telemetry").value<QObject*>());
        engine.rootContext()->setContextProperty("devinfo",   mocks->property("devinfo").value<QObject*>());
        engine.load(QUrl::fromLocalFile(qmlDir + "/" + harness));
        if (engine.rootObjects().isEmpty()) return 1;
        auto *win = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
        win->setVisibility(QWindow::Windowed); win->resize(800, 480);
        for (int ms : {400, 3000})
            QTimer::singleShot(ms, [=] { win->grabWindow().save(outDir + QString("/window-%1ms.png").arg(ms)); });
        QTimer::singleShot(3200, &app, &QGuiApplication::quit);
        return app.exec();
    }

    QQuickView view;
    QQmlComponent mc(view.engine(), QUrl::fromLocalFile(qmlDir + "/preview/Mocks.qml"));
    QObject *mocks = mc.create();
    if (!mocks) { qWarning() << mc.errors(); return 1; }
    view.rootContext()->setContextProperty("telemetry", mocks->property("telemetry").value<QObject*>());
    view.rootContext()->setContextProperty("devinfo",   mocks->property("devinfo").value<QObject*>());
    view.rootContext()->setContextProperty("shotDir",   outDir);
    QObject::connect(view.engine(), &QQmlEngine::quit, &app, &QGuiApplication::quit);
    view.setSource(QUrl::fromLocalFile(qmlDir + "/" + harness));
    if (view.status() != QQuickView::Ready) { qWarning() << view.errors(); return 1; }
    view.show();
    return app.exec();
}
