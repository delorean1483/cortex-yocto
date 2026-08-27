/* weather.c — pure forecast transforms (see weather.h). No I/O. */
#include "weather.h"

#include <cjson/cJSON.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

weather_cat_t wmo_to_category(int wmo_code)
{
    /* WMO 4677 weather-interpretation codes as returned by Open-Meteo. */
    switch (wmo_code) {
        case 0: case 1:                     return WCAT_CLEAR;   /* clear / mainly clear */
        case 2:                             return WCAT_PARTLY;  /* partly cloudy        */
        case 3:                             return WCAT_CLOUDY;  /* overcast             */
        case 45: case 48:                   return WCAT_FOG;     /* fog / rime fog       */
        case 51: case 53: case 55:                               /* drizzle              */
        case 56: case 57:                                        /* freezing drizzle     */
        case 61: case 63: case 65:                               /* rain                 */
        case 66: case 67:                                        /* freezing rain        */
        case 80: case 81: case 82:          return WCAT_RAIN;    /* rain showers         */
        case 71: case 73: case 75: case 77:                      /* snow / grains        */
        case 85: case 86:                   return WCAT_SNOW;    /* snow showers         */
        case 95: case 96: case 99:          return WCAT_STORM;   /* thunderstorm         */
        default:                            return WCAT_UNKNOWN;
    }
}

const char *weather_cat_slug(weather_cat_t cat)
{
    switch (cat) {
        case WCAT_CLEAR:  return "clear";
        case WCAT_PARTLY: return "partly";
        case WCAT_CLOUDY: return "cloudy";
        case WCAT_FOG:    return "fog";
        case WCAT_RAIN:   return "rain";
        case WCAT_SNOW:   return "snow";
        case WCAT_STORM:  return "storm";
        case WCAT_UNKNOWN:
        default:          return "unknown";
    }
}

const char *weekday_abbrev(const char *iso_date)
{
    static const char *const NAMES[7] = {"Sun","Mon","Tue","Wed","Thu","Fri","Sat"};
    int y, m, d;

    if (!iso_date) return "?";
    if (sscanf(iso_date, "%d-%d-%d", &y, &m, &d) != 3) return "?";
    if (y < 1 || m < 1 || m > 12 || d < 1 || d > 31) return "?";

    /* Sakamoto's method (proleptic Gregorian), 0 = Sunday. No libc time / TZ. */
    static const int t[] = {0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4};
    int yy = y - (m < 3);
    int dow = (yy + yy/4 - yy/100 + yy/400 + t[m - 1] + d) % 7;
    if (dow < 0) dow += 7;
    return NAMES[dow];
}

static int arr_len(const cJSON *a)
{
    return cJSON_IsArray(a) ? cJSON_GetArraySize(a) : -1;
}

char *weather_build_json(const char *open_meteo_json,
                         const char *location_label,
                         long long fetched_ts_ms,
                         int max_days)
{
    if (!open_meteo_json) return NULL;

    cJSON *in = cJSON_Parse(open_meteo_json);
    if (!in) return NULL;

    cJSON *daily = cJSON_GetObjectItemCaseSensitive(in, "daily");
    cJSON *time  = cJSON_GetObjectItemCaseSensitive(daily, "time");
    cJSON *code  = cJSON_GetObjectItemCaseSensitive(daily, "weather_code");
    cJSON *tmax  = cJSON_GetObjectItemCaseSensitive(daily, "temperature_2m_max");
    cJSON *tmin  = cJSON_GetObjectItemCaseSensitive(daily, "temperature_2m_min");
    cJSON *pprob = cJSON_GetObjectItemCaseSensitive(daily, "precipitation_probability_max");

    int n = arr_len(time);
    if (n <= 0 || arr_len(code) < n || arr_len(tmax) < n || arr_len(tmin) < n) {
        cJSON_Delete(in);
        return NULL;   /* not a usable daily forecast */
    }
    if (max_days > 0 && n > max_days) n = max_days;

    cJSON *out  = cJSON_CreateObject();
    cJSON_AddNumberToObject(out, "fetched_ts", (double)fetched_ts_ms);
    if (location_label && location_label[0])
        cJSON_AddStringToObject(out, "location", location_label);
    cJSON *days = cJSON_AddArrayToObject(out, "days");

    for (int i = 0; i < n; i++) {
        const char *date = cJSON_GetStringValue(cJSON_GetArrayItem(time, i));
        if (!date) continue;

        int    wcode = (int)cJSON_GetNumberValue(cJSON_GetArrayItem(code, i));
        double hi    = cJSON_GetNumberValue(cJSON_GetArrayItem(tmax, i));
        double lo    = cJSON_GetNumberValue(cJSON_GetArrayItem(tmin, i));

        int precip = 0;   /* Open-Meteo may send null when unavailable */
        if (pprob) {
            cJSON *p = cJSON_GetArrayItem(pprob, i);
            if (cJSON_IsNumber(p)) precip = (int)lround(cJSON_GetNumberValue(p));
        }

        cJSON *day = cJSON_CreateObject();
        cJSON_AddStringToObject(day, "date",       date);
        cJSON_AddStringToObject(day, "label",      weekday_abbrev(date));
        cJSON_AddNumberToObject(day, "hi_f",       (double)lround(hi));
        cJSON_AddNumberToObject(day, "lo_f",       (double)lround(lo));
        cJSON_AddNumberToObject(day, "code",       wcode);
        cJSON_AddStringToObject(day, "cat",        weather_cat_slug(wmo_to_category(wcode)));
        cJSON_AddNumberToObject(day, "precip_pct", precip);
        cJSON_AddItemToArray(days, day);
    }

    char *result = cJSON_PrintUnformatted(out);
    cJSON_Delete(out);
    cJSON_Delete(in);
    return result;
}
