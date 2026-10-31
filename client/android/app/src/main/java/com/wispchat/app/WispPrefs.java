package com.wispchat.app;

import android.content.Context;
import android.content.SharedPreferences;

/** Small on-device store the native side needs even when the web app isn't running. */
public final class WispPrefs {
    private static final String FILE = "wisp_native";
    private WispPrefs() {}

    private static SharedPreferences sp(Context c) {
        return c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public static void setSession(Context c, String token, String apiBase) {
        sp(c).edit().putString("token", token).putString("apiBase", trimSlash(apiBase)).apply();
    }

    public static void clearSession(Context c) {
        sp(c).edit().remove("token").apply();
    }

    public static String token(Context c) { return sp(c).getString("token", null); }
    public static String apiBase(Context c) { return sp(c).getString("apiBase", null); }

    public static void setPushToken(Context c, String t) { sp(c).edit().putString("pushToken", t).apply(); }
    public static String pushToken(Context c) { return sp(c).getString("pushToken", null); }

    public static void setActiveConversation(Context c, String id) {
        sp(c).edit().putString("activeConversation", id == null ? "" : id).apply();
    }
    public static String activeConversation(Context c) { return sp(c).getString("activeConversation", ""); }

    /** "Stay connected in the background" — the Firebase-free notification path. On by default. */
    public static boolean backgroundEnabled(Context c) { return sp(c).getBoolean("bgEnabled", true); }
    public static void setBackgroundEnabled(Context c, boolean on) { sp(c).edit().putBoolean("bgEnabled", on).apply(); }

    private static String trimSlash(String s) {
        if (s == null) return null;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }
}
