#pragma once

#include <QJsonValue>
#include <QString>

// Merge one key into the agent's command file (atomic). Merging — rather than
// overwriting — lets several quick commands accumulate before the agent consumes
// the file.
void mergeCommandKey(const QString &path, const QString &key, const QJsonValue &value);
