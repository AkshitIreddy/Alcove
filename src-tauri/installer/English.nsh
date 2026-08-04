; -----------------------------------------------------------------------------
; src-tauri/installer/English.nsh — the installer's English strings.
;
; Reached through `bundle > windows > nsis > customLanguageFiles` in
; tauri.conf.json, which REPLACES the file Tauri would otherwise write. It is a
; copy of that file with two deliberate differences:
;
;  1. `deleteAppData` is the label on the uninstaller's one destructive choice.
;     Tauri's wording is "Delete the application data", which is jargon for the
;     one thing in this app nobody can get back — a reader could easily read it
;     as "clear the cache" and lose every book they have written. It now names
;     what it deletes.
;
;  2. Tauri writes `{{product_name}}` into this file and never renders it, so
;     the stock installer really does put the words "{{product_name}} is
;     running!" in front of a reader. Every one of those is `${PRODUCTNAME}`
;     here, which NSIS does resolve.
;
; Because this file REPLACES Tauri's, every LangString the template references
; has to be present. `tests/installer-hooks.test.ts` checks the set against the
; one Tauri last generated into `src-tauri/target/release/nsis/`, so a CLI
; upgrade that adds a string fails a test rather than shipping a literal
; `$(newString)` on a page.
; -----------------------------------------------------------------------------
LangString addOrReinstall ${LANG_ENGLISH} "Add/Reinstall components"
LangString alreadyInstalled ${LANG_ENGLISH} "Already Installed"
LangString alreadyInstalledLong ${LANG_ENGLISH} "${PRODUCTNAME} ${VERSION} is already installed. Select the operation you want to perform and click Next to continue."
LangString appRunning ${LANG_ENGLISH} "${PRODUCTNAME} is running. Please close it first, then try again."
LangString appRunningOkKill ${LANG_ENGLISH} "${PRODUCTNAME} is running.$\nClick OK to close it."
LangString chooseMaintenanceOption ${LANG_ENGLISH} "Choose the maintenance option to perform."
LangString choowHowToInstall ${LANG_ENGLISH} "Choose how you want to install ${PRODUCTNAME}."
LangString createDesktop ${LANG_ENGLISH} "Put a shortcut on the desktop"
LangString deleteAppData ${LANG_ENGLISH} "Also delete my library — every book and page in %APPDATA%\com.alcove.app"
LangString dontUninstall ${LANG_ENGLISH} "Do not uninstall"
LangString dontUninstallDowngrade ${LANG_ENGLISH} "Do not uninstall (Downgrading without uninstall is disabled for this installer)"
LangString failedToKillApp ${LANG_ENGLISH} "Could not close ${PRODUCTNAME}. Please close it first, then try again."
LangString installingWebview2 ${LANG_ENGLISH} "Installing WebView2..."
LangString newerVersionInstalled ${LANG_ENGLISH} "A newer version of ${PRODUCTNAME} is already installed! It is not recommended that you install an older version. If you really want to install this older version, it's better to uninstall the current version first. Select the operation you want to perform and click Next to continue."
LangString older ${LANG_ENGLISH} "older"
LangString olderOrUnknownVersionInstalled ${LANG_ENGLISH} "An $R4 version of ${PRODUCTNAME} is installed on your system. It's recommended that you uninstall the current version before installing. Select the operation you want to perform and click Next to continue."
LangString silentDowngrades ${LANG_ENGLISH} "Downgrades are disabled for this installer, can't proceed with the silent installer, please use the graphical interface installer instead.$\n"
LangString unableToUninstall ${LANG_ENGLISH} "Unable to uninstall!"
LangString uninstallApp ${LANG_ENGLISH} "Uninstall ${PRODUCTNAME}"
LangString uninstallBeforeInstalling ${LANG_ENGLISH} "Uninstall before installing"
LangString unknown ${LANG_ENGLISH} "unknown"
LangString webview2AbortError ${LANG_ENGLISH} "Failed to install WebView2! The app can't run without it. Try restarting the installer."
LangString webview2DownloadError ${LANG_ENGLISH} "Error: Downloading WebView2 Failed - $0"
LangString webview2DownloadSuccess ${LANG_ENGLISH} "WebView2 bootstrapper downloaded successfully"
LangString webview2Downloading ${LANG_ENGLISH} "Downloading WebView2 bootstrapper..."
LangString webview2InstallError ${LANG_ENGLISH} "Error: Installing WebView2 failed with exit code $1"
LangString webview2InstallSuccess ${LANG_ENGLISH} "WebView2 installed successfully"
