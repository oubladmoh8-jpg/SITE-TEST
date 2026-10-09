<?php
declare(strict_types=1);

/**
 * Development router for PHP's built-in server.
 * Apache production hosting uses .htaccess instead.
 */
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');

// Never expose repository metadata or hidden configuration files.
if (preg_match('~(?:^|/)\\.[^/]*~', $path)) {
    http_response_code(404);
    exit('Not found');
}

$blocked = ['php', 'database', 'uploads', 'routes', 'views', 'scripts', 'middleware', 'node_modules'];
foreach ($blocked as $directory) {
    if (preg_match('~^/' . preg_quote($directory, '~') . '(?:/|$)~i', $path)) {
        http_response_code(404);
        exit('Not found');
    }
}
if (preg_match('~^/(?:\.env(?:\..*)?|package\.json|package-lock\.json|database\.js|server\.js)$~i', $path)) {
    http_response_code(404);
    exit('Not found');
}

$aliases = [
    '/css/' => __DIR__ . '/public/css/',
    '/js/' => __DIR__ . '/public/js/',
    '/assets/' => __DIR__ . '/public/assets/',
];

foreach ($aliases as $prefix => $directory) {
    if (str_starts_with($path, $prefix)) {
        $base = realpath($directory);
        $file = $base ? realpath($base . DIRECTORY_SEPARATOR . substr($path, strlen($prefix))) : false;
        if (!$base || !$file || !is_file($file) || !str_starts_with($file, $base . DIRECTORY_SEPARATOR)) {
            http_response_code(404);
            exit('Asset not found');
        }

        $types = [
            'css' => 'text/css; charset=utf-8',
            'js' => 'application/javascript; charset=utf-8',
            'svg' => 'image/svg+xml',
            'png' => 'image/png',
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'webp' => 'image/webp',
            'ico' => 'image/x-icon',
            'woff' => 'font/woff',
            'woff2' => 'font/woff2',
        ];
        $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        header('Content-Type: ' . ($types[$extension] ?? 'application/octet-stream'));
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: public, max-age=3600');
        readfile($file);
        exit;
    }
}

// Let PHP's development server serve ordinary, existing public files directly.
$requestedFile = realpath(__DIR__ . $path);
if ($path !== '/' && $requestedFile && is_file($requestedFile) &&
    str_starts_with($requestedFile, __DIR__ . DIRECTORY_SEPARATOR)) {
    return false;
}

require __DIR__ . '/index.php';
