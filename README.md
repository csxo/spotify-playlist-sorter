# 🎵 Spotify Playlist Auto Sorter

[![GitHub Repo](https://img.shields.io/badge/GitHub-csxo%2Fspotify--playlist--sorter-181717.svg?logo=github)](https://github.com/csxo/spotify-playlist-sorter)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-blue.svg)](./extension)
[![Violentmonkey](https://img.shields.io/badge/Userscript-Violentmonkey%20%2F%20Tampermonkey-orange.svg)](./spotify-playlist-sorter.user.js)
[![Zero Token Required](https://img.shields.io/badge/Auth-Zero_Token_Required-brightgreen.svg)]()
[![Privacy Friendly](https://img.shields.io/badge/Privacy-100%25_Local_Execution-success.svg)]()

<p align="right">
  <strong>Language:</strong>
  <a href="./README.md"><strong>English</strong></a> |
  <a href="./README_zh.md">简体中文</a>
</p>

> **The 100% local, zero-token, zero-config Spotify playlist organizer & deduplicator designed for music curators and playlist perfectionists.**  
> Automatically groups songs by artist, sorts by track count descending, applies A-Z / release date intra-artist ordering, sinks single-track artists, removes duplicates, provides interactive artist analytics, and generates beautifully organized playlists with one-click copy & paste!

* GitHub Repository: [https://github.com/csxo/spotify-playlist-sorter](https://github.com/csxo/spotify-playlist-sorter)

---

## 📑 Table of Contents

- [🎵 Spotify Playlist Auto Sorter](#-spotify-playlist-auto-sorter)
  - [📑 Table of Contents](#-table-of-contents)
  - [1. The Problem: Why Do You Need This?](#1-the-problem-why-do-you-need-this)
  - [2. Key Features & Advantages](#2-key-features--advantages)
  - [3. 10 Professional Sorting Rules Explained](#3-10-professional-sorting-rules-explained)
  - [4. Smart Deduplication Module](#4-smart-deduplication-module)
  - [5. Artist Analytics Dashboard & Interactive Filtering](#5-artist-analytics-dashboard--interactive-filtering)
  - [6. Installation Options (Choose Either)](#6-installation-options-choose-either)
    - [Option 1: Chrome / Edge Unpacked Extension (Recommended)](#option-1-chrome--edge-unpacked-extension-recommended)
    - [Option 2: Violentmonkey / Tampermonkey Userscript](#option-2-violentmonkey--tampermonkey-userscript)
  - [7. Quick Start Guide (30 Seconds)](#7-quick-start-guide-30-seconds)
    - [Step 1: Open Your Playlist & Click Sort](#step-1-open-your-playlist--click-sort)
    - [Step 2: Instant Scanning & Duplicate Check](#step-2-instant-scanning--duplicate-check)
    - [Step 3: Customize 10 Sorting Rules (Optional)](#step-3-customize-10-sorting-rules-optional)
    - [Step 4: Preview Organized Playlist & Artist Stats](#step-4-preview-organized-playlist--artist-stats)
    - [Step 5: Copy Tracks & Paste into Spotify Desktop App](#step-5-copy-tracks--paste-into-spotify-desktop-app)
  - [8. Technical Caveats & FAQ](#8-technical-caveats--faq)
    - [1. Why copy & paste to a new playlist instead of in-place mutation?](#1-why-copy--paste-to-a-new-playlist-instead-of-in-place-mutation)
    - [2. Must I use the Spotify Desktop App to paste?](#2-must-i-use-the-spotify-desktop-app-to-paste)
    - [3. Pasting into empty (0-track) playlists quirk](#3-pasting-into-empty-0-track-playlists-quirk)
    - [4. OS Keyboard Shortcuts](#4-os-keyboard-shortcuts)
    - [5. Large playlist performance](#5-large-playlist-performance)
  - [9. Technical Architecture & Privacy](#9-technical-architecture--privacy)
  - [10. License (MIT)](#10-license-mit)

---

## 1. The Problem: Why Do You Need This?

Spotify is one of the world's finest streaming music platforms, but its **playlist management and organization features** have frustrated power users for years:

1. **Scattered Tracks by the Same Artist**:  
   In playlists containing 500 to 1,000+ tracks, your 40 songs by Coldplay or 25 songs by Taylor Swift are scattered randomly across the list. Listening through feels chaotic and disjointed.
2. **No "Track Count Volume" Sorting Dimension**:  
   You want to prioritize artists you've collected the most songs from. But native Spotify only allows basic sorting by title, date added, or artist name A-Z, with no way to sort by "number of tracks per artist in this playlist".
3. **Messy Collabs & Feat. Attribution**:  
   Duets and featured tracks are often attributed strictly to the first artist, splitting songs by your favorite artist away from their core cluster.
4. **Single-Track Artists Cluttering Core Listening**:  
   Casual one-off songs dilute the flow of your staple artists. There is no native option to group single-song artists together at the bottom.
5. **Rampant & Undetected Duplicate Tracks**:  
   Long-lived playlists accumulate identical tracks from album versions, single releases, and remaster editions. Spotting them by eye is tedious and exhausting.
6. **No Native Bilingual / Pinyin Alphabetical Sorting**:  
   Mixed English and non-Latin character sets (such as Chinese Pinyin) sort unpredictably in native web players.

**Spotify Playlist Auto Sorter** fixes all of these issues in a single click, completely locally with zero account friction!

---

## 2. Key Features & Advantages

* **⚡ 100% Local & Zero Token**: No Spotify Developer API keys, no OAuth redirect URI setups, no rate limits, and no token expiration. Runs entirely inside your browser.
* **🔒 100% Client-Side Privacy**: All track parsing, sorting, and deduplication logic execute locally in your browser memory. Zero external server requests.
* **🎯 10 Customizable Sorting Rules**: From full artist grouping and volume descending to secondary tie-breakers, intra-artist A-Z, and single-track sinking.
* **🧹 Smart Deduplication Engine**: Detects both exact track duplicates and version variants (Live, Remix, Acoustic) with one-click cleanup.
* **📊 Visual Artist Distribution Dashboard**: Visual bar charts, track percentage distribution, and instant filtering by top artists.
* **📋 Universal 1-Click Clipboard Generation**: Copies standard Spotify URIs directly to your system clipboard. Open Spotify Desktop, press `Ctrl+V` (`Cmd+V`), and your perfectly organized playlist is born!

---

## 3. 10 Professional Sorting Rules Explained

| # | Rule Name | Description | Default Setting |
| :-: | :--- | :--- | :--- |
| **1** | **Artist Aggregation** | Gathers all tracks by the same artist into contiguous clusters. | `Enabled` |
| **2** | **Artist Order Mode** | Determines the ranking of artist groups: by track count descending or name A-Z. | `Track Count Descending` |
| **3** | **Tie-Breaker Strategy** | Secondary sorting when multiple artists have the exact same song count. | `Artist Name A-Z` |
| **4** | **Single-Track Strategy** | Handles artists with only 1 song: sink them to the bottom or keep in main ranking. | `Sink to Bottom (A-Z)` |
| **5** | **Intra-Artist Track Order** | Sorting order within each artist's discography cluster. | `Track Title A-Z` |
| **6** | **Feat. & Collab Attribution** | Assigns collaborative/duet tracks to the artist with the most songs in this playlist. | `Most Frequent Artist` |
| **7** | **Smart Deduplication** | Strategy for handling duplicate tracks: prompt for review, auto-remove, or keep. | `Prompt & Review` |
| **8** | **Punctuation & Prefix Handling** | Ignores brackets, quotes, and symbols during A-Z sorting (e.g. `(The)` or `【...】`). | `Ignore Special Prefixes` |
| **9** | **Sunk Single-Track Order** | Primary sorting key for the sunk single-track section at the bottom. | `Artist Name A-Z` |
| **10** | **Displacement Diff Tracking** | Calculates and displays original vs. new index shifts (e.g., `#15 -> #3 (+12)`). | `Enabled` |

---

## 4. Smart Deduplication Module

Large playlists inevitably suffer from duplicate tracks added over months or years. The built-in deduplication engine provides:

1. **Exact Title & Artist Match**: Identifies identical recordings across singles, EPs, and full-length albums.
2. **Version / Remix / Live Detection**: Highlights variant tracks so you can choose between original studio versions and acoustic/live takes.
3. **Flexible Resolution**:
   - **One-Click Clean**: Automatically keeps the first occurrence and removes redundant copies.
   - **Manual Per-Track Review**: View exact playlist positions, album names, and remove specific entries individually.
   - **Instant Undo**: Restore removed duplicates anytime before exporting.

---

## 5. Artist Analytics Dashboard & Interactive Filtering

The interactive dashboard at the top of the sorter modal gives you actionable insights into your playlist's composition:

* **Top Artist Share**: Visual progress bars displaying the top 10+ artists, their track counts, and percentage share of the entire playlist.
* **Quick Segment Tags**: Filter by `All Artists`, `Top 10 Headliners`, `5+ Tracks`, `2-4 Tracks`, or `Single-Track Artists`.
* **Real-time Search Filter**: Instant keyword search to locate specific artists and inspect their sorted tracks immediately.

---

## 6. Installation Options (Choose Either)

You only need **one** of the two installation methods below:

### Option 1: Chrome / Edge Unpacked Extension (Recommended)

1. Download or clone this repository to your computer:
   ```bash
   git clone https://github.com/csxo/spotify-playlist-sorter.git
   ```
2. Open your browser's extension management page:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** (加载已解压的扩展程序) in the top-left corner.
5. Select the `extension/` folder in the project directory.
6. Done! Pin the extension icon to your toolbar for quick access.

### Option 2: Violentmonkey / Tampermonkey Userscript

1. Install a userscript manager extension in your browser:
   - [Violentmonkey (Recommended)](https://violentmonkey.github.io/) or [Tampermonkey](https://www.tampermonkey.net/)
2. Open the file [`spotify-playlist-sorter.user.js`](./spotify-playlist-sorter.user.js) in your browser, or copy its code into a new script in Violentmonkey.
3. Click **Install**.
4. Refresh your Spotify Web Player tab (`open.spotify.com`).

---

## 7. Quick Start Guide (30 Seconds)

### Step 1: Open Your Playlist & Click Sort
Navigate to any Spotify playlist you own or have edit permissions for on [Spotify Web Player](https://open.spotify.com).  
Look for the green **🎵 Sort Playlist (智能排序歌单)** button on the playlist action bar, or click the extension icon.

### Step 2: Instant Scanning & Duplicate Check
The tool will automatically scan all tracks in the playlist (typically takes 1–3 seconds for 500+ tracks). If duplicate tracks are found, a notification banner appears with a 1-click cleanup button.

### Step 3: Customize 10 Sorting Rules (Optional)
Click **⚙️ Sort Rules** to fine-tune how you want your playlist organized (e.g., sort intra-artist tracks by release year instead of title A-Z, or change feat. attribution).

### Step 4: Preview Organized Playlist & Artist Stats
Inspect the **Grouped by Artist** view or the **Flat List** view with position displacement badges (`▲ Up 12`, `▼ Down 5`).

### Step 5: Copy Tracks & Paste into Spotify Desktop App
1. Click the green **📋 Copy Tracks** button in the bottom-right corner.
2. Open the **Spotify Desktop Application** on your computer.
3. Click **"+ Create playlist"** on the left sidebar.
4. Click once inside the new playlist's song area.
5. Press `Ctrl + V` (Windows) or `Cmd + V` (Mac).  
   *All tracks will instantly appear in your newly created playlist in exact sorted order!*

---

## 8. Technical Caveats & FAQ

### 1. Why copy & paste to a new playlist instead of in-place mutation?
* **Zero Token / Zero Account Risk**: Spotify's official Web API strictly limits playlist modification endpoints, requires complex OAuth refresh tokens, and is prone to rate limits (HTTP 429) and account security flags on mass modifications.
* **100% Non-Destructive**: Your original playlist remains completely untouched and safe. If you don't like the new arrangement, your original playlist is never altered.
* **Instant Speed**: Pasting 1,000 tracks via Spotify's internal clipboard handler takes under 1 second, compared to minutes of batched HTTP API requests.

### 2. Must I use the Spotify Desktop App to paste?
Yes. The Spotify Web Player does not support OS clipboard track pasting into playlists due to browser security sandboxes. You must paste into the **Spotify Desktop App** (Windows or macOS).

### 3. Pasting into empty (0-track) playlists quirk
Certain versions of Spotify Desktop do not activate the paste listener on an entirely empty (0-track) playlist.  
> 💡 **Solution**: Simply drag or add **1 temporary song** to the new playlist first to initialize its tracklist view. Then press `Ctrl+V` / `Cmd+V` to paste your sorted tracks, and delete that temporary song.

### 4. OS Keyboard Shortcuts
* **Windows / Linux**: `Ctrl + V`
* **macOS**: `Cmd + V`

### 5. Large playlist performance
The tool has been stress-tested on playlists with over 1,500 tracks. DOM scanning and sorting complete in under 3 seconds.

---

## 9. Technical Architecture & Privacy

```
┌─────────────────────────────────────────────────────────────┐
│                    Spotify Web Player                       │
│                   (open.spotify.com)                        │
└──────────────────────────────┬──────────────────────────────┘
                               │ Injected Script (MAIN World)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Spotify Playlist Auto Sorter                  │
│                                                             │
│   ┌────────────────┐   ┌────────────────┐   ┌───────────┐   │
│   │ Track Scanner  │──▶│  Sorter Core   │──▶│ Visual UI │   │
│   │ (DOM/API Feed) │   │ (10 Rules ENG) │   │  & i18n   │   │
│   └────────────────┘   └────────────────┘   └───────────┘   │
│                               │                             │
│                               ▼                             │
│                   Clean Spotify URI Stream                  │
└──────────────────────────────┬──────────────────────────────┘
                               │ System Clipboard Copy
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Spotify Desktop App                       │
│            (Ctrl+V / Cmd+V into New Playlist)               │
└─────────────────────────────────────────────────────────────┘
```

* **Zero Tracking**: No Google Analytics, no telemetry, no remote scripts.
* **Pure JavaScript**: Standard ES6+, zero heavy framework dependencies (no React/Vue overhead).
* **Open Source**: MIT licensed, full code inspectable on GitHub.

---

## 10. License (MIT)

This project is licensed under the [MIT License](./LICENSE). Feel free to use, modify, and distribute it freely.

---

*Made with ❤️ for music lovers and playlist curators worldwide.*
