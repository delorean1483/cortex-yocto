#include "UpdateNotice.h"

#include <QStringList>
#include <QtGlobal>

static UpdateNotice make(UpdateNotice::Kind kind, const QString &title,
                         const QString &detail, const QString &key = QString())
{
    UpdateNotice n;
    n.kind = kind; n.title = title; n.detail = detail; n.key = key;
    return n;
}

/* System (A/B image) update from gobi-ota-apply's status line. */
static UpdateNotice fromOta(const QString &status)
{
    const QStringList w = status.split(QLatin1Char(' '), Qt::SkipEmptyParts);
    if (w.size() < 2) return UpdateNotice();

    const QString title = QStringLiteral("Updating software to %1").arg(w[1]);
    if (w[0] == QLatin1String("downloading"))
        return make(UpdateNotice::Busy, title, QStringLiteral("Downloading…"));
    if (w[0] == QLatin1String("installing"))
        return make(UpdateNotice::Busy, title, QStringLiteral("Installing…"));
    if (w[0] == QLatin1String("success"))   // worker is about to cold-reboot
        return make(UpdateNotice::Busy, title, QStringLiteral("Restarting…"));

    // "failed: download 1.2.67" / "failed: install 1.2.67 (rc 1)"
    if (w[0] == QLatin1String("failed:") && w.size() >= 3)
        return make(UpdateNotice::Failed,
                    QStringLiteral("Software update to %1 failed").arg(w[2]),
                    QStringLiteral("The unit is still running its current software."),
                    status);
    return UpdateNotice();
}

/* APU controller (STM32) flash from the agent's own flash task. */
static UpdateNotice fromApu(const QString &state, int pct)
{
    if (state == QLatin1String("flashing")) {
        pct = qBound(0, pct, 100);
        UpdateNotice n = make(UpdateNotice::Busy, QStringLiteral("Updating APU controller"),
                              QStringLiteral("%1% complete").arg(pct));
        n.progress = pct;
        return n;
    }
    if (state == QLatin1String("failed"))
        return make(UpdateNotice::Failed, QStringLiteral("APU controller update failed"),
                    QStringLiteral("The APU is still running its previous firmware."),
                    QStringLiteral("apu-failed"));
    return UpdateNotice();
}

UpdateNotice describeUpdate(const QString &otaStatus, const QString &apuFlashState, int apuFlashPct)
{
    const UpdateNotice ota = fromOta(otaStatus);
    const UpdateNotice apu = fromApu(apuFlashState, apuFlashPct);

    // Something in progress beats an old failure; the system update beats the APU.
    if (ota.kind == UpdateNotice::Busy) return ota;
    if (apu.kind == UpdateNotice::Busy) return apu;
    if (ota.kind == UpdateNotice::Failed) return ota;
    return apu;
}
