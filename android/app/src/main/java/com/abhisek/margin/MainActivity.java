package com.abhisek.margin;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Margin for Android: a full-screen window onto the Margin page hosted on Claude.
 * All notes, tasks and features live in that page and sync through the Claude account,
 * so this app only frames it, keeps the sign-in, and sends outside links to the browser.
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://claude.ai/artifact/TEjCdDzWtDLhjfPUfrZYEk";
    private static final Pattern URL = Pattern.compile("https?://[^\\s\"'<>]+");

    private WebView web;
    private ProgressBar bar;
    private LinearLayout offline;
    private Button pasteBtn;
    private boolean inSignIn = false;
    private int ink, muted, accent, bg;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        bg = Color.parseColor(dark ? "#111514" : "#F7F8F7");
        ink = Color.parseColor(dark ? "#E4EBE8" : "#1A2220");
        muted = Color.parseColor(dark ? "#8F9A96" : "#68736F");
        accent = Color.parseColor(dark ? "#7EC4B6" : "#2D6A60");

        Window w = getWindow();
        w.setStatusBarColor(bg);
        w.setNavigationBarColor(bg);
        if (!dark) {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(bg);

        web = new WebView(this);
        web.setBackgroundColor(bg);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgressTintList(ColorStateList.valueOf(accent));
        bar.setProgressBackgroundTintList(ColorStateList.valueOf(bg));
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP));

        offline = buildOffline();
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        pasteBtn = pill("Paste sign-in link");
        pasteBtn.setVisibility(View.GONE);
        pasteBtn.setOnClickListener(v -> pasteSignInLink());
        FrameLayout.LayoutParams pl = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        pl.bottomMargin = dp(24);
        root.addView(pasteBtn, pl);

        setContentView(root);
        setUpWebView();

        if (state != null && web.restoreState(state) != null) return;
        web.loadUrl(startUrl(getIntent()));
    }

    private void setUpWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);   // Margin runs in a frame on Claude's page

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (!req.isForMainFrame()) return false;
                return route(req.getUrl());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                offline.setVisibility(View.GONE);
                afterNavigation(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) offline.setVisibility(View.VISIBLE);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                bar.setProgress(p);
                bar.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean userGesture, Message msg) {
                // Links that open a new window go to the phone's browser.
                WebView popup = new WebView(MainActivity.this);
                final boolean[] handled = {false};
                popup.setWebViewClient(new WebViewClient() {
                    private void take(String url) {
                        if (handled[0] || url == null || url.equals("about:blank")) return;
                        handled[0] = true;
                        openOutside(Uri.parse(url));
                        popup.post(popup::destroy);
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                        take(r.getUrl().toString());
                        return true;
                    }

                    @Override
                    public void onPageStarted(WebView v, String url, Bitmap f) {
                        take(url);
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) msg.obj;
                transport.setWebView(popup);
                msg.sendToTarget();
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
        });

        web.setDownloadListener((url, ua, cd, mime, len) -> openOutside(Uri.parse(url)));
    }

    /** Decide where a top-level link goes: stay in the app for Claude's own pages, browser for the rest. */
    private boolean route(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
        if (scheme.equals("http") || scheme.equals("https")) {
            if (host.equals("accounts.google.com")) {
                showGoogleNotice();
                return true;
            }
            if (inApp(host)) return false;
            openOutside(u);
            return true;
        }
        if (scheme.equals("intent")) {
            try {
                Intent i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
                startActivity(i);
            } catch (Exception ignored) {
            }
            return true;
        }
        openOutside(u);
        return true;
    }

    private static boolean inApp(String host) {
        return host.equals("claude.ai") || host.endsWith(".claude.ai")
                || host.equals("anthropic.com") || host.endsWith(".anthropic.com")
                || host.equals("claudeusercontent.com") || host.endsWith(".claudeusercontent.com")
                || host.equals("challenges.cloudflare.com");
    }

    /** Show the paste button on sign-in pages, and return to Margin once sign-in lands elsewhere on Claude. */
    private void afterNavigation(String url) {
        Uri u = Uri.parse(url == null ? "" : url);
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
        String path = u.getPath() == null ? "" : u.getPath().toLowerCase();
        boolean signIn = host.endsWith("claude.ai")
                && (path.startsWith("/login") || path.contains("magic") || path.contains("verify") || path.contains("auth"));
        if (signIn) inSignIn = true;
        pasteBtn.setVisibility(signIn ? View.VISIBLE : View.GONE);
        if (inSignIn && !signIn && host.equals("claude.ai") && !path.startsWith("/artifact")) {
            inSignIn = false;
            web.post(() -> web.loadUrl(HOME));
        }
    }

    private void pasteSignInLink() {
        ClipboardManager cb = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        String text = "";
        if (cb != null && cb.hasPrimaryClip()) {
            ClipData clip = cb.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence c = clip.getItemAt(0).coerceToText(this);
                if (c != null) text = c.toString();
            }
        }
        Matcher m = URL.matcher(text);
        while (m.find()) {
            Uri u = Uri.parse(m.group());
            if (u.getHost() != null && inApp(u.getHost().toLowerCase())) {
                web.loadUrl(u.toString());
                return;
            }
        }
        Toast.makeText(this, "Copy the sign-in link from Claude's email first, then tap Paste sign-in link.", Toast.LENGTH_LONG).show();
    }

    private void showGoogleNotice() {
        new AlertDialog.Builder(this)
                .setTitle("Sign in with your email")
                .setMessage("Google doesn't allow its sign-in inside apps. Tap “Continue with email” and enter the email address you use with Claude.\n\n"
                        + "If Claude emails you a code, type it in. If it emails a link, press and hold the link, choose Copy link address, "
                        + "come back here and tap Paste sign-in link.")
                .setPositiveButton("OK", null)
                .show();
    }

    private void openOutside(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app on this phone can open that link.", Toast.LENGTH_SHORT).show();
        }
    }

    private String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data != null && data.getHost() != null && inApp(data.getHost().toLowerCase())) return data.toString();
        return HOME;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent.getData() != null) web.loadUrl(startUrl(intent));
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // ---- small UI helpers ----

    private LinearLayout buildOffline() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(bg);
        box.setPadding(dp(32), dp(32), dp(32), dp(32));
        box.setClickable(true);

        TextView title = new TextView(this);
        title.setText("Can't reach Claude");
        title.setTextColor(ink);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setGravity(Gravity.CENTER);

        TextView body = new TextView(this);
        body.setText("Check your internet connection, then try again.");
        body.setTextColor(muted);
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, dp(8), 0, dp(20));

        Button retry = pill("Try again");
        retry.setOnClickListener(v -> {
            offline.setVisibility(View.GONE);
            String url = web.getUrl();
            if (url == null || url.startsWith("about:") || url.startsWith("data:")) web.loadUrl(HOME);
            else web.reload();
        });

        box.addView(title);
        box.addView(body);
        box.addView(retry, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return box;
    }

    private Button pill(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(bg);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setPadding(dp(22), dp(10), dp(22), dp(10));
        b.setMinHeight(0);
        b.setMinimumHeight(0);
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(accent);
        shape.setCornerRadius(dp(24));
        b.setBackground(shape);
        b.setStateListAnimator(null);
        b.setElevation(dp(4));
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
