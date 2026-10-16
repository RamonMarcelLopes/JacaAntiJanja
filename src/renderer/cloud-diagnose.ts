/**
 * Explains why a Cloudflare room could not be reached. Three checks from this PC, in order:
 * 1. a WebSocket to the Worker (what a room uses): if it works the network is fine;
 * 2. a plain HTTPS request to the Worker (made by the main process): if only this works, something blocks WebSockets;
 * 3. neither: this PC cannot reach workers.dev at all.
 * Every step is also written to jaca.log with what really came back (file only, never on screen).
 */
export async function diagnoseCloud(wsBase: string, subdomain: string, failure: 'TIMEOUT' | 'UNREACHABLE' = 'UNREACHABLE'): Promise<string> {
  const t0 = performance.now();
  const works = await webSocketWorks(wsBase);
  void window.jaca.log('rede', `diagnóstico da Cloudflare: o teste de conexão (sala inexistente) ${works ? 'funcionou' : 'FALHOU'} em ${Math.round(performance.now() - t0)} ms; a entrada tinha falhado com ${failure}`);
  if (works && failure === 'TIMEOUT') {
    return 'A sala não respondeu a tempo (esperei 15 segundos, em duas tentativas), embora a conexão com a Cloudflare tenha funcionado agora. Pode ser uma oscilação na rota até a Cloudflare: tente de novo em instantes ou use outra rede (como o celular). Se continuar, confirme com o dono que a sala está aberta e peça o código atual.';
  }
  if (works) {
    return 'A conexão com a Cloudflare funciona neste PC, então o problema não é a sua rede. Provavelmente a sala não está aberta agora ou o código mudou: peça ao dono para criar a sala de novo e mandar o código atual.';
  }
  const reach = await window.jaca.workerReachable(subdomain);
  void window.jaca.log('rede', `diagnóstico da Cloudflare: pedido HTTPS comum ao Worker ${reach.ok ? 'respondeu' : 'FALHOU'}${reach.nameUnknown ? ' (nome da conta desconhecido)' : ''}: ${reach.detail}`);
  if (!reach.ok && reach.nameUnknown) {
    return `O endereço jaca-sala.${subdomain}.workers.dev não existe. O código tem a conta "${subdomain}" errada ou cortada. Peça o código de novo ao dono (ele usa o botão "Copiar código" na sala) e cole inteiro.`;
  }
  if (reach.ok) {
    return 'Este PC alcança a Cloudflare, mas a conexão da sala (WebSocket) está sendo bloqueada. Costuma ser a proteção web do antivírus, um firewall ou a rede. Tente outra rede (hotspot do celular) ou desative a proteção web do antivírus para o Jaca anti Janja. Detalhe técnico: ' + reach.detail + '.';
  }
  return `Este PC não consegue alcançar o servidor da Cloudflare (workers.dev). Confira a internet; se ela estiver ok, troque o DNS do Windows para 1.1.1.1 ou veja se a rede, o antivírus ou o firewall bloqueia o Jaca anti Janja. Detalhe técnico: ${reach.detail || 'sem detalhe'}.`;
}

/** Opens a WebSocket to a room id nobody created: a working Worker answers "room closed", which proves the whole path works. */
function webSocketWorks(wsBase: string): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket;
    let done = false;
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    const finish = (ok: boolean, why = '') => {
      if (done) return;
      done = true;
      void window.jaca.log('rede', `teste de conexão com a sala inexistente: ${ok ? 'respondeu' : 'não respondeu'} em ${ms()} ms${why ? ' — ' + why : ''}`);
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false, 'sem resposta em 10 s'), 10_000);
    try {
      ws = new WebSocket(`${wsBase}/ws/0000000000`);
    } catch (e: any) {
      clearTimeout(timer);
      void window.jaca.log('rede', `teste de conexão: não consegui nem criar a conexão: ${e?.message ?? e}`);
      resolve(false);
      return;
    }
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', to: null, payload: { token: 0, name: 'teste', avatar: null } }));
    ws.onmessage = (ev) => finish(true, `resposta: ${String(ev.data).slice(0, 120)}`);
    ws.onerror = () => finish(false, 'evento de erro da conexão');
    ws.onclose = (ev) => finish(false, `a conexão fechou (código ${ev.code}, motivo "${ev.reason}")`);
  });
}
