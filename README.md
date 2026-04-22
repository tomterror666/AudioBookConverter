# AudioBookConverter

AudioBookConverter is a macOS app that converts a folder of MP3 files into a single audiobook file.

The app is built with React Native for macOS and includes a conversion pipeline that can:
- scan MP3 tracks and detect chapter boundaries,
- merge tracks into one audio file with chapter metadata,
- export a final audiobook file (`.m4b`).

## Platform

This project is currently focused on **macOS**.

## What You Need

Before starting the app, make sure these dependencies are available:

- Node.js 18 or newer
- npm
- Xcode (opened at least once)
- CocoaPods
- `ffmpeg` and `ffprobe` in your PATH
- Python 3

For full conversion functionality, create a Python virtual environment in the repository named `.audioBookConverter` and install the required Python packages (for example `faster-whisper`).

**Google Books API key (optional).** The app can look up a book cover for the selected folder name via the Google Books API. You may set `GOOGLE_BOOKS_API_KEY` in a local `.env` file (see `.env.example` in the repository root; copy it to `.env` and add your key). That file is not tracked by git. If no key is set, unauthenticated access still works but with stricter rate limits. Providing a key is only for convenience and is not required to run the rest of the conversion pipeline.

## Getting Started

### 1) Install JavaScript dependencies

```bash
npm install
```

### 2) Install macOS Pods

```bash
cd macos
pod install
cd ..
```

### 3) Start Metro

Open terminal 1:

```bash
npm start
```

### 4) Launch the macOS app

Open terminal 2:

```bash
npx react-native run-macos
```

## How to Use

1. Start the app.
2. Select the folder that contains your MP3 files.
3. Run the conversion pipeline from the UI.
4. Wait for processing to finish.

Expected output files in your selected project/output folder:
- `AudiobookConverter_kapitel.log`
- `AudiobookConverter_merged.m4a` (intermediate file)
- `AudiobookConverter.m4b` (final audiobook)

## Troubleshooting

- If native build errors appear, run `pod install` again in `macos/`.
- If Xcode build cache causes issues, use **Product -> Clean Build Folder**.
- If dependency checks fail in the app, verify `ffmpeg`, Python, and the `.audioBookConverter` environment.
