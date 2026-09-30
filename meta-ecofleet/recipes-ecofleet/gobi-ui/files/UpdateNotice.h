#pragma once

#include <QString>

/* What the screen should say about a firmware update, derived from the agent's
 * latest.json: `ota_status` (the root OTA worker's line — "downloading 1.2.67",
 * "installing 1.2.67", "success 1.2.67", "failed: ..." or "idle") and the APU
 * controller flash state/percent ("idle" | "flashing" | "done" | "failed").
 *
 *   Busy   → full-screen "don't power off" overlay
 *   Failed → dismissible banner; `key` identifies the failure so a dismissal
 *            sticks until a different failure appears
 *
 * `progress` is 0-100 when the source reports a real percentage (APU flash),
 * else -1 (system update reports phases only → indeterminate bar).
 *
 * Unrecognised status lines map to None: never block the screen on a guess. */
struct UpdateNotice
{
    enum Kind { None, Busy, Failed };
    Kind    kind = None;
    QString title;
    QString detail;
    QString key;
    int     progress = -1;
};

UpdateNotice describeUpdate(const QString &otaStatus, const QString &apuFlashState, int apuFlashPct);
