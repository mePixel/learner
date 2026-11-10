# Recall

A mobile-first learning workspace built with React, React Router, shadcn/ui and Vite. An Express server discovers class folders at runtime; SQLite keeps each learner’s progress separate. No account, email or external service is required.

## Run

Requires Node.js 22.22 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:3000. The same server handles the frontend, API and source files. On a phone on the same network, use your computer’s local IP address and port 3000. Copy the learning link from that address so it works on both devices; a localhost link only works on the computer itself.

For a production build:

```sh
npm run build
npm start
```

Use one server with persistent storage and HTTPS when hosting. `PORT` defaults to `3000`, `HOST` to `0.0.0.0`, and `DATA_DIR` to `./data`. Back up the whole data directory. Do not serve the app as a static-only site: progress and folder discovery need the server. SQLite is intended for a single server; use a shared database if you later run multiple server instances.

## Cloudflare Workers

The Cloudflare deployment runs `worker/index.mjs` for `/api/*`, stores learners and progress in D1, and streams original course files from a private R2 bucket. Text and Word previews are prepared during the build. The frontend and learner links work the same way as with the local Express server. Cloudflare classes are discovered at build time: adding or changing classes requires uploading their sources and redeploying.

Workers and D1 have free plans. R2 Standard includes a free monthly allowance, but enabling R2 requires a billing subscription and usage beyond its allowance is billed. Videos cannot be deployed as Workers static assets because each asset is limited to 25 MiB. Git LFS stores the video in GitHub; R2 serves it to learners.

One-time setup:

```sh
npm ci
npx wrangler login
npx wrangler d1 create learner --location weur
```

Set the resulting `database_id` in `wrangler.json`. Enable R2 in the Cloudflare dashboard, then create the bucket:

```sh
npx wrangler r2 bucket create learner-sources
```

Build, upload the original sources (including the LFS video), apply database migrations and deploy:

```sh
git lfs pull
npm run build
npm run upload:sources
npm run deploy
```

For Cloudflare Git builds, set the **build command** to `git lfs pull && npm run build` and the **deploy command** to `npm run deploy`. The build environment must have Git LFS available. Upload source changes with `npm run upload:sources` before deploying the updated catalog. Keep preview builds disabled until they have separate D1 and R2 bindings; otherwise previews share production data. The Worker must deploy with its checked-in configuration, including `main`, `DB`, `SOURCES`, and `/api/*` routing; uploading only `dist` does not deploy the API.

Existing local SQLite progress is not copied into D1 automatically. Keep `data/` and your saved learning links if you need to migrate existing learners. Database migrations create tables without deleting data.

Run `npm run test:worker` to check the Cloudflare API against local D1 and R2 emulators, including learner isolation, concurrent retries, validation and source byte ranges. These tests do not access your Cloudflare account.

## Add a class

Create a folder inside `Classes`. It appears automatically, including when empty. The browser refreshes the catalog every 30 seconds, when refocused, or with **Refresh classes**. No source-code edit or rebuild is needed. In production, add the folder on the server as well.

```text
Classes/
  My new class/
    class.json          optional title and description
    flashcards.json     questions, answers and references
    Sources/
      lecture.pdf
      notes.txt
```

Optional `class.json`:

```json
{
  "title": "My new class",
  "description": "A short description"
}
```

Use `flashcards.json` or any number of `*.cards.json` files anywhere in a class folder. JSON supports multiline text and structured source references more naturally than CSV.

```json
[
  {
    "id": "a-stable-unique-id",
    "topic": "Fundamentals",
    "question": "What should I remember?",
    "answer": "A clear, concise answer.",
    "source": {
      "file": "Sources/lecture.pdf",
      "page": 4,
      "quote": "The actual supporting passage from the original source."
    }
  }
]
```

Keep class folder names and card IDs stable: progress uses both. Card IDs must be lowercase letters, numbers and hyphens, unique within their class. `page` is the PDF’s one-based physical page number, not necessarily its printed page label. Omit it for text, Word and video sources. Supported sources: PDF, TXT, Markdown, DOCX, MP4 and WebM. Text and Word previews highlight the matching paragraph; PDFs open at their cited page and also offer an original-file link for mobile browsers. Video playback supports seeking, but automatic timestamp citations are not implemented.

Invalid content files produce visible errors instead of silently disappearing. Referenced source files must exist inside the class folder. Symlinks are ignored. Adding source files does not generate new flashcards automatically: write or generate the JSON separately, then check the answers against the originals.

The class includes the original 48 AI-generated German flashcards from the slides, transcript, lifecycle handout and Word notes, plus 40 cards in `ethics-introduction.cards.json` from the ethics lecture: 88 cards in total. The ethics cards cover Jonas, Wiener, Weizenbaum, Moor, ethical agency, surveillance capitalism, social media, Value Based Engineering and social teaching. Each new card cites the exact PDF page and a supporting quote. Discussion prompts without supplied answers and provocative quotations are excluded. The flashcards do not claim to cover external articles or videos linked in the handouts. Generated study content displays: **Content generated by AI. AIs can make mistakes.**

### Create cards with Codex

The repo-local [create skill](.agents/skills/create/SKILL.md) handles new and existing classes. Use `/create <source> for <class>` as the project shorthand, or explicitly select `$create` in Codex. It preserves existing IDs and progress, reads the source, adds a supplemental `*.cards.json` deck and validates citations. For example:

```text
/create Classes/Innovationsmanagment/Sources/new-lecture.pdf for Innovationsmanagment
$create Make flashcards from this PDF for a new class called Economics
```

Validate an added deck directly with `node .agents/skills/create/scripts/validate.mjs Classes/<class>/<deck>.cards.json`. Publishing still follows the current task's authorization; the skill itself does not grant access to external services.

## Ask your sources

Open **Ask your sources** in the navigation, or **Ask about this source** in a source preview. Select the class and documents, then enter an API base URL, model ID and your own API key. The chat uses Vercel AI SDK with an OpenAI-compatible adapter, so you can switch providers without changing the app.

Gemini is the suggested provider. To get a Gemini Developer API key, sign in to [Google AI Studio](https://aistudio.google.com/), open [API keys](https://aistudio.google.com/api-keys), and copy the default key or create one in a new or existing Google Cloud project. Paste it into Recall’s API key field. The suggested base URL is `https://generativelanguage.googleapis.com/v1beta/openai` and model is `gemini-3.8-flash`. The in-app guide links to Google’s current pricing and setup documentation. Free access depends on your model, account eligibility and project quota; leave billing disabled to stay on the free tier. Free-tier content may be used to improve Google’s products.

**Privacy:** provider settings, the API key and conversation stay in page memory. They are never saved to Recall’s server, D1, R2, localStorage or sessionStorage. Leaving the chat area, reloading, or using **Forget settings and chat** clears them. The extracted document cache is also cleared when leaving the page. Model requests go directly from the browser to the selected provider with no cookies, referrer, cache or redirects. The provider receives your question, recent conversation and selected source excerpts. Providers must allow browser requests (CORS); there is no server proxy fallback. Keys cannot be sent to Recall’s own origin. HTTPS is required except for local models on localhost.

PDF text is extracted in the browser with page references. Text and Word files use the existing text-preview API. A video uses a matching `.txt` transcript; it is not transcribed or watched by the model. Scanned or encrypted PDFs need an accessible text or OCR version. The chat selects up to 12 relevant passages locally and links to those sources; it does not send every page of a large document or use embeddings. AI answers can still be wrong—check the original passages.

## Learners and links

A first visit creates a learner with a cryptographically random private link. **My learning link** lets you copy it, change the display name, create a separate learner, or switch between learners remembered by this browser. Opening the copied link on a different device restores that learner’s progress from the server. Names need not be unique.

Links contain the secret in the URL fragment, so it is not sent as part of a page request or referrer. The app clears it from the address bar after restoring the learner, remembers it locally, and sends it in an Authorization header. The database stores only a hash of the secret. Anyone who has a link can read and change that learner’s progress. There is no email recovery: keep a copy. Class material is shared with everyone who can reach the app; learner links protect progress, not course access.

Review sessions contain up to 10 new or due cards. Tap or click the card to flip it. Once the answer is revealed, swipe left for **Again** or right for **Got it**, or use the rating buttons. Space reveals the answer; 1 and 2 rate it. Vertical swipes scroll without submitting a rating. **Again** schedules a review in 10 minutes. **Got it** uses 1, 3, 7, 14, then 30-day intervals; three consecutive successful recalls mark a card as mastered. Progress is saved after each rating, with idempotent retries to avoid counting a failed network request twice. Offline study is not supported; a failed save stays visible until retried. Other-device changes appear on refocus or within 30 seconds.

## Checks

```sh
npm test
npm run build
```

The tests cover class discovery, malformed content, duplicate IDs, source access, learner isolation, authentication, review scheduling, duplicate submissions, Word preview and byte-range source delivery.
