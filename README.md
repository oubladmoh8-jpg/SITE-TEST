# C8B

C8B is a Node.js/Express project platform. Phase 2 adds SQLite initialization, server-side registration/login, persistent sessions, optional Google/Discord OAuth, and Owner authorization middleware. Project management and uploads are intentionally not implemented yet.

## Requirements

- Node.js 20 or newer
- npm

## Local setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env`. Keep `.env` local; it is ignored by Git.
3. Generate a session secret and put it in `.env`:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

4. Generate an Owner password hash:

   ```sh
   node scripts/hash-password.js
   ```

   Set the printed bcrypt hash as `OWNER_PASSWORD_HASH` in your local `.env`. Set `OWNER_USERNAME=admin` (or another reserved username) and optionally `OWNER_EMAIL`. No default Owner password is created. If no valid hash is configured, the app still runs, but it does not seed an Owner account.

5. Start the app:

   ```sh
   npm start
   ```

   Visit `http://localhost:3000/login` or `/register`. The SQLite application database and SQLite-backed session store are created automatically under `database/`.

## Optional OAuth

OAuth is disabled unless both the client ID and client secret are configured for a provider. Register these callback URLs in the respective provider console and set the matching variables in `.env`:

- Google: `http://localhost:3000/auth/google/callback`
- Discord: `http://localhost:3000/auth/discord/callback`

OAuth login requires a verified email. OAuth accounts are not automatically linked to an existing account based only on email. Never commit OAuth credentials.

## Security notes

- Passwords are hashed with bcrypt; SQL access uses prepared statements.
- Session cookies are HttpOnly, SameSite=Lax, and Secure in production.
- The app uses Helmet CSP, CSRF tokens for state-changing authentication requests, and authentication rate limits.
- Normal registrations always receive the `user` role. Owner access is checked server-side.
- Configure HTTPS and a stable random `SESSION_SECRET` before production deployment.
- The `/app` page is only a Phase 2 authentication confirmation placeholder, not a project dashboard.
