#include "TelemetryModel.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QDateTime>

static constexpr const char *DB_PATH          = "/var/lib/ecofleet/telemetry.db";
static constexpr int         POLL_MS          = 2000;
static constexpr qint64      STALE_MS         = 30000; /* 30 s without new row */

TelemetryModel::TelemetryModel(QObject *parent) : QObject(parent)
{
    int rc = sqlite3_open_v2(DB_PATH, &m_db,
                             SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nullptr);
    if (rc != SQLITE_OK) {
        qWarning("gobi-ui: cannot open %s: %s", DB_PATH,
                 m_db ? sqlite3_errmsg(m_db) : "unknown");
        sqlite3_close(m_db);
        m_db = nullptr;
    }

    m_timer = new QTimer(this);
    connect(m_timer, &QTimer::timeout, this, &TelemetryModel::poll);
    m_timer->start(POLL_MS);
    poll();
}

TelemetryModel::~TelemetryModel()
{
    if (m_db)
        sqlite3_close(m_db);
}

void TelemetryModel::poll()
{
    if (!m_db) {
        /* Retry open in case gobi-agent hasn't created the DB yet */
        int rc = sqlite3_open_v2(DB_PATH, &m_db,
                                 SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nullptr);
        if (rc != SQLITE_OK) {
            sqlite3_close(m_db);
            m_db = nullptr;
            if (!m_stale) { m_stale = true; emit dataChanged(); }
            return;
        }
    }

    static const char *sql =
        "SELECT payload FROM telemetry ORDER BY id DESC LIMIT 1;";

    sqlite3_stmt *stmt = nullptr;
    if (sqlite3_prepare_v2(m_db, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        if (!m_stale) { m_stale = true; emit dataChanged(); }
        return;
    }

    bool updated = false;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        const auto *raw = reinterpret_cast<const char *>(sqlite3_column_text(stmt, 0));
        if (raw) {
            auto doc = QJsonDocument::fromJson(QByteArray(raw));
            if (doc.isObject()) {
                const QJsonObject o = doc.object();
                m_dcV        = o[u"dc_v"].toDouble();
                m_dcA        = o[u"dc_a"].toDouble();
                m_battV      = o[u"batt_v"].toDouble();
                m_battSoc    = o[u"batt_soc"].toDouble();
                m_battT      = o[u"batt_t"].toDouble();
                m_oilPsi     = o[u"oil_psi"].toDouble();
                m_coolantT   = o[u"coolant_t"].toDouble();
                m_apuState   = o[u"apu_state"].toString(QStringLiteral("unknown"));
                m_runtimeHrs = static_cast<int>(o[u"runtime_hrs"].toDouble());
                m_watts      = static_cast<int>(o[u"watts"].toDouble());
                m_rpm        = static_cast<int>(o[u"rpm"].toDouble());
                m_fault      = o[u"fault"].toString(QStringLiteral("0x0000"));
                m_hasFault   = m_fault != QLatin1String("0x0000") &&
                               m_fault != QLatin1String("0x0");
                m_tsMs       = static_cast<qint64>(o[u"ts"].toDouble());
                m_stale      = (QDateTime::currentMSecsSinceEpoch() - m_tsMs) > STALE_MS;
                updated      = true;
            }
        }
    }
    sqlite3_finalize(stmt);

    if (!updated && !m_stale) {
        m_stale = true;
    }

    emit dataChanged();
}
