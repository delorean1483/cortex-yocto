#pragma once

#include <QObject>
#include <QString>
#include <QTimer>
#include <sqlite3.h>

class TelemetryModel : public QObject
{
    Q_OBJECT
    Q_PROPERTY(double  dcV        READ dcV        NOTIFY dataChanged)
    Q_PROPERTY(double  dcA        READ dcA        NOTIFY dataChanged)
    Q_PROPERTY(double  battV      READ battV      NOTIFY dataChanged)
    Q_PROPERTY(double  battSoc    READ battSoc    NOTIFY dataChanged)
    Q_PROPERTY(double  battT      READ battT      NOTIFY dataChanged)
    Q_PROPERTY(double  oilPsi     READ oilPsi     NOTIFY dataChanged)
    Q_PROPERTY(double  coolantT   READ coolantT   NOTIFY dataChanged)
    Q_PROPERTY(QString apuState   READ apuState   NOTIFY dataChanged)
    Q_PROPERTY(int     runtimeHrs READ runtimeHrs NOTIFY dataChanged)
    Q_PROPERTY(int     watts      READ watts      NOTIFY dataChanged)
    Q_PROPERTY(int     rpm        READ rpm        NOTIFY dataChanged)
    Q_PROPERTY(QString fault      READ fault      NOTIFY dataChanged)
    Q_PROPERTY(bool    hasFault   READ hasFault   NOTIFY dataChanged)
    Q_PROPERTY(bool    stale      READ stale      NOTIFY dataChanged)
    Q_PROPERTY(qint64  tsMs       READ tsMs       NOTIFY dataChanged)

public:
    explicit TelemetryModel(QObject *parent = nullptr);
    ~TelemetryModel() override;

    double  dcV()        const { return m_dcV; }
    double  dcA()        const { return m_dcA; }
    double  battV()      const { return m_battV; }
    double  battSoc()    const { return m_battSoc; }
    double  battT()      const { return m_battT; }
    double  oilPsi()     const { return m_oilPsi; }
    double  coolantT()   const { return m_coolantT; }
    QString apuState()   const { return m_apuState; }
    int     runtimeHrs() const { return m_runtimeHrs; }
    int     watts()      const { return m_watts; }
    int     rpm()        const { return m_rpm; }
    QString fault()      const { return m_fault; }
    bool    hasFault()   const { return m_hasFault; }
    bool    stale()      const { return m_stale; }
    qint64  tsMs()       const { return m_tsMs; }

signals:
    void dataChanged();

private slots:
    void poll();

private:
    sqlite3 *m_db    = nullptr;
    QTimer  *m_timer = nullptr;

    double  m_dcV = 0, m_dcA = 0, m_battV = 0, m_battSoc = 0, m_battT = 0;
    double  m_oilPsi = 0, m_coolantT = 0;
    int     m_runtimeHrs = 0, m_watts = 0, m_rpm = 0;
    QString m_apuState = QStringLiteral("unknown");
    QString m_fault    = QStringLiteral("0x0000");
    bool    m_hasFault = false;
    bool    m_stale    = true;
    qint64  m_tsMs     = 0;
};
