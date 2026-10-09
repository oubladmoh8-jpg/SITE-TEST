<?php
declare(strict_types=1);

/** Smoke test for the file-based SQLite database used by C8B. */
$path = sys_get_temp_dir() . '/c8b-schema-test-' . bin2hex(random_bytes(5)) . '.sqlite';
try {
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $schemaPath = dirname(__DIR__) . '/database/schema.sqlite.sql';
    $sql = file_get_contents($schemaPath);
    if ($sql === false) throw new RuntimeException('Could not read database/schema.sqlite.sql');
    $sql = preg_replace('/^\s*--.*$/m', '', $sql) ?? $sql;
    foreach (preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: [] as $statement) {
        $statement = trim($statement);
        if ($statement !== '') $pdo->exec($statement);
    }
    $expected = ['users','categories','projects','project_files','downloads','oauth_accounts','site_settings','contact_messages'];
    $actual = array_column($pdo->query("SELECT name FROM sqlite_master WHERE type='table'")->fetchAll(), 'name');
    $missing = array_values(array_diff($expected, $actual));
    if ($missing) throw new RuntimeException('Schema is missing tables: ' . implode(', ', $missing));
    $foreignKeys = 0;
    foreach (['projects','project_files','downloads','oauth_accounts'] as $table) {
        $foreignKeys += count($pdo->query('PRAGMA foreign_key_list(' . $table . ')')->fetchAll());
    }
    if ($foreignKeys < 1) throw new RuntimeException('Expected relational foreign keys were not created.');
    echo 'PASS: SQLite file schema created all ' . count($expected) . ' tables and ' . $foreignKeys . " foreign-key relationships.\n";
} finally {
    unset($pdo);
    foreach ([$path, $path . '-journal', $path . '-wal', $path . '-shm'] as $file) {
        if (is_file($file)) unlink($file);
    }
}
