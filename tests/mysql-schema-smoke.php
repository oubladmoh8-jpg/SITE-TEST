<?php
declare(strict_types=1);

/**
 * Integration smoke test for database/schema.mysql.sql.
 * Uses a disposable MySQL database supplied by GitHub Actions.
 */
$host = getenv('C8B_DB_HOST') ?: '127.0.0.1';
$port = (int) (getenv('C8B_DB_PORT') ?: '3306');
$database = getenv('C8B_DB_DATABASE') ?: 'site_test';
$username = getenv('C8B_DB_USERNAME') ?: 'root';
$password = getenv('C8B_DB_PASSWORD') ?: 'root';

$pdo = new PDO(
    sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $database),
    $username,
    $password,
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]
);

$schemaPath = dirname(__DIR__) . '/database/schema.mysql.sql';
$sql = file_get_contents($schemaPath);
if ($sql === false) {
    throw new RuntimeException('Could not read database/schema.mysql.sql');
}

// Remove whole-line SQL comments and run each statement as the app does.
$sql = preg_replace('/^\s*--.*$/m', '', $sql) ?? $sql;
$statements = preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: [];
foreach ($statements as $statement) {
    $statement = trim($statement);
    if ($statement !== '') {
        $pdo->exec($statement);
    }
}

$expectedTables = [
    'users',
    'categories',
    'projects',
    'project_files',
    'downloads',
    'oauth_accounts',
    'site_settings',
    'contact_messages',
];
$check = $pdo->prepare(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
);
$check->execute();
$actualTables = array_column($check->fetchAll(), 'TABLE_NAME');
$missingTables = array_values(array_diff($expectedTables, $actualTables));
if ($missingTables !== []) {
    throw new RuntimeException('Schema is missing tables: ' . implode(', ', $missingTables));
}

$foreignKeys = (int) $pdo->query(
    'SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL'
)->fetchColumn();
if ($foreignKeys < 1) {
    throw new RuntimeException('Expected relational foreign keys were not created.');
}

echo 'PASS: MySQL schema created all ' . count($expectedTables) . ' required tables and ' . $foreignKeys . " foreign-key relationships.\n";
