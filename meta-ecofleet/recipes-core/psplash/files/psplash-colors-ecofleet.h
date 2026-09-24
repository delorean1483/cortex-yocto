/*
 *  EcoFleet psplash colours — match gobi-ui's Theme.qml (bg / textMute /
 *  accent / surface2) so the boot splash hands off seamlessly to the
 *  Weston background and gobi-ui's own splash (SplashArt.qml).
 *
 *  SPDX-License-Identifier: GPL-2.0-or-later
 */

#ifndef _HAVE_PSPLASH_COLORS_H
#define _HAVE_PSPLASH_COLORS_H

/* This is the overall background color */
#define PSPLASH_BACKGROUND_COLOR 0x0e,0x11,0x16

/* This is the color of any text output */
#define PSPLASH_TEXT_COLOR 0x9a,0xa4,0xb0

/* This is the color of the progress bar indicator */
#define PSPLASH_BAR_COLOR 0x00,0xc4,0x9a

/* This is the color of the progress bar background */
#define PSPLASH_BAR_BACKGROUND_COLOR 0x26,0x2c,0x36

#endif
