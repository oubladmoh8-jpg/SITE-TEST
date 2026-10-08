# C8B

C8B is a Node.js/Express project platform with SQLite-backed accounts, secure sessions, a protected Owner Control Center, public project discovery, and server-hosted downloads.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

1. Clone the repository and enter its directory:

   ```sh
   git clone https://github.com/oubladmoh8-jpg/SITE-TEST.git
   cd SITE-TEST
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Create your local environment file:

   **Windows PowerShell**
   ```powershell
   Copy-Item .env.example .env
   ```

   **macOS / Linux**
   ```sh
   cp .env.example .env
   ```

4. Generate a session secret and put it in `.env` as `SESSION_SECRET`:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

5. Generate a strong Owner password hash:

   ```sh
   node scripts/hash-password.js
   ```

   Enter a password of at least 12 characters with lowercase, uppercase, and a number. Copy the printed bcrypt hash into `.env` as `OWNER_PASSWORD_HASH`. Do not put the plain password or hash in Git.

6. Set the Owner identity in `.env`:

   ```dotenv
   OWNER_USERNAME=admin
   OWNER_EMAIL=your-owner-email@example.com
   OWNER_PASSWORD_HASH=paste_the_generated_bcrypt_hash_here
   SESSION_SECRET=paste_a_random_secret_here
   NODE_ENV=development
   PORT=3000
   ```

   Use a unique email address. The Owner account is created/updated on server startup only when `OWNER_PASSWORD_HASH` is a valid bcrypt hash. No default password is supplied. Normal registrations always receive the `user` role and cannot self-promote.

7. Start the application:

   ```sh
   npm start
   ```

   For automatic restart while editing:
   ```sh
   npm run dev
   ```

8. Open these local pages:

   - Home: `http://localhost:3000/`
   - Projects: `http://localhost:3000/projects`
   - About: `http://localhost:3000/about`
   - Contact: `http://localhost:3000/contact`
   - Sign in: `http://localhost:3000/login`
   - Register: `http://localhost:3000/register`
   - Owner Control Center: `http://localhost:3000/owner` (Owner account only)

The SQLite database and session store are created under `database/`. Project files and uploaded images are stored locally under `uploads/`; both directories are runtime data and are intentionally ignored by Git.

## Publishing a project

1. Sign in with the Owner credentials configured above and open `/owner`.
2. Create a category if needed.
3. Create a project and fill in its title, description, version, category, features, requirements, changelog, and external links.
4. Save the project, then use the project media controls to upload an icon, banner, and screenshots.
5. Upload one or more downloadable files in the project's file manager.
6. Set the project status to **Published**. Draft and archived projects do not appear on the public site.
7. A normal user can open the published project page, read its details, and sign in to download active files. Downloads stream from this server and are recorded in SQLite.

## Public site and contact

- Public project pages are server-rendered from the SQLite database; project cards, categories, statistics, details, active files, and download counts are dynamic.
- Downloads require authentication. The Owner dashboard and Owner APIs enforce server-side role checks and are not linked in normal public navigation.
- Contact form messages are stored in the SQLite `contact_messages` table.
- The public brand first tries `public/assets/logo.jpeg` and falls back to the included C8B SVG wordmark if the JPEG is absent.

## Optional OAuth

OAuth is disabled unless both the client ID and client secret are configured for a provider. Register these callback URLs in the relevant provider console and set the matching variables in `.env`:

- Google: `http://localhost:3000/auth/google/callback`
- Discord: `http://localhost:3000/auth/discord/callback`

OAuth login requires a verified email. OAuth accounts are not automatically linked to an existing password account based only on email. Never commit OAuth credentials.

## Security and deployment notes

- Passwords are hashed with bcrypt; SQL access uses prepared statements.
- Session cookies are HttpOnly, SameSite=Lax, and Secure in production.
- Helmet CSP, CSRF verification, and rate limits protect sensitive operations.
- Uploads use random server-side filenames, extension allowlists, signature checks for common file types, and configurable size limits (`UPLOAD_MAX_MB`, default 100 MB; images up to 10 MB).
- Configure HTTPS, a stable random `SESSION_SECRET`, and production environment variables before deployment.
- Back up the local `database/` and `uploads/` directories. Do not commit `.env`, database files, or user uploads.
