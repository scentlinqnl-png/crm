<?php
// Doorgeefluik naar de Anthropic API: de sleutel staat alleen in config.php, nooit op de telefoons.
// Alleen voor aangemelde gebruikers van de gedeelde database, met een daglimiet per gebruiker.
// De app roept dit aan als <app>/api/claude.php/v1/messages (baseURL van de Anthropic SDK).

declare(strict_types=1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'Alleen POST');

$path = $_SERVER['PATH_INFO'] ?? '/v1/messages';
if ($path !== '/v1/messages') fail(404, 'Alleen /v1/messages is toegestaan');

$key = (string)(config()['anthropic_key'] ?? '');
if ($key === '') fail(503, 'Claude is nog niet ingesteld op de server (anthropic_key in api/config.php).');

try {
  $user = currentUser();
  $limit = (int)(config()['claude_daily_limit'] ?? 200);
  $pdo = db();
  $pdo->exec('CREATE TABLE IF NOT EXISTS kk_claude_usage (user_id INT NOT NULL, day DATE NOT NULL, n INT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day)) ENGINE=InnoDB');
  $pdo->prepare('INSERT INTO kk_claude_usage (user_id, day, n) VALUES (?, CURDATE(), 1) ON DUPLICATE KEY UPDATE n = n + 1')->execute([$user['id']]);
  $st = $pdo->prepare('SELECT n FROM kk_claude_usage WHERE user_id = ? AND day = CURDATE()');
  $st->execute([$user['id']]);
  if ((int)$st->fetchColumn() > $limit) fail(429, "Daglimiet van $limit Claude-verzoeken bereikt. Morgen weer beschikbaar.");
} catch (PDOException $e) {
  error_log('klantkaart claude: ' . $e->getMessage());
  fail(500, 'Databasefout');
}

$body = file_get_contents('php://input') ?: '';
if (strlen($body) > 5 * 1024 * 1024) fail(413, 'Verzoek te groot');
$req = json_decode($body, true);
if (!is_array($req) || !str_starts_with((string)($req['model'] ?? ''), 'claude-')) fail(400, 'Ongeldig verzoek');

$headers = [
  'content-type: application/json',
  'x-api-key: ' . $key,
  'anthropic-version: ' . ($_SERVER['HTTP_ANTHROPIC_VERSION'] ?? '2023-06-01'),
];
if (!empty($_SERVER['HTTP_ANTHROPIC_BETA'])) $headers[] = 'anthropic-beta: ' . $_SERVER['HTTP_ANTHROPIC_BETA'];
$url = 'https://api.anthropic.com/v1/messages' . (empty($_SERVER['QUERY_STRING']) ? '' : '?' . $_SERVER['QUERY_STRING']);

@set_time_limit(320);
if (function_exists('curl_init')) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT => 300,
  ]);
  $res = curl_exec($ch);
  $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $err = curl_error($ch);
  curl_close($ch);
} else {
  $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $body, 'timeout' => 300, 'ignore_errors' => true]]);
  $res = @file_get_contents($url, false, $ctx);
  $status = 0;
  foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $status = (int)$m[1];
  $err = $res === false ? 'geen verbinding' : '';
}

if ($res === false || $status === 0) fail(502, 'Anthropic API niet bereikbaar: ' . $err);
http_response_code($status);
header('Content-Type: application/json');
header('Cache-Control: no-store');
echo $res;
