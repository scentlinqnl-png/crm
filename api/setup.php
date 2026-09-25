<?php
// Eenmalige inrichting: tabellen aanmaken en gebruikers toevoegen.
// Zolang er nog geen gebruikers zijn, maakt het eerste formulier de beheerder aan.
// Daarna moet een beheerder zijn eigen gegevens invullen om een collega toe te voegen.

declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
$msg = '';
$ok = false;

try {
  schema();
  $count = (int)db()->query('SELECT COUNT(*) FROM kk_users')->fetchColumn();

  if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $new = trim((string)($_POST['username'] ?? ''));
    $pass = (string)($_POST['password'] ?? '');
    if ($count > 0) {
      $admin = checkPassword(trim((string)($_POST['admin_user'] ?? '')), (string)($_POST['admin_pass'] ?? ''));
      if (!$admin || !$admin['admin']) $msg = 'Beheerder-gegevens kloppen niet.';
    }
    if (!$msg && !preg_match('/^[A-Za-z0-9._@-]{2,80}$/', $new)) $msg = 'Gebruikersnaam: 2–80 tekens, letters, cijfers en . _ @ -';
    if (!$msg && strlen($pass) < 10) $msg = 'Wachtwoord: minimaal 10 tekens.';
    if (!$msg) {
      $st = db()->prepare('SELECT COUNT(*) FROM kk_users WHERE username = ?');
      $st->execute([$new]);
      if ($st->fetchColumn()) $msg = 'Die gebruikersnaam bestaat al.';
    }
    if (!$msg) {
      db()->prepare('INSERT INTO kk_users (username, pass_hash, admin, created_at) VALUES (?, ?, ?, ?)')
        ->execute([$new, password_hash($pass, PASSWORD_DEFAULT), $count === 0 || !empty($_POST['is_admin']) ? 1 : 0, date('Y-m-d H:i:s')]);
      $ok = true;
      $msg = "Gebruiker “{$new}” aangemaakt. Meld je in de app aan via Meer › Gedeelde database.";
      $count++;
    }
  }
} catch (PDOException $e) {
  error_log('klantkaart setup: ' . $e->getMessage());
  $msg = 'Kan niet verbinden met de database. Controleer api/config.php (host, naam, gebruiker, wachtwoord).';
}
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
?><!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Klantkaart · inrichting</title>
<style>body{font:16px system-ui,sans-serif;max-width:460px;margin:40px auto;padding:0 16px;background:#0d0d0f;color:#eee}input,button{font:inherit;width:100%;box-sizing:border-box;padding:10px;margin:4px 0 12px;border-radius:8px;border:1px solid #444;background:#1a1a1e;color:#eee}button{background:#c9a86a;color:#111;border:0;font-weight:600;cursor:pointer}.m{padding:10px;border-radius:8px;background:<?= $ok ? '#1e3a26' : '#3a1e1e' ?>}label{font-size:14px;color:#aaa}fieldset{border:1px solid #333;border-radius:8px;margin:0 0 12px}a{color:#c9a86a}</style>
</head><body>
<h1>Gedeelde database</h1>
<?php if ($msg): ?><p class="m"><?= $e($msg) ?></p><?php endif; ?>
<?php if (!isset($count)): ?>
<?php elseif ($count === 0): ?>
  <p>De tabellen staan klaar. Maak de eerste gebruiker aan; die wordt beheerder.</p>
<?php else: ?>
  <p><?= $count ?> gebruiker(s). Een collega toevoegen kan alleen met de gegevens van een beheerder.</p>
<?php endif; ?>
<?php if (isset($count)): ?>
<form method="post" autocomplete="off">
  <?php if ($count > 0): ?>
  <fieldset><legend>Beheerder</legend>
    <label>Gebruikersnaam<input name="admin_user" required></label>
    <label>Wachtwoord<input name="admin_pass" type="password" required></label>
  </fieldset>
  <?php endif; ?>
  <label>Nieuwe gebruikersnaam<input name="username" required autocomplete="off"></label>
  <label>Wachtwoord (min. 10 tekens)<input name="password" type="password" minlength="10" required autocomplete="new-password"></label>
  <?php if ($count > 0): ?><label><input type="checkbox" name="is_admin" value="1" style="width:auto"> ook beheerder</label><?php endif; ?>
  <button>Gebruiker aanmaken</button>
</form>
<?php endif; ?>
<p><a href="../#/meer">Naar de app</a></p>
</body></html>
