#include "WeatherModel.h"

#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QDateTime>
#include <QVariantMap>

static constexpr const char *WEATHER_PATH = "/var/lib/ecofleet/weather.json";
static constexpr int         POLL_MS      = 60000;              /* 1 min          */
static constexpr qint64      STALE_MS     = 6LL * 3600 * 1000;  /* 6 h -> grey out */

WeatherModel::WeatherModel(QObject *parent) : QObject(parent)
{
    m_timer = new QTimer(this);
    connect(m_timer, &QTimer::timeout, this, &WeatherModel::poll);
    m_timer->start(POLL_MS);
    poll();
}

void WeatherModel::poll()
{
    bool         valid = false;
    bool         stale = false;
    QVariantList days;
    QString      location;

    QFile f(QString::fromLatin1(WEATHER_PATH));
    if (f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        const QByteArray raw = f.readAll();
        f.close();

        const auto doc = QJsonDocument::fromJson(raw);
        if (doc.isObject()) {
            const QJsonObject o = doc.object();
            location = o.value(QStringLiteral("location")).toString();
            const qint64 fetched = static_cast<qint64>(
                o.value(QStringLiteral("fetched_ts")).toDouble());

            const QJsonArray arr = o.value(QStringLiteral("days")).toArray();
            for (const auto &v : arr) {
                const QJsonObject d = v.toObject();
                QVariantMap m;
                m[QStringLiteral("label")]  = d.value(QStringLiteral("label")).toString();
                m[QStringLiteral("date")]   = d.value(QStringLiteral("date")).toString();
                m[QStringLiteral("hi")]     = d.value(QStringLiteral("hi_f")).toInt();
                m[QStringLiteral("lo")]     = d.value(QStringLiteral("lo_f")).toInt();
                m[QStringLiteral("code")]   = d.value(QStringLiteral("code")).toInt();
                m[QStringLiteral("cat")]    = d.value(QStringLiteral("cat")).toString();
                m[QStringLiteral("precip")] = d.value(QStringLiteral("precip_pct")).toInt();
                days.append(m);
            }

            valid = !days.isEmpty();
            if (fetched > 0) {
                const qint64 age = QDateTime::currentMSecsSinceEpoch() - fetched;
                stale = age > STALE_MS;
            }
        }
    }

    if (valid != m_valid || stale != m_stale ||
        location != m_location || days != m_days) {
        m_valid    = valid;
        m_stale    = stale;
        m_location = location;
        m_days     = days;
        emit changed();
    }
}
