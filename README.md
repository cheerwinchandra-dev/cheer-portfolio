# Cheerwin Chandra · Portfolio (Netlify)

Your AI/ML engineer portfolio, styled after the dark red "PORTFOLIO" poster template, with:

- **Smooth animations.** The letters rise in, the photo fades up over the red sun, a band of your skills slides along and speeds up with your scrolling, sections and headings slide in, project covers wipe in, the process line glides, and scrolling has a soft, inertial feel. Visitors who turn on "reduce motion" get a calm, still page.
- **Projects that update themselves.** A new GitHub repo appears in *Featured work* on its own. The data refreshes whenever it is more than 15 minutes old, plus once a day by a scheduled job.
- **A contact form.** Visitors' messages are saved in your own database.
- **A private dashboard at `/login`.** Only you can sign in. Read and reply to messages, choose which projects show, edit every word on the site, and manage your password.
- **Security built in.** Hashed passwords, lockouts, secure sessions, CSRF protection and strict security headers. Details are [below](#security).

It runs on **Netlify** (free plan) with a free **Neon Postgres** database.

## Where do I read the messages people send me?

Open **`https://<your-site>/login`** (or press **Owner login** at the bottom of your site), sign in with username **`cheerwin`** and your password, and you land in the **Inbox**. Every message from the contact form is there, newest first, with the sender's name, email, topic and text. New ones appear within 20 seconds.

---

## 1. Put it online (about 15 minutes, no terminal needed)

### Step 1: Put the code on GitHub
1. **Unzip** `cheerwin-portfolio-netlify.zip` first (Windows: right-click → **Extract All**; Mac: double-click it). Open the folder it creates. You should see four folders, **`lib`**, **`netlify`**, **`public`** and **`scripts`**, plus files such as `package.json` and `netlify.toml`.
2. On [github.com/new](https://github.com/new), create a repository, for example `portfolio`. Private is fine.
3. Click **uploading an existing file**. In the unzipped folder, select everything (**Ctrl+A**, or **⌘A** on a Mac) and drag it onto the GitHub page, so the four folders go up as folders. Don't upload the .zip file itself, and skip `node_modules` if you have one. Click **Commit changes**.
4. Check your repository's main page: the folders `lib`, `netlify`, `public` and `scripts` must be listed at the top. If you see loose files such as `app.js` or `site.css` there instead, the folders were lost and the Netlify build will stop with a message saying so; upload again as in item 3.

### Step 2: Import it into Netlify
1. On [app.netlify.com](https://app.netlify.com), click **Add new project** → **Import an existing project** → **GitHub**, allow Netlify to see your repositories, and pick your `portfolio` repository.
2. Leave the build settings as they are (`netlify.toml` fills them in) and click the deploy button at the bottom of the page.
3. When it finishes, your site is live at an address like `https://your-name.netlify.app`. The pages work right away; the contact form and sign-in need steps 3 and 4.

### Step 3: Create the free database (Neon)
1. Sign up at [neon.com](https://neon.com) (the free plan is enough) and create a project. For the region, choose **AWS US East (Ohio)**, which is where Netlify runs your API by default.
2. Click **Connect**, keep **Connection pooling** on, and copy the connection string. It starts with `postgresql://` and contains a password, so keep it private.
3. In Netlify, open your project → **Project configuration** → **Environment variables** → **Add a variable**. Key: `DATABASE_URL`. Value: the connection string. Keep all scopes and deploy contexts, and save it. The tables are created automatically on first use.

### Step 4: Set your admin password
1. Open **`https://<your-site>/admin/setup`**, type your password twice and click **Create value**. Everything happens in your browser; nothing is sent anywhere. Pick a password you don't use anywhere else, and never write it in a README or a repository description.
2. Add a second variable the same way as in step 3. Key: `ADMIN_PASSWORD_HASH`. Value: the text from the setup page.
3. Open **Deploys** → **Trigger deploy** and pick the first option. New settings only apply after a new deploy.

Now sign in at **`https://<your-site>/login`** with username **`cheerwin`** and your password.

> Prefer the terminal? Run `npm install`, then `npm run hash-password`, which prints the same value.

## 2. Everyday use (no code needed)

| You want to… | Go to |
| --- | --- |
| Read messages from visitors | `/login` → **Inbox**. It refreshes every 20 seconds, and the tab title shows unread messages. |
| Reply to someone | Open the message → **Reply by email** (opens your mail app with their address filled in) |
| Keep a copy of all messages | Inbox → **Export CSV** (opens in Excel or Google Sheets) |
| Choose which projects show, and in what order | **Projects** → *Pin*, *Show* or *Hide*, then *Edit card* for a nicer title, headline or description |
| Show a new GitHub repo right now | **Projects** → **Sync with GitHub now** |
| Change your role, bio, services, tools or contact details | **Profile** → edit → **Save changes**. The site updates immediately. |
| Change your password, see signed-in devices or sign-in history | **Security** |

The **Owner login** button at the bottom of your site also opens the dashboard (`/admin` and `/dashboard` work too).
Every time you push changes to GitHub, Netlify publishes them automatically. Dashboard changes (text, projects, password) don't need a new deploy.

## 3. Changing the code or photos

```bash
npm install
npm run hash-password -- --local   # once: saves a test password in .env.local
npm run dev                        # open http://localhost:3000
```

`npm run dev` follows the same headers and addresses as Netlify (`public/_headers` and `public/_redirects`) and uses a separate local database in the `.data/` folder, so testing never touches your real messages. To work against your real database instead, add `DATABASE_URL='…'` (your Neon connection string) to `.env.local`.

- **Photos** are in `public/img/`. `hero-cheerwin.webp` (and the smaller `hero-cheerwin-420.webp`) is the cut-out in the suit, and `about-cheerwin.webp` is the About photo. Keep the transparent background and the same file names.
- **Default text** is in `public/js/shared/defaults.js`. You normally edit text in the dashboard instead.
- **Colors and fonts** are at the top of `public/css/site.css`.

## 4. Optional extras

- **Your own domain** (like `cheerwin.dev`): in Netlify, open **Domain management** → **Production domains** → **Add a domain**. Trigger a deploy afterwards so link previews use the new address.
- **More reliable GitHub updates.** Without a token, GitHub allows about 60 requests an hour, shared with other sites on Netlify's servers. If projects stop updating, create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with *Public repositories (read-only)* access, add it as the environment variable `GITHUB_TOKEN`, and trigger a deploy.

## Free plan limits

Netlify's free plan has **300 credits a month** (for accounts created since September 2025; older accounts keep Netlify's earlier free plan). Each production deploy (every push to GitHub, or **Trigger deploy**) uses 15. A first-time visit to your portfolio downloads about 250 KB in about 20 requests, which costs roughly 0.01 credits; the daily GitHub job and your dashboard use almost nothing. With a few deploys a month, that covers roughly 20,000 first-time visits. If the credits run out, Netlify pauses the site until the next month, so group your code changes into a few pushes rather than many small ones. Neon's free plan (1 GB of storage, 100 compute hours a month) is far more than this site needs.

## Forgot your password?

Open `/admin/setup`, create a new value, replace `ADMIN_PASSWORD_HASH` in Netlify and trigger a deploy. This works even if you had changed your password in the dashboard: a new `ADMIN_PASSWORD_HASH` always takes over.

## Security

| Protection | How |
| --- | --- |
| Password storage | Only a salted **PBKDF2-SHA256** hash (310,000 rounds) is stored, in a Netlify environment variable or the database. The password itself is never stored or logged. |
| Guessing attacks | 5 wrong attempts lock sign-in from that network for **15 minutes**, doubling on each repeat (up to 24 hours). IPv6 networks count as one. 30 failures from anywhere within 15 minutes pause all sign-ins for 10 minutes. The visitor's address comes from Netlify itself, so faked headers can't get around a lockout. Every attempt is logged in *Security*. |
| Timing leaks | A wrong username and a wrong password take the same time and show the same message. |
| Sessions | A random 256-bit token in an `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-` cookie. Only its SHA-256 hash is stored. You are signed out after 2 hours idle or 12 hours at most, and the inbox auto-refresh does not keep you signed in. At most 5 devices stay signed in, and changing your password signs out the others. |
| Cross-site attacks (CSRF) | Every change must come from your own domain over HTTPS (checked with `Origin` and `Sec-Fetch-Site`), and the session cookie is never sent by other sites. |
| Injected code (XSS) | Everything visitors type is stored and shown as plain text. A strict Content Security Policy allows only this site's own scripts. |
| Clickjacking and sniffing | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy` on every page (set in `public/_headers`) and every API response (set in `lib/http.js`, because Netlify doesn't add `_headers` to functions). |
| Spam on the contact form | Hidden honeypot field, a minimum time on the page, 5 messages per hour per network, 300 per day in total, duplicate detection and a 5-link limit. |
| Bad input | Strict size limits and validation on every field. SQL uses bound parameters only. CSV export is protected against spreadsheet formula injection. |
| Scheduled job | The daily GitHub refresh is a Netlify scheduled function. It has no web address, so nobody else can start it. |
| Your GitHub descriptions | Anything that looks like `User: … Password: …` in a repository description is removed before it is shown. |
| Privacy | IP addresses are stored only as a salted fingerprint for rate limits, or masked (like `103.21.x.x`) in the sign-in log. The dashboard is never indexed by search engines. Database tables start with `pf_`, so they never clash with another app's tables. |

## Troubleshooting

| Message | Fix |
| --- | --- |
| Your `netlify.app` address shows a Netlify error page | If it says *Site not available*, the month's free credits ran out (see [Free plan limits](#free-plan-limits)). Otherwise no deploy has finished yet: open **Deploys**, click the newest one and read its log; the next row is the usual cause. |
| Deploy log: "Some folders are missing from your GitHub repository" | The folders `lib`, `netlify`, `public` and `scripts` didn't reach GitHub. Upload them as folders (Step 1, item 3). |
| "Sign-in is not set up yet" | Add `ADMIN_PASSWORD_HASH` (step 4), then trigger a deploy. |
| "The database is not connected yet" | Add `DATABASE_URL` (step 3), then trigger a deploy. |
| "Too many failed attempts" | Wait for the time shown. Changing networks also works, for example mobile data instead of Wi-Fi. |
| Projects don't show a new repo | Dashboard → **Projects** → **Sync with GitHub now**, or on the **Functions** page in Netlify open `github-refresh` and click **Run now**. If it says GitHub can't be reached, add a `GITHUB_TOKEN`. |
| The first page load after a quiet spell is slow | The free database sleeps after 5 minutes without use and wakes in about a second. Your site still shows straight away. |

## What's inside

```
public/              the website (served as-is by Netlify)
  index.html         portfolio page
  admin/             dashboard (index.html) and password setup (setup.html)
  _headers           security headers for every page and file
  _redirects         the /login, /dashboard and /admin/setup addresses
  css/ js/ fonts/ img/
  js/shared/         code shared by the site and the server (defaults, project rules, HTML, hashing)
netlify/functions/   api.mjs (every /api/* request) and github-refresh.mjs (the daily job)
lib/                 server code: routes, sign-in, sessions, rate limits, validation, GitHub, database
scripts/             build step, local dev server, hash-password
netlify.toml         build settings: build command, Node 22, publish and functions folders
```

Fonts: Anton, DM Serif Display, Manrope and Mrs Saint Delafield (SIL Open Font License). Smooth scrolling: Lenis (MIT). QR codes: qrcode-generator (MIT).
