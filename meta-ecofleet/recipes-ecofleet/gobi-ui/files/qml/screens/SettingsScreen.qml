import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: Theme.gap
        ScreenHeader { title: "Settings"; onBack: if (page.StackView.view) page.StackView.view.pop() }

        InfoCard { Layout.fillWidth: true
            title: "About this unit"
            rows: [ {k: "Firmware", v: devinfo.fwVersion},
                    {k: "Serial",   v: devinfo.serial},
                    {k: "Hostname", v: devinfo.hostname} ] }
        Item { Layout.fillHeight: true }
    }
}
