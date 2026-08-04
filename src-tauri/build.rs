//! Build script for the Tauri host.
//!
//! `tauri_build::build()` is what embeds the Windows resources — the icon
//! group the shell shows for `alcove.exe`, and through it every surface that
//! falls back to the exe's icon. The Start-menu shortcut has no icon of its
//! own (see `docs/packaging-icons.md`), so this is the only thing deciding
//! what a reader sees there.
//!
//! ## Why the `rerun-if-changed` lines exist
//!
//! `tauri_build` does NOT declare the icon files as inputs, and a build script
//! with no declared inputs is re-run only when its own source changes. So
//! regenerating `icon.ico` and rebuilding produced an installer carrying the
//! PREVIOUS icon, with nothing anywhere reporting a problem: the `.ico` on
//! disk was correct, the bundler copied it into the installer correctly, and
//! the exe simply kept the resource cargo had cached from an earlier run.
//! It was caught by reading the icon back OUT of the built binary and finding
//! the app's old artwork inside it.
//!
//! Naming the files here makes an icon change invalidate this script the way
//! any other input would. `tauri.conf.json` is listed for the same reason —
//! it decides which icons are embedded at all.
//!
//! Adding a new icon to `bundle.icon` means adding it here too. That is the
//! one manual step, and it is why this is an explicit list rather than a glob:
//! a glob over `icons/` would also watch the generated Store PNGs that no
//! Windows build reads, and re-linking the whole crate whenever a macOS asset
//! moved is a worse trade than remembering one line.

fn main() {
    // The resources actually compiled into alcove.exe on Windows.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/128x128.png");
    println!("cargo:rerun-if-changed=icons/128x128@2x.png");
    // macOS, listed so a cross-platform build is not the odd one out.
    println!("cargo:rerun-if-changed=icons/icon.icns");
    // Decides which of the above are embedded, and the bundle settings.
    println!("cargo:rerun-if-changed=tauri.conf.json");

    tauri_build::build()
}
