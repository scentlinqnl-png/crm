<?php
// Gedeelde database: verbinding, JSON-antwoorden en aanmelding met tokens.

declare(strict_types=1);

function config(): array {
  static $cfg = null;
  if ($cfg === null) {
    $file = __DIR__ . '/config.php';
    if (!is_file($file)) fail(500, 'api/config.php ontbreekt. Kopieer config.sample.php en vul de databasegegevens in.');
    $cfg = require $file;
  }
  return $cfg;
}

function db(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    $c = config();
    $pdo = new PDO(
      "mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4",
      $c['db_user'],
      $c['db_pass'],
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
    );
  }
  return $pdo;
}

function out(array $data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function fail(int $status, string $msg): void {
  out(['error' => $msg], $status);
}

function body(): array {
  $raw = file_get_contents('php://input') ?: '';
  if (strlen($raw) > 20 * 1024 * 1024) fail(413, 'Verzoek te groot');
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function schema(): void {
  $pdo = db();
  $pdo->exec("CREATE TABLE IF NOT EXISTS kk_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    pass_hash VARCHAR(255) NOT NULL,
    admin TINYINT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    created_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS kk_tokens (
    hash CHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    created_at DATETIME NOT NULL,
    last_used DATETIME NOT NULL,
    INDEX (user_id)
  ) ENGINE=InnoDB");
  // Eén regel per record (klant, bezoek, deal, …) met de laatste versie; rev loopt globaal op.
  $pdo->exec("CREATE TABLE IF NOT EXISTS kk_docs (
    coll VARCHAR(40) NOT NULL,
    id VARCHAR(190) NOT NULL,
    data MEDIUMTEXT NULL,
    deleted TINYINT NOT NULL DEFAULT 0,
    rev BIGINT NOT NULL,
    updated_by INT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (coll, id),
    INDEX (rev)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
  $pdo->exec("CREATE TABLE IF NOT EXISTS kk_counter (k VARCHAR(20) PRIMARY KEY, v BIGINT NOT NULL) ENGINE=InnoDB");
  $pdo->exec("INSERT IGNORE INTO kk_counter (k, v) VALUES ('rev', 0)");
  // Tijdelijk wachtwoord: moet bij de eerste keer inloggen worden vervangen.
  try { $pdo->exec('ALTER TABLE kk_users ADD COLUMN must_change TINYINT NOT NULL DEFAULT 0'); } catch (PDOException $e) { /* bestaat al */ }
}

// Wachtwoord controleren met vertraging en tijdelijke blokkade na te veel pogingen.
function checkPassword(string $username, string $password): ?array {
  $st = db()->prepare('SELECT * FROM kk_users WHERE username = ?');
  $st->execute([$username]);
  $u = $st->fetch();
  if (!$u) { usleep(800000); return null; }
  if ($u['locked_until'] && strtotime($u['locked_until']) > time()) fail(429, 'Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.');
  if (!password_verify($password, $u['pass_hash'])) {
    $failed = (int)$u['failed'] + 1;
    $lock = $failed >= 8 ? date('Y-m-d H:i:s', time() + 900) : null;
    db()->prepare('UPDATE kk_users SET failed = ?, locked_until = ? WHERE id = ?')->execute([$lock ? 0 : $failed, $lock, $u['id']]);
    usleep(800000);
    return null;
  }
  db()->prepare('UPDATE kk_users SET failed = 0, locked_until = NULL WHERE id = ?')->execute([$u['id']]);
  return $u;
}

// Tijdelijke pincode van 6 cijfers (willekeurig). Raden wordt afgeremd door de blokkade na 8 mislukte pogingen.
function tempPin(): string {
  return sprintf('%06d', random_int(0, 999999));
}

function newToken(int $userId): string {
  $token = bin2hex(random_bytes(32));
  $now = date('Y-m-d H:i:s');
  db()->prepare('INSERT INTO kk_tokens (hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)')->execute([hash('sha256', $token), $userId, $now, $now]);
  return $token;
}

// Token uit de header X-Auth-Token (Authorization wordt door sommige hosts weggefilterd).
function currentUser(): array {
  $token = $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
  if (!preg_match('/^[a-f0-9]{64}$/', $token)) fail(401, 'Niet aangemeld');
  $st = db()->prepare('SELECT u.id, u.username, u.admin, t.last_used FROM kk_tokens t JOIN kk_users u ON u.id = t.user_id WHERE t.hash = ?');
  $st->execute([hash('sha256', $token)]);
  $u = $st->fetch();
  if (!$u || strtotime($u['last_used']) < time() - 180 * 86400) fail(401, 'Sessie verlopen, meld je opnieuw aan');
  if (strtotime($u['last_used']) < time() - 3600) {
    db()->prepare('UPDATE kk_tokens SET last_used = ? WHERE hash = ?')->execute([date('Y-m-d H:i:s'), hash('sha256', $token)]);
  }
  return $u;
}
