#include "DisplayModel.h"

#include <QDir>
#include <QEvent>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>
#include <QStorageInfo>

static constexpr int SAVE_DEBOUNCE_MS = 1000;   // slider drags write sysfs live, disk once
static constexpr int BL_POWER_ON   = 0;         // FB_BLANK_UNBLANK
static constexpr int BL_POWER_DOWN = 4;         // FB_BLANK_POWERDOWN

static int readInt(const QString &path, int fallback)
{
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) return fallback;
    bool ok = false;
    const int v = QString::fromLatin1(f.readAll()).trimmed().toInt(&ok);
    return ok ? v : fallback;
}

DisplayModel::DisplayModel(const QString &backlightDir, const QString &configPath, QObject *parent)
    : QObject(parent), m_blDir(backlightDir), m_cfgPath(configPath)
{
    m_idle.setSingleShot(true);
    connect(&m_idle, &QTimer::timeout, this, &DisplayModel::onIdleTimeout);
    m_saveDebounce.setSingleShot(true);
    m_saveDebounce.setInterval(SAVE_DEBOUNCE_MS);
    connect(&m_saveDebounce, &QTimer::timeout, this, &DisplayModel::save);

    if (!m_blDir.isEmpty()) {
        m_maxRaw = qMax(1, readInt(m_blDir + QStringLiteral("/max_brightness"), 100));
        // Start from what the kernel applied at boot (DT default-brightness-level).
        const int raw = readInt(m_blDir + QStringLiteral("/brightness"), m_maxRaw * 80 / 100);
        m_brightness = qBound(MIN_BRIGHTNESS, raw * 100 / m_maxRaw, 100);
    }
    load();
    wake();
}

DisplayModel::~DisplayModel()
{
    if (m_saveDebounce.isActive()) save();
}

QString DisplayModel::defaultBacklightDir()
{
    const QDir dir(QStringLiteral("/sys/class/backlight"));
    const QStringList entries = dir.entryList(QDir::Dirs | QDir::NoDotAndDotDot);
    return entries.isEmpty() ? QString() : dir.filePath(entries.first());
}

QString DisplayModel::defaultConfigPath()
{
    // Only use /data when it is really the shared partition — a bare /data dir on
    // the rootfs would silently lose settings on the next A/B update.
    const QStorageInfo data(QStringLiteral("/data"));
    if (data.isValid() && data.rootPath() == QLatin1String("/data"))
        return QStringLiteral("/data/ecofleet/display.json");
    return QStringLiteral("/var/lib/gobi-ui/display.json");
}

QString DisplayModel::state() const
{
    switch (m_state) {
    case State::Dim: return QStringLiteral("dim");
    case State::Off: return QStringLiteral("off");
    default:         return QStringLiteral("on");
    }
}

void DisplayModel::setBrightness(int pct)
{
    pct = qBound(MIN_BRIGHTNESS, pct, 100);
    if (pct != m_brightness) {
        m_brightness = pct;
        emit brightnessChanged();
        m_saveDebounce.start();
    }
    wake();   // adjusting the level is itself activity, and shows the new level
}

void DisplayModel::setSleepMinutes(int min)
{
    min = qBound(0, min, 240);
    m_dimOverrideMs = m_offOverrideMs = -2;
    if (min != m_sleepMin) {
        m_sleepMin = min;
        emit sleepMinutesChanged();
        save();
    }
    restartIdle();
}

void DisplayModel::setKeepAwake(bool on)
{
    if (on == m_keepAwake) return;
    m_keepAwake = on;
    emit keepAwakeChanged();
    if (on) wake(); else restartIdle();
}

int DisplayModel::dimAfterMs() const
{
    if (m_dimOverrideMs != -2) return m_dimOverrideMs;
    if (m_sleepMin <= 0) return -1;
    return qMax(0, m_sleepMin * 60000 - DIM_WARNING_MS);
}

int DisplayModel::offAfterMs() const
{
    if (m_offOverrideMs != -2) return m_offOverrideMs;
    if (m_sleepMin <= 0) return -1;
    return qMin(DIM_WARNING_MS, m_sleepMin * 60000);
}

void DisplayModel::setIdleTimings(int dimMs, int offMs)
{
    m_dimOverrideMs = dimMs;
    m_offOverrideMs = offMs;
    restartIdle();
}

bool DisplayModel::eventFilter(QObject *watched, QEvent *event)
{
    switch (event->type()) {
    case QEvent::TouchBegin:
    case QEvent::MouseButtonPress:
    case QEvent::MouseButtonDblClick:
        if (m_state != State::On) {
            m_swallowing = true;
            wake();
            event->accept();   // accepted + filtered: Qt won't synthesize a mouse press from it
            return true;
        }
        if (m_swallowing) { event->accept(); return true; }
        restartIdle();
        break;
    case QEvent::TouchUpdate:
    case QEvent::MouseMove:
        if (m_swallowing) { event->accept(); return true; }
        break;
    case QEvent::TouchEnd:
    case QEvent::TouchCancel:
    case QEvent::MouseButtonRelease:
        if (m_swallowing) { m_swallowing = false; event->accept(); return true; }
        restartIdle();
        break;
    default:
        break;
    }
    return QObject::eventFilter(watched, event);
}

void DisplayModel::load()
{
    QFile f(m_cfgPath);
    if (!f.open(QIODevice::ReadOnly)) return;
    const QJsonObject o = QJsonDocument::fromJson(f.readAll()).object();
    if (o.contains(QStringLiteral("brightness")))
        m_brightness = qBound(MIN_BRIGHTNESS, o.value(QStringLiteral("brightness")).toInt(), 100);
    if (o.contains(QStringLiteral("sleep_minutes")))
        m_sleepMin = qBound(0, o.value(QStringLiteral("sleep_minutes")).toInt(), 240);
}

void DisplayModel::save()
{
    m_saveDebounce.stop();
    QDir().mkpath(QFileInfo(m_cfgPath).absolutePath());
    QSaveFile f(m_cfgPath);   // atomic rename — a power cut never leaves half a file
    if (!f.open(QIODevice::WriteOnly)) {
        qWarning("gobi-ui: cannot write %s", qPrintable(m_cfgPath));
        return;
    }
    QJsonObject o;
    o[QStringLiteral("brightness")]    = m_brightness;
    o[QStringLiteral("sleep_minutes")] = m_sleepMin;
    f.write(QJsonDocument(o).toJson(QJsonDocument::Compact));
    f.commit();
}

void DisplayModel::wake()
{
    setState(State::On);
    restartIdle();
}

void DisplayModel::restartIdle()
{
    m_idle.stop();
    if (m_keepAwake) return;
    if (m_state == State::On) {
        const int ms = dimAfterMs();
        if (ms >= 0) m_idle.start(ms);
    }
}

void DisplayModel::onIdleTimeout()
{
    if (m_keepAwake) return;
    if (m_state == State::On) {
        setState(State::Dim);
        const int ms = offAfterMs();
        if (ms >= 0) m_idle.start(ms);
    } else if (m_state == State::Dim) {
        setState(State::Off);
    }
}

void DisplayModel::setState(State s)
{
    // Always re-apply sysfs for On (brightness may have just changed); Dim/Off only
    // on the transition.
    const bool changed = s != m_state;
    m_state = s;
    switch (s) {
    case State::On:
        writeSysfs("bl_power", BL_POWER_ON);
        writeSysfs("brightness", m_brightness * m_maxRaw / 100);
        break;
    case State::Dim:
        if (changed) writeSysfs("brightness", qMin(m_brightness, DIM_BRIGHTNESS) * m_maxRaw / 100);
        break;
    case State::Off:
        if (changed) writeSysfs("bl_power", BL_POWER_DOWN);
        break;
    }
    if (changed) emit stateChanged();
}

void DisplayModel::writeSysfs(const char *file, int value)
{
    if (m_blDir.isEmpty()) return;
    QFile f(m_blDir + QLatin1Char('/') + QLatin1String(file));
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate)) return;   // no panel / not root: stay silent
    f.write(QByteArray::number(value) + '\n');
}
