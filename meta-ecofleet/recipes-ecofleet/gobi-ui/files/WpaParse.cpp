#include "WpaParse.h"

#include <QCryptographicHash>
#include <QPasswordDigestor>
#include <QRegularExpression>
#include <QVariantMap>
#include <algorithm>

namespace wpa {

static int hexVal(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/* Inverse of wpa_supplicant's printf_encode(): \\ \" \e \n \r \t and \xhh. */
QString decodeSsid(const QByteArray &in)
{
    QByteArray out;
    for (int i = 0; i < in.size(); ++i) {
        const char c = in[i];
        if (c != '\\' || i + 1 >= in.size()) { out += c; continue; }
        const char n = in[++i];
        switch (n) {
        case '\\': out += '\\'; break;
        case '"':  out += '"';  break;
        case 'n':  out += '\n'; break;
        case 'r':  out += '\r'; break;
        case 't':  out += '\t'; break;
        case 'e':  out += '\033'; break;
        case 'x':
            if (i + 2 < in.size() && hexVal(in[i + 1]) >= 0 && hexVal(in[i + 2]) >= 0) {
                out += char(hexVal(in[i + 1]) * 16 + hexVal(in[i + 2]));
                i += 2;
            } else {
                out += "\\x";
            }
            break;
        default: out += '\\'; out += n; break;
        }
    }
    return QString::fromUtf8(out);
}

/* Data lines of a tab-separated table reply (header line skipped). */
static QList<QByteArrayList> tableRows(const QByteArray &reply)
{
    QList<QByteArrayList> rows;
    const QByteArrayList lines = reply.split('\n');
    for (int i = 1; i < lines.size(); ++i) {
        if (lines[i].isEmpty()) continue;
        rows << lines[i].split('\t');
    }
    return rows;
}

QList<ScanEntry> parseScanResults(const QByteArray &reply)
{
    QList<ScanEntry> out;
    for (const QByteArrayList &f : tableRows(reply)) {
        if (f.size() < 4) continue;
        ScanEntry e;
        e.bssid  = QString::fromLatin1(f[0]);
        e.freq   = f[1].toInt();
        e.signal = f[2].toInt();
        e.flags  = QString::fromLatin1(f[3]);
        e.ssid   = f.size() > 4 ? decodeSsid(f[4]) : QString();
        out << e;
    }
    return out;
}

QList<SavedNet> parseListNetworks(const QByteArray &reply)
{
    QList<SavedNet> out;
    for (const QByteArrayList &f : tableRows(reply)) {
        if (f.size() < 2) continue;
        SavedNet n;
        n.id = f[0].toInt();
        n.ssid = decodeSsid(f[1]);
        n.current = f.size() > 3 && f[3].contains("[CURRENT]");
        out << n;
    }
    return out;
}

QMap<QString, QString> parseKeyValues(const QByteArray &reply)
{
    QMap<QString, QString> kv;
    for (const QByteArray &line : reply.split('\n')) {
        const int eq = line.indexOf('=');
        if (eq <= 0) continue;
        const QString key = QString::fromLatin1(line.left(eq));
        const QByteArray val = line.mid(eq + 1);
        kv.insert(key, key == QLatin1String("ssid") ? decodeSsid(val) : QString::fromUtf8(val));
    }
    return kv;
}

static int intField(const QByteArray &line, const char *pattern)
{
    const QRegularExpression re(QString::fromLatin1(pattern));
    const auto m = re.match(QString::fromLatin1(line));
    return m.hasMatch() ? m.captured(1).toInt() : -1;
}

Event parseEvent(const QByteArray &line)
{
    Event e;
    if (line.startsWith("CTRL-EVENT-CONNECTED")) {
        e.type = Event::Connected;
        e.id = intField(line, "\\[id=(\\d+)");
    } else if (line.startsWith("CTRL-EVENT-DISCONNECTED")) {
        e.type = Event::Disconnected;
    } else if (line.startsWith("CTRL-EVENT-SSID-TEMP-DISABLED") && line.contains("reason=WRONG_KEY")) {
        e.type = Event::WrongKey;
        e.id = intField(line, "\\bid=(\\d+)");
    } else if (line.startsWith("CTRL-EVENT-SCAN-RESULTS")) {
        e.type = Event::ScanResults;
    }
    return e;
}

int signalBars(int dbm)
{
    if (dbm >= -55) return 4;
    if (dbm >= -65) return 3;
    if (dbm >= -75) return 2;
    if (dbm >= -85) return 1;
    return 0;
}

bool isSecured(const QString &flags)
{
    return flags.contains(QLatin1String("WPA")) || flags.contains(QLatin1String("RSN"))
        || flags.contains(QLatin1String("WEP")) || flags.contains(QLatin1String("SAE"));
}

bool isSupported(const QString &flags)
{
    if (!isSecured(flags)) return true;                       // open
    // Check for any PSK variant: -PSK (standard), /PSK (FT), +PSK (combined)
    return flags.contains(QLatin1String("-PSK")) || flags.contains(QLatin1String("/PSK"))
        || flags.contains(QLatin1String("+PSK"));
}

QByteArray ssidHex(const QString &ssid) { return ssid.toUtf8().toHex(); }

QByteArray pskHex(const QString &password, const QString &ssid)
{
    return QPasswordDigestor::deriveKeyPbkdf2(QCryptographicHash::Sha1, password.toLatin1(),
                                              ssid.toUtf8(), 4096, 32).toHex();
}

QString validateSsid(const QString &ssid)
{
    const int n = ssid.toUtf8().size();
    if (n == 0) return QStringLiteral("Enter the network name.");
    if (n > 32) return QStringLiteral("Network name is too long.");
    return QString();
}

QString validatePassword(const QString &pw)
{
    if (pw.size() < 8) return QStringLiteral("Password must be at least 8 characters.");
    if (pw.size() > 63) return QStringLiteral("Password must be 63 characters or fewer.");
    for (const QChar c : pw)
        if (c.unicode() < 0x20 || c.unicode() > 0x7e)
            return QStringLiteral("Password can only use standard keyboard characters.");
    return QString();
}

/* Check if SSID is hidden: empty or consists only of NUL characters. */
static bool isHiddenSsid(const QString &ssid)
{
    if (ssid.isEmpty()) return true;
    for (const QChar c : ssid)
        if (c != QChar(0)) return false;
    return true;
}

QVariantList buildNetworkList(const QList<ScanEntry> &scan, const QList<SavedNet> &saved,
                              const QString &inUseSsid)
{
    // Strongest entry per SSID; hidden (empty or NUL-only) SSIDs dropped.
    QMap<QString, ScanEntry> best;
    for (const ScanEntry &e : scan) {
        if (isHiddenSsid(e.ssid)) continue;
        auto it = best.find(e.ssid);
        if (it == best.end() || e.signal > it->signal) best.insert(e.ssid, e);
    }
    QList<QVariantMap> rows;
    for (const ScanEntry &e : best) {
        int savedId = -1;
        for (const SavedNet &s : saved)
            if (s.ssid == e.ssid) { savedId = s.id; break; }
        QVariantMap m;
        m["ssid"] = e.ssid;
        m["bars"] = signalBars(e.signal);
        m["signal"] = e.signal;
        m["secured"] = isSecured(e.flags);
        m["supported"] = isSupported(e.flags);
        m["saved"] = savedId >= 0;
        m["savedId"] = savedId;
        m["inUse"] = !inUseSsid.isEmpty() && e.ssid == inUseSsid;
        rows << m;
    }
    std::sort(rows.begin(), rows.end(), [](const QVariantMap &a, const QVariantMap &b) {
        if (a["inUse"].toBool() != b["inUse"].toBool()) return a["inUse"].toBool();
        if (a["saved"].toBool() != b["saved"].toBool()) return a["saved"].toBool();
        return a["signal"].toInt() > b["signal"].toInt();
    });
    QVariantList out;
    for (const QVariantMap &m : rows) out << m;
    return out;
}

Internet classifyCheck(int exitCode, const QByteArray &httpCode)
{
    if (exitCode != 0) return Internet::NoInternet;
    return httpCode.trimmed() == "204" ? Internet::Online : Internet::Portal;
}

QString internetName(Internet i)
{
    switch (i) {
    case Internet::Online:     return QStringLiteral("online");
    case Internet::NoInternet: return QStringLiteral("no_internet");
    case Internet::Portal:     return QStringLiteral("portal");
    default:                   return QStringLiteral("unknown");
    }
}

} // namespace wpa
