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

struct ScanEntry { QString bssid; int freq = 0; int signal = 0; QString flags; QString ssid; };
struct SavedNet  { int id = -1; QString ssid; bool current = false; };
struct Event     { enum Type { Other, Connected, Disconnected, WrongKey, ScanResults }; Type type = Other; int id = -1; };
enum class Internet { Unknown, Online, NoInternet, Portal };

QString decodeSsid(const QByteArray &escaped);
QList<ScanEntry> parseScanResults(const QByteArray &reply);
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
