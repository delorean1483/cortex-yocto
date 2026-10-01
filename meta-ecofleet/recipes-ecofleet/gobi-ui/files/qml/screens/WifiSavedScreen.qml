import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import ".."
import "../atoms"
// Networks this unit remembers; Forget removes one (the in-use one disconnects).
Item {
    id: page
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 14; spacing: 10
        ScreenHeader { title: "Saved networks"; onBack: if (page.StackView.view) page.StackView.view.pop() }
        Item {
            Layout.fillWidth: true; Layout.fillHeight: true
            ListView { id: savedList; anchors.fill: parent; clip: true; spacing: 6
            model: wifi.saved
            delegate: Rectangle {
                width: ListView.view.width; height: 52; radius: Theme.radiusSm
                color: modelData.inUse ? Theme.tint(Theme.accent, 0.12) : Theme.surface
                border.color: modelData.inUse ? Theme.accent : "transparent"; border.width: 1
                RowLayout { anchors.fill: parent; anchors.leftMargin: 14; anchors.rightMargin: 8; spacing: 12
                    Icon { name: "wifi"; size: 22; color: modelData.inUse ? Theme.accent : Theme.textMute }
                    Text { Layout.fillWidth: true; elide: Text.ElideRight; text: modelData.ssid; textFormat: Text.PlainText
                        color: Theme.text; font.pixelSize: Theme.fsBody }
                    Text { visible: modelData.inUse; text: "✓ In use"; color: Theme.accent
                        font.pixelSize: Theme.fsLabel; font.weight: Font.DemiBold }
                    ConfirmButton { onConfirmed: wifi.forget(modelData.id) } }
            }
            }
            Text { anchors.centerIn: parent; visible: savedList.count === 0; text: "No saved networks"
                color: Theme.textMute; font.pixelSize: Theme.fsBody }
        }
    }
}
