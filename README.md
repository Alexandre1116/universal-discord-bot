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
docker run -p 3000:3000 -d universal-discord-bot
```
3. Acede ao painel em `http://localhost:3000`.

### Via Terminal Local
1. Instala as dependências usando `npm install`
2. Inicia o Bot usando `npm start`
3. Acede a `http://localhost:3000`.

*(No primeiro acesso serás reencaminhado para configurar o utilizador e a senha de administrador).*

### Variáveis de ambiente (opcionais)

| Variável | Efeito |
|---|---|
| `PORT` | Porta do painel web (por omissão `3000`). |
| `DISCORD_TOKEN` | Token do bot, em vez de o guardar no painel (fica em `data/config.json`). |
| `CLIENT_ID` | ID da aplicação, para registar slash commands sem depender do arranque. |
| `SESSION_SECRET` | Segredo das sessões do painel; é gerado automaticamente na primeira execução. |
| `RESTORE_BODY_LIMIT` | Limite do corpo do pedido de restauro (por omissão `50mb`). Um restauro envia a base de dados em base64, por isso backups com mais de ~37 MB de BD precisam de um valor maior. |

---
> 💡 Queres criar o teu próprio plugin para o bot? Lê a documentação: [Como Criar um Plugin Não Oficial](CREATING_PLUGINS.md)

## ☕ Apoiar o Projeto

Se este bot te for útil, considera apoiar o desenvolvimento oferecendo um café! O teu apoio ajuda a manter o projeto gratuito e em constante evolução.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/alexandre1116)
