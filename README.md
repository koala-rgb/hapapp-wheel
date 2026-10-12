# Harvest — Spin the Wheel (JavaScript + SQLite)

Harvest is the browser-JavaScript version of the autumn-themed spin wheel. It keeps the modern fall palette, upright labels, fixed maple-leaf center, and animated spin. A small Node.js backend stores both the choice list and recent results in a local SQLite database, so data survives server restarts.

## Requirements

- Node.js **22.5 or newer** (uses Node's built-in `node:sqlite` module).
- A modern browser.
- No npm packages or network connection are needed after Node.js is installed.

## Run on Windows

1. Extract this folder.
2. Double-click `start.bat`.
3. Your browser opens `http://127.0.0.1:8080/`. Keep the terminal window open while using the app.
4. Press `Ctrl+C` in the terminal to stop the server.

## Run on macOS / Linux

From a terminal, run:

```sh
./start.sh
```

Then open `http://127.0.0.1:8080/` in your browser. The server binds to `127.0.0.1` only, so it is accessible from your own computer by default. To use a different port, set `PORT`, for example `PORT=8090 node server.js`.

## Database and persistence

The app creates `data/harvest.sqlite` automatically on first launch. It contains:

- **choices** — the current ordered list of wheel options;
- **recent_results** — the latest 20 winners, including timestamps;
- **settings** — the remove-winner preference.

The first launch seeds the database with Coffee, Tea, Tacos, Sushi, Pizza, Burgers, Pasta, and Surprise me. After that, the database is the source of truth; there is no `choices.txt` configuration file.

Edit the list in the interface and click **Apply list** to save it to SQLite. Use **Restore defaults** to replace the current choice list with the sample list. The **Shuffle** button shuffles and saves the database order. Winners are inserted into the result history transactionally when selected, and the history remains available after stopping and starting the server again. **Clear history** deletes saved results from the database. The remove-winner setting is also saved between launches.

The database file is ordinary SQLite and can be backed up by stopping the server and copying `data/harvest.sqlite`.

## Limits and behavior

- Up to 100 choices are supported.
- Each choice can be up to 140 characters.
- Recent result history is capped at 20 entries in storage and displays the five most recent.
- With remove-winner enabled, a selected choice is removed from SQLite after a spin, unless it is the final remaining choice.
- The browser animation uses JavaScript; the backend uses Node.js JavaScript and Node's built-in SQLite API. No third-party runtime libraries are required.
