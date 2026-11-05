// Color math for the external LED color wheel. Plain C++, no Qt.
#pragma once

namespace ledcolor {

struct Rgb { int r, g, b; };

// hueDeg in degrees (any value, normalized into [0,360)); sat, val in 0..1.
// Result channels are rounded (half up) to 0..255.
Rgb hsvToRgb(double hueDeg, double sat, double val);

// Hue of a point relative to the wheel center. dx grows right, dy grows down.
// 12 o'clock = 0, clockwise. The exact center returns prevHue.
double hueFromPoint(double dx, double dy, double prevHue);

// Distance from center divided by radius, capped at 1.
double satFromPoint(double dx, double dy, double radius);

} // namespace ledcolor
