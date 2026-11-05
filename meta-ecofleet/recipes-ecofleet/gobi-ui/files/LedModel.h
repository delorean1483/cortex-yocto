#pragma once

#include <QElapsedTimer>
#include <QObject>
#include <QString>
#include <QTimer>

// State behind the External LED Color page: HSV chosen on the wheel + brightness
// slider, sent to the agent as "led_rgb" in command.json (throttled) and saved to
// led.json (only on release()/flush()) so the agent can restore it at start.
class LedModel : public QObject
{
    Q_OBJECT
    Q_PROPERTY(double hue        READ hue        NOTIFY changed)                                  // 0..360
    Q_PROPERTY(double saturation READ saturation NOTIFY changed)                                  // 0..1
    Q_PROPERTY(double brightness READ brightness WRITE setBrightness NOTIFY changed)              // 0..1
    Q_PROPERTY(int    r READ r NOTIFY changed)
    Q_PROPERTY(int    g READ g NOTIFY changed)
    Q_PROPERTY(int    b READ b NOTIFY changed)
    Q_PROPERTY(bool   hasColor READ hasColor NOTIFY changed)   // a color was saved or touched

public:
    static constexpr int SEND_THROTTLE_MS = 200;

    LedModel(const QString &configPath, const QString &commandPath, QObject *parent = nullptr);
    ~LedModel() override;

    static QString defaultConfigPath();   // /data (shared A/B) when mounted, else /var/lib/gobi-ui

    double hue()        const { return m_hue; }
    double saturation() const { return m_sat; }
    double brightness() const { return m_val; }
    int    r() const;
    int    g() const;
    int    b() const;
    bool   hasColor()   const { return m_hasColor; }

    Q_INVOKABLE void pickAt(double dx, double dy, double radius);   // wheel: set H,S; throttled send
    Q_INVOKABLE void release();                                      // finger lifted: send final now, save
    Q_INVOKABLE void flush();                                        // page closing: save if a change is unsaved
    void setBrightness(double v);                                    // throttled send

signals:
    void changed();

private:
    void load();
    void save();
    void requestSend();
    void sendNow();

    QString       m_cfgPath;
    QString       m_cmdPath;
    QTimer        m_trailing;
    QElapsedTimer m_sinceSend;
    double        m_hue = 0.0;
    double        m_sat = 1.0;
    double        m_val = 1.0;
    bool          m_hasColor = false;
    bool          m_dirty = false;      // changed since last save
    bool          m_pending = false;    // a throttled send is waiting for the trailing timer
};
