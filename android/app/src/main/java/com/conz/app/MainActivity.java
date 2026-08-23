package com.conz.app;

import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import com.getcapacitor.BridgeActivity;
import java.io.PrintWriter;
import java.io.StringWriter;

public class MainActivity extends BridgeActivity {
    // Temporary diagnostic: if the Activity dies during startup, this shows
    // the real Java crash directly on the phone screen instead of silently
    // falling through to whatever app was open before Con Z (which is what
    // made this look like "it opens Chrome instead"). No computer, ADB, or
    // chrome://inspect needed to read it. Remove once native builds are
    // confirmed reliably working -- see the equivalent JS-level diagnostic
    // in src/routes/__root.tsx for anything that fails after the WebView
    // itself has started.
    private Handler urlWatcherHandler;
    private TextView urlWatcherLabel;
    private String lastSeenUrl = null;
    private final StringBuilder urlHistory = new StringBuilder();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Catches crashes on background threads too (e.g. if a Capacitor
        // plugin throws asynchronously during its own init).
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread thread, Throwable throwable) {
                try {
                    showCrash(throwable);
                } catch (Throwable ignored) {
                    if (previous != null) previous.uncaughtException(thread, throwable);
                }
            }
        });

        // Catches the far more likely case: something throws synchronously,
        // on the main thread, inside Capacitor's own Bridge/plugin setup --
        // super.onCreate() is where all of that happens.
        try {
            super.onCreate(savedInstanceState);
        } catch (Throwable t) {
            showCrash(t);
            return;
        }

        // No crash (confirmed by an earlier build) -- so instead, watch what
        // URL the WebView actually reports, live, every 300ms. This is
        // purely observational: it does NOT touch Capacitor's own
        // WebViewClient or navigation-handling logic in any way, it just
        // reads and displays getUrl(). If something IS handing the page off
        // to an external browser, the last value shown here before the app
        // vanishes is exactly what it was trying to load at that moment.
        startUrlWatcher();
    }

    private void startUrlWatcher() {
        urlWatcherLabel = new TextView(this);
        urlWatcherLabel.setTextColor(Color.YELLOW);
        urlWatcherLabel.setBackgroundColor(Color.argb(220, 0, 0, 0));
        urlWatcherLabel.setTextSize(10);
        urlWatcherLabel.setPadding(12, 60, 12, 12);
        urlWatcherLabel.setTextIsSelectable(true);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(urlWatcherLabel);
        addContentView(
            scroll,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 260)
        );

        urlHistory.append("URL watch log (t=ms since app start):\n");
        urlWatcherLabel.setText(urlHistory.toString());
        final long startedAt = System.currentTimeMillis();

        urlWatcherHandler = new Handler(Looper.getMainLooper());
        urlWatcherHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    String url =
                        (getBridge() != null && getBridge().getWebView() != null)
                            ? getBridge().getWebView().getUrl()
                            : "(no webview yet)";
                    if (url != null && !url.equals(lastSeenUrl)) {
                        lastSeenUrl = url;
                        urlHistory.append("t+").append(System.currentTimeMillis() - startedAt).append("ms: ").append(url).append("\n");
                        urlWatcherLabel.setText(urlHistory.toString());
                    }
                } catch (Throwable t) {
                    urlHistory.append("error: ").append(t.getMessage()).append("\n");
                    urlWatcherLabel.setText(urlHistory.toString());
                }
                urlWatcherHandler.postDelayed(this, 300);
            }
        });
    }

    private void showCrash(Throwable t) {
        StringWriter sw = new StringWriter();
        t.printStackTrace(new PrintWriter(sw));
        String text = "CON Z FAILED TO START\n\n" + sw;

        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.WHITE);
        tv.setBackgroundColor(Color.BLACK);
        tv.setTextSize(12);
        tv.setPadding(24, 72, 24, 48);
        tv.setTextIsSelectable(true);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(tv);
        setContentView(scroll);
    }
}
