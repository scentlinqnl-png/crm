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
    out(['token' => newToken((int)$u['id']), 'user' => $u['username']]);
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
