# C8B — PHP / MySQL edition

C8B now has a PHP front controller intended for PHP shared hosting such as InfinityFree. Existing HTML templates, CSS, JavaScript, logo, and original Node.js source are retained. The PHP entry point handles website pages, local authentication, sessions, contact messages, owner management APIs, uploads, and downloads.

## Runtime
- PHP 8.1+ recommended, with PDO MySQL and Fileinfo enabled (mbstring is recommended).
- A MySQL database created in the hosting control panel.
- Apache with mod_rewrite / .htaccess enabled.

## Configuration
- Copy php/database.config.example.php to php/database.config.php and enter the database connection details provided by the host.
- Upload the repository files to the hosting web root. If the users table does not exist, PHP attempts to create the tables using database/schema.mysql.sql on the first successful database connection.
- The real php/database.config.php is excluded from Git. Never publish database credentials.

## First-time setup

After configuring the database connection and uploading the files, open the site in a browser. If no Owner account exists yet, C8B displays a one-time setup screen. Create the first Owner account there; once it exists, that setup screen is permanently disabled and normal registration creates regular users only.

## Important
- Original Node.js files remain as a reference and are not invoked by the PHP entry point.
- Credentials may be supplied with C8B_DB_HOST, C8B_DB_PORT, C8B_DB_DATABASE, C8B_DB_USERNAME, C8B_DB_PASSWORD, and C8B_DB_CHARSET environment variables, or php/database.config.php.
- Google and Discord OAuth are supported when their client IDs, client secrets, and callback URLs are configured in the private PHP config file. Leave these values blank to hide the OAuth controls.
- SQLite records and runtime uploads are not automatically imported.
- Upload sizes are subject to the limits of the hosting plan and PHP configuration.
