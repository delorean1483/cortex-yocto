#include "LedColor.h"

#include <cmath>

namespace ledcolor {

static int toByte(double v)
{
    if (v < 0.0) v = 0.0;
    if (v > 1.0) v = 1.0;
    return static_cast<int>(std::floor(v * 255.0 + 0.5));
}

Rgb hsvToRgb(double hueDeg, double sat, double val)
{
    double h = std::fmod(hueDeg, 360.0);
    if (h < 0.0) h += 360.0;
    if (sat < 0.0) sat = 0.0;
    if (sat > 1.0) sat = 1.0;
    if (val < 0.0) val = 0.0;
    if (val > 1.0) val = 1.0;

    const double c = val * sat;
    const double hp = h / 60.0;
    const double x = c * (1.0 - std::fabs(std::fmod(hp, 2.0) - 1.0));
    double r = 0, g = 0, b = 0;
    switch (static_cast<int>(hp)) {
    case 0:  r = c; g = x; break;
    case 1:  r = x; g = c; break;
    case 2:  g = c; b = x; break;
    case 3:  g = x; b = c; break;
    case 4:  r = x; b = c; break;
    default: r = c; b = x; break;
    }
    const double m = val - c;
    return { toByte(r + m), toByte(g + m), toByte(b + m) };
}

double hueFromPoint(double dx, double dy, double prevHue)
{
    if (dx == 0.0 && dy == 0.0) return prevHue;
    const double kPi = 3.14159265358979323846;
    double deg = std::atan2(dx, -dy) * 180.0 / kPi;
    if (deg < 0.0) deg += 360.0;
    if (deg >= 360.0) deg -= 360.0;
    return deg;
}

double satFromPoint(double dx, double dy, double radius)
{
    if (radius <= 0.0) return 0.0;
    const double s = std::hypot(dx, dy) / radius;
    return s > 1.0 ? 1.0 : s;
}

} // namespace ledcolor
