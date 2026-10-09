<?php
/**
 * Copy to php/database.config.php and replace the placeholders.
 * Never put real credentials in this example file or commit database.config.php.
 *
 * Environment variables C8B_DB_HOST, C8B_DB_PORT, C8B_DB_DATABASE,
 * C8B_DB_USERNAME, C8B_DB_PASSWORD, and C8B_DB_CHARSET take precedence.
 */
return [
    'host' => 'localhost',
    'port' => 3306,
    'database' => 'if0_XXXXXXXX_c8b',
    'username' => 'if0_XXXXXXXX',
    'password' => 'REPLACE_WITH_YOUR_MYSQL_PASSWORD',
    'charset' => 'utf8mb4',

    // Optional OAuth. Leave blank to hide these sign-in buttons.
    'google_client_id' => '',
    'google_client_secret' => '',
    'google_callback_url' => 'https://YOUR-DOMAIN/auth/google/callback',
    'discord_client_id' => '',
    'discord_client_secret' => '',
    'discord_callback_url' => 'https://YOUR-DOMAIN/auth/discord/callback',
];
