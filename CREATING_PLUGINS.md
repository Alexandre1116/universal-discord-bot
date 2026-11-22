# 🧩 Como Criar um Plugin (Não Oficial)

O **Universal Discord Bot** foi desenvolvido de raiz para ser altamente flexível. Qualquer pessoa pode criar um repositório no GitHub com um plugin, e qualquer administrador do bot pode instalar esse plugin colando apenas o URL do repositório no Dashboard (Web UI).

Este documento explica os passos e regras para desenvolveres o teu próprio plugin.

---

## 1. Estrutura do Repositório

O teu repositório (ou pasta do plugin) necessita obrigatoriamente de, pelo menos, três ficheiros na raiz:

```text
omeu-plugin-discord/
├── plugin.json       # Ficheiro de metadados obrigatório
├── index.js          # Ficheiro principal onde o código será exportado
├── LICENSE           # Obrigatório: O código tem de ser Open-Source (ex: MIT, GPL)
├── package.json      # (Opcional) Apenas se precisares de dependências extra do NPM
└── ui/               # (Opcional) Ficheiros HTML/JS para integrares na Dashboard
    └── tab.html
```

---

## 2. O `plugin.json` (Obrigatório)

O ficheiro `plugin.json` identifica o teu módulo e a forma como o painel o apresenta. Exemplo:

```json
{
  "name": "meuPluginFantastico",
  "displayName": "O Meu Plugin",
  "version": "1.0.0",
  "author": "O Teu Nome",
  "description": "Uma breve descrição do que o plugin faz no Discord."
}
```
*Atenção: a chave usada para ativar/desativar o plugin é o **nome da pasta** (o `folderId`, que é o nome do repositório). Evita que o nome da pasta tenha espaços ou caracteres especiais.*

---

## 3. O `index.js` (Obrigatório)

Este é o cérebro do teu plugin. O bot principal espera que este ficheiro exporte objetos específicos, dependendo daquilo que pretendes fazer. Podes exportar:

- `commands`: Um array de `SlashCommandBuilder` (comandos de barra do Discord).
- `events`: Um objeto com ouvintes de eventos (ex: `interactionCreate`, `messageCreate`). O primeiro argumento de cada handler é sempre o `client`; os restantes são os argumentos do evento do discord.js.
- `init`: Uma função que será executada imediatamente quando o bot liga ou quando o plugin é carregado.
- `routes`: (Opcional) Função que recebe o objeto do Express para registares rotas HTTP tuas (ex: `app.get('/api/meu-plugin', ...)`).

### Exemplo Base do `index.js`

```javascript
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// 1. (Opcional) Registar um Slash Command
const commands = [
  new SlashCommandBuilder()
    .setName('ola')
    .setDescription('Responde com um olá simpático!')
];

// 2. (Opcional) Lógica que responde aos Eventos do Discord
const events = {
  interactionCreate: async (client, interaction) => {
    // Se não for o comando 'ola', ignorar
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'ola') return;
    
    await interaction.reply({ content: 'Olá! O meu plugin não oficial está a funcionar! 👋', ephemeral: true });
  },
  
  messageCreate: async (client, message) => {
    if (message.content === '!ping') {
      message.reply('Pong do meu plugin! 🏓');
    }
  }
};

// 3. (Opcional) Executado assim que o plugin inicia
function init(client) {
  console.log('[Meu Plugin] Inicializado com sucesso!');
}

// 4. Exportar tudo para o Core ler!
module.exports = {
  commands,
  events,
  init
};
```

---

## 4. Integração com a Dashboard (Opcional)

Se o teu plugin necessitar de uma página de configurações no Painel Web (Web UI), podes criar a pasta `ui/` e colocar lá um `tab.html`.

Ao fazeres isto:
1. O Core adiciona automaticamente um botão de menu na lateral esquerda do painel.
2. O conteúdo do teu `tab.html` será carregado nativamente (podendo injetar ecrãs de definição diretamente na interface central).
3. Todos os ficheiros dentro de `ui/` são servidos em `/api/plugins-ui/<nome-da-pasta>/ui/...` — usa caminhos **relativos** no HTML (ex: `<script src="script.js"></script>`); o painel resolve-os automaticamente contra a pasta `ui/` do teu plugin. Só é servida a pasta `ui/` — o resto do código do plugin não é exposto pelo painel.

> ⚠️ **Confiança:** um plugin é código de plena confiança. O `index.js` corre no processo do bot (com acesso à base de dados, ao config e ao token) e os scripts do `ui/tab.html` correm no painel, com a sessão de administrador. Instala apenas plugins cujo código possas inspecionar — é por isso que a licença Open-Source é obrigatória.

*As credenciais e lógica de gravação na interface do utilizador já partilham as classes CSS e funções globais da Dashboard padrão (como os avisos de toast).*

---

## 5. Partilha o teu Plugin!

1. Coloca a tua pasta num **Repositório Público do GitHub**.
2. Certifica-te que incluis o ficheiro `LICENSE` (ex: Licença MIT). **O bot irá rejeitar a instalação se o código não for explicitamente Open-Source!**
3. Partilha o Link! Exemplo: `https://github.com/TeuUser/omeu-plugin-discord`
4. Qualquer utilizador do **Universal Discord Bot** pode agora ir à sua Dashboard > Aba Plugins > Clicar em "Instalar via Github" e colocar o teu link. O bot faz o clone, instala as dependências do `package.json` e o teu plugin ganha vida sem ser preciso mexer numa linha de código! 🎉
