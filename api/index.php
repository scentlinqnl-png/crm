<?php
// API voor de gedeelde database. Alle verzoeken zijn POST met JSON: ?a=login | logout | me | sync

declare(strict_types=1);
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'Alleen POST');

const MAX_PULL = 2000;

try {
  $action = $_GET['a'] ?? '';
  $in = body();

  if ($action === 'login') {
    $u = checkPassword(trim((string)($in['username'] ?? '')), (string)($in['password'] ?? ''));
    if (!$u) fail(401, 'Onjuiste gebruikersnaam of wachtwoord');
    out(['token' => newToken((int)$u['id']), 'user' => $u['username'], 'mustChange' => !empty($u['must_change'])]);
  }

  $user = currentUser();

  if ($action === 'logout') {
    db()->prepare('DELETE FROM kk_tokens WHERE hash = ?')->execute([hash('sha256', $_SERVER['HTTP_X_AUTH_TOKEN'])]);
    out(['ok' => true]);
  }

  if ($action === 'me') {
    $n = (int)db()->query("SELECT COUNT(*) FROM kk_docs WHERE deleted = 0 AND coll = 'customers'")->fetchColumn();
    out(['user' => $user['username'], 'admin' => (bool)$user['admin'], 'klanten' => $n, 'claude' => !empty(config()['anthropic_key'])]);
  }

  // Eigen wachtwoord wijzigen.
  if ($action === 'password') {
    if (!checkPassword($user['username'], (string)($in['old'] ?? ''))) fail(403, 'Huidig wachtwoord klopt niet');
    $new = (string)($in['new'] ?? '');
    if (strlen($new) < 10) fail(400, 'Nieuw wachtwoord: minimaal 10 tekens');
    if ($new === (string)($in['old'] ?? '')) fail(400, 'Kies een ander wachtwoord dan het huidige');
    db()->prepare('UPDATE kk_users SET pass_hash = ?, must_change = 0 WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $user['id']]);
    db()->prepare('DELETE FROM kk_tokens WHERE user_id = ? AND hash <> ?')->execute([$user['id'], hash('sha256', $_SERVER['HTTP_X_AUTH_TOKEN'])]);
    out(['ok' => true]);
  }

  // Gebruikersbeheer (alleen beheerders).
  if (in_array($action, ['users', 'user_add', 'user_update', 'user_delete'], true)) {
    if (!$user['admin']) fail(403, 'Alleen voor beheerders');
    if ($action === 'user_add') {
      $name = trim((string)($in['username'] ?? ''));
      $pass = (string)($in['password'] ?? '');
      if (!preg_match('/^[A-Za-z0-9._@-]{2,80}$/', $name)) fail(400, 'Gebruikersnaam: 2–80 tekens, letters, cijfers en . _ @ -');
      if ($pass === '') $pin = $pass = tempPin(); // leeg = tijdelijke pincode
      elseif (strlen($pass) < 10) fail(400, 'Wachtwoord: minimaal 10 tekens');
      $st = db()->prepare('SELECT COUNT(*) FROM kk_users WHERE username = ?');
      $st->execute([$name]);
      if ($st->fetchColumn()) fail(409, 'Die gebruikersnaam bestaat al');
      db()->prepare('INSERT INTO kk_users (username, pass_hash, admin, created_at, must_change) VALUES (?, ?, ?, ?, 1)')
        ->execute([$name, password_hash($pass, PASSWORD_DEFAULT), empty($in['admin']) ? 0 : 1, date('Y-m-d H:i:s')]);
    } elseif ($action === 'user_update') {
      $id = (int)($in['id'] ?? 0);
      if (!empty($in['pin'])) $in['password'] = $pin = tempPin();
      if (isset($in['password'])) {
        if (!isset($pin) && strlen((string)$in['password']) < 10) fail(400, 'Wachtwoord: minimaal 10 tekens');
        db()->prepare('UPDATE kk_users SET pass_hash = ?, failed = 0, locked_until = NULL, must_change = 1 WHERE id = ?')->execute([password_hash((string)$in['password'], PASSWORD_DEFAULT), $id]);
        db()->prepare('DELETE FROM kk_tokens WHERE user_id = ?')->execute([$id]);
      }
      if (isset($in['admin'])) {
        if ($id === (int)$user['id'] && empty($in['admin'])) fail(400, 'Je kunt jezelf geen beheerder-af maken');
        db()->prepare('UPDATE kk_users SET admin = ? WHERE id = ?')->execute([empty($in['admin']) ? 0 : 1, $id]);
      }
    } elseif ($action === 'user_delete') {
      $id = (int)($in['id'] ?? 0);
      if ($id === (int)$user['id']) fail(400, 'Je kunt jezelf niet verwijderen');
      db()->prepare('DELETE FROM kk_tokens WHERE user_id = ?')->execute([$id]);
      db()->prepare('DELETE FROM kk_users WHERE id = ?')->execute([$id]);
    }
    $rows = db()->query('SELECT id, username, admin, must_change, created_at, (SELECT MAX(last_used) FROM kk_tokens t WHERE t.user_id = u.id) AS last_seen FROM kk_users u ORDER BY username')->fetchAll();
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['admin'] = (bool)$r['admin']; $r['must_change'] = (bool)$r['must_change']; }
    out(['users' => $rows, 'me' => (int)$user['id']] + (isset($pin) ? ['pin' => $pin] : []));
  }

  if ($action === 'sync') {
    $cursor = max(0, (int)($in['cursor'] ?? 0));
    $changes = is_array($in['changes'] ?? null) ? $in['changes'] : [];
    $pdo = db();
    $pdo->beginTransaction();
    $first = $last = 0;
    if ($changes) {
      // Revisies reserveren; de rijvergrendeling op de teller zorgt dat schrijvers na elkaar committen.
      $pdo->prepare("UPDATE kk_counter SET v = LAST_INSERT_ID(v + ?) WHERE k = 'rev'")->execute([count($changes)]);
      $last = (int)$pdo->lastInsertId();
      $first = $last - count($changes) + 1;
      $up = $pdo->prepare('INSERT INTO kk_docs (coll, id, data, deleted, rev, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE data = VALUES(data), deleted = VALUES(deleted), rev = VALUES(rev), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)');
      $now = date('Y-m-d H:i:s');
      $rev = $first;
      foreach ($changes as $c) {
        $coll = (string)($c['c'] ?? '');
        $id = (string)($c['id'] ?? '');
        $del = !empty($c['del']);
        $data = $del ? null : (string)($c['d'] ?? '');
        if (!preg_match('/^[A-Za-z]{1,40}$/', $coll) || $id === '' || strlen($id) > 190) { $pdo->rollBack(); fail(400, "Ongeldig record: $coll/$id"); }
        if (!$del && json_decode($data) === null && $data !== 'null') { $pdo->rollBack(); fail(400, "Ongeldige gegevens: $coll/$id"); }
        $up->execute([$coll, $id, $data, $del ? 1 : 0, $rev++, $user['id'], $now]);
      }
    }
    $st = $pdo->prepare('SELECT coll AS c, id, data AS d, deleted AS del, rev FROM kk_docs WHERE rev > ? AND NOT (rev BETWEEN ? AND ?) ORDER BY rev LIMIT ' . (MAX_PULL + 1));
    $st->execute([$cursor, $first, $last]);
    $rows = $st->fetchAll();
    $pdo->commit();
    $more = count($rows) > MAX_PULL;
    if ($more) array_pop($rows);
    $next = $rows ? (int)end($rows)['rev'] : $cursor;
    if (!$more) $next = max($next, $last, $cursor);
    foreach ($rows as &$r) { $r['del'] = (bool)$r['del']; unset($r['rev']); }
    out(['cursor' => $next, 'more' => $more, 'changes' => $rows, 'written' => count($changes), 'claude' => !empty(config()['anthropic_key'])]);
  }

  fail(404, 'Onbekende actie');
} catch (PDOException $e) {
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
  error_log('klantkaart api: ' . $e->getMessage());
  fail(500, 'Databasefout. Controleer api/config.php en of setup.php is uitgevoerd.');
}
