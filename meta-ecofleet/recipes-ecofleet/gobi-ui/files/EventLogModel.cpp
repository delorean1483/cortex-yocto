#include "EventLogModel.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QVariantMap>

static constexpr const char *EVENTS_PATH          = "/data/ecofleet/events.json";
static constexpr const char *EVENTS_FALLBACK_PATH = "/var/lib/ecofleet/events.json";
static constexpr int         POLL_MS              = 5000;

EventLogModel::EventLogModel(QObject *parent) : QObject(parent)
{
    m_timer = new QTimer(this);
    connect(m_timer, &QTimer::timeout, this, &EventLogModel::poll);
    m_timer->start(POLL_MS);
    poll();
}

void EventLogModel::poll()
{
    QFile f(QString::fromLatin1(EVENTS_PATH));
    if (!f.exists()) f.setFileName(QString::fromLatin1(EVENTS_FALLBACK_PATH));

    QVariantList events;
    int active = 0;
    if (f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        const auto doc = QJsonDocument::fromJson(f.readAll());
        f.close();
        const QJsonArray arr = doc.object().value(QStringLiteral("events")).toArray();
        for (const auto &v : arr) {
            const QJsonObject e = v.toObject();
            QVariantMap m;
            m[QStringLiteral("code")]          = e.value(QStringLiteral("code")).toInt();
            m[QStringLiteral("error")]         = e.value(QStringLiteral("error")).toString();
            m[QStringLiteral("startMs")]       = e.value(QStringLiteral("start_ms")).toDouble();
            m[QStringLiteral("endMs")]         = e.value(QStringLiteral("end_ms")).toDouble();
            m[QStringLiteral("mode")]          = e.value(QStringLiteral("mode")).toString();
            m[QStringLiteral("controlStatus")] = e.value(QStringLiteral("control_status")).toString();
            m[QStringLiteral("engineStatus")]  = e.value(QStringLiteral("engine_status")).toString();
            m[QStringLiteral("rpm")]           = e.value(QStringLiteral("rpm")).toInt();
            m[QStringLiteral("battV")]         = e.value(QStringLiteral("batt_v")).toDouble();
            m[QStringLiteral("cabinF")]        = e.value(QStringLiteral("cabin_temp_f")).toDouble();
            m[QStringLiteral("coolantF")]      = e.value(QStringLiteral("coolant_temp_f")).toDouble();
            if (e.value(QStringLiteral("end_ms")).toDouble() == 0) active++;
            events.append(m);
        }
    }

    if (events != m_events || active != m_active) {
        m_events = events;
        m_active = active;
        emit changed();
    }
}
