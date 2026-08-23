package com.conz.app;

import android.graphics.Color;
import android.os.Bundle;
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
        }
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
