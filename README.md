# Universal Discord Bot 🤖

Um bot de Discord poderoso, gratuito e projetado para ser corrido de forma isolada (*self-hosted*). Construído com Node.js, Discord.js v14, e acompanhado de uma incrível Web UI (Dashboard) gerada em Express.

## 🚀 O Conceito "Core + Plugins"
A verdadeira força deste bot está na sua arquitetura completamente extensível e modular. 
- **O Core (Bot Base)**: Mantém a estrutura, conecta-se ao Discord, gere a base de dados (SQLite), trata das mensagens essenciais (Welcome/Leave) e gere a Web UI.
- **O Sistema de Plugins**: Tudo o resto é um plugin! Qualquer funcionalidade pode ser ligada ou desligada livremente sem quebrar o bot. Melhor ainda: **a comunidade pode criar novos plugins e os utilizadores podem instalá-los através da Web UI fornecendo apenas o URL do Github do plugin!**

## 📦 Plugins Oficiais Integrados
O bot já vem com um leque formidável de plugins oficiais (que podes desativar livremente):
- **Audit Log**: Registo detalhado de edição/apagar de mensagens, banimentos, logs de entrada e saída de salas de voz.
- **Custom Commands**: Permite aos administradores definirem respostas customizadas e via Regex.
- **Giveaways**: Sistema de sorteios nativo e interativo via botões.
- **Levels & Voice XP**: Os utilizadores ganham XP não apenas a escrever em canais de texto, mas também de forma passiva quando permanecem conectados em canais de voz!
- **Moderation**: Sistema de Ban, Kick, Mute, Clear, com Auto-Mod (anti-spam, caps, anti-link e palavras proibidas).
- **Music**: Sistema de Música avançado nativo movido a DisTube (YouTube; Spotify/SoundCloud exigem extratores adicionais do DisTube).
- **Notifications**: Motor node-cron para enviares alertas das tuas livestreams da Twitch e dos vídeos de YouTube mal eles saiam.
- **Reaction Roles**: A clássica, porém moderna e em botões, forma de gerir cargos (roles) automáticos.
- **Tickets**: Configura botões para gerar de forma rápida e controlada tickets privados entre ti e a tua comunidade.
- **Utility**: Comandos de enquetes, resumos estatísticos (ServerInfo e UserInfo).
- **Voice Clone**: Configura Canais "Hub" (Geradores), onde sempre que alguém entrar o bot clona e cria instantaneamente canais de áudio temporários configurados com permissões exclusivas para o utilizador até ele sair.

## 🛠️ Como Iniciar (Docker Recomendado)

### Via Docker (O Mais Fácil)
O repositório já inclui um ficheiro `Dockerfile`!
1. Faz o clone do projeto
2. Constrói e corre a imagem, apontando a porta `3000`:
```bash
docker build -t universal-discord-bot .
# -v mantém o config e a BD entre reconstruções do contentor
docker run -p 3000:3000 -d -v "$(pwd)/data:/app/data" universal-discord-bot
# na primeira execução, a password do painel aparece nos logs:
docker logs universal-discord-bot
```
3. Acede ao painel em `http://localhost:3000`.

### Via Terminal Local
1. Instala as dependências usando `npm install`
2. Inicia o Bot usando `npm start`
3. Acede a `http://localhost:3000`.

### Primeiro arranque (o que acontece quando fazes download do repositório)

O repositório **não traz `data/config.json`** — cada instalação cria o seu no primeiro arranque:

1. Se `data/config.json` não existir, é criada uma configuração limpa com utilizador e **password do painel gerados aleatoriamente** (`crypto.randomInt`), mostrados uma única vez no **terminal** (não entram no anel de logs nem no painel).
2. Depois disso o ficheiro é teu: fica em `data/` (ignorado pelo git) e nunca é regenerado por cima de um existente.
3. Em Docker/headless podes definir as credenciais à partida com `WEB_AUTH_USERNAME` e `WEB_AUTH_PASSWORD`; só têm efeito **na criação** do ficheiro (primeiro arranque). Depois disso, roda a password no painel ou apagando `webAuth` do `data/config.json` e reiniciando. O token do bot continua a poder vir de `DISCORD_TOKEN`.

> ⚠️ **A atualizar a partir de uma versão antiga:** essa versão tinha `data/config.json` *versionado*, com a password do painel em texto claro (visível no histórico público). O `git pull` **não remove o ficheiro se o tiveres modificado** (o bot acrescenta `sessionSecret` no primeiro arranque, por isso quase sempre está modificado): o pull aborta com "local changes would be overwritten". Sequência segura:
>
> 1. **Para o bot.**
> 2. `cp data/config.json /tmp/config.backup.json`
> 3. `git checkout -- data/config.json` (descarta a modificação local)
> 4. `git pull`
> 5. `cp /tmp/config.backup.json data/config.json`
> 6. Arranca o bot de novo.
>
> Se saltas o passo 2-5, perdes **tudo** (token, credenciais, configurações), não só o token. Em qualquer dos casos, considera a password antiga queimada e muda-a no painel (Definições → "Nova Password do Painel Web") ou apaga `webAuth` do `data/config.json` e reinicia (será gerada uma nova).
>
> Nota: um backup manual de uma instalação antiga pode repor a password queimada, porque o restauro preserva a `webAuth` do backup quando esta existe. Restaura só o que precisas, ou roda a password depois.

### Requisitos

**Node.js ≥ 22.22.2** (declarado em `engines` no `package.json`). O extrator do YouTube do DisTube (`@distube/youtube` → `@distube/ytdl-core` → `jsdom`) exige essa versão; em Node 18/20 o plugin de música falha ao carregar. O `Dockerfile` já usa `node:22-alpine`.

### Variáveis de ambiente (opcionais)
| Variável | Efeito |
|---|---|
| `PORT` | Porta do painel web (por omissão `3000`). |
| `DISCORD_TOKEN` | Token do bot, em vez de o guardar no painel (fica em `data/config.json`). |
| `CLIENT_ID` | ID da aplicação, para registar slash commands sem depender do arranque. |
| `SESSION_SECRET` | Segredo das sessões do painel; é gerado automaticamente na primeira execução. |
| `WEB_AUTH_USERNAME` / `WEB_AUTH_PASSWORD` | Credenciais do painel a usar **na criação** do `data/config.json` (primeiro arranque em Docker/headless). Não substituem um config já existente. |
| `RESTORE_BODY_LIMIT` | Limite do corpo do pedido de restauro (por omissão `50mb`). Um restauro envia a base de dados em base64, por isso backups com mais de ~37 MB de BD precisam de um valor maior. |

### Notas de funcionamento

- A base de dados (sql.js) vive em memória e é gravada em `data/data.db`. O sql.js não escreve em incremental — cada gravação exporta a base de dados inteira — por isso as escritas são agrupadas: avisos, tickets, sorteios, agendamentos e configuração vão para disco **na hora**; XP, estatísticas de mensagens e o histórico de membros vão para disco **até ~2 s depois** (agrupados) e o *autosave* varre a cada 30 s. Um `kill -9` perde no máximo esse intervalo. Os backups (painel e anexo diário) forçam a gravação antes de ler o ficheiro.
- O anexo diário do Discord inclui o `data.db` **sem filtrar**: contém os dados de todos os servidores onde o bot está (XP, avisos, tickets, sorteios, histórico). Escolhe um canal onde isso seja aceitável — a bot avisa isso mesmo na mensagem do backup.
- Um restauro bem-sucedido **termina o processo** de propósito. Com o `docker-compose.yml` incluído (`restart: unless-stopped`), o contentor volta a arrancar sozinho; fora de Docker, precisas de um supervisor (systemd, pm2, etc.).

---
> 💡 Queres criar o teu próprio plugin para o bot? Lê a documentação: [Como Criar um Plugin Não Oficial](CREATING_PLUGINS.md)

## ☕ Apoiar o Projeto

Se este bot te for útil, considera apoiar o desenvolvimento oferecendo um café! O teu apoio ajuda a manter o projeto gratuito e em constante evolução.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/alexandre1116)
