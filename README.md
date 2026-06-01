# Twilio WA Verificação — Versão Render (v3)

App web para ativar números WhatsApp Sender na Twilio.
Roda na nuvem — sem tunnel local, sem cloudflared, URL permanente.

---

## Como fazer o deploy no Render

### 1. Crie uma conta no Render
Acesse https://render.com e crie uma conta gratuita.

### 2. Suba o código no GitHub
Crie um repositório no GitHub e faça o push do projeto:
```bash
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/SEU_USUARIO/twilio-wa-verificacao.git
git push -u origin main
```

### 3. Crie o serviço no Render
- Acesse https://dashboard.render.com
- Clique em **New → Web Service**
- Conecte o repositório GitHub
- Render detecta o `render.yaml` automaticamente e preenche tudo

### 4. Configure as variáveis de ambiente
No painel do serviço, vá em **Environment** e defina:

| Variável         | Valor                          |
|------------------|--------------------------------|
| `APP_PASSWORD`   | senha forte de sua escolha     |
| `SESSION_SECRET` | string aleatória longa         |

### 5. Deploy
Clique em **Deploy** — em ~2 minutos o app estará online com uma URL permanente do tipo:
```
https://twilio-wa-verificacao.onrender.com
```

---

## Variáveis de ambiente

| Variável              | Descrição                                      | Obrigatória |
|-----------------------|------------------------------------------------|-------------|
| `APP_PASSWORD`        | Senha de acesso ao app                         | ✅           |
| `SESSION_SECRET`      | Segredo para assinar sessões (string longa)    | ✅           |
| `PORT`                | Porta do servidor (Render define automaticamente) | ✅        |
| `RENDER_EXTERNAL_URL` | URL pública (Render injeta automaticamente)    | automático  |

---

## Estrutura do projeto

```
twilio-wa-verificacao/
├── server.js          # Backend Express
├── render.yaml        # Config automática do Render
├── package.json
├── README.md
└── public/
    ├── index.html     # App principal
    └── login.html     # Tela de login
```

---

## Fluxo do app

```
Login com senha
    ↓
Passo 1 — Credenciais Twilio
    ↓
Passo 2 — Webhook configurado automaticamente (URL do Render)
    ↓
Passo 3 — Solicitação de verificação por voz
    ↓
Passo 4 — Gravação da ligação aparece com player de áudio
    ↓
Passo 5 — Sender ativado ✅
```

---

## Observação sobre o plano gratuito do Render

O free tier "dorme" após 15 minutos sem uso e leva ~30s para acordar.
Para uso interno esporádico isso é aceitável.
Para uso constante, o plano Starter custa $7/mês e mantém o servidor sempre ativo.
