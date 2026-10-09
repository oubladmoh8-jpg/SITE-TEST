# C8B — PHP with a simple file database

C8B uses PHP and a single SQLite database file instead of requiring a MySQL server. On the first request, it creates the `database/` folder if needed, creates `database/c8b.sqlite`, and initializes the tables automatically.

## Requirements

- PHP 8.1+ with `pdo_sqlite` and Fileinfo enabled (`mbstring` recommended).
- Apache with `.htaccess` / mod_rewrite enabled.
- PHP must have permission to write to the `database/` folder. The repository's `.htaccess` blocks direct web access to that folder.

## Getting started

1. Upload the repository to PHP hosting or run it on a local PHP server.
2. Enable the PHP `pdo_sqlite` extension for the active PHP version.
3. Visit the site. The database file and all eight tables are created automatically; no MySQL control panel or database credentials are required.
4. Sign in at `/login` using the Owner account credentials already provided for this deployment.

By default the database file is `database/c8b.sqlite`. To store it outside the public web directory, set the `C8B_DB_PATH` environment variable to an absolute writable path, or set `path` in the private `php/database.config.php` file. Do not commit that private file.

## Important

- GitHub Pages only serves static files; it cannot run PHP or write a SQLite database. This PHP version must run on PHP hosting or a local PHP server.
- SQLite is a file, so back up `database/c8b.sqlite` along with any files in `uploads/`.
- Existing HTML templates, CSS, JavaScript, logo, and original Node.js source are retained.
- Google and Discord sign-in need their OAuth credentials configured in the private PHP config file.
- Upload sizes are subject to the hosting plan and PHP configuration.
