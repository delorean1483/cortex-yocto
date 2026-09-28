#pragma once

#include <QObject>
#include <QTimer>
#include <QVariantList>

/* The APU fault history gobi-agent keeps for the panel's Error Log (see
 * gobi-agent event_log.h for the schema): /data/ecofleet/events.json on the
 * slot-shared data partition, or /var/lib/ecofleet/events.json when /data
 * isn't available. File-based polling, like WeatherModel. Newest first. */
class EventLogModel : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QVariantList events      READ events      NOTIFY changed)
    Q_PROPERTY(int          activeCount READ activeCount NOTIFY changed)

public:
    explicit EventLogModel(QObject *parent = nullptr);
    ~EventLogModel() override = default;

    /* Each entry is a map: code, error, startMs, endMs (0 = active), mode,
     * controlStatus, engineStatus, rpm, battV, cabinF, coolantF. */
    QVariantList events()      const { return m_events; }
    int          activeCount() const { return m_active; }

signals:
    void changed();

private slots:
    void poll();

private:
    QTimer      *m_timer = nullptr;
    QVariantList m_events;
    int          m_active = 0;
};
