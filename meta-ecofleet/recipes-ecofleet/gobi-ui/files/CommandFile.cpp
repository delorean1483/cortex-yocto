#include "CommandFile.h"

#include <QFile>
#include <QSaveFile>
#include <QJsonDocument>
#include <QJsonObject>

/* Merge one key into command.json (atomic). Merging — rather than overwriting —
 * lets several quick taps (e.g. temp then mode) accumulate before the agent
 * consumes the file on its next cycle. */
void mergeCommandKey(const QString &path, const QString &key, const QJsonValue &value)
{
    QJsonObject obj;
    QFile in(path);
    if (in.open(QIODevice::ReadOnly)) {
        const auto doc = QJsonDocument::fromJson(in.readAll());
        if (doc.isObject()) obj = doc.object();
        in.close();
    }
    obj.insert(key, value);

    QSaveFile out(path);
    if (out.open(QIODevice::WriteOnly)) {
        out.write(QJsonDocument(obj).toJson(QJsonDocument::Compact));
        out.commit();   /* atomic rename */
    }
}
