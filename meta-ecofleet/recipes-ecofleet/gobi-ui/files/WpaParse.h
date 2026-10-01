#pragma once

#include <QByteArray>
#include <QList>
#include <QMap>
#include <QString>
#include <QVariantList>

/* Pure helpers for talking to wpa_supplicant's control interface: parsing its
 * text replies and events, hashing WPA2 keys exactly like wpa_passphrase,
 * validating input, and merging scan + saved networks into the list the WiFi
 * screen shows. No I/O here, so all of it is host-testable. */
namespace wpa {

/* One BSS. id/ok are set by parseBss (id = wpa_supplicant's BSS-table id, used
 * to page with BSS NEXT-<id>; ok = false past the end of the table). */
struct ScanEntry { QString bssid; int freq = 0; int signal = 0; QString flags; QString ssid;
                   int id = -1; bool ok = false; };
struct SavedNet  { int id = -1; QString ssid; bool current = false; };
struct Event     { enum Type { Other, Connected, Disconnected, WrongKey, ScanResults }; Type type = Other; int id = -1; };
enum class Internet { Unknown, Online, NoInternet, Portal };

QString decodeSsid(const QByteArray &escaped);
/* Fields the WiFi list needs from BSS: id 0x1, bssid 0x2, freq 0x4, level 0x80,
 * flags 0x800, ssid 0x1000 (WPA_BSS_MASK_*; each bit checked against
 * wpa_supplicant 2.10 on the unit). One small reply per BSS, unlike
 * SCAN_RESULTS, which is cut off at ~4 KB on busy sites. */
inline constexpr const char *kBssMask = "MASK=0x1887";
ScanEntry parseBss(const QByteArray &reply);
QList<SavedNet> parseListNetworks(const QByteArray &reply);
QMap<QString, QString> parseKeyValues(const QByteArray &reply);
Event parseEvent(const QByteArray &line);

int signalBars(int rssiDbm);
bool isSecured(const QString &flags);
bool isSupported(const QString &flags);

QByteArray ssidHex(const QString &ssid);
QByteArray pskHex(const QString &password, const QString &ssid);
QString validateSsid(const QString &ssid);
QString validatePassword(const QString &password);

QVariantList buildNetworkList(const QList<ScanEntry> &scan, const QList<SavedNet> &saved,
                              const QString &inUseSsid);

Internet classifyCheck(int exitCode, const QByteArray &httpCode);
QString internetName(Internet i);

} // namespace wpa
