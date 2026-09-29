#pragma once

#include <QObject>
#include <QString>
#include <QTimer>

// Panel backlight + screen sleep. Owns /sys/class/backlight/<x>: applies the
// user brightness, dims after inactivity, then powers the backlight down. Weston
// runs with idle-time=0, so this is the only thing that ever blanks the panel.
//
// Installed as an application event filter: any touch/click restarts the idle
// timer; one that lands while dim/off only wakes the screen and is swallowed
// (press through release) so it can't press whatever is underneath.
class DisplayModel : public QObject
{
    Q_OBJECT
    Q_PROPERTY(int     brightness   READ brightness   WRITE setBrightness   NOTIFY brightnessChanged)
    Q_PROPERTY(int     sleepMinutes READ sleepMinutes WRITE setSleepMinutes NOTIFY sleepMinutesChanged)
    Q_PROPERTY(bool    keepAwake    READ keepAwake    WRITE setKeepAwake    NOTIFY keepAwakeChanged)
    Q_PROPERTY(QString state        READ state                              NOTIFY stateChanged)

public:
    static constexpr int MIN_BRIGHTNESS = 10;   // % — never black, so it can't look dead
    static constexpr int DIM_BRIGHTNESS = 20;   // % during the dim warning
    static constexpr int DIM_WARNING_MS = 30000;
    static constexpr int DEFAULT_SLEEP_MIN = 10;

    DisplayModel(const QString &backlightDir, const QString &configPath, QObject *parent = nullptr);
    ~DisplayModel() override;

    static QString defaultBacklightDir();   // first /sys/class/backlight entry, or "" if none
    static QString defaultConfigPath();     // /data (shared A/B) when mounted, else /var/lib/gobi-ui

    int     brightness()   const { return m_brightness; }
    int     sleepMinutes() const { return m_sleepMin; }
    bool    keepAwake()    const { return m_keepAwake; }
    QString state()        const;

    void setBrightness(int pct);
    void setSleepMinutes(int min);   // 0 = never
    void setKeepAwake(bool on);

    // Idle timings actually in use (-1 = sleep disabled). Test hook overrides the
    // minute-derived values until sleepMinutes next changes.
    int  dimAfterMs() const;
    int  offAfterMs() const;
    void setIdleTimings(int dimAfterMs, int offAfterMs);

    bool eventFilter(QObject *watched, QEvent *event) override;

signals:
    void brightnessChanged();
    void sleepMinutesChanged();
    void keepAwakeChanged();
    void stateChanged();

private:
    enum class State { On, Dim, Off };

    void load();
    void save();
    void wake();
    void restartIdle();
    void setState(State s);
    void onIdleTimeout();
    void writeSysfs(const char *file, int value);

    QString m_blDir;
    QString m_cfgPath;
    QTimer  m_idle;
    QTimer  m_saveDebounce;
    State   m_state      = State::On;
    int     m_brightness = 80;
    int     m_sleepMin   = DEFAULT_SLEEP_MIN;
    int     m_maxRaw     = 100;
    int     m_dimOverrideMs = -2;   // -2 = no override
    int     m_offOverrideMs = -2;
    bool    m_keepAwake  = false;
    bool    m_swallowing = false;   // eating the rest of a wake tap
};
