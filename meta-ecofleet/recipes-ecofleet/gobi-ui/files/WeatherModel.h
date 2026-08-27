#pragma once

#include <QObject>
#include <QString>
#include <QTimer>
#include <QVariantList>

/* Reads the forecast the weather-fetch service writes to
 * /var/lib/ecofleet/weather.json (see recipes-ecofleet/gobi-agent/files/
 * weather.h for the schema). File-based polling, mirroring TelemetryModel.
 *
 * `valid` is false when no location is configured or no forecast has been
 * fetched yet — the dashboard hides the weather strip in that case. `stale`
 * goes true once the forecast ages past its refresh window so the UI can grey
 * it out rather than show a confidently-wrong outlook. */
class WeatherModel : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QVariantList days     READ days     NOTIFY changed)
    Q_PROPERTY(bool         valid    READ valid    NOTIFY changed)
    Q_PROPERTY(bool         stale    READ stale    NOTIFY changed)
    Q_PROPERTY(QString      location READ location NOTIFY changed)

public:
    explicit WeatherModel(QObject *parent = nullptr);
    ~WeatherModel() override = default;

    /* Each entry is a map: label, date, hi, lo, code, cat, precip. */
    QVariantList days()     const { return m_days; }
    bool         valid()    const { return m_valid; }
    bool         stale()    const { return m_stale; }
    QString      location() const { return m_location; }

signals:
    void changed();

private slots:
    void poll();

private:
    QTimer      *m_timer = nullptr;
    QVariantList m_days;
    bool         m_valid = false;
    bool         m_stale = false;
    QString      m_location;
};
