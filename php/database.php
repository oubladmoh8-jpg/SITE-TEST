<?php
declare(strict_types=1);

/**
 * Simple file-based SQLite database. The database is stored at database/c8b.sqlite.
 * Set C8B_DB_PATH to move it outside the public web directory on production hosting.
 */
function c8b_database(): PDO
{
    static $connection = null;
    if ($connection instanceof PDO) return $connection;

    $configPath = __DIR__ . '/database.config.php';
    $config = is_file($configPath) ? require $configPath : [];
    if (!is_array($config)) throw new RuntimeException('The database configuration must return an array.');

    foreach ([
        'google_client_id' => 'GOOGLE_CLIENT_ID', 'google_client_secret' => 'GOOGLE_CLIENT_SECRET', 'google_callback_url' => 'GOOGLE_CALLBACK_URL',
        'discord_client_id' => 'DISCORD_CLIENT_ID', 'discord_client_secret' => 'DISCORD_CLIENT_SECRET', 'discord_callback_url' => 'DISCORD_CALLBACK_URL',
    ] as $configKey => $environmentName) {
        if ((getenv($environmentName) === false || getenv($environmentName) === '') && !empty($config[$configKey])) {
            putenv($environmentName . '=' . $config[$configKey]);
        }
    }

    $path = getenv('C8B_DB_PATH');
    if ($path === false || trim($path) === '') $path = (string)($config['path'] ?? dirname(__DIR__) . '/database/c8b.sqlite');
    $path = trim($path);
    if ($path === '') throw new RuntimeException('SQLite database path is empty.');

    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        throw new RuntimeException('Could not create the database folder. Check folder permissions.');
    }
    if (!is_file($path) && !is_writable($directory)) {
        throw new RuntimeException('The database folder is not writable by PHP.');
    }

    $connection = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $connection->exec('PRAGMA foreign_keys = ON');
    $connection->exec('PRAGMA busy_timeout = 5000');
    return $connection;
}
