RASOI - household meal agent (free stack)
GitHub (code) + Netlify free plan (app, scheduled jobs) + Google Sheets (data)
+ Gemini API free tier (suggestions, bill reading)
+ Web Push (app notifications on each phone). No paid subscriptions.

The agent stays OFF until the Setup checklist is complete. Required before go-live:
allergies for every family member (write "none" if none) and notifications
turned on for every family member. The cook does not need the app. Diet, spice level,
favourites etc. can be filled or changed in the Family tab at any time.


DAILY FLOW (UAE time)
12:00  notification to the family: 3 options. Vote in the app.
12:50  reminder to anyone who has not voted
13:00  vote closes. Tie or no votes: option with the fewest items to buy wins.
       Family: dish + list of items to buy. One person taps "I am buying"; the others are told.
       Anyone taps "Send recipe to cook" (Hindi or English) to share it on WhatsApp.
       Sunday, or when someone taps "Cook is off today": off-day options instead,
       or the dish moves to the next day if already decided.
In the app anytime: Mark as cooked (pantry goes down), rate the dish, add a bill photo (pantry goes up).
Before 1pm: "I am not eating tonight", guests for dinner, "Cook is off today", "No cooking today (eating out)".
If nobody taps "cooked", the dish is marked cooked automatically at the next day's 12:00.
Daily-use items in Settings > ALWAYS_STOCKED are never put on the shopping list and are not tracked.
Pantry day 1: Pantry tab > "Add many at once", one item per line (toor dal 2 kg).


FILES
netlify/functions/app.mjs      data and actions for the app (household password)
netlify/functions/vote.mjs     12:00 scheduled job
netlify/functions/remind.mjs   12:50 scheduled job
netlify/functions/close.mjs    13:00 scheduled job
lib/agent.js     all the logic and AI prompts
lib/sheets.js    Google Sheets read/write, tab layout, default settings
lib/ai.js        Gemini call
lib/push.js      notifications
public/          the installable app (index.html, sw.js, manifest, icons)
scripts/check.mjs  logic checks: npm run check


SETUP

1. Google Sheet (free)
   - Create an empty Google Sheet. Copy its ID from the URL (between /d/ and /edit).
   - console.cloud.google.com: create a project, enable "Google Sheets API".
   - IAM > Service Accounts: create one, then Keys > Add key > JSON. Note client_email and private_key.
   - Share the Sheet with the client_email as Editor.
   No billing account is needed for the Sheets API.

2. Gemini (free)
   - aistudio.google.com > Get API key. No card needed.
   - Note: on the free tier Google may use prompts to improve its products. Prompts include
     first names, diets, allergies and pantry items, nothing else.
   - Default model is gemini-2.5-flash. If Google retires it, set GEMINI_MODEL to the current Flash model.

3. Notification keys (free, one time)
   - Run:  npx web-push generate-vapid-keys
   - Note the Public Key and Private Key.

4. GitHub + Netlify
   - Push this folder to a private GitHub repo.
   - Netlify > Add new site > Import from GitHub. Build command: empty. Publish directory: public.
   - Site configuration > Environment variables:
       SHEET_ID
       GOOGLE_CLIENT_EMAIL
       GOOGLE_PRIVATE_KEY     the full key including BEGIN/END lines
       GEMINI_API_KEY
       GEMINI_MODEL           optional
       VAPID_PUBLIC_KEY
       VAPID_PRIVATE_KEY
       VAPID_SUBJECT          mailto:your-email
       APP_PASSWORD           household password for the app
     Netlify functions allow about 4 KB of environment variables in total; these fit.
   - Deploy. Netlify installs web-push from package.json automatically.

5. First run in the app (https://YOUR-SITE.netlify.app)
   - Enter APP_PASSWORD
   - Setup > Create sheet tabs
   - Family: add each person and the cook. Allergies are needed now; the rest can come later.
   - On each family member's phone:
       Android: open the site in Chrome > menu > Add to Home screen > open it > Turn on notifications
       iPhone (iOS 16.4+): open in Safari > Share > Add to Home Screen > open it from there > Turn on notifications
       Choose who you are when asked.
   - Preview today's options until the suggestions look right
   - Go live

6. Timing and testing
   - Scheduled functions run at 08:00, 08:50 and 09:00 UTC (12:00, 12:50, 13:00 UAE).
   - To test at any time: Netlify > Logs and metrics > Functions > vote (or close) > Run now.


KNOWN LIMITS (deliberate, simple first)
- Netlify free functions have short time limits (about 10 s for app actions, 30 s for scheduled jobs).
  Gemini Flash with thinking off fits; if a bill photo times out, retake it closer and straighter.
- Pantry matching is by item name + unit. The AI is told to reuse pantry names and units.
- The allergy check after the AI is a plain word match. Write allergies as concrete items
  ("peanut, prawn, milk"), not categories ("nuts, dairy").
