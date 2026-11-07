//! Player rotate button: ask iOS to rotate the window scene. WKWebView has no
//! working `screen.orientation.lock`, so the web side can't do this itself.

/// Rotate to landscape (`true`) or portrait (`false`). A request, not a lock:
/// the device can still rotate freely afterwards. No-op off iOS and below iOS 16.
#[tauri::command]
pub fn set_orientation(app: tauri::AppHandle, landscape: bool) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        app.run_on_main_thread(move || unsafe { request(landscape) })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "ios"))]
    let _ = (app, landscape);
    Ok(())
}

#[cfg(target_os = "ios")]
unsafe fn request(landscape: bool) {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::msg_send;

    // UIInterfaceOrientationMask: Portrait = 1<<1, LandscapeLeft|LandscapeRight = 1<<4|1<<3.
    let mask: usize = if landscape { (1 << 4) | (1 << 3) } else { 1 << 1 };
    let (Some(app_cls), Some(prefs_cls)) = (
        AnyClass::get(c"UIApplication"),
        AnyClass::get(c"UIWindowSceneGeometryPreferencesIOS"), // iOS 16+
    ) else {
        return;
    };
    let app: *mut AnyObject = msg_send![app_cls, sharedApplication];
    let scenes: *mut AnyObject = msg_send![app, connectedScenes];
    let scene: *mut AnyObject = msg_send![scenes, anyObject];
    if scene.is_null() {
        return;
    }
    // ponytail: the preferences object is leaked (a few bytes per tap).
    let prefs: *mut AnyObject = msg_send![prefs_cls, alloc];
    let prefs: *mut AnyObject = msg_send![prefs, initWithInterfaceOrientations: mask];
    let none: *mut AnyObject = std::ptr::null_mut();
    let _: () = msg_send![scene, requestGeometryUpdateWithPreferences: prefs, errorHandler: none];
}
