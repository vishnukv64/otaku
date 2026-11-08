//! iOS orientation: the app is portrait-only, the player may rotate.
//!
//! WKWebView has no working `screen.orientation.lock`, so the web side calls
//! `set_orientation`. We replace `supportedInterfaceOrientations` on the root
//! view controller's class with one that reads a mask we control, then ask the
//! window scene to re-evaluate (and optionally rotate).

/// `mode`:
/// - `"app"`: portrait only, rotate back to portrait now (leaving the player, app start)
/// - `"player"`: portrait and landscape, follow the device
/// - `"landscape"` / `"portrait"`: player rotate button; device can still rotate after
///
/// No-op off iOS; rotation requests need iOS 16+.
#[tauri::command]
pub fn set_orientation(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let (mask, request) = match mode.as_str() {
            "app" => (ios::PORTRAIT, Some(ios::PORTRAIT)),
            "player" => (ios::ALL, None),
            "landscape" => (ios::ALL, Some(ios::LANDSCAPE)),
            "portrait" => (ios::ALL, Some(ios::PORTRAIT)),
            other => return Err(format!("unknown orientation mode {other}")),
        };
        app.run_on_main_thread(move || unsafe { ios::apply(mask, request) })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "ios"))]
    let _ = (app, mode);
    Ok(())
}

#[cfg(target_os = "ios")]
mod ios {
    use objc2::ffi::{class_replaceMethod, object_getClass};
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::sel;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Once;

    // UIInterfaceOrientationMask bits.
    pub const PORTRAIT: usize = 1 << 1;
    pub const LANDSCAPE: usize = (1 << 3) | (1 << 4);
    pub const ALL: usize = PORTRAIT | LANDSCAPE;

    static MASK: AtomicUsize = AtomicUsize::new(PORTRAIT);
    static INSTALL: Once = Once::new();

    extern "C-unwind" fn supported(_this: *mut AnyObject, _cmd: Sel) -> usize {
        MASK.load(Ordering::Relaxed)
    }

    unsafe fn first_scene() -> *mut AnyObject {
        let Some(app_cls) = AnyClass::get(c"UIApplication") else {
            return std::ptr::null_mut();
        };
        let app: *mut AnyObject = msg_send![app_cls, sharedApplication];
        let scenes: *mut AnyObject = msg_send![app, connectedScenes];
        msg_send![scenes, anyObject]
    }

    unsafe fn root_vc(scene: *mut AnyObject) -> *mut AnyObject {
        let windows: *mut AnyObject = msg_send![scene, windows];
        let window: *mut AnyObject = msg_send![windows, firstObject];
        if window.is_null() {
            return std::ptr::null_mut();
        }
        msg_send![window, rootViewController]
    }

    pub unsafe fn apply(mask: usize, request: Option<usize>) {
        // Store first: if the window isn't up yet (app start), the swizzle installed
        // on a later call still reads the right mask.
        MASK.store(mask, Ordering::Relaxed);
        let scene = first_scene();
        if scene.is_null() {
            return;
        }
        let vc = root_vc(scene);
        if vc.is_null() {
            return;
        }
        INSTALL.call_once(|| {
            // ponytail: swizzles the whole root VC class; fine, the app has one window.
            let cls = object_getClass(vc) as *mut AnyClass;
            let imp: Imp = std::mem::transmute(
                supported as extern "C-unwind" fn(*mut AnyObject, Sel) -> usize,
            );
            class_replaceMethod(cls, sel!(supportedInterfaceOrientations), imp, c"Q@:".as_ptr());
        });

        // iOS 16+: re-read the mask, then rotate if asked.
        let responds: bool =
            msg_send![vc, respondsToSelector: sel!(setNeedsUpdateOfSupportedInterfaceOrientations)];
        if responds {
            let _: () = msg_send![vc, setNeedsUpdateOfSupportedInterfaceOrientations];
        }
        let (Some(want), Some(prefs_cls)) =
            (request, AnyClass::get(c"UIWindowSceneGeometryPreferencesIOS"))
        else {
            return;
        };
        // ponytail: the preferences object is leaked (a few bytes per call).
        let prefs: *mut AnyObject = msg_send![prefs_cls, alloc];
        let prefs: *mut AnyObject = msg_send![prefs, initWithInterfaceOrientations: want];
        let none: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![scene, requestGeometryUpdateWithPreferences: prefs, errorHandler: none];
    }
}
