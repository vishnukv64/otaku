# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.otaku.player.* {
  native <methods>;
}

-keep class com.otaku.player.WryActivity {
  public <init>(...);

  void setWebView(com.otaku.player.RustWebView);
  java.lang.Class getAppClass(...);
  java.lang.String getVersion();
}

-keep class com.otaku.player.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.otaku.player.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.otaku.player.RustWebChromeClient,com.otaku.player.RustWebViewClient {
  public <init>(...);
}
