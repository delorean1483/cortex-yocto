# gobi-ui screenshot runner

Renders every screen headlessly at the native 800x480 canvas with the bundled
Inter font and the mocks in `../Mocks.qml` — no device or image build needed.
Dev tooling only; not installed by the recipe.

```sh
cmake -S . -B /tmp/shots-build -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt
cmake --build /tmp/shots-build
F=<repo>/meta-ecofleet/recipes-ecofleet/gobi-ui/files
QT_QPA_PLATFORM=offscreen QT_QUICK_CONTROLS_STYLE=Basic QT_QUICK_BACKEND=software \
  /tmp/shots-build/shots $F/qml $F/fonts /tmp/shots preview/Shots.qml
```

Args: `<qml dir> <font dir or -> <output dir> <harness path relative to qml dir>`.
Writes one PNG per step in `Shots.qml`; stderr should show only `app font "Inter"`.

Pass `main.qml` as the harness to load the real app window instead: it saves
`window-400ms.png` (boot splash up) and `window-3000ms.png` (Home), then quits.
