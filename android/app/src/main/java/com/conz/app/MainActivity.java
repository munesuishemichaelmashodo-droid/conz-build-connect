package com.conz.app;

import android.graphics.Color;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.ScrollView;
import android.widget.TextView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
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
    private long startedAt;

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

        startedAt = System.currentTimeMillis();

        // Catches the far more likely case: something throws synchronously,
        // on the main thread, inside Capacitor's own Bridge/plugin setup --
        // super.onCreate() is where all of that happens.
        try {
            super.onCreate(savedInstanceState);
        } catch (Throwable t) {
            showCrash(t);
            return;
        }

        // No crash (confirmed by an earlier build). A prior build's URL-watch
        // log then showed the WebView loading https://conz.co.zw/ once and
        // never changing again -- no error, no further navigation, just a
        // hang. This replaces Capacitor's own WebViewClient with a subclass
        // of it (NOT a from-scratch replacement -- every method here calls
        // super first, so shouldInterceptRequest, shouldOverrideUrlLoading,
        // onPageFinished, and WebViewListener notifications all still work
        // exactly as before) purely to also log onReceivedError /
        // onReceivedHttpError / onReceivedSslError, which the URL-watch log
        // alone can't see.
        try {
            Bridge bridge = getBridge();
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().setWebViewClient(new DiagnosticWebViewClient(bridge));
            }
        } catch (Throwable ignored) {
        }

        startUrlWatcher();
    }

    private class DiagnosticWebViewClient extends BridgeWebViewClient {
        DiagnosticWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            log("onPageStarted: " + url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            log("onPageFinished: progress=" + view.getProgress() + "% url=" + url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            log("onReceivedError: " + error.getErrorCode() + " " + error.getDescription() + " url=" + request.getUrl());
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            log("onReceivedHttpError: " + errorResponse.getStatusCode() + " url=" + request.getUrl());
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            log("onReceivedSslError: " + error);
            super.onReceivedSslError(view, handler, error);
        }
    }

    private void log(String message) {
        urlHistory.append("t+").append(System.currentTimeMillis() - startedAt).append("ms: ").append(message).append("\n");
        if (urlWatcherLabel != null) {
            urlWatcherLabel.setText(urlHistory.toString());
        }
    }

    private int lastSeenProgress = -1;

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
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 320)
        );

        urlHistory.append("URL watch log (t=ms since app start):\n");
        urlWatcherLabel.setText(urlHistory.toString());

        urlWatcherHandler = new Handler(Looper.getMainLooper());
        urlWatcherHandler.post(new Runnable() {
            @Override
            public void run() {
                try {
                    WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
                    String url = (wv != null) ? wv.getUrl() : "(no webview yet)";
                    int progress = (wv != null) ? wv.getProgress() : -1;
                    if (url != null && !url.equals(lastSeenUrl)) {
                        lastSeenUrl = url;
                        log("getUrl(): " + url);
                    }
                    if (progress != lastSeenProgress) {
                        lastSeenProgress = progress;
                        log("progress: " + progress + "%");
                    }
                } catch (Throwable t) {
                    log("watcher error: " + t.getMessage());
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
