#include "ota_fetch.h"

#include <pthread.h>
#include <string.h>

enum { SLOT_IDLE, SLOT_RUNNING, SLOT_DONE };

static pthread_mutex_t    s_mu = PTHREAD_MUTEX_INITIALIZER;
static int                s_slot = SLOT_IDLE;
static ota_fetch_fn       s_fn;
static ota_fetch_result_t s_result;

static void *worker(void *arg)
{
    (void)arg;
    static ota_fetch_result_t r;   /* only this thread writes it while RUNNING */
    memset(&r, 0, sizeof r);
    s_fn(&r);
    pthread_mutex_lock(&s_mu);
    s_result = r;
    s_slot = SLOT_DONE;
    pthread_mutex_unlock(&s_mu);
    return NULL;
}

bool ota_fetch_start(ota_fetch_fn fn)
{
    if (!fn) return false;
    pthread_mutex_lock(&s_mu);
    if (s_slot != SLOT_IDLE) {
        pthread_mutex_unlock(&s_mu);
        return false;
    }
    s_fn = fn;
    s_slot = SLOT_RUNNING;
    pthread_mutex_unlock(&s_mu);

    pthread_attr_t attr;
    pthread_t th;
    bool ok = pthread_attr_init(&attr) == 0;
    if (ok) {
        pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
        ok = pthread_create(&th, &attr, worker, NULL) == 0;
        pthread_attr_destroy(&attr);
    }
    if (!ok) {
        pthread_mutex_lock(&s_mu);
        s_slot = SLOT_IDLE;
        pthread_mutex_unlock(&s_mu);
    }
    return ok;
}

bool ota_fetch_take(ota_fetch_result_t *out)
{
    bool done = false;
    pthread_mutex_lock(&s_mu);
    if (s_slot == SLOT_DONE) {
        if (out) *out = s_result;
        s_slot = SLOT_IDLE;
        done = true;
    }
    pthread_mutex_unlock(&s_mu);
    return done;
}

bool ota_fetch_busy(void)
{
    pthread_mutex_lock(&s_mu);
    bool busy = s_slot != SLOT_IDLE;
    pthread_mutex_unlock(&s_mu);
    return busy;
}
