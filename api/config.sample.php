<?php
// Kopieer dit bestand naar config.php (op de server) en vul de gegevens uit het one.com-controlepaneel in.
// config.php staat in .gitignore en wordt nooit meegecommit.
return [
  'db_host' => 'VUL_IN',              // bv. c188lupzh.mysql.db (zie one.com › Database › Technische informatie)
  'db_name' => 'c188lupzh_scentlinq',
  'db_user' => 'c188lupzh_scentlinq',
  'db_pass' => 'VUL_IN',
  // Optioneel: Claude voor alle aangemelde gebruikers. Sleutel van platform.claude.com (begint met sk-ant-).
  'anthropic_key' => '',
  'claude_daily_limit' => 200,  // max. Claude-verzoeken per gebruiker per dag
];
