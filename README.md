# RollScout

**Script in. B-roll out.** Upload a video script and RollScout finds matching images and videos for every topic in it, across the stock media platforms you connect. Preview everything, then download it one file at a time, by topic, or all at once as a ZIP.

## How it works

1. **Upload the script.** TXT, Markdown, DOCX, PDF, SRT, VTT, RTF or Fountain, or paste the text.
2. **Connect platforms.** Paste the API key of each platform you want searched. Only connected platforms are used.
3. **Review topics.** RollScout splits the script into topics and writes search phrases for each. Rename topics, edit phrases or add your own.
4. **Get media.** For every topic RollScout searches all connected platforms, ranks the results by relevance and shows at least **5 images and 5 videos** (10 of each by default, up to 30). If the connected platforms together have fewer than 5, it says so for that topic.
5. **Download.** Single files, one topic, only a topic's images or videos, your selection, or everything. ZIPs are organised as `01-topic-name/images/...` and `01-topic-name/videos/...` and include a `CREDITS.txt` with author, source page and license for every file.

## Supported platforms

| Platform | Images | Videos | Key | Get a key |
|---|---|---|---|---|
| Pexels | ✓ | ✓ | Required (free) | https://www.pexels.com/api/ |
| Pixabay | ✓ | ✓ | Required (free) | https://pixabay.com/api/docs/ |
| Unsplash | ✓ | | Required (free, use the app's Access Key) | https://unsplash.com/developers |
| Wikimedia Commons | ✓ | ✓ | Not needed (opt in) | https://commons.wikimedia.org/ |

Adding another platform means writing one connector in `server/providers/` (see `pexels.js` for the shape) and listing it in `server/providers/index.js`.

## Topic detection

- **Built-in (default, free, offline).** Uses headings (`# Heading`, `SCENE 1`, `[INTRO]`, `INT. KITCHEN - DAY`, short ALL CAPS lines), then paragraphs, and groups related paragraphs together. It extracts names and noun phrases ("Great Barrier Reef", "green sea turtles") as search phrases.
- **AI (optional).** Choose "AI (Claude)" under *Search settings* and add an Anthropic API key to get smarter topic splits and camera-friendly search phrases. If it fails, RollScout falls back to the built-in detector automatically.

**Tip:** visual cues in the script such as `[B-roll: aerial view of a city at night]` or a line starting `VISUAL:` are used as the first search phrase for that topic.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm start
# open http://localhost:3000
```

Optional environment variables (handy when hosting it for a team, so people do not need their own keys):

| Variable | Purpose |
|---|---|
| `PORT` / `HOST` | Where the server listens (default `127.0.0.1:3000`; use `HOST=0.0.0.0` to expose it) |
| `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY` | Server-side platform keys, used when a user leaves the field empty |
| `ANTHROPIC_API_KEY` | Server-side key for AI topic detection |

## Privacy and licensing

- Keys are sent to the RollScout server only to call the platforms and are never written to disk. "Remember my keys" stores them in your own browser only.
- Downloads are streamed through the server and only from the platforms' media hosts.
- Each file keeps its platform's license. Pexels, Pixabay and Unsplash content is free to use; Wikimedia Commons files often require attribution. Check `CREDITS.txt` before publishing.

## Development

```bash
npm test        # unit and API tests (platform APIs are mocked)
npm run dev     # restart on file changes
```

Project layout:

```
server/
  index.js          Express app and API routes
  scriptParser.js   File upload to text
  topics.js         Built-in topic detection
  aiTopics.js       Optional Claude topic detection
  search.js         Multi-platform search, minimum-per-topic logic
  rank.js           Relevance scoring
  download.js       Single file and ZIP downloads
  providers/        One connector per platform
public/             Web interface (plain HTML, CSS, JS)
test/               node:test suites
```
