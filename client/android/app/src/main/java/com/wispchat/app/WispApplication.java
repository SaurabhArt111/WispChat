package com.wispchat.app;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;

/**
 * Creates the notification channels once and tracks whether the chat UI is on
 * screen, so a push for a message / call the person is already looking at
 * isn't shown a second time.
 */
public class WispApplication extends Application {
    private static volatile int startedMainActivities = 0;

    /** True while MainActivity (the chat UI) is visible. */
    public static boolean isForeground() { return startedMainActivities > 0; }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationHelper.createChannels(this);
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override public void onActivityStarted(Activity a) { if (a instanceof MainActivity) startedMainActivities++; }
            @Override public void onActivityStopped(Activity a) { if (a instanceof MainActivity && startedMainActivities > 0) startedMainActivities--; }
            @Override public void onActivityCreated(Activity a, Bundle b) {}
            @Override public void onActivityResumed(Activity a) {}
            @Override public void onActivityPaused(Activity a) {}
            @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
            @Override public void onActivityDestroyed(Activity a) {}
        });
    }
}
