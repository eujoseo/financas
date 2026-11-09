/**
 * Finanças do José — widget do iPhone + bot do Telegram + lembrete das 20h
 *
 * Tudo lê e grava o arquivo "Finanças do José - dados.json" no Google Drive,
 * o mesmo que o site eujoseo.github.io/financas usa.
 *
 * CONFIGURAR O TELEGRAM (uma vez):
 *  1. No Telegram, fale com @BotFather → /newbot → escolha nome e usuário.
 *     Ele te dá um token (ex.: 123456:ABC...).
 *  2. Cole o token entre as aspas abaixo, salve e rode a função "configurarTelegram".
 *  3. Abra o seu bot no Telegram e mande /start. Pronto.
 */
const TELEGRAM_TOKEN = '';

const ARQUIVO = 'Finanças do José - dados.json';
const FUSO = 'America/Fortaleza';
const SITE = 'https://eujoseo.github.io/financas/';

/* ═════════════ widget (não mudou o uso) ═════════════ */

function configurar() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('TOKEN', token);
  }
  DriveApp.getFilesByName(ARQUIVO);
  Logger.log('Seu código secreto do widget: ' + token);
}

function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token || !e || !e.parameter || e.parameter.token !== token) {
    return json_({ ok: false, msg: 'Código secreto inválido.' });
  }
  try {
    return json_(montarResumo_());
  } catch (err) {
    return json_({ ok: false, msg: String(err && err.message || err) });
  }
}

function montarResumo_() {
  const dados = lerDados_().dados;
  const r = dados.resumo;
  if (!r || r.erro) throw new Error('O site ainda não gerou o resumo. Abra o app uma vez.');

  const hoje = hoje_();
  const mesAtual = hoje.slice(0, 7);
  const diasRestantes = diasNoMes_(mesAtual) - (+hoje.slice(8, 10)) + 1;

  const m = r.mes && r.mes.mes === mesAtual ? r.mes : null;
  // gasto de hoje direto dos lançamentos (inclui o que o bot acabou de gravar)
  const gastoHoje = soma_(itensDoDia_(dados, hoje).filter(function (i) { return i.t === 'diario'; }));
  // diário do mês: o do resumo + o que entrou depois que o resumo foi gerado
  const novosDepois = itensDoMes_(dados, mesAtual).filter(function (i) { return i.t === 'diario' && i.orig === 'bot' && i.em && i.em > r.geradoEm; });

  const orc = m ? +m.orcamentoDiarioDoMes || 0 : 0;
  const diarioMes = (m ? +m.diario || 0 : 0) + soma_(novosDepois);
  const restanteAntesDeHoje = orc - (diarioMes - gastoHoje);
  const porDia = orc ? arred_(restanteAntesDeHoje / diasRestantes) : null;
  const sobraOrcamento = porDia == null ? null : arred_(porDia - gastoHoje);

  // ── dinheiro em conta ──
  // o saldo do resumo é do momento em que o app salvou; aqui entra o que foi lançado depois
  // (compras no cartão não saem da conta agora, só na fatura)
  const cfg = dados.config || {};
  const cartoes = (cfg.cartoes || []).map(function (c) { return c.nome; });
  const naConta = function (i) { return cartoes.indexOf(i.pag) < 0 || i.t === 'entrada'; };
  const efeito = function (i) { return (i.t === 'entrada' ? 1 : -1) * (+i.v || 0); };
  const desde = r.geradoEm || '', diaResumo = r.hoje || hoje;
  const recentes = [somaMes_(mesAtual, -1), mesAtual].reduce(function (acc, ym) { return acc.concat(itensDoMes_(dados, ym)); }, [])
    .filter(function (i) { return naConta(i) && i.d <= hoje && ((i.em && i.em > desde) || (i.d > diaResumo && !(i.em && i.em > desde))); });
  const saldoConta = r.saldoEmContaHoje == null ? null : arred_(+r.saldoEmContaHoje + recentes.reduce(function (s, i) { return s + efeito(i); }, 0));

  // caminho do saldo dia a dia: lançamentos futuros + fixos e faturas previstos, sem o diário
  const cx = saldoConta == null ? null : caixa_(dados, r, hoje, saldoConta, cartoes, naConta, efeito);

  // pode gastar hoje: o menor entre a sobra do orçamento e o que a conta aguenta por dia até o dinheiro entrar
  let sobraHoje = sobraOrcamento, limitadoPelaConta = false, porDiaConta = null;
  if (cx) {
    porDiaConta = arred_((cx.menorAteEntrada + gastoHoje) / cx.diasAteEntrada);
    const podeConta = arred_(porDiaConta - gastoHoje);
    if (sobraHoje == null || podeConta < sobraHoje) { sobraHoje = podeConta; limitadoPelaConta = true; }
  }

  const venc = (r.vencimentosProximos7Dias || [])
    .filter(function (v) { return v.d >= hoje; })
    .sort(function (a, b) { return a.d < b.d ? -1 : 1; })
    .slice(0, 3)
    .map(function (v) { return { d: v.d, desc: v.desc, v: +v.v }; });

  const faturas = (r.faturas || [])
    .filter(function (f) { return !f.paga && +f.total > 0; })
    .map(function (f) { return { cartao: f.cartao, total: +f.total, venc: f.vencimento }; });

  return {
    ok: true, hoje: hoje, atualizadoEm: r.geradoEm, consultadoEm: new Date().toISOString(), dadosDeHoje: r.hoje === hoje,
    saldoConta: saldoConta, gastoHoje: arred_(gastoHoje), porDia: porDia, sobraHoje: sobraHoje,
    sobraOrcamento: sobraOrcamento, limitadoPelaConta: limitadoPelaConta, porDiaConta: porDiaConta,
    livreConta: cx ? Math.max(0, cx.menorAteEntrada) : null,
    faltaNaConta: cx && cx.menor < 0 ? { v: arred_(-cx.menor), d: cx.menorEm, desc: cx.menorDesc } : null,
    proximaEntrada: cx ? cx.proximaEntrada : null, diasAteEntrada: cx ? cx.diasAteEntrada : null,
    diasRestantes: diasRestantes,
    mes: m ? {
      orcamentoDiario: orc, gastoDiario: arred_(diarioMes), usoPct: orc ? Math.round(diarioMes / orc * 100) : null,
      entradas: m.entradas, saidas: m.saidas, fimPrevisto: m.fimDoMesPrevisto,
      economiaPct: m.economiaPct, metaEconomiaPct: m.metaEconomiaPct
    } : null,
    vencimentos: venc,
    atrasados: (r.fixosVencidosSemConfirmar || []).length,
    faturas: faturas,
    reservaMeses: r.reserva ? r.reserva.mesesCobertos : null
  };
}

// Projeta o saldo em conta de hoje até o fim do mês seguinte.
// Devolve o menor saldo antes da próxima entrada, o menor saldo do período e onde ele acontece.
function caixa_(dados, r, hoje, saldo, cartoes, naConta, efeito) {
  const cfg = dados.config || {};
  const mesAtual = hoje.slice(0, 7), meses = [mesAtual, somaMes_(mesAtual, 1)];
  const porDia = {};
  const add = function (d, v, desc) { (porDia[d] = porDia[d] || []).push({ v: v, desc: desc }); };
  meses.forEach(function (ym) {
    const todos = ((dados.meses || {})[ym] || { itens: [] }).itens;   // inclui os pulados: marcam fixo resolvido no mês
    const cobertos = {};
    todos.forEach(function (i) { if (i.rec) cobertos[i.rec] = true; });
    // lançamentos com data futura
    todos.filter(function (i) { return !i.skip && i.d > hoje && naConta(i); }).forEach(function (i) { add(i.d, efeito(i), i.desc); });
    // fixos previstos
    const n = diasNoMes_(ym);
    (cfg.recorrentes || []).forEach(function (f) {
      if (ym < (cfg.inicioPrevisao || '0000-00') || ym < (f.inicio || '0000-00') || (f.fim && ym > f.fim)) return;
      if (cobertos[f.id] || (cartoes.indexOf(f.pag) >= 0 && f.t !== 'entrada')) return;
      const d = ym + '-' + pad_(Math.min(+f.dia || 1, n));
      if (d < hoje) return;
      add(d, (f.t === 'entrada' ? 1 : -1) * (+f.v || 0), f.desc);
    });
    // faturas do cartão (o valor do mês atual vem do app)
    (r.faturas || []).forEach(function (f) {
      if (f.paga || !(+f.total > 0) || f.vencimento.slice(0, 7) !== ym || cobertos['fatura:' + f.cartao] || f.vencimento < hoje) return;
      add(f.vencimento, -(+f.total), 'Fatura ' + f.cartao);
    });
  });

  let cash = saldo, menor = saldo, menorEm = hoje, menorDesc = null, menorAteEntrada = saldo, prox = null;
  const fim = meses[1] + '-' + pad_(diasNoMes_(meses[1]));
  let dias = 0;
  for (let d = hoje; d <= fim; d = somaDias_(d, 1)) {
    const mov = (porDia[d] || []).slice().sort(function (a, b) { return b.v - a.v; });   // entradas do dia primeiro
    const ent = mov.filter(function (x) { return x.v > 0; }).reduce(function (s, x) { return s + x.v; }, 0);
    if (!prox && d > hoje && ent > 0) prox = { d: d, v: arred_(ent) };
    if (!prox) dias++;
    mov.forEach(function (x) {
      cash = arred_(cash + x.v);
      if (cash < menor) { menor = cash; menorEm = d; menorDesc = x.desc; }
      if (!prox && cash < menorAteEntrada) menorAteEntrada = cash;
    });
  }
  return { menor: menor, menorEm: menorEm, menorDesc: menorDesc, menorAteEntrada: menorAteEntrada, proximaEntrada: prox, diasAteEntrada: Math.max(1, dias) };
}

/* ═════════════ Telegram: configuração ═════════════ */

function configurarTelegram() {
  if (!TELEGRAM_TOKEN) throw new Error('Cole o token do @BotFather na linha TELEGRAM_TOKEN, salve e rode de novo.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('TG_TOKEN', TELEGRAM_TOKEN);
  tg_('deleteWebhook', {});                       // usamos leitura a cada minuto (mais confiável no Apps Script)
  const me = tg_('getMe', {});
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['verificarTelegram', 'lembrete20h'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('verificarTelegram').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('lembrete20h').timeBased().everyDays(1).atHour(20).nearMinute(0).inTimezone(FUSO).create();
  Logger.log('Bot @' + me.result.username + ' pronto. Abra o Telegram e mande /start para ele.');
}

/* ═════════════ Telegram: receber mensagens ═════════════ */

function verificarTelegram() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const offset = +(props.getProperty('TG_OFFSET') || 0);
    const up = tg_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message'] });
    (up.result || []).forEach(function (u) {
      props.setProperty('TG_OFFSET', String(u.update_id + 1));
      const msg = u.message;
      if (!msg || !msg.text) return;
      const chat = String(msg.chat.id);
      let dono = props.getProperty('TG_CHAT');
      if (!dono && /^\/start/.test(msg.text)) { props.setProperty('TG_CHAT', chat); dono = chat; }
      if (chat !== dono) return;                   // só você conversa com o bot
      let resp;
      try { resp = responder_(msg.text.trim()); }
      catch (err) { resp = '⚠️ ' + (err && err.message || err); }
      enviar_(resp);
    });
  } finally { lock.releaseLock(); }
}

const AJUDA = [
  '<b>Como falar comigo</b>',
  '',
  '💸 <b>Gasto do diário</b>: <code>45,90 mercado</code>',
  '   (ou <code>/gasto 45,90 mercado</code>; "ontem" no fim lança ontem; "cartão" lança no cartão)',
  '💳 <b>Parcelado no cartão</b>: <code>/parcelado 1200 10x notebook</code>',
  '💰 <b>Entrada</b>: <code>/entrada 300 freela</code>',
  '🤔 <b>Posso comprar?</b>: <code>/posso 3000 10x tv</code> ou <code>/posso 250 tênis</code>',
  '📋 <code>/hoje</code> lançamentos de hoje e o que falta conferir',
  '📊 <code>/saldo</code> como está o mês',
  '↩️ <code>/desfazer</code> apaga o último lançamento feito aqui'
].join('\n');

function responder_(txt) {
  const low = txt.toLowerCase();
  const cmd = (low.match(/^\/(\w+)/) || [])[1] || '';
  const resto = txt.replace(/^\/\w+(@\w+)?\s*/, '');

  if (cmd === 'start' || cmd === 'ajuda' || cmd === 'help') return 'Oi, José! 👋\n\n' + AJUDA;
  if (cmd === 'hoje') return cmdHoje_();
  if (cmd === 'saldo') return cmdSaldo_();
  if (cmd === 'desfazer') return cmdDesfazer_();
  if (cmd === 'posso') return cmdPosso_(resto);
  if (cmd === 'parcelado' || cmd === 'parcela') return cmdLancar_('parcelado', resto);
  if (cmd === 'entrada') return cmdLancar_('entrada', resto);
  if (cmd === 'gasto' || cmd === 'diario') return cmdLancar_('diario', resto);
  if (!cmd && /^\s*r?\$?\s*\d/.test(low)) {
    if (/\d+\s*x\b/.test(low)) return cmdLancar_('parcelado', txt);
    return cmdLancar_('diario', txt);
  }
  if (!cmd && /^posso\b/.test(low)) return cmdPosso_(txt.replace(/^posso\s*/i, ''));
  return 'Não entendi 🤔\n\n' + AJUDA;
}

/* ═════════════ lançar ═════════════ */

function interpretar_(texto) {
  let t = ' ' + texto + ' ';
  const mValor = t.match(/r?\$?\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*mil\b)?/i);
  if (!mValor) throw new Error('Faltou o valor. Ex.: 45,90 mercado');
  let v = mValor[1];
  v = /,\d{1,2}$/.test(v) ? +v.replace(/\./g, '').replace(',', '.') : (/\.\d{3}$/.test(v) ? +v.replace(/\./g, '') : +v);
  if (mValor[2]) v = v * 1000;
  t = t.replace(mValor[0], ' ');
  const mParc = t.match(/(\d{1,3})\s*x\b/i);
  const parc = mParc ? +mParc[1] : 1;
  if (mParc) t = t.replace(mParc[0], ' ');
  let d = hoje_();
  if (/\bontem\b/i.test(t)) { d = somaDias_(d, -1); t = t.replace(/\bontem\b/i, ' '); }
  const mData = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (mData) { d = d.slice(0, 4) + '-' + pad_(mData[2]) + '-' + pad_(mData[1]); t = t.replace(mData[0], ' '); }
  const cartao = /\bcart[aã]o\b|\bcr[eé]dito\b/i.test(t);
  t = t.replace(/\b(no|na|em|de|do|da)?\s*(cart[aã]o|cr[eé]dito)\b/gi, ' ').replace(/\b(no|na|em|de)\s*$/i, ' ');
  const desc = t.replace(/\s+/g, ' ').trim();
  return { v: arred_(v), parc: parc, d: d, cartao: cartao, desc: desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : '' };
}

function cmdLancar_(tipo, texto) {
  const p = interpretar_(texto);
  if (!(p.v > 0)) throw new Error('Valor inválido.');
  const lido = lerDados_(), dados = lido.dados, cfg = dados.config || {};
  const cartoes = cfg.cartoes || [];
  const t = tipo === 'entrada' ? 'entrada' : tipo === 'parcelado' ? 'saida' : 'diario';
  const desc = p.desc || (t === 'entrada' ? 'Entrada' : 'Gasto');
  const item = { id: uid_(), d: p.d, t: t, v: p.v, desc: desc, cat: categoria_(dados, t, desc), orig: 'bot', em: new Date().toISOString() };
  if (tipo === 'parcelado' || p.cartao) {
    if (!cartoes.length) throw new Error('Não há cartão cadastrado no app.');
    item.pag = acharCartao_(cartoes, texto).nome;
    if (p.parc > 1) item.parc = p.parc;
  } else if (t !== 'entrada') item.pag = 'Pix';
  const ym = item.d.slice(0, 7);
  dados.meses = dados.meses || {};
  const mes = dados.meses[ym] || (dados.meses[ym] = { itens: [] });
  mes.itens.push(item);
  mes.itens.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
  PropertiesService.getScriptProperties().setProperty('TG_ULTIMO', JSON.stringify({ id: item.id, ym: ym }));
  salvarDados_(lido);

  const quando = item.d === hoje_() ? 'hoje' : item.d === somaDias_(hoje_(), -1) ? 'ontem' : br_(item.d);
  let r = (t === 'entrada' ? '💰 Entrada lançada ' : item.parc ? '💳 Parcelado lançado ' : '✅ Gasto lançado ') + '' + quando + ':\n' +
    '<b>' + esc_(desc) + '</b> · ' + brl_(item.v) + (item.parc ? ' em ' + item.parc + 'x de ' + brl_(item.v / item.parc) : '') +
    '\nCategoria: ' + esc_(item.cat) + (item.pag ? ' · ' + esc_(item.pag) : '');
  if (t === 'diario') {
    const hojeTot = soma_(itensDoDia_(dados, hoje_()).filter(function (i) { return i.t === 'diario'; }));
    r += '\n\nHoje no diário: ' + brl_(hojeTot);
  }
  return r + '\n<i>(/desfazer se errei)</i>';
}

function cmdDesfazer_() {
  const props = PropertiesService.getScriptProperties();
  const u = JSON.parse(props.getProperty('TG_ULTIMO') || 'null');
  if (!u) return 'Nada para desfazer.';
  const lido = lerDados_(), mes = (lido.dados.meses || {})[u.ym];
  const it = mes && mes.itens.filter(function (i) { return i.id === u.id; })[0];
  if (!it) { props.deleteProperty('TG_ULTIMO'); return 'Esse lançamento já não existe (talvez apagado no app).'; }
  mes.itens = mes.itens.filter(function (i) { return i.id !== u.id; });
  salvarDados_(lido);
  props.deleteProperty('TG_ULTIMO');
  return '↩️ Apaguei: ' + esc_(it.desc) + ' · ' + brl_(it.v);
}

/* ═════════════ consultas ═════════════ */

function cmdHoje_() {
  const dados = lerDados_().dados, h = hoje_();
  const its = itensDoDia_(dados, h);
  let r = '📋 <b>Hoje (' + br_(h) + ')</b>\n';
  if (!its.length) r += 'Nenhum lançamento ainda.\n';
  its.forEach(function (i) {
    r += (i.t === 'entrada' ? '＋ ' : '－ ') + esc_(i.desc) + ' · ' + brl_(i.v) + (i.parc ? ' (' + i.parc + 'x)' : '') + (i.orig === 'bot' ? ' 🤖' : '') + '\n';
  });
  const dia = soma_(its.filter(function (i) { return i.t === 'diario'; }));
  r += '\nDiário de hoje: <b>' + brl_(dia) + '</b>';
  const w = tentar_(montarResumo_);
  if (w && w.sobraHoje != null) r += '\n' + (w.sobraHoje >= 0 ? 'Ainda pode gastar hoje: <b>' + brl_(w.sobraHoje) + '</b>' : 'Passou ' + brl_(-w.sobraHoje) + ' do previsto para hoje');
  if (w && w.limitadoPelaConta) r += '\n<i>(limitado pelo dinheiro em conta' + (w.proximaEntrada ? ' até a entrada de ' + br_(w.proximaEntrada.d) : '') + ')</i>';
  if (w && w.faltaNaConta) r += '\n⚠️ Faltam ' + brl_(w.faltaNaConta.v) + ' na conta em ' + br_(w.faltaNaConta.d) + ' para cobrir as contas previstas.';
  return r;
}

function cmdSaldo_() {
  const dados = lerDados_().dados, r = dados.resumo || {};
  const w = montarResumo_();
  let s = '📊 <b>Como está o mês</b>\n';
  s += 'Saldo em conta: <b>' + brl_(w.saldoConta) + '</b>\n';
  if (w.livreConta != null) s += 'Livre na conta (já separando contas previstas): <b>' + brl_(w.livreConta) + '</b>' + (w.proximaEntrada ? ' · próxima entrada ' + br_(w.proximaEntrada.d) : '') + '\n';
  if (w.faltaNaConta) s += '⚠️ Faltam ' + brl_(w.faltaNaConta.v) + ' na conta em ' + br_(w.faltaNaConta.d) + '\n';
  if (w.mes) {
    s += 'Diário: ' + brl_(w.mes.gastoDiario) + ' de ' + brl_(w.mes.orcamentoDiario) + ' (' + w.mes.usoPct + '%)\n';
    s += 'Pode gastar por dia até o fim do mês: <b>' + brl_(w.porDia) + '</b>\n';
    s += 'Fim do mês previsto: ' + brl_(w.mes.fimPrevisto) + '\n';
  }
  (w.faturas || []).forEach(function (f) { s += '💳 ' + esc_(f.cartao) + ': ' + brl_(f.total) + ' (vence ' + br_(f.venc) + ')\n'; });
  (w.vencimentos || []).forEach(function (v) { s += '📅 ' + br_(v.d) + ' ' + esc_(v.desc) + ' · ' + brl_(v.v) + '\n'; });
  if (w.reservaMeses != null) s += '🛟 Reserva: ' + String(w.reservaMeses).replace('.', ',') + ' meses de custo de vida\n';
  s += '\n<i>Números do app atualizados em ' + hora_(r.geradoEm) + '. Abra o app para recalcular tudo.</i>';
  return s;
}

/* "Posso comprar?" — conta simples e conservadora:
 * usa a previsão mês a mês do app (entradas − fixos − faturas − investimentos − orçamento do diário)
 * e vê se a parcela cabe em cada mês, deixando uma margem de segurança. */
function cmdPosso_(texto) {
  if (!texto.trim()) return 'Me diga o valor. Ex.: <code>/posso 3000 10x tv</code> ou <code>/posso 250 tênis</code>';
  const p = interpretar_(texto);
  const dados = lerDados_().dados, r = dados.resumo || {}, cfg = dados.config || {};
  const proj = r.projecao || [];
  if (!proj.length) return 'Preciso que o app gere a previsão: abra o site uma vez (com o Drive conectado) e me pergunte de novo.';
  const nome = esc_(p.desc || 'essa compra');
  const parcelado = p.parc > 1 || p.cartao;

  if (!parcelado) {
    // à vista: sai do saldo agora; precisa não deixar o mês negativo nem comer a margem
    const mes = proj[0];
    const fim = +mes.saldoFim - p.v;
    const livre = +mes.livre - p.v;
    const margem = margem_(mes);
    let veredito;
    if (fim < 0) veredito = '❌ <b>Não dá.</b> Seu saldo previsto no fim do mês ficaria em ' + brl_(fim) + '.';
    else if (livre < 0) veredito = '⚠️ <b>Dá, mas aperta.</b> Você gastaria ' + brl_(-livre) + ' a mais do que entra este mês, tirando do saldo guardado em conta (fim do mês: ' + brl_(fim) + ').';
    else if (livre < margem) veredito = '⚠️ <b>Cabe, mas no limite.</b> Sobram só ' + brl_(livre) + ' de folga este mês.';
    else veredito = '✅ <b>Pode comprar.</b> Depois dela, ainda sobra ' + brl_(livre) + ' de folga este mês.';
    return '🤔 <b>' + nome + '</b> · ' + brl_(p.v) + ' à vista\n\n' + veredito +
      '\n\n<i>Se for no cartão em 1x, mande: /posso ' + num_(p.v) + ' 1x cartão ' + (p.desc || '') + '</i>';
  }

  const cartoes = cfg.cartoes || [];
  if (!cartoes.length) return 'Não há cartão cadastrado no app para simular o parcelamento.';
  const c = acharCartao_(cartoes, texto);
  const n = Math.max(1, p.parc);
  const parcelas = dividir_(p.v, n);
  const primeira = faturaYm_(c, hoje_());
  let pior = null, linhas = [], faltaProj = false;
  for (let k = 0; k < n; k++) {
    const ym = somaMes_(primeira, k);
    const pm = proj.filter(function (x) { return x.mes === ym; })[0];
    if (!pm) { faltaProj = true; continue; }
    const sobra = arred_(+pm.livre - parcelas[k]);
    const folga = arred_(sobra - margem_(pm));
    if (!pior || folga < pior.folga) pior = { ym: ym, sobra: sobra, folga: folga };
    if (k < 4 || sobra < 0) linhas.push(mesNome_(ym) + ': sobra ' + brl_(sobra));
  }
  let veredito;
  if (!pior) veredito = 'Não tenho previsão para esses meses ainda.';
  else if (pior.sobra < 0) veredito = '❌ <b>Vai apertar.</b> Em ' + mesNome_(pior.ym) + ' faltariam ' + brl_(-pior.sobra) + ' (salário − contas − faturas − diário − investimentos).';
  else if (pior.folga < 0) veredito = '⚠️ <b>Cabe, mas no limite.</b> O mês mais justo é ' + mesNome_(pior.ym) + ', com só ' + brl_(pior.sobra) + ' de folga.';
  else veredito = '✅ <b>Pode comprar.</b> O mês mais justo é ' + mesNome_(pior.ym) + ', e ainda sobram ' + brl_(pior.sobra) + '.';
  return '🤔 <b>' + nome + '</b> · ' + brl_(p.v) + ' em ' + n + 'x de ' + brl_(parcelas[0]) + ' no ' + esc_(c.nome) +
    '\n1ª parcela na fatura de ' + mesNome_(primeira) + '\n\n' + veredito +
    (linhas.length ? '\n\n' + linhas.join('\n') : '') +
    (faltaProj ? '\n<i>(as últimas parcelas passam do horizonte da previsão do app)</i>' : '') +
    '\n\n<i>Margem de segurança: 10% das entradas do mês. Se comprar, mande /parcelado ' + num_(p.v) + ' ' + n + 'x ' + (p.desc || '') + '</i>';
}

function margem_(pm) { return Math.max(150, arred_((+pm.entradas || 0) * 0.10)); }

/* ═════════════ lembrete das 20h ═════════════ */

function lembrete20h() {
  if (!PropertiesService.getScriptProperties().getProperty('TG_CHAT')) return;
  const dados = lerDados_().dados, h = hoje_();
  const its = itensDoDia_(dados, h);
  let r = '🌙 <b>Hora de conferir o dia!</b>\n\n';
  if (its.length) {
    r += 'Você lançou hoje:\n';
    its.forEach(function (i) { r += '• ' + esc_(i.desc) + ' · ' + brl_(i.v) + (i.orig === 'bot' ? ' 🤖' : '') + '\n'; });
    r += 'Diário de hoje: <b>' + brl_(soma_(its.filter(function (i) { return i.t === 'diario'; }))) + '</b>\n';
  } else r += 'Nenhum gasto lançado hoje. Esqueceu algum? É só me mandar, ex.: <code>32 almoço</code>\n';
  r += '\nAbra o app para conferir: ' + SITE;
  enviar_(r);
}

/* ═════════════ Drive ═════════════ */

function lerDados_() {
  const it = DriveApp.getFilesByName(ARQUIVO);
  let arq = null;
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    if (!arq || f.getLastUpdated() > arq.getLastUpdated()) arq = f;
  }
  if (!arq) throw new Error('Não achei "' + ARQUIVO + '" no Drive.');
  return { arq: arq, dados: JSON.parse(arq.getBlob().getDataAsString('UTF-8')) };
}

function salvarDados_(lido) {
  // nova marca de versão: o site vê que mudou e baixa na próxima vez que abrir
  lido.dados.atualizadoEm = new Date().toISOString() + '~tg' + Math.random().toString(36).slice(2, 6);
  lido.arq.setContent(JSON.stringify(lido.dados));
}

/* ═════════════ ajudantes ═════════════ */

function tg_(metodo, corpo) {
  const token = PropertiesService.getScriptProperties().getProperty('TG_TOKEN') || TELEGRAM_TOKEN;
  if (!token) throw new Error('Bot sem token. Rode configurarTelegram.');
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + metodo, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(corpo), muteHttpExceptions: true
  });
  const j = JSON.parse(r.getContentText());
  if (!j.ok) throw new Error('Telegram: ' + j.description);
  return j;
}

function enviar_(texto) {
  const chat = PropertiesService.getScriptProperties().getProperty('TG_CHAT');
  if (!chat) return;
  tg_('sendMessage', { chat_id: chat, text: texto, parse_mode: 'HTML', disable_web_page_preview: true });
}

function todosItens_(dados) {
  const out = [];
  Object.keys(dados.meses || {}).forEach(function (k) { (dados.meses[k].itens || []).forEach(function (i) { if (!i.skip) out.push(i); }); });
  return out;
}
function itensDoMes_(dados, ym) { return ((dados.meses || {})[ym] || { itens: [] }).itens.filter(function (i) { return !i.skip; }); }
function itensDoDia_(dados, d) { return itensDoMes_(dados, d.slice(0, 7)).filter(function (i) { return i.d === d; }); }

function categoria_(dados, t, desc) {
  const cats = (((dados.config || {}).categorias || {})[t] || []);
  const low = desc.toLowerCase();
  const direta = cats.filter(function (c) { return c.length >= 3 && low.indexOf(c.toLowerCase()) >= 0; })[0];
  if (direta) return direta;
  // aprende com o que você já lançou com descrição parecida
  const palavra = (low.match(/[a-zà-ú]{3,}/) || [])[0];
  if (palavra) {
    const ant = todosItens_(dados).filter(function (i) { return i.t === t && i.cat && String(i.desc || '').toLowerCase().indexOf(palavra) >= 0; }).pop();
    if (ant) return ant.cat;
  }
  const dic = { uber: 'Transporte', '99': 'Transporte', gasolina: 'Gasolina', posto: 'Gasolina', mercado: 'Mercado', supermercado: 'Mercado',
    farm: 'Farmácia', remédio: 'Farmácia', lanche: 'Lanches', almoço: 'Lanches', jantar: 'Lanches', ifood: 'Lanches', café: 'Lanches', padaria: 'Lanches',
    barbe: 'Barbearia', cabelo: 'Barbearia', salário: 'Salário' };
  for (const k in dic) if (low.indexOf(k) >= 0 && cats.indexOf(dic[k]) >= 0) return dic[k];
  if (cats.indexOf('Outros') >= 0) return 'Outros';
  if (t === 'entrada' && cats.indexOf('Outras entradas') >= 0) return 'Outras entradas';
  return cats[0] || 'Outros';
}

function acharCartao_(cartoes, texto) {
  const low = texto.toLowerCase();
  return cartoes.filter(function (c) { return low.indexOf(String(c.nome).toLowerCase().replace(/^cart[aã]o\s*/, '')) >= 0; })[0] || cartoes[0];
}
function cardFech_(c) { const f = parseInt(c.fech, 10); if (f >= 1 && f <= 31) return f; const v = +c.venc || 10; return v - 7 >= 1 ? v - 7 : v + 23; }
function faturaYm_(c, ds) {
  const ym = ds.slice(0, 7), dia = +ds.slice(8), F = cardFech_(c);
  const fechaYm = dia <= Math.min(F, diasNoMes_(ym)) ? ym : somaMes_(ym, 1);
  return (+c.venc || 10) > F ? fechaYm : somaMes_(fechaYm, 1);
}
function dividir_(v, n) { const base = Math.floor(Math.round(v * 100) / n) / 100; const a = []; for (let i = 0; i < n; i++) a.push(base); a[n - 1] = arred_(v - base * (n - 1)); return a; }

function hoje_() { return Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd'); }
function hora_(iso) { return iso ? Utilities.formatDate(new Date(iso), FUSO, "dd/MM 'às' HH:mm") : '?'; }
function somaDias_(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function somaMes_(ym, n) { const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; return (y + Math.floor(m / 12)) + '-' + pad_(((m % 12) + 12) % 12 + 1); }
function diasNoMes_(ym) { return new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate(); }
function mesNome_(ym) { return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+ym.slice(5, 7) - 1] + '/' + ym.slice(2, 4); }
function br_(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) : ''; }
function pad_(n) { return ('0' + n).slice(-2); }
function uid_() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function soma_(l) { return arred_(l.reduce(function (s, i) { return s + (+i.v || 0); }, 0)); }
function arred_(n) { return Math.round(n * 100) / 100; }
function num_(v) { return String(v).replace('.', ','); }
function brl_(v) { return v == null ? '–' : 'R$ ' + (+v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function tentar_(f) { try { return f(); } catch (e) { return null; } }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
