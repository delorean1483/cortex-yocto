#include "LedModel.h"

#include "CommandFile.h"
#include "LedColor.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>
#include <QStorageInfo>
#include <QtGlobal>

LedModel::LedModel(const QString &configPath, const QString &commandPath, QObject *parent)
    : QObject(parent), m_cfgPath(configPath), m_cmdPath(commandPath)
{
    m_trailing.setSingleShot(true);
    connect(&m_trailing, &QTimer::timeout, this, [this] { if (m_pending) sendNow(); });
    load();
}

LedModel::~LedModel()
{
    flush();
}

QString LedModel::defaultConfigPath()
{
    // Same rule as DisplayModel: /data only when it is really the shared partition.
    const QStorageInfo data(QStringLiteral("/data"));
    if (data.isValid() && data.rootPath() == QLatin1String("/data"))
        return QStringLiteral("/data/ecofleet/led.json");
    return QStringLiteral("/var/lib/gobi-ui/led.json");
}

int LedModel::r() const { return ledcolor::hsvToRgb(m_hue, m_sat, m_val).r; }
int LedModel::g() const { return ledcolor::hsvToRgb(m_hue, m_sat, m_val).g; }
int LedModel::b() const { return ledcolor::hsvToRgb(m_hue, m_sat, m_val).b; }

void LedModel::pickAt(double dx, double dy, double radius)
{
    m_hue = ledcolor::hueFromPoint(dx, dy, m_hue);
    m_sat = ledcolor::satFromPoint(dx, dy, radius);
    m_hasColor = true;
    m_dirty = true;
    emit changed();
    requestSend();
}

void LedModel::setBrightness(double v)
{
    m_val = qBound(0.0, v, 1.0);
    m_hasColor = true;
    m_dirty = true;
    emit changed();
    requestSend();
}

void LedModel::release()
{
    if (!m_hasColor) return;
    sendNow();
    save();
}

void LedModel::flush()
{
    if (m_dirty) save();
}

void LedModel::requestSend()
{
    if (!m_sinceSend.isValid() || m_sinceSend.elapsed() >= SEND_THROTTLE_MS) {
        sendNow();
        return;
    }
    m_pending = true;
    if (!m_trailing.isActive())
        m_trailing.start(SEND_THROTTLE_MS - static_cast<int>(m_sinceSend.elapsed()));
}

void LedModel::sendNow()
{
    m_trailing.stop();
    m_pending = false;
    const ledcolor::Rgb c = ledcolor::hsvToRgb(m_hue, m_sat, m_val);
    mergeCommandKey(m_cmdPath, QStringLiteral("led_rgb"), QJsonArray{c.r, c.g, c.b});
    m_sinceSend.restart();
}

void LedModel::load()
{
    QFile f(m_cfgPath);
    if (!f.open(QIODevice::ReadOnly)) return;
    const QJsonObject o = QJsonDocument::fromJson(f.readAll()).object();
    if (!o.contains(QStringLiteral("h")) || !o.contains(QStringLiteral("s")) || !o.contains(QStringLiteral("v")))
        return;
    m_hue = qBound(0.0, o.value(QStringLiteral("h")).toDouble(), 360.0);
    m_sat = qBound(0.0, o.value(QStringLiteral("s")).toDouble(), 1.0);
    m_val = qBound(0.0, o.value(QStringLiteral("v")).toDouble(), 1.0);
    m_hasColor = true;
}

void LedModel::save()
{
    QDir().mkpath(QFileInfo(m_cfgPath).absolutePath());
    QSaveFile f(m_cfgPath);   // atomic rename — a power cut never leaves half a file
    if (!f.open(QIODevice::WriteOnly)) {
        qWarning("gobi-ui: cannot write %s", qPrintable(m_cfgPath));
        return;
    }
    const ledcolor::Rgb c = ledcolor::hsvToRgb(m_hue, m_sat, m_val);
    QJsonObject o;
    o[QStringLiteral("h")] = m_hue;
    o[QStringLiteral("s")] = m_sat;
    o[QStringLiteral("v")] = m_val;
    o[QStringLiteral("r")] = c.r;
    o[QStringLiteral("g")] = c.g;
    o[QStringLiteral("b")] = c.b;
    f.write(QJsonDocument(o).toJson(QJsonDocument::Compact));
    // The agent runs as another user and must be able to read this.
    f.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner |
                     QFileDevice::ReadGroup | QFileDevice::ReadOther);
    if (f.commit()) m_dirty = false;
}
