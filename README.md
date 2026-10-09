# C8B — PHP / MySQL edition

C8B now has a PHP front controller intended for PHP shared hosting such as InfinityFree. Existing HTML templates, CSS, JavaScript, logo, and original Node.js source are retained. The PHP entry point handles website pages, local authentication, sessions, contact messages, owner management APIs, uploads, and downloads.

## Runtime
- PHP 8.1+ recommended, with PDO MySQL and Fileinfo enabled (mbstring is recommended).
- A MySQL database created in the hosting control panel. The PHP app creates its tables, but shared hosts generally do not let an app create the database itself.
- The `pdo_mysql` extension enabled for the exact PHP runtime serving the site (not just another installed PHP version).
- Apache with mod_rewrite / .htaccess enabled.

## Configuration
- Create a MySQL database and database user in your host's control panel first. Copy `php/database.config.example.php` to `php/database.config.php`, then enter the exact host, database name, username, and password provided by the host. Do not commit the real config file.
- Upload the repository files to the hosting web root. After a successful connection, PHP creates any missing tables from `database/schema.mysql.sql`, including when a database was only partially initialized.
- For local development, verify the same PHP binary used by `php -S` has the MySQL PDO driver: run `php --ini` and `php -m` and confirm both `PDO` and `pdo_mysql` are listed. Installing a package for PHP 8.3 will not enable it in a PHP 8.4 runtime; restart the local PHP server after enabling the correct extension.
- The real php/database.config.php is excluded from Git. Never publish database credentials.

## Default Owner login

On a fresh database, C8B automatically creates the Owner account:
- Username: `admin`
- Password: the password provided by the site owner for this deployment.

The account is created automatically when the database has no Owner account, so there is no separate Owner-creation page to complete. Sign in at `/login`; the Owner dashboard is at `/owner`. Normal user registration remains available at `/register` and creates regular user accounts only. Change the default password after first login if you add password-change support or update the stored hash securely.

## Important
- Original Node.js files remain as a reference and are not invoked by the PHP entry point.
- Credentials may be supplied with C8B_DB_HOST, C8B_DB_PORT, C8B_DB_DATABASE, C8B_DB_USERNAME, C8B_DB_PASSWORD, and C8B_DB_CHARSET environment variables, or php/database.config.php.
- Google and Discord OAuth are supported when their client IDs, client secrets, and callback URLs are configured in the private PHP config file. Leave these values blank to hide the OAuth controls.
- SQLite records and runtime uploads are not automatically imported.
- Upload sizes are subject to the limits of the hosting plan and PHP configuration.
