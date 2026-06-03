#pragma once

#include <QObject>
#include <QString>
#include <QTimer>

class DeviceInfoModel : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString serial     READ serial     CONSTANT)
    Q_PROPERTY(QString hostname   READ hostname   CONSTANT)
    Q_PROPERTY(QString fwVersion  READ fwVersion  CONSTANT)
    Q_PROPERTY(QString ipAddress  READ ipAddress  NOTIFY networkChanged)
    Q_PROPERTY(QString macAddress READ macAddress NOTIFY networkChanged)
    Q_PROPERTY(bool    ethLinked  READ ethLinked  NOTIFY networkChanged)

public:
    explicit DeviceInfoModel(QObject *parent = nullptr);

    QString serial()     const { return m_serial; }
    QString hostname()   const { return m_hostname; }
    QString fwVersion()  const { return m_fw; }
    QString ipAddress()  const { return m_ip; }
    QString macAddress() const { return m_mac; }
    bool    ethLinked()  const { return m_linked; }

signals:
    void networkChanged();

private slots:
    void refreshNetwork();

private:
    static QString readFirstLine(const QString &path);
    static QString parseOsRelease(const QString &key);

    QTimer  *m_timer  = nullptr;
    QString  m_serial;
    QString  m_hostname;
    QString  m_fw;
    QString  m_ip;
    QString  m_mac;
    bool     m_linked = false;
};
