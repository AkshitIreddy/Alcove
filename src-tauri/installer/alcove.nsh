; -----------------------------------------------------------------------------
; src-tauri/installer/alcove.nsh — the installer's manners and its looks.
;
; Two things live here, and they came from the same review:
;
;   > "make the uninstall exe has an option to also to delete the all app data
;   >  and show the user where that app data is in case they want to transfer
;   >  for it"
;   > "most install and unistall exe look boring make sure ours looks
;   >  interesting, pretty like our app"
;
; The first half is the important one. Alcove is a storybook library on this
; machine; an uninstaller that quietly takes somebody's books with it is
; unforgivable. So the option DEFAULTS TO KEEPING the library — that is
; Tauri's own behaviour and this file does not change it — and a page is added
; ahead of the question that says exactly where the library is and offers to
; open the folder, so it can be copied somewhere first.
;
; ## How this file is reached
;
; `bundle > windows > nsis > installerHooks` in tauri.conf.json. Tauri
; `!include`s it near the TOP of its generated installer.nsi, after MUI2.nsh
; and FileFunc.nsh but before every page macro and before the template declares
; its own variables. Both halves of that matter:
;
;   * Anything MUI reads at page-insert time can be set from here — the
;     colours, the page copy, and the extra uninstaller page below all get in
;     without forking Tauri's 977-line template, which is the thing that would
;     rot at the next `@tauri-apps/cli` bump.
;
;   * Nothing the template declares LATER exists yet. `$PassiveMode`,
;     `${BUNDLEID}` and `$DeleteAppDataCheckboxState` are all declared below
;     this include, so a top-level function here cannot name them. The passive
;     check is therefore re-derived from $CMDLINE, and the identifier is
;     spelt out — `tests/packaging.test.ts` pins that spelling against
;     `tauri.conf.json` so the two cannot drift.
;
;   A macro body is different: `NSIS_HOOK_POSTUNINSTALL` is *expanded* deep
;   inside `Section Uninstall`, so it may name `$DeleteAppDataCheckboxState`
;   and does.
;
; ## The look
;
; `MUI_BGCOLOR` is FLAT.cream from src/art/flat.ts, the same hex the two BMPs
; that `scripts/gen-icons.py` draws are grounded on. That pairing is the whole
; reason the header art looks built into the window instead of pasted onto it —
; change one and change the other. `MUI_TEXTCOLOR` is FLAT.ink; the pair
; measures 10.4:1, so it clears 4.5:1 with room to spare.
; -----------------------------------------------------------------------------

; The bundle identifier, and the folder Tauri's `app_data_dir()` /
; `app_config_dir()` both resolve to on Windows. `notebook.db`, `assets/` and
; `backups/` are all inside it — it IS the library, and it is what the
; uninstaller's checkbox removes.
!define ALCOVE_IDENTIFIER "com.alcove.app"
!define ALCOVE_LIBRARY "$APPDATA\${ALCOVE_IDENTIFIER}"
!define ALCOVE_LOCATION_FILE "${ALCOVE_LIBRARY}\library-location.txt"
; The same path written the way a reader can paste it into Explorer's address
; bar. Used where the string is baked at compile time and `$APPDATA` would
; never get the chance to expand.
!define ALCOVE_LIBRARY_TYPED "%APPDATA%\${ALCOVE_IDENTIFIER}"

; ---------------------------------------------------------------- the palette
!define MUI_BGCOLOR "F7F1E3"
!define MUI_TEXTCOLOR "4F3120"

; ------------------------------------------------------------- what it says
!define MUI_WELCOMEPAGE_TITLE "Alcove"
!define MUI_WELCOMEPAGE_TEXT "Built like a storybook library — cozy shelves and patterned walls.$\r$\nNotebook pages with diagrams, notes, tape, and stickers inside.$\r$\n$\r$\nAlcove installs for you alone. No administrator prompt, nothing in Program Files, and no account to make.$\r$\n$\r$\nYour library is a folder on this machine and stays there.$\r$\n$\r$\nClick Next to put it on the shelf."

!define MUI_FINISHPAGE_TITLE "Alcove is on the shelf"
; MUI gives the finish page's paragraph 40 dialog units and puts the two check
; boxes 5 units under that — so a longer text does not scroll and does not
; clip, it is silently painted UNDER the check boxes. `_TEXT_LARGE` is the
; supported way to ask for 60 instead, and it moves the boxes down with it.
; Both of those were found by looking at a screenshot of the real page: at 40
; the last two lines were hidden behind "Open Alcove now", and at 60 the text
; below still had one line too many. SIX slots fit — count a blank line as one.
!define MUI_FINISHPAGE_TEXT_LARGE
!define MUI_FINISHPAGE_TEXT "Open it to find a storybook shelf and one welcome book.$\r$\n$\r$\nYour books, pictures and backups live together in the library folder you chose.$\r$\n$\r$\nCopy that folder to back it up or to carry your books to another machine."
!define MUI_FINISHPAGE_RUN_TEXT "Open Alcove now"

; Two short lines: the text control on the uninstall confirm page is about
; three lines tall, and Tauri's own "delete the library" checkbox sits just
; below it. Anything longer is clipped rather than scrolled.
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Alcove will be removed from this computer. The library folder shown on the previous page is KEPT unless you tick the box below."

; -----------------------------------------------------------------------------
; The extra uninstaller page: where the library is, before anything is deleted.
;
; It is declared here, so it is the FIRST page the uninstaller shows — read the
; folder, take a copy if you want one, and only then answer the question. The
; checkbox itself stays Tauri's, on the confirm page, because that is what is
; wired to `$DeleteAppDataCheckboxState` and to the `RmDir /r` that acts on it;
; a second checkbox that merely looked like the choice would be worse than none.
; -----------------------------------------------------------------------------
Var AlcoveLibraryDialog
Var AlcoveLibraryPathBox
Var AlcoveLibrarySelection
Var AlcoveLibraryBrowseButton

; The installer owns a separate library-location page.  It is skipped for
; passive updater runs, which keep the existing pointer without interruption.
Page custom AlcoveLibraryInstallPage AlcoveLibraryInstallLeave

Function AlcoveResolveLibrarySelection
  ${If} $AlcoveLibrarySelection != ""
    Return
  ${EndIf}
  StrCpy $AlcoveLibrarySelection "${ALCOVE_LIBRARY}"
  IfFileExists "${ALCOVE_LOCATION_FILE}" 0 done
  ClearErrors
  FileOpen $0 "${ALCOVE_LOCATION_FILE}" r
  ${IfNot} ${Errors}
    FileRead $0 $1
    FileClose $0
    trim_location_line:
    StrCpy $2 $1 1 -1
    StrCmp $2 "$\r" trim_location_char
    StrCmp $2 "$\n" trim_location_char location_line_ready
    trim_location_char:
    StrCpy $1 $1 -1
    Goto trim_location_line
    location_line_ready:
    ${If} $1 != ""
      StrCpy $AlcoveLibrarySelection $1
    ${EndIf}
  ${EndIf}
  done:
FunctionEnd

Function AlcoveLibraryInstallPage
  ClearErrors
  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${IfNot} ${Errors}
    Abort
  ${EndIf}

  Call AlcoveResolveLibrarySelection
  !insertmacro MUI_HEADER_TEXT "Choose your library folder" "Your books, pages, pictures and backups stay together."
  nsDialogs::Create 1018
  Pop $AlcoveLibraryDialog
  ${If} $AlcoveLibraryDialog == error
    Abort
  ${EndIf}
  ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

  ${NSD_CreateLabel} 0 0u 100% 28u "Choose where Alcove stores your library. This is separate from the app's install folder, and you can copy the whole folder as a backup."
  Pop $0
  ${NSD_CreateLabel} 0 34u 100% 10u "Library folder:"
  Pop $0
  ${NSD_CreateText} 0 47u 76% 13u "$AlcoveLibrarySelection"
  Pop $AlcoveLibraryPathBox
  ${NSD_CreateButton} 79% 46u 21% 15u "Browse..."
  Pop $AlcoveLibraryBrowseButton
  ${NSD_OnClick} $AlcoveLibraryBrowseButton AlcoveBrowseLibrary
  ${NSD_CreateLabel} 0 70u 100% 38u "If you already have an Alcove library in the normal location and choose a new empty folder, Alcove copies it there on first launch. The old copy is kept as a safety copy."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function AlcoveBrowseLibrary
  ${NSD_GetText} $AlcoveLibraryPathBox $AlcoveLibrarySelection
  nsDialogs::SelectFolderDialog "Choose Alcove's library folder" "$AlcoveLibrarySelection"
  Pop $0
  ${If} $0 != error
    StrCpy $AlcoveLibrarySelection $0
    ${NSD_SetText} $AlcoveLibraryPathBox "$AlcoveLibrarySelection"
  ${EndIf}
FunctionEnd

Function AlcoveLibraryInstallLeave
  ${NSD_GetText} $AlcoveLibraryPathBox $AlcoveLibrarySelection
  ${If} $AlcoveLibrarySelection == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "Choose a folder for your Alcove library."
    Abort
  ${EndIf}
  GetFullPathName $AlcoveLibrarySelection "$AlcoveLibrarySelection"
FunctionEnd

UninstPage custom un.AlcoveLibraryPage

Function un.AlcoveLibraryPage
  ; A passive install (`/P`) shows no window at all, and Tauri forwards both
  ; `/P` and `/UPDATE` to the old uninstaller when the installer itself was run
  ; that way. A page that stops there hangs whatever is waiting on it, so this
  ; aborts on exactly the flags the template's own `un.SkipIfPassive` checks —
  ; re-read from $CMDLINE, because `$PassiveMode` is not declared until further
  ; down the generated script.
  ClearErrors
  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${IfNot} ${Errors}
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Your library" "Everything you have written, and where it is kept."

  Call un.AlcoveResolveLibrarySelection

  nsDialogs::Create 1018
  Pop $AlcoveLibraryDialog
  ${If} $AlcoveLibraryDialog == error
    Abort
  ${EndIf}
  ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

  ; Worded to be true of an UPGRADE as well as a removal. Tauri runs the old
  ; uninstaller with its full interface when a newer version is installed over
  ; it — no /P, no /UPDATE, verified by watching one — so this page is on the
  ; upgrade path too, and "you are uninstalling" would be a lie half the time.
  ${NSD_CreateLabel} 0 0u 100% 24u "Whatever happens next, your books are yours. Removing Alcove — or replacing it with a newer version — leaves your library exactly where it is, unless you tick the delete box on the next page."
  Pop $0

  ${NSD_CreateLabel} 0 30u 100% 10u "Your library lives here:"
  Pop $0

  ; A read-only edit rather than a label, so the path can be selected and
  ; copied. A path a reader cannot copy is a path they have to retype.
  ${NSD_CreateText} 0 42u 100% 13u "$AlcoveLibrarySelection"
  Pop $AlcoveLibraryPathBox
  SendMessage $AlcoveLibraryPathBox ${EM_SETREADONLY} 1 0

  ${NSD_CreateButton} 0 60u 74u 15u "Open the folder"
  Pop $0
  ${NSD_OnClick} $0 un.AlcoveOpenLibrary

  ${NSD_CreateLabel} 0 82u 100% 34u "Copy that folder somewhere safe and you have your whole library: every book, page and picture, plus its backups. Drop it into the same place on another computer and Alcove there will open it."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function un.AlcoveOpenLibrary
  ; `un.onInit` has already run `SetShellVarContext current`, so $APPDATA is
  ; this user's Roaming folder — the same one the uninstall section deletes.
  ExecShell "open" "$AlcoveLibrarySelection"
FunctionEnd

Function un.AlcoveResolveLibrarySelection
  ${If} $AlcoveLibrarySelection != ""
    Return
  ${EndIf}
  StrCpy $AlcoveLibrarySelection "${ALCOVE_LIBRARY}"
  IfFileExists "${ALCOVE_LOCATION_FILE}" 0 done
  ClearErrors
  FileOpen $0 "${ALCOVE_LOCATION_FILE}" r
  ${IfNot} ${Errors}
    FileRead $0 $1
    FileClose $0
    un_trim_location_line:
    StrCpy $2 $1 1 -1
    StrCmp $2 "$\r" un_trim_location_char
    StrCmp $2 "$\n" un_trim_location_char un_location_line_ready
    un_trim_location_char:
    StrCpy $1 $1 -1
    Goto un_trim_location_line
    un_location_line_ready:
    ${If} $1 != ""
      StrCpy $AlcoveLibrarySelection $1
    ${EndIf}
  ${EndIf}
  done:
FunctionEnd

; -----------------------------------------------------------------------------
; The hooks Tauri expands inside its own sections. It offers four —
; PRE/POST INSTALL and PRE/POST UNINSTALL — and each insertion is guarded by
; `!ifmacrodef`, so the two that have nothing to say are simply absent.
; -----------------------------------------------------------------------------

!macro NSIS_HOOK_POSTINSTALL
  Call AlcoveResolveLibrarySelection
  CreateDirectory "${ALCOVE_LIBRARY}"
  FileOpen $0 "${ALCOVE_LOCATION_FILE}" w
  FileWrite $0 "$AlcoveLibrarySelection$\r$\n"
  FileClose $0
  ; The install log is the one place a reader can scroll back to afterwards.
  DetailPrint "Your library will live in $AlcoveLibrarySelection"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Save the selected path before Tauri optionally removes the default app
  ; data folder (which also contains our location pointer).
  Call un.AlcoveResolveLibrarySelection
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Expanded inside `Section Uninstall`, which is why this may name a variable
  ; the template declares after this file is included.
  ${If} $DeleteAppDataCheckboxState = 1
    ; Tauri removes the default folder itself.  For a custom library, remove
    ; only Alcove-owned entries; never recursively erase an arbitrary folder
    ; the reader may also use for other files.
    ${If} $AlcoveLibrarySelection != "${ALCOVE_LIBRARY}"
      Delete "$AlcoveLibrarySelection\notebook.db"
      Delete "$AlcoveLibrarySelection\notebook.db-wal"
      Delete "$AlcoveLibrarySelection\notebook.db-shm"
      RmDir /r "$AlcoveLibrarySelection\assets"
      RmDir /r "$AlcoveLibrarySelection\backups"
      RmDir "$AlcoveLibrarySelection"
    ${EndIf}
    DetailPrint "Alcove's library data in $AlcoveLibrarySelection has been deleted."
  ${Else}
    DetailPrint "Your library has been LEFT IN PLACE, in $AlcoveLibrarySelection"
  ${EndIf}
!macroend
