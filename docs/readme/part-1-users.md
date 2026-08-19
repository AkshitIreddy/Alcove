<p align="right"><i>
  <a href="../../README.md">← Alcove</a> ·
  Part 1 of 2 ·
  <a href="part-2-developers.md">Part 2 — Building Alcove →</a>
</i></p>

# Part 1 — Using Alcove

Alcove is a private notebook that looks and behaves like a shelf of real books.
Open a book, write on fixed pages, add cards and diagrams, or ask the optional
AI Agent to prepare reviewed pages for you. There is no account and your library
stays on your computer.

![Alcove's storybook library and open notebook.](img/hero.png)

This page is the short user guide. Development, architecture and release details
live in **[Part 2 — Building Alcove](part-2-developers.md)**.

**On this page**

<!-- gen:contents-part-1 -->
- [Download and install](#download-and-install) — Choose your platform, install Alcove and start writing
- [A tour](#a-tour) — The shelf, books, pages and the few controls worth knowing first
- [Writing in a book](#writing-in-a-book) — Fixed pages, the slash menu, the context menu and media
- [Written with an AI](#written-with-an-ai) — Ask the in-book Agent to answer questions or prepare reviewed pages
- [Notebook Script](#notebook-script) — A small Markdown-based format for complete Alcove pages
- [Making it yours](#making-it-yours) — Rooms, bindings, paper, colours and sound
- [The keyboard](#the-keyboard) — The shortcuts most readers use
- [Backups, export and import](#backups-export-and-import) — Keep another copy or move your library
- [Questions](#questions) — Privacy, updates, moving computers and getting help
<!-- /gen -->

<!--lift: download-->
## Download and install
<!--nav: Choose your platform, install Alcove and start writing-->

Download the file for your computer from the latest release, open it, and follow
the installer. Alcove needs no account.

<!-- gen:downloads -->
| Platform | Take |
| --- | --- |
| **Windows 10 / 11** | [`Alcove_0.7.6_x64-setup.exe`](https://github.com/AkshitIreddy/Alcove/releases/latest) · about 16 MB |
| **macOS 11+** | [`Alcove_0.7.6_universal.dmg`](https://github.com/AkshitIreddy/Alcove/releases/latest) · Apple silicon and Intel |
| **Linux** | [`.deb`, `.rpm` or `.AppImage`](https://github.com/AkshitIreddy/Alcove/releases/latest) |
<!-- /gen -->

Your library is stored separately from the app, so uninstalling Alcove does not
remove your notebooks. Alcove checks for updates automatically; you can also use
**Settings → System → Check for updates**.

**[See what changed in each release](releases.md).**
<!--/lift-->

<!--lift: tour-->
## A tour
<!--nav: The shelf, books, pages and the few controls worth knowing first-->

Alcove opens on a bookcase. Click or pull a book from the shelf, then choose
**Read it** to open its pages.

| What you want | What to do |
| --- | --- |
| Open a book | Click it, or drag it out of the shelf |
| Move around the shelf | Wheel to zoom; Shift+wheel to pan |
| Go back or close a panel | Press `Escape` |
| Write | Click a ruled line and type |
| Add something to a page | Type `/` on an empty line |
| Change an existing block | Right-click it |
| Find a book or heading | Press `Ctrl+K` |
| Change the room or book | Open **Studio** on the shelf or **Customize** in a book |

![A bookcase in Alcove.](img/shelf.png)

The first launch asks a few appearance questions and offers a guided tour. You
can skip it and replay it later from **Settings → Help**.

## Writing in a book
<!--nav: Fixed pages, the slash menu, the context menu and media-->

Pages are fixed leaves rather than scrolling documents. When one fills, Alcove
moves the trailing blocks onto the next page and creates another page when
needed. Resizing the window changes only the book's display size; it does not
move your writing between pages.

![An open Alcove book.](img/spread.png)

Use the slash menu for headings, lists, tables, callouts, sticky notes,
diagrams, pictures, code, maths and decoration. The Catalogue in the left rail
shows the same choices when you would rather browse.

Right-click a block to change its type or colour, add effects, duplicate it,
copy or download it, paste beside it, move it to the previous page, or delete
it. You can also drag pictures onto a page and drag blocks by their six-dot
handle.

The left rail contains the tools for the current book: page style, Catalogue,
AI Agent, contents, history, import/export, ribbons, focus mode, thumbnails and
new pages.

Pictures are copied into the library's `assets` folder. Links remain links, and
an expanded picture can be zoomed and panned without changing the page.
<!--/lift-->

<!--lift: ai-->
## Written with an AI
<!--nav: Ask the in-book Agent to answer questions or prepare reviewed pages-->

The optional **AI Agent** lives in the book's left rail. Connect your own Cohere
key, then ask a question or describe what you want added.

- A normal question gets a normal answer in the panel.
- A notebook request creates pages in an isolated draft.
- Alcove validates, renders and visually reviews those pages before showing you
  a preview.
- Nothing enters the book until you choose **Insert**.

![The AI Agent showing a reviewed notebook preview.](img/agent.png)

You can attach images, PDFs, office documents and text files, or drag them onto
the chat box. The Agent reads only the sources needed for that task. A pending
preview stays available while you ask a follow-up question, and you can still
insert it or ask for changes afterwards.

The Agent may ask one genuinely necessary question, but ordinary choices such
as layout, length and repair strategy are its job. If a tool call fails, the
failure is returned to the Agent so it can choose a better action; repeated
calls that make no progress are stopped safely.

Your Cohere key can stay only for the session or be stored in the operating
system credential vault. Other books are not sent to Cohere. For sensitive
work, review the provider's terms and use **Text veil** under
**Settings → AI & integrations** when local masking is appropriate.

### Using another assistant

You do not need to connect the in-book Agent. Open **In and out → Copy the
format for your AI**, give that Notebook Script guide to any assistant, then
preview its `.md` file in Alcove before inserting it.
<!--/lift-->

<!--lift: manual-->
## Notebook Script
<!--nav: A small Markdown-based format for complete Alcove pages-->

Notebook Script is Markdown with a few readable containers. It can describe
page breaks, cards, callouts, columns, diagrams, images and decoration while
remaining easy to save as a plain `.md` file.

```md
# Photosynthesis

Plants turn light into stored chemical energy.

:::callout {kind=tip title="Remember"}
Water + carbon dioxide + light → glucose + oxygen.
:::

::page

## Quick check

- Where does the light energy come from?
- Which gas is released?
```

Paste a script into **In and out → Insert script** to preview it. Alcove's
parser reports what it could not recognise instead of crashing or silently
discarding the rest.

## Making it yours
<!--nav: Rooms, bindings, paper, colours and sound-->

The shelf's **Studio** controls the room: bookcase, wallpaper, colours and
writing-desk background. **Customize this book** controls one book: its binding,
cover, page ruling and line spacing.

Choose from the included presets or enter your own colour. Star favourites,
hide options you do not use, and create more bookcases when you want separate
rooms. Sound sets, ambience and volume live under **Settings → Sound** and can
all be turned off.

## The keyboard
<!--nav: The shortcuts most readers use-->

| Shortcut | Action |
| --- | --- |
| `Escape` | Go back or close the current panel |
| `Ctrl+K` | Open the quick switcher |
| `/` | Open the block menu on an empty line |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+Alt+T` | Table of contents |
| `Ctrl+Alt+M` | Page thumbnails |

Shortcuts can be changed in **Settings → Keyboard**.

## Backups, export and import
<!--nav: Keep another copy or move your library-->

Alcove saves as you write. Scheduled backups create local ZIP files, and a
`.nbk` bundle moves a library between computers. **In and out** can also import
or export Markdown, create PDFs, save page images and copy pages as Notebook
Script.

Your library folder contains the notebook database, media assets and backups.
Its exact location is shown in **Settings → System**, where it can be opened
without memorising an operating-system path.

## Questions
<!--nav: Privacy, updates, moving computers and getting help-->

**Does Alcove need an account?** No.

**Does it work offline?** Writing, editing, search, customisation, backup and
export do. Updates and the optional AI Agent need a connection.

**Can I move to another computer?** Export a `.nbk` bundle and import it on the
other installation.

**Will uninstalling delete my work?** No. The app and library are stored
separately.

**Where can I report a problem?** Open a
**[GitHub issue](https://github.com/AkshitIreddy/Alcove/issues)** and include the
app version shown at the bottom of Settings. Agent failures also offer a copied
diagnostic that excludes the saved API key.
<!--/lift-->
