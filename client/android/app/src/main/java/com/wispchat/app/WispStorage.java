package com.wispchat.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.os.Build;
import android.os.Environment;
import android.webkit.MimeTypeMap;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The WispChat folder on the phone — laid out like WhatsApp's:
 *
 *   Android/media/com.wispchat.app/WispChat/
 *     Media/
 *       WispChat Images/  (+ Sent/)      WispChat Video/  (+ Sent/)
 *       WispChat Audio/   (+ Sent/)      WispChat Voice Notes/
 *       WispChat Documents/ (+ Sent/)    WispChat Animated Gifs/
 *       WispChat Stickers/               WispChat Profile Photos/   WispChat Status/
 *     Databases/   (call history, chat index)
 *     Backups/     (chat backups you can copy off the phone)
 *
 * Android 10+ forbids apps from creating arbitrary top-level folders in shared
 * storage ("scoped storage"). Android/media/<package>/ is the sanctioned
 * location: it needs NO storage permission, is visible in every file manager
 * and the gallery picks up images/videos in it. On Android 9 and older the
 * folder is created at the top level (/WispChat) like old WhatsApp did.
 */
public final class WispStorage {
    public static final String ROOT_NAME = "WispChat";
    private static final String[] MEDIA_DIRS = {
            "WispChat Images", "WispChat Video", "WispChat Audio", "WispChat Voice Notes",
            "WispChat Documents", "WispChat Animated Gifs", "WispChat Stickers",
            "WispChat Profile Photos", "WispChat Status"
    };
    private static final String[] WITH_SENT = { "WispChat Images", "WispChat Video", "WispChat Audio", "WispChat Documents" };
    private static final String[] HIDDEN_FROM_GALLERY = { "WispChat Stickers", "WispChat Profile Photos", "WispChat Status", "WispChat Voice Notes" };

    private WispStorage() {}

    // ----------------------------------------------------------------- root

    @SuppressWarnings("deprecation")
    public static File root(Context ctx) {
        File base = null;
        if (Build.VERSION.SDK_INT <= 28
                && ctx.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                && Environment.MEDIA_MOUNTED.equals(Environment.getExternalStorageState())) {
            base = Environment.getExternalStorageDirectory();
        } else {
            File[] media = ctx.getExternalMediaDirs();
            if (media != null && media.length > 0 && media[0] != null) base = media[0];
        }
        if (base == null) base = ctx.getExternalFilesDir(null); // no shared storage at all (rare)
        if (base == null) base = ctx.getFilesDir();
        return new File(base, ROOT_NAME);
    }

    /** Creates the whole tree (idempotent). Returns the root. */
    public static File ensure(Context ctx) {
        File root = root(ctx);
        File media = new File(root, "Media");
        mkdir(media);
        for (String d : MEDIA_DIRS) mkdir(new File(media, d));
        for (String d : WITH_SENT) mkdir(new File(new File(media, d), "Sent"));
        for (String d : HIDDEN_FROM_GALLERY) touch(new File(new File(media, d), ".nomedia"));
        mkdir(new File(root, "Databases"));
        mkdir(new File(root, "Backups"));
        return root;
    }

    // ------------------------------------------------------- saving media

    /** Folder for an attachment kind. kind = image|video|audio|voice|file|gif|sticker|profile|status */
    public static File dirFor(Context ctx, String kind, boolean sent) {
        String name;
        switch (kind == null ? "file" : kind) {
            case "image": name = "WispChat Images"; break;
            case "video": name = "WispChat Video"; break;
            case "audio": name = "WispChat Audio"; break;
            case "voice": name = "WispChat Voice Notes"; break;
            case "gif": name = "WispChat Animated Gifs"; break;
            case "sticker": name = "WispChat Stickers"; break;
            case "profile": name = "WispChat Profile Photos"; break;
            case "status": name = "WispChat Status"; break;
            default: name = "WispChat Documents";
        }
        File dir = new File(new File(ensure(ctx), "Media"), name);
        boolean hasSent = false;
        for (String s : WITH_SENT) if (s.equals(name)) hasSent = true;
        return sent && hasSent ? new File(dir, "Sent") : dir;
    }

    private static String prefix(String kind) {
        switch (kind == null ? "file" : kind) {
            case "image": return "IMG";
            case "video": return "VID";
            case "audio": return "AUD";
            case "voice": return "PTT";
            case "gif": return "GIF";
            case "sticker": return "STK";
            case "profile": return "PRF";
            default: return "DOC";
        }
    }

    /** IMG-20260131-WC0007.jpg style for photos/video/audio; original name (made unique) for documents. */
    public static File targetFile(Context ctx, String kind, boolean sent, String originalName, String mime) {
        File dir = dirFor(ctx, kind, sent);
        String ext = extensionOf(originalName, mime);
        String safeOriginal = sanitize(originalName);
        if ("file".equals(kind) && !safeOriginal.isEmpty()) return unique(dir, stripExt(safeOriginal), ext);
        String stamp = new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date());
        String base = prefix(kind) + "-" + stamp + "-WC";
        for (int i = 1; i < 100000; i++) {
            File f = new File(dir, base + String.format(Locale.US, "%04d", i) + (ext.isEmpty() ? "" : "." + ext));
            if (!f.exists()) return f;
        }
        return new File(dir, base + System.currentTimeMillis() + "." + ext);
    }

    private static File unique(File dir, String base, String ext) {
        String suffix = ext.isEmpty() ? "" : "." + ext;
        File f = new File(dir, base + suffix);
        for (int i = 1; f.exists() && i < 10000; i++) f = new File(dir, base + " (" + i + ")" + suffix);
        return f;
    }

    /** key (e.g. the attachment URL) -> saved path, so the same file is never stored twice. */
    private static SharedPreferences index(Context c) {
        return c.getApplicationContext().getSharedPreferences("wisp_media_index", Context.MODE_PRIVATE);
    }

    public static String lookup(Context ctx, String key) {
        if (key == null) return null;
        String path = index(ctx).getString(key, null);
        return path != null && new File(path).exists() ? path : null;
    }

    private static File partFile(Context ctx, String key) {
        File dir = new File(ctx.getCacheDir(), "wisp-parts");
        mkdir(dir);
        return new File(dir, Integer.toHexString(key.hashCode()) + ".part");
    }

    /**
     * Append one base64 chunk of a file being saved. On the last chunk the part
     * file is moved into the right WispChat folder and indexed. Returns the final
     * path on the last chunk, otherwise null.
     */
    public static String saveChunk(Context ctx, String key, String kind, boolean sent, String name, String mime,
                                   byte[] bytes, boolean first, boolean last) throws IOException {
        File part = partFile(ctx, key);
        try (FileOutputStream out = new FileOutputStream(part, !first)) { out.write(bytes); }
        if (!last) return null;
        File dest = targetFile(ctx, kind, sent, name, mime);
        if (!part.renameTo(dest)) { copy(part, dest); //noinspection ResultOfMethodCallIgnored
            part.delete(); }
        finishSaved(ctx, key, dest, mime);
        return dest.getAbsolutePath();
    }

    /** Download a (public) URL straight into the folder. Blocking — run off the main thread. */
    public static String saveFromUrl(Context ctx, String url, String key, String kind, boolean sent, String name, String mime) throws IOException {
        String existing = lookup(ctx, key);
        if (existing != null) return existing;
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        try {
            if (c.getResponseCode() / 100 != 2) throw new IOException("HTTP " + c.getResponseCode());
            if (mime == null || mime.isEmpty()) mime = c.getContentType();
            File part = partFile(ctx, key);
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            File dest = targetFile(ctx, kind, sent, name, mime);
            if (!part.renameTo(dest)) { copy(part, dest); //noinspection ResultOfMethodCallIgnored
                part.delete(); }
            finishSaved(ctx, key, dest, mime);
            return dest.getAbsolutePath();
        } finally {
            c.disconnect();
        }
    }

    private static void finishSaved(Context ctx, String key, File dest, String mime) {
        index(ctx).edit().putString(key, dest.getAbsolutePath()).apply();
        // Make photos / videos / music show up in the gallery and music apps.
        MediaScannerConnection.scanFile(ctx, new String[] { dest.getAbsolutePath() }, new String[] { mime }, null);
    }

    // ------------------------------------------------------ text files (DB / backups)

    public static File textDir(Context ctx, String dir) {
        if (!"Databases".equals(dir) && !"Backups".equals(dir)) throw new IllegalArgumentException("Unknown folder");
        File d = new File(ensure(ctx), dir);
        mkdir(d);
        return d;
    }

    public static void writeText(Context ctx, String dir, String name, String content) throws IOException {
        File f = new File(textDir(ctx, dir), sanitize(name));
        File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(content.getBytes(StandardCharsets.UTF_8)); }
        if (f.exists() && !f.delete()) throw new IOException("Couldn't replace " + f.getName());
        if (!tmp.renameTo(f)) throw new IOException("Couldn't write " + f.getName());
    }

    public static String readText(Context ctx, String dir, String name) throws IOException {
        File f = new File(textDir(ctx, dir), sanitize(name));
        try (InputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[32 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    public static JSONArray listFiles(Context ctx, String dir) throws JSONException {
        JSONArray arr = new JSONArray();
        File[] files = textDir(ctx, dir).listFiles();
        if (files == null) return arr;
        java.util.Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (File f : files) {
            if (!f.isFile() || f.getName().startsWith(".") || f.getName().endsWith(".tmp")) continue;
            arr.put(new JSONObject().put("name", f.getName()).put("bytes", f.length()).put("modified", f.lastModified()));
        }
        return arr;
    }

    // ---------------------------------------------------------------- info

    public static JSONObject info(Context ctx) throws JSONException {
        File root = ensure(ctx);
        JSONObject out = new JSONObject().put("root", root.getAbsolutePath());
        JSONArray folders = new JSONArray();
        File media = new File(root, "Media");
        for (String d : MEDIA_DIRS) folders.put(folderInfo(new File(media, d), d));
        folders.put(folderInfo(new File(root, "Databases"), "Databases"));
        folders.put(folderInfo(new File(root, "Backups"), "Backups"));
        out.put("folders", folders);
        return out;
    }

    private static JSONObject folderInfo(File dir, String name) throws JSONException {
        long[] t = new long[2];
        walk(dir, t);
        return new JSONObject().put("name", name).put("path", dir.getAbsolutePath()).put("files", t[0]).put("bytes", t[1]);
    }

    private static void walk(File dir, long[] totals) {
        File[] kids = dir.listFiles();
        if (kids == null) return;
        for (File k : kids) {
            if (k.isDirectory()) walk(k, totals);
            else if (!k.getName().startsWith(".")) { totals[0]++; totals[1] += k.length(); }
        }
    }

    // ------------------------------------------------------------- helpers

    public static String mimeOf(File f) {
        String ext = MimeTypeMap.getFileExtensionFromUrl(f.getName());
        String m = ext == null ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase(Locale.ROOT));
        return m == null ? "*/*" : m;
    }

    /** True only for files that live inside the WispChat folder (guards open/share). */
    public static boolean isInsideRoot(Context ctx, File f) {
        try {
            return f.getCanonicalPath().startsWith(root(ctx).getCanonicalPath() + File.separator);
        } catch (IOException e) {
            return false;
        }
    }

    private static String extensionOf(String name, String mime) {
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot > 0 && dot < name.length() - 1 && name.length() - dot <= 8) return name.substring(dot + 1).toLowerCase(Locale.ROOT);
        }
        if (mime != null) {
            String e = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime.split(";")[0].trim());
            if (e != null) return e;
        }
        return "";
    }

    private static String stripExt(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    /** No path separators or control characters ever reach the file system. */
    static String sanitize(String name) {
        if (name == null) return "";
        String s = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (s.startsWith(".")) s = s.substring(1);
        return s.length() > 120 ? s.substring(s.length() - 120) : s;
    }

    private static void mkdir(File d) {
        if (!d.exists()) //noinspection ResultOfMethodCallIgnored
            d.mkdirs();
    }

    private static void touch(File f) {
        try { if (!f.exists()) //noinspection ResultOfMethodCallIgnored
            f.createNewFile(); } catch (IOException ignored) { }
    }

    private static void copy(File from, File to) throws IOException {
        try (InputStream in = new java.io.FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
    }
}
