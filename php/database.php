<?php
declare(strict_types=1);

/**
 * Separate PDO/MySQL connection for the PHP migration.
 *
 * The connection itself does not create tables. The PHP front controller
 * initializes database/schema.mysql.sql on first run when the users table is absent.
 *
 * Configure either C8B_DB_* environment variables or copy
 * database.config.example.php to database.config.php and fill in the values.
 */
function c8b_database(): PDO
{
    static $connection = null;

    if ($connection instanceof PDO) {
        return $connection;
    }

    $configPath = __DIR__ . '/database.config.php';
    $config = is_file($configPath) ? require $configPath : [];

    if (!is_array($config)) {
        throw new RuntimeException('The PHP database configuration must return an array.');
    }

    $readConfig = static function (string $key, $default = '') use ($config) {
        $environmentName = 'C8B_DB_' . strtoupper($key);
        $environmentValue = getenv($environmentName);

        if ($environmentValue !== false && $environmentValue !== '') {
            return $environmentValue;
        }

        return array_key_exists($key, $config) ? $config[$key] : $default;
    };

    $host = trim((string) $readConfig('host', 'localhost'));
    $port = (int) $readConfig('port', 3306);
    $database = trim((string) $readConfig('database'));
    $username = trim((string) $readConfig('username'));
    $password = (string) $readConfig('password');
    $charset = (string) $readConfig('charset', 'utf8mb4');

    if ($database === '' || $username === '') {
        throw new RuntimeException(
            'MySQL is not configured. Set C8B_DB_DATABASE and C8B_DB_USERNAME, ' .
            'or create php/database.config.php from the example.'
        );
    }

    if ($host === '' || $port < 1 || $port > 65535) {
        throw new RuntimeException('The MySQL host or port configuration is invalid.');
    }

    if (!preg_match('/^[A-Za-z0-9_]+$/', $charset)) {
        throw new RuntimeException('The configured MySQL character set is invalid.');
    }

    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        $host,
        $port,
        $database,
        $charset
    );

    $connection = new PDO($dsn, $username, $password, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
        PDO::ATTR_TIMEOUT => 5,
    ]);

    // Keep DATETIME values and CURRENT_TIMESTAMP defaults in UTC.
    $connection->exec("SET time_zone = '+00:00'");

    return $connection;
}
