// Landingspagina voor de Microsoft-aanmelding (redirect URI).
import { buildAuthorizeUrl, exchangeCode, saveToken } from './graph.js';

const params = new URLSearchParams(location.search);
const msg = document.getElementById('msg');
const TEAMS_FLAG = 'klantkaart.teamsAuth';

async function teams() {
  await window.microsoftTeams.app.initialize();
  return window.microsoftTeams.authentication;
}

async function run() {
  // Stap 1 (alleen in Teams): Teams opent dit venster; stuur door naar Microsoft.
  if (params.has('start')) {
    sessionStorage.setItem(TEAMS_FLAG, '1');
    location.replace(await buildAuthorizeUrl(params.get('cid'), params.get('tenant')));
    return;
  }

  const fromTeams = sessionStorage.getItem(TEAMS_FLAG) === '1';

  if (params.has('error')) {
    const err = params.get('error_description') || params.get('error');
    if (fromTeams) (await teams()).notifyFailure(err);
    throw new Error(err);
  }

  // Stap 2: terug van Microsoft met een code.
  const tokens = await exchangeCode(params);
  if (fromTeams) {
    sessionStorage.removeItem(TEAMS_FLAG);
    (await teams()).notifySuccess(JSON.stringify(tokens));
    return;
  }
  saveToken(tokens);
  const back = sessionStorage.getItem('klantkaart.returnTo') || '#/instellingen';
  sessionStorage.removeItem('klantkaart.returnTo');
  // Laat de app na terugkomst meteen synchroniseren.
  sessionStorage.setItem('klantkaart.syncAfterLogin', '1');
  location.replace('./' + back);
}

run().catch((e) => {
  msg.textContent = 'Aanmelden mislukt: ' + e.message;
});
