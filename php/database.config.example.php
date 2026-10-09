<?php
/**
 * Optional private configuration. Normally no database configuration is needed:
 * C8B automatically creates database/c8b.sqlite on first visit.
 * Set path to a writable absolute path outside the public web root on production hosting.
 * Never commit php/database.config.php.
 */
return [
    'path' => '', // Example: /home/your-account/private/c8b.sqlite

    // Optional OAuth. Leave blank to hide these sign-in buttons.
    'google_client_id' => '',
    'google_client_secret' => '',
    'google_callback_url' => 'https://YOUR-DOMAIN/auth/google/callback',
    'discord_client_id' => '',
    'discord_client_secret' => '',
    'discord_callback_url' => 'https://YOUR-DOMAIN/auth/discord/callback',
];
