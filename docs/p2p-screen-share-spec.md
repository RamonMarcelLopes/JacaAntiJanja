# Especificação — App de Compartilhamento de Tela P2P

> Nome do app: **Jaca anti Janja**
> Status: rascunho v0.1
> Autor: Ramon

---

## 1. Visão geral

Aplicativo desktop leve para compartilhar a tela (com áudio) entre amigos, sem depender de nenhum back-end em nuvem. Um usuário (sempre o Ramon) atua como **host**: abre o app, cria uma sala e recebe um **código de convite**. Os amigos abrem o app, colam o código e entram na sala.

A comunicação por voz continua sendo feita pelo Discord. O app existe **apenas** para o compartilhamento de tela, como alternativa ao recurso de tela do Discord, que está indisponível no Brasil.

### 1.1 Objetivos

- Compartilhar tela com áudio do sistema, com baixa latência.
- Ser leve: instalador pequeno, baixo uso de RAM/CPU em repouso.
- Funcionar sem servidor em nuvem: o PC do host faz a sinalização.
- Permitir escolher resolução (720p, 1080p, 1440p) e FPS (30, 60) separadamente.
- Suportar até **10 participantes** por sala.

### 1.2 Fora do escopo (não-objetivos)

- Microfone, chat de voz ou chat de texto.
- Contas de usuário, login ou persistência em servidor.
- Gravação de tela.
- Salas hospedadas por qualquer pessoa além do host fixo (pode vir depois).

---

## 2. Stack técnica

| Camada | Tecnologia | Motivo |
|---|---|---|
| Shell do app | **Tauri 2** | Instalador de poucos MB, usa o WebView do sistema |
| Backend local | **Rust** (tokio + axum ou tokio-tungstenite) | Servidor de sinalização WebSocket embutido no app do host |
| Interface | HTML + CSS + **TypeScript** (Vite; framework leve opcional, ex: Svelte ou Solid) | Simples, rápido, sem peso extra |
| Mídia e conexão | **WebRTC** (APIs do WebView) | Captura de tela, codificação, criptografia e P2P prontos |
| NAT traversal | **STUN** público (ex: `stun:stun.l.google.com:19302`) | Descobrir endereço público dos peers |

### 2.1 Plataforma-alvo

- **Windows 10/11** como alvo principal. O Tauri usa o **WebView2** (baseado em Chromium), que tem o melhor suporte a `getDisplayMedia` e captura de áudio do sistema.
- macOS e Linux ficam fora da v1: o WKWebView (macOS) e o WebKitGTK (Linux) têm suporte limitado a captura de tela/áudio via WebRTC.

> ⚠️ **Validar no spike inicial (Fase 0):** confirmar que `getDisplayMedia` com áudio funciona dentro do WebView2 do Tauri na versão usada. Se não funcionar bem, os planos B são: (a) captura nativa em Rust (Windows Graphics Capture + WASAPI) alimentando o WebRTC, ou (b) trocar Tauri por Electron, abrindo mão de parte da leveza.

---

## 3. Arquitetura

### 3.1 Visão geral

```
            ┌──────────────────────── PC do Host ───────────────────────┐
            │  App Tauri                                                 │
            │  ┌──────────────┐   WebSocket    ┌──────────────────────┐  │
            │  │  UI (WebView)│ ◄────────────► │ Servidor sinalização │  │
            │  │  WebRTC      │   (localhost)  │ (Rust, porta 47800)  │  │
            │  └──────┬───────┘                └──────────▲───────────┘  │
            └─────────┼───────────────────────────────────┼──────────────┘
                      │ mídia P2P (WebRTC, criptografada) │ sinalização (WS)
                      ▼                                   │
            ┌──────────────── PC do Amigo ───────────────┼───┐
            │  App Tauri  ─  UI (WebView) + WebRTC ───────┘   │
            └─────────────────────────────────────────────────┘
```

- **Sinalização** (troca de SDP/ICE, entrada/saída de participantes) passa pelo servidor WebSocket que roda **no app do host**.
- **Mídia** (vídeo + áudio) vai **direto entre os PCs** via WebRTC, nunca pelo servidor.

### 3.2 Topologia de mídia: mesh

Cada participante que compartilha a tela envia um stream separado para cada espectador (malha / mesh).

- Vantagem: zero infraestrutura, simples.
- Custo: o **upload** de quem compartilha cresce com o número de espectadores.

Estimativa de bitrate por espectador (valores de referência, ajustáveis):

| Qualidade | 30 fps | 60 fps |
|---|---|---|
| 720p | ~2,5 Mbps | ~4 Mbps |
| 1080p | ~4 Mbps | ~6 Mbps |
| 1440p | ~7 Mbps | ~12 Mbps |

Exemplo: 1440p60 para 9 espectadores ≈ **108 Mbps de upload**. Para grupos grandes, a UI deve avisar quando a combinação qualidade × espectadores provavelmente exceder o upload disponível.

> Evolução futura (se necessário): usar o PC do host como **SFU** (o sharer envia 1 stream ao host, que repassa aos demais), com uma lib como `webrtc-rs`. Fora da v1.

---

## 4. Conectividade (ponto crítico)

### 4.1 Por que o código precisa carregar o endereço do host

Sem servidor na nuvem, não existe um lugar central onde um código curto como `A1B2C3` possa ser "procurado". O amigo precisa saber **onde** está o host. Por isso, o código de convite codifica:

- IP público do host (IPv4, 4 bytes)
- Porta do servidor de sinalização (2 bytes)
- Token secreto da sala (4 bytes)

Total: 10 bytes → codificado em **Base32 Crockford** (sem caracteres ambíguos como `0/O` e `1/I/L`), resultando em 16 caracteres, exibidos em blocos:

```
Exemplo: K7QM-2XRA-9TPD-H4WB
```

O app oferece botão **Copiar código**. O amigo cola em **Entrar na sala** e o app decodifica tudo sozinho.

O IP público do host é descoberto automaticamente via STUN ao criar a sala.

### 4.2 Requisitos de rede do host

O servidor de sinalização roda no PC do host, então ele precisa ser **alcançável pela internet**:

1. Liberar a porta TCP do servidor (padrão `47800`) no firewall do Windows (o app pode pedir isso na primeira execução).
2. Fazer **port forwarding** dessa porta no roteador para o PC do host, ou tentar abertura automática via **UPnP / NAT-PMP** (implementar como tentativa automática na criação da sala).

### 4.3 ⚠️ Risco: CGNAT

Muitos provedores brasileiros usam **CGNAT**: o host não tem IP público próprio, e port forwarding se torna impossível. Nesse caso, alternativas em ordem de preferência:

1. **IPv6**: se host e amigos tiverem IPv6, conexão direta costuma funcionar sem port forwarding (suporte a endereço IPv6 no código de convite fica como item da Fase 3).
2. **VPN mesh** gratuita (Tailscale, ZeroTier ou Radmin VPN): todos entram na mesma rede virtual e o código usa o IP da VPN. Funciona sempre, sem mudar o app.
3. Pedir IP público ao provedor (alguns oferecem).

O app deve ter um botão **Testar conectividade** que verifica se a porta está acessível de fora e mostra uma mensagem clara caso não esteja.

### 4.4 NAT na mídia (STUN / TURN)

- STUN resolve a maioria das conexões P2P de mídia.
- Em NATs simétricos, a conexão pode falhar sem um servidor **TURN**. Na v1, falhas desse tipo são exibidas com mensagem clara ("não foi possível conectar com Fulano"). Usar VPN mesh (4.3) também resolve.

---

## 5. Funcionalidades

### 5.1 Perfil local

- Nome de exibição (obrigatório, até 24 caracteres).
- Avatar: imagem escolhida do PC (redimensionada para 128×128, enviada como data URL na entrada da sala) ou, por padrão, **iniciais com cor gerada a partir do nome**.
- Salvo localmente (arquivo de config do Tauri). Sem contas.

### 5.2 Criar sala (host)

1. Host clica em **Criar sala**.
2. App sobe o servidor de sinalização, tenta UPnP, descobre IP público via STUN.
3. Gera token aleatório e exibe o código de convite + botão copiar.
4. Host entra automaticamente na própria sala.
5. Fechar a sala (ou o app) encerra a sala para todos.

### 5.3 Entrar na sala (convidado)

1. Convidado clica em **Entrar com código** e cola o código.
2. App decodifica IP, porta e token e conecta via WebSocket.
3. Erros tratados: código inválido, host inacessível, sala cheia, token errado, sala encerrada.

### 5.4 Tela da sala

- Grade com os **avatares** e nomes de todos os participantes.
- Indicador visual em quem está compartilhando (borda/ícone "ao vivo").
- Clicar no participante que compartilha abre o stream na área principal.
- Botão de **tela cheia** no player.
- **Controle de volume por stream** (local, só para quem assiste).
- Indicador de qualidade de conexão por participante (ping/perda de pacotes via `getStats()`).
- Limite de **10 participantes**; o 11º recebe erro "sala cheia".

### 5.5 Compartilhar tela

- Botão único **Compartilhar tela** / **Parar de compartilhar**.
- Antes de iniciar, o usuário escolhe:
  - **Resolução:** 720p · 1080p · 1440p
  - **FPS:** 30 · 60
  - **Modo:** *Movimento* (jogos/vídeo — prioriza fluidez) ou *Detalhe* (texto/código — prioriza nitidez), via `track.contentHint` e `degradationPreference`.
- Seleção do que compartilhar pelo seletor do sistema (tela inteira ou janela).
- **Áudio do sistema** sempre incluído quando disponível.
- Qualidade pode ser alterada durante o compartilhamento sem derrubar a transmissão (`applyConstraints` + `RTCRtpSender.setParameters`).
- Mais de uma pessoa pode compartilhar ao mesmo tempo; cada espectador escolhe qual assistir.
- Sem microfone em nenhum momento: o app **nunca** solicita `getUserMedia` de áudio.

### 5.6 ⚠️ Problema conhecido: eco do Discord

Como a voz roda no Discord, capturar o **áudio do sistema inteiro** inclui as vozes do Discord. Os amigos ouviriam a própria voz atrasada (eco).

Soluções:

- **v1 (contorno):** orientar o sharer a usar fones e, se possível, compartilhar uma **janela** específica em vez da tela inteira, ou mandar o Discord para outro dispositivo de saída de áudio.
- **v2 (solução definitiva):** captura nativa em Rust usando **WASAPI process loopback** (Windows 10 2004+), que permite capturar o áudio do sistema **excluindo o processo do Discord**, ou capturar só o processo da janela compartilhada. Esse áudio é injetado no WebRTC como uma track.

---

## 6. Protocolo de sinalização

Transporte: WebSocket, mensagens JSON. Formato base:

```json
{ "type": "<tipo>", "from": "<peerId>", "to": "<peerId|null>", "payload": { } }
```

| Tipo | Direção | Payload | Descrição |
|---|---|---|---|
| `join` | cliente → servidor | `{ token, name, avatar }` | Pedido de entrada |
| `welcome` | servidor → cliente | `{ peerId, peers: [...] }` | Entrada aceita + lista atual |
| `error` | servidor → cliente | `{ code }` | `ROOM_FULL`, `BAD_TOKEN`, `ROOM_CLOSED` |
| `peer-joined` | servidor → todos | `{ peerId, name, avatar }` | Novo participante |
| `peer-left` | servidor → todos | `{ peerId }` | Participante saiu |
| `share-started` | cliente → todos | `{ resolution, fps }` | Começou a compartilhar |
| `share-stopped` | cliente → todos | `{}` | Parou de compartilhar |
| `offer` | cliente → cliente | `{ sdp }` | Oferta WebRTC (repassada pelo servidor) |
| `answer` | cliente → cliente | `{ sdp }` | Resposta WebRTC |
| `ice` | cliente → cliente | `{ candidate }` | Candidato ICE |
| `room-closed` | servidor → todos | `{}` | Host encerrou a sala |

Regras do servidor:

- Valida o token no `join`; conexões sem `join` válido em 5 s são fechadas.
- Mensagens com `to` são repassadas apenas ao destinatário; o servidor **não** interpreta SDP.
- Heartbeat (ping/pong) a cada 15 s para detectar quedas.
- Limite de tamanho de mensagem (ex: 256 KB, por causa do avatar).

### 6.1 Negociação WebRTC

- Uma `RTCPeerConnection` por par de participantes.
- Uso de **perfect negotiation** (padrão MDN) para evitar colisão de ofertas.
- Codec preferido: VP9 ou H.264 (testar qual tem melhor encode por hardware no WebView2); AV1 opcional se disponível.
- Bitrate máximo definido por qualidade escolhida (tabela da seção 3.2).

---

## 7. Segurança

- Mídia criptografada ponta a ponta por padrão (DTLS-SRTP do WebRTC).
- Token de 32 bits no código impede entrada de quem só sabe o IP/porta.
- Rate limit de tentativas de `join` com token errado (ex: 5 por minuto por IP).
- Servidor aceita apenas mensagens do protocolo; tudo o mais é descartado.
- (Opcional v2) Host aprova manualmente cada entrada.

---

## 8. Estrutura do projeto

```
JacaAntiJanja/
├── docs/
│   └── p2p-screen-share-spec.md
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── signaling/       # servidor WebSocket, salas, protocolo
│   │   ├── network/         # STUN (IP público), UPnP, teste de porta
│   │   ├── invite.rs        # encode/decode do código de convite
│   │   └── config.rs        # perfil local
│   └── tauri.conf.json
├── src/
│   ├── main.ts
│   ├── screens/             # Home, Sala, Configurações
│   ├── rtc/                 # PeerManager, negociação, stats
│   ├── signaling-client.ts
│   └── styles/
└── README.md
```

---

## 9. Roadmap

**Fase 0 — Spike técnico (validar riscos)**
- `getDisplayMedia` com áudio funcionando dentro do Tauri/WebView2.
- Conexão WebRTC entre 2 PCs em redes diferentes com sinalização no host.
- Verificar se o host está atrás de CGNAT.

**Fase 1 — MVP (2 pessoas)**
- Perfil local, criar/entrar com código, compartilhar tela com áudio em qualidade fixa.

**Fase 2 — Completo**
- Até 10 pessoas, múltiplos sharers, seletores de resolução/FPS/modo, volume por stream, tela cheia, indicador de conexão, UPnP e teste de conectividade.

**Fase 3 — Refinos**
- Áudio sem Discord (WASAPI process loopback), suporte a IPv6 no código, aprovação manual de entrada, auto-update.

---

## 10. Critérios de aceite (v1)

- Instalador abaixo de ~15 MB; uso de RAM em repouso baixo (< 150 MB).
- Do clique em "Entrar" ao vídeo aparecendo em menos de 5 s em rede normal.
- 1080p60 estável para 3 espectadores em conexão com upload ≥ 30 Mbps.
- Nenhuma permissão de microfone solicitada.
- Mensagens de erro claras para: código inválido, host inacessível, sala cheia, conexão P2P falhou.

---

## 11. Questões em aberto

- ~~Nome final do app.~~ Definido: **Jaca anti Janja**.
- Host está ou não atrás de CGNAT? (define se o plano é port forwarding ou VPN mesh)
- Framework de UI: vanilla TS, Svelte ou Solid?
- Vale a pena ter tema claro/escuro desde a v1?
