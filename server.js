'use strict';

const express  = require('express');
const session  = require('express-session');
const axios    = require('axios');
const path     = require('path');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000');

// Informa ao Express que está atrás do proxy do Render (necessário para cookies HTTPS)
app.set('trust proxy', 1);

// ── URL pública (Render injeta automaticamente em produção) ───────────────────
function getPublicUrl() {
  const host = process.env.RENDER_EXTERNAL_URL;
  if (host) {
    return host.startsWith('http') ? host : `https://${host}`;
  }
  return `http://localhost:${PORT}`;
}

// ── Senha de acesso ───────────────────────────────────────────────────────────
const APP_PASSWORD = process.env.APP_PASSWORD || 'twilio2024';

// ══════════════════════════════════════════════════════════════════════════════
//  MIDDLEWARES
// ══════════════════════════════════════════════════════════════════════════════
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret           : process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave           : false,
  saveUninitialized: false,
  cookie: {
    secure  : process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge  : 8 * 60 * 60 * 1000  // 8 horas
  }
}));

// ── Guarda gravações em memória (reseta ao reiniciar) ─────────────────────────
const state = { recordings: [] };

// ══════════════════════════════════════════════════════════════════════════════
//  AUTH — rotas públicas (login) + middleware de proteção
// ══════════════════════════════════════════════════════════════════════════════

// Rotas que a Twilio bate (sem autenticação — vêm de fora)
const PUBLIC_PATHS = ['/twiml/record', '/twiml/recording-done', '/login', '/api/login', '/api/logout'];

function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) return next();
  if (req.session?.authenticated) return next();
  // Requisições de API retornam 401
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado.' });
  // Páginas retornam a tela de login
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
}

// Arquivos estáticos ficam ANTES do requireAuth — senão o CSS/JS do app
// ficaria bloqueado para usuários não autenticados, causando loop infinito
app.use(express.static(path.join(__dirname, 'public')));

app.use(requireAuth);

// ── Login page ────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── Login ─────────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Senha incorreta.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── Info do servidor (URL pública) ───────────────────────────────────────────
app.get('/api/server-info', (req, res) => {
  res.json({ publicUrl: getPublicUrl() });
});

// ══════════════════════════════════════════════════════════════════════════════
//  TWIML — chamados pela Twilio diretamente
// ══════════════════════════════════════════════════════════════════════════════
app.all('/twiml/record', (req, res) => {
  const callbackUrl = `${getPublicUrl()}/twiml/recording-done`;
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record maxLength="90"
          trim="do-not-trim"
          timeout="5"
          transcribe="false"
          recordingStatusCallback="${callbackUrl}"
          recordingStatusCallbackMethod="POST" />
</Response>`);
});

app.post('/twiml/recording-done', (req, res) => {
  const { RecordingUrl, RecordingSid, RecordingDuration, CallSid } = req.body;
  console.log(`\n📼 Nova gravação — SID: ${RecordingSid} | Duração: ${RecordingDuration}s`);
  if (RecordingSid) {
    state.recordings.unshift({
      sid      : RecordingSid,
      url      : RecordingUrl,
      duration : parseInt(RecordingDuration) || 0,
      callSid  : CallSid,
      createdAt: new Date().toISOString()
    });
    state.recordings = state.recordings.slice(0, 10);
  }
  res.status(200).send('<Response/>');
});

// ══════════════════════════════════════════════════════════════════════════════
//  API — chamados pelo frontend (protegidos por auth)
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/recordings', (_req, res) => {
  res.json(state.recordings);
});

app.get('/api/recording-audio', async (req, res) => {
  const { sid, as: accountSid, at: authToken } = req.query;
  if (!sid || !accountSid || !authToken)
    return res.status(400).json({ error: 'Parâmetros sid, as, at são obrigatórios.' });
  try {
    const audioRes = await axios.get(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.mp3`,
      { auth: { username: accountSid, password: authToken }, responseType: 'stream', timeout: 20_000 }
    );
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-cache');
    audioRes.data.pipe(res);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

app.post('/api/setup-webhook', async (req, res) => {
  const { accountSid, authToken, phoneNumber } = req.body;
  const webhookUrl = `${getPublicUrl()}/twiml/record`;

  try {
    const listRes = await axios.get(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`,
      { auth: { username: accountSid, password: authToken }, params: { PhoneNumber: phoneNumber }, timeout: 15_000 }
    );
    const numbers = listRes.data.incoming_phone_numbers;
    if (!numbers?.length) {
      return res.status(404).json({
        error: `Número ${phoneNumber} não encontrado nesta conta Twilio.`,
        hint : 'Verifique o formato (+5511...) e se o número pertence à conta informada.'
      });
    }
    const { sid: numberSid, friendly_name } = numbers[0];
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${numberSid}.json`,
      new URLSearchParams({ VoiceUrl: webhookUrl, VoiceMethod: 'POST' }),
      { auth: { username: accountSid, password: authToken }, timeout: 15_000 }
    );
    console.log(`\n✅ Webhook configurado: ${webhookUrl}`);
    res.json({ success: true, webhookUrl, numberSid, friendlyName: friendly_name });
  } catch (err) {
    const status = err.response?.status || 500;
    const data   = err.response?.data   || {};
    res.status(status).json({ error: data.message || err.message, code: data.code });
  }
});

app.post('/api/request-verification', async (req, res) => {
  const { accountSid, authToken, waNumber, senderName } = req.body;
  try {
    const response = await axios.post(
      'https://messaging.twilio.com/v2/Channels/Senders',
      { sender_id: `whatsapp:${waNumber}`, configuration: { verification_method: 'voice' }, profile: { name: senderName } },
      { auth: { username: accountSid, password: authToken }, timeout: 20_000 }
    );
    console.log(`\n📞 Verificação solicitada — SID: ${response.data.sid}`);
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data   = err.response?.data   || {};
    res.status(status).json(data.message ? data : { error: err.message });
  }
});

app.post('/api/confirm-verification', async (req, res) => {
  const { accountSid, authToken, xeCode, verificationCode } = req.body;
  try {
    const response = await axios.post(
      `https://messaging.twilio.com/v2/Channels/Senders/${xeCode}`,
      { configuration: { verification_code: verificationCode } },
      { auth: { username: accountSid, password: authToken }, timeout: 20_000 }
    );
    console.log(`\n🎉 Código confirmado — Sender: ${xeCode}`);
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const data   = err.response?.data   || {};
    res.status(status).json(data.message ? data : { error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  🚀  Servidor : http://localhost:${PORT}`);
  console.log(`  🌍  URL pub  : ${getPublicUrl()}`);
  console.log(`  🔑  Senha    : ${APP_PASSWORD}`);
  console.log(`${'═'.repeat(55)}\n`);
});
