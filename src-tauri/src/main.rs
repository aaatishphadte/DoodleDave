// Desktop shell for Doodle Dash. The built web game (build/exe) is embedded in the binary.
// Hide the console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn is_internal(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "tauri" | "asset" | "about" | "data" | "blob")
        || matches!(url.host_str(), Some("tauri.localhost") | Some("localhost") | Some("127.0.0.1"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Doodle Dash")
                .inner_size(1280.0, 760.0)
                .min_inner_size(800.0, 480.0)
                .center()
                .resizable(true)
                // Links (e.g. the credits) open in the player's browser, never inside the game.
                .on_navigation(|url| {
                    if is_internal(url) {
                        true
                    } else {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                        false
                    }
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Doodle Dash");
}
