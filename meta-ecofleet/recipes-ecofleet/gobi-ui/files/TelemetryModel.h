#pragma once

#include <QObject>
#include <QString>
#include <QTimer>

/* Reads the live telemetry snapshot the gobi-agent writes to
 * /var/lib/ecofleet/latest.json every poll cycle (climate-APU schema).
 * File-based (not SQLite): the agent's SQLite buffer only holds rows while
 * offline, whereas latest.json is always current. */
class TelemetryModel : public QObject
{
    Q_OBJECT
    Q_PROPERTY(double  cabinTempF    READ cabinTempF    NOTIFY dataChanged)
    Q_PROPERTY(double  extTempF      READ extTempF      NOTIFY dataChanged)
    Q_PROPERTY(double  battV         READ battV         NOTIFY dataChanged)
    Q_PROPERTY(double  clmtSetpointF READ clmtSetpointF NOTIFY dataChanged)
    Q_PROPERTY(double  battSetpointV READ battSetpointV NOTIFY dataChanged)
    Q_PROPERTY(int     rpm           READ rpm           NOTIFY dataChanged)
    Q_PROPERTY(int     fanSpeed      READ fanSpeed      NOTIFY dataChanged)
    Q_PROPERTY(int     engineHrs     READ engineHrs     NOTIFY dataChanged)
    Q_PROPERTY(int     machineHrs    READ machineHrs    NOTIFY dataChanged)
    Q_PROPERTY(int     oilHrs        READ oilHrs        NOTIFY dataChanged)
    Q_PROPERTY(bool    oilOk         READ oilOk         NOTIFY dataChanged)
    Q_PROPERTY(bool    ignition      READ ignition      NOTIFY dataChanged)
    Q_PROPERTY(QString mode          READ mode          NOTIFY dataChanged)
    Q_PROPERTY(QString engineStatus  READ engineStatus  NOTIFY dataChanged)
    Q_PROPERTY(QString controlStatus READ controlStatus NOTIFY dataChanged)
    Q_PROPERTY(QString error         READ error         NOTIFY dataChanged)
    Q_PROPERTY(bool    hasError      READ hasError      NOTIFY dataChanged)
    Q_PROPERTY(QString oilChange     READ oilChange     NOTIFY dataChanged)
    Q_PROPERTY(bool    stale         READ stale         NOTIFY dataChanged)
    Q_PROPERTY(qint64  tsMs          READ tsMs          NOTIFY dataChanged)

public:
    explicit TelemetryModel(QObject *parent = nullptr);
    ~TelemetryModel() override = default;

    double  cabinTempF()    const { return m_cabinTempF; }
    double  extTempF()      const { return m_extTempF; }
    double  battV()         const { return m_battV; }
    double  clmtSetpointF() const { return m_clmtSetpointF; }
    double  battSetpointV() const { return m_battSetpointV; }
    int     rpm()           const { return m_rpm; }
    int     fanSpeed()      const { return m_fanSpeed; }
    int     engineHrs()     const { return m_engineHrs; }
    int     machineHrs()    const { return m_machineHrs; }
    int     oilHrs()        const { return m_oilHrs; }
    bool    oilOk()         const { return m_oilOk; }
    bool    ignition()      const { return m_ignition; }
    QString mode()          const { return m_mode; }
    QString engineStatus()  const { return m_engineStatus; }
    QString controlStatus() const { return m_controlStatus; }
    QString error()         const { return m_error; }
    bool    hasError()      const { return m_error != QLatin1String("none") &&
                                            !m_error.isEmpty(); }
    QString oilChange()     const { return m_oilChange; }
    bool    stale()         const { return m_stale; }
    qint64  tsMs()          const { return m_tsMs; }

signals:
    void dataChanged();

private slots:
    void poll();

private:
    QTimer *m_timer = nullptr;

    double  m_cabinTempF = 0, m_extTempF = 0, m_battV = 0;
    double  m_clmtSetpointF = 0, m_battSetpointV = 0;
    int     m_rpm = 0, m_fanSpeed = 0;
    int     m_engineHrs = 0, m_machineHrs = 0, m_oilHrs = 0;
    bool    m_oilOk = false, m_ignition = false;
    QString m_mode          = QStringLiteral("off");
    QString m_engineStatus  = QStringLiteral("off");
    QString m_controlStatus = QStringLiteral("off");
    QString m_error         = QStringLiteral("none");
    QString m_oilChange     = QStringLiteral("good");
    bool    m_stale         = true;
    qint64  m_tsMs          = 0;
};
