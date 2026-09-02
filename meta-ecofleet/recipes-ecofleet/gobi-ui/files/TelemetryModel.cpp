#include "TelemetryModel.h"

#include <QFile>
#include <QSaveFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QDateTime>

static constexpr const char *LATEST_PATH  = "/var/lib/ecofleet/latest.json";
static constexpr const char *COMMAND_PATH = "/var/lib/ecofleet/command.json";
static constexpr int         POLL_MS      = 2000;
static constexpr qint64      STALE_MS     = 30000; /* 30 s without a fresh snapshot */

/* Merge one key into command.json (atomic). Merging — rather than overwriting —
 * lets several quick taps (e.g. temp then mode) accumulate before the agent
 * consumes the file on its next cycle. */
static void writeCommand(const QString &key, const QJsonValue &value)
{
    QJsonObject obj;
    QFile in(QString::fromLatin1(COMMAND_PATH));
    if (in.open(QIODevice::ReadOnly)) {
        const auto doc = QJsonDocument::fromJson(in.readAll());
        if (doc.isObject()) obj = doc.object();
        in.close();
    }
    obj.insert(key, value);

    QSaveFile out(QString::fromLatin1(COMMAND_PATH));
    if (out.open(QIODevice::WriteOnly)) {
        out.write(QJsonDocument(obj).toJson(QJsonDocument::Compact));
        out.commit();   /* atomic rename */
    }
}

TelemetryModel::TelemetryModel(QObject *parent) : QObject(parent)
{
    m_timer = new QTimer(this);
    connect(m_timer, &QTimer::timeout, this, &TelemetryModel::poll);
    m_timer->start(POLL_MS);
    poll();
}

void TelemetryModel::poll()
{
    QFile f(QString::fromLatin1(LATEST_PATH));
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        if (!m_stale) { m_stale = true; emit dataChanged(); }
        return;
    }
    const QByteArray raw = f.readAll();
    f.close();

    const auto doc = QJsonDocument::fromJson(raw);
    if (!doc.isObject()) {
        if (!m_stale) { m_stale = true; emit dataChanged(); }
        return;
    }
    const QJsonObject o = doc.object();

    m_cabinTempF    = o[u"cabin_temp_f"].toDouble();
    m_extTempF      = o[u"ext_temp_f"].toDouble();
    m_battV         = o[u"batt_v"].toDouble();
    m_clmtSetpointF = o[u"clmt_setpoint_f"].toDouble();
    m_battSetpointV = o[u"batt_setpoint_v"].toDouble();
    m_rpm           = static_cast<int>(o[u"rpm"].toDouble());
    m_fanSpeed      = static_cast<int>(o[u"fan_speed"].toDouble());
    m_fanAuto       = o[u"fan_auto"].toBool();
    m_engineHrs     = static_cast<int>(o[u"engine_hrs"].toDouble());
    m_machineHrs    = static_cast<int>(o[u"machine_hrs"].toDouble());
    m_oilHrs        = static_cast<int>(o[u"oil_hrs"].toDouble());
    m_oilOk         = o[u"oil_ok"].toBool();
    m_ignition      = o[u"ignition"].toBool();
    m_mode          = o[u"mode"].toString(QStringLiteral("off"));
    m_engineStatus  = o[u"engine_status"].toString(QStringLiteral("off"));
    m_controlStatus = o[u"control_status"].toString(QStringLiteral("off"));
    m_error         = o[u"error"].toString(QStringLiteral("none"));
    m_oilChange     = o[u"oil_change"].toString(QStringLiteral("good"));
    m_tsMs          = static_cast<qint64>(o[u"ts"].toDouble());
    m_diagActive    = o[u"diag_active"].toBool();
    m_diagOutputs   = static_cast<int>(o[u"diag_outputs"].toDouble());
    m_stale         = (QDateTime::currentMSecsSinceEpoch() - m_tsMs) > STALE_MS;

    emit dataChanged();
}

void TelemetryModel::setMode(const QString &mode)   { writeCommand(QStringLiteral("mode"), mode); }
void TelemetryModel::setSetpoint(int degF)          { writeCommand(QStringLiteral("setpoint_f"), degF); }
void TelemetryModel::setFan(int speed)              { writeCommand(QStringLiteral("fan"), speed); }
void TelemetryModel::setFanAuto(bool on)            { writeCommand(QStringLiteral("fan_auto"), on ? 1 : 0); }
void TelemetryModel::resetOil()                     { writeCommand(QStringLiteral("reset_oil"), true); }

void TelemetryModel::enterComponentTest()              { writeCommand(QStringLiteral("diag_mode"), 1); }
void TelemetryModel::exitComponentTest()               { writeCommand(QStringLiteral("diag_mode"), 0); }
void TelemetryModel::setTestRelay(int index, bool on)  { writeCommand(QStringLiteral("diag_out"), (index << 8) | (on ? 1 : 0)); }
