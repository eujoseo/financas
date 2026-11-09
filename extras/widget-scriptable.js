// Finanças do José — widget para o Scriptable (tela bloqueada e tela inicial)
// Cole aqui o URL do App da Web (termina em /exec) e o código secreto:
const URL_API = "https://script.google.com/macros/s/AKfycbyW6oHv1zqTp838QP8LEnJzT3K_VTs6tbC1JQ700byMYLZ61mCHF8GPt2OU4391cxM9/exec";
const TOKEN = "COLE_AQUI_O_CODIGO";
const SITE = "https://eujoseo.github.io/financas/";

// ───────── dados (com cópia guardada para quando estiver sem internet) ─────────
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "financas-widget.json");

// código secreto: o guardado no iPhone (Keychain) vale mais que o escrito no topo do script
const CHAVE = "financas-widget-token";
const codigoSecreto = () => Keychain.contains(CHAVE) ? Keychain.get(CHAVE) : TOKEN;

async function pedirCodigo() {
  const a = new Alert();
  a.title = "Código secreto do widget";
  a.message = "Cole o código que o bot do Telegram mandou (comando /widget).";
  a.addTextField("código", "");
  a.addAction("Salvar"); a.addCancelAction("Cancelar");
  if (await a.presentAlert() === -1) return false;
  const c = a.textFieldValue(0).trim();
  if (!c) return false;
  Keychain.set(CHAVE, c);
  return true;
}

async function buscar() {
  const req = new Request(`${URL_API}?token=${encodeURIComponent(codigoSecreto())}`);
  req.timeoutInterval = 20;
  return await req.loadJSON();
}

async function carregar() {
  // link do Telegram com ?token=... também grava o código
  if (args.queryParameters && args.queryParameters.token) Keychain.set(CHAVE, args.queryParameters.token);
  try {
    let j = await buscar();
    if (!j.ok && j.codigo === "token" && config.runsInApp && await pedirCodigo()) j = await buscar();
    // erro do servidor (código errado etc.): mostra o erro em vez de dados velhos
    if (!j.ok) return { ok: false, msg: j.codigo === "token"
      ? "Código secreto inválido. Mande /widget para o bot no Telegram, abra o Scriptable, toque neste script e cole o código."
      : (j.msg || "Erro no Apps Script") };
    j._offline = false;
    fm.writeString(CACHE, JSON.stringify(j));
    return j;
  } catch (e) {
    // sem internet: usa a última cópia boa
    if (fm.fileExists(CACHE)) {
      const j = JSON.parse(fm.readString(CACHE));
      j._offline = true;
      return j;
    }
    return { ok: false, msg: String(e.message || e) };
  }
}

// ───────── formatação ─────────
const brl = (v, cent = false) => v == null ? "–" :
  "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: cent ? 2 : 0, maximumFractionDigits: cent ? 2 : 0 });
const ddmm = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "";
const hora = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const diaHora = iso => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${hora(iso)}`; };
// valor com sinal: negativo aparece como "−R$ 116"
const brlS = v => v == null ? "–" : (v < 0 ? "−" : "") + brl(Math.abs(v));
// o que o widget diz sobre hoje: cor, título, valor e explicação
function estado(d) {
  const s = d.sobraHoje, e = d.proximaEntrada;
  const ateEntrada = e ? `${brl(d.saldoConta)} na conta até ${ddmm(e.d)} (${d.diasAteEntrada} dias)` : `${brl(d.saldoConta)} na conta`;
  if (s == null) return { cor: texto, titulo: "HOJE", valor: brl(d.gastoHoje), linha: "sem orçamento definido" };
  if (s < 0) return {
    cor: VERMELHO, titulo: "NÃO GASTE HOJE", valor: brlS(s),
    linha: d.faltaNaConta ? `faltam ${brl(d.faltaNaConta.v)} p/ ${d.faltaNaConta.desc || "contas"} em ${ddmm(d.faltaNaConta.d)}`
      : d.limitadoPelaConta ? ateEntrada : "passou do orçamento de hoje"
  };
  if (d.limitadoPelaConta) return { cor: AMARELO, titulo: "ATENÇÃO · NO MÁXIMO HOJE", valor: brl(s), linha: ateEntrada };
  return { cor: VERDE, titulo: "PODE GASTAR HOJE", valor: brl(s), linha: `${brl(d.porDia)}/dia até o fim do mês` };
}

const VERDE = new Color("#34C759"), AMARELO = new Color("#FFCC00"), VERMELHO = new Color("#FF453A");
const corUso = pct => pct == null ? Color.gray() : pct > 100 ? VERMELHO : pct > 85 ? AMARELO : VERDE;
const fundo = Color.dynamic(new Color("#FFFFFF"), new Color("#141416"));
const texto = Color.dynamic(new Color("#111111"), new Color("#F2F2F2"));
const suave = Color.dynamic(new Color("#6E6E73"), new Color("#9A9AA0"));

function barra(pct, w, h, cor) {
  const dc = new DrawContext();
  dc.size = new Size(w, h); dc.opaque = false; dc.respectScreenScale = true;
  const fundoBarra = new Path(); fundoBarra.addRoundedRect(new Rect(0, 0, w, h), h / 2, h / 2);
  dc.addPath(fundoBarra); dc.setFillColor(new Color("#8E8E93", 0.3)); dc.fillPath();
  const p = Math.max(0, Math.min(100, pct || 0)) / 100;
  if (p > 0) {
    const cheio = new Path(); cheio.addRoundedRect(new Rect(0, 0, Math.max(h, w * p), h), h / 2, h / 2);
    dc.addPath(cheio); dc.setFillColor(cor); dc.fillPath();
  }
  return dc.getImage();
}

function txt(stack, s, size, opts = {}) {
  const t = stack.addText(s);
  t.font = opts.bold ? Font.boldRoundedSystemFont(size) : opts.semi ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  if (opts.color) t.textColor = opts.color;
  t.lineLimit = opts.lines || 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

// ───────── tela bloqueada ─────────
function lockRetangular(w, d) {
  const e = estado(d);
  txt(w, `${e.titulo === "PODE GASTAR HOJE" ? "Pode gastar" : e.titulo === "NÃO GASTE HOJE" ? "Não gaste" : "Máx. hoje"} ${e.valor}`, 14, { bold: true });
  txt(w, `Na conta ${brl(d.saldoConta)}${d.proximaEntrada ? ` até ${ddmm(d.proximaEntrada.d)}` : ""}`, 12);
  if (d.faltaNaConta) txt(w, `Falta ${brl(d.faltaNaConta.v)} em ${ddmm(d.faltaNaConta.d)}`, 12);
  else txt(w, `Gasto hoje ${brl(d.gastoHoje)}`, 12);
}

function lockInline(w, d) {
  const s = d.sobraHoje;
  txt(w, s == null ? `Conta ${brl(d.saldoConta)}` : s < 0 ? `Não gaste · conta ${brl(d.saldoConta)}` : `Pode ${brl(s)} · conta ${brl(d.saldoConta)}`, 12);
}

function lockCircular(w, d) {
  w.addSpacer();
  const s = w.addStack(); s.layoutHorizontally(); s.addSpacer();
  txt(s, d.sobraHoje == null ? "–" : String(Math.round(d.sobraHoje)), 16, { bold: true });
  s.addSpacer();
  const l = w.addStack(); l.addSpacer(); txt(l, "hoje", 9); l.addSpacer();
  w.addSpacer();
}

// ───────── tela inicial ─────────
function pequeno(w, d) {
  w.backgroundColor = fundo; w.setPadding(14, 14, 12, 14);
  const e = estado(d);
  txt(w, "NA CONTA", 10, { semi: true, color: suave });
  txt(w, brl(d.saldoConta), 24, { bold: true, color: d.saldoConta < 0 ? VERMELHO : texto });
  w.addSpacer(6);
  txt(w, e.titulo, 9, { semi: true, color: e.cor });
  txt(w, e.valor, 20, { bold: true, color: e.cor });
  txt(w, e.linha, 9, { color: suave, lines: 2 });
  w.addSpacer();
  txt(w, rodape(d), 7, { color: suave });
}

function medio(w, d) {
  w.backgroundColor = fundo; w.setPadding(14, 16, 12, 16);
  const e = estado(d);
  const topo = w.addStack(); topo.layoutHorizontally();

  const esq = topo.addStack(); esq.layoutVertically();
  txt(esq, e.titulo, 10, { semi: true, color: e.cor });
  txt(esq, e.valor, 30, { bold: true, color: e.cor });
  txt(esq, e.linha, 10, { color: suave });

  topo.addSpacer();

  const dir = topo.addStack(); dir.layoutVertically();
  const linha = (rot, val, cor, tam = 11) => { const l = dir.addStack(); l.addSpacer(); txt(l, rot + " ", tam, { color: suave }); txt(l, val, tam, { semi: true, color: cor || texto }); };
  linha("Na conta", brl(d.saldoConta), d.saldoConta < 0 ? VERMELHO : null, 14);
  linha("Gasto hoje", brl(d.gastoHoje));
  if (d.porDia != null) linha("Orçamento", `${brl(d.porDia)}/dia`);
  if (d.mes) linha("Fim do mês", brl(d.mes.fimPrevisto), d.mes.fimPrevisto < 0 ? VERMELHO : null);

  w.addSpacer(8);
  if (d.mes) {
    w.addImage(barra(d.mes.usoPct, 640, 10, corUso(d.mes.usoPct))).imageSize = new Size(320, 7);
    w.addSpacer(3);
    txt(w, `Diário: ${brl(d.mes.gastoDiario)} de ${brl(d.mes.orcamentoDiario)} (${d.mes.usoPct}%) · faltam ${d.diasRestantes} dias`, 10, { color: suave });
  }
  w.addSpacer(6);

  let aviso = null;
  if (d.faltaNaConta) aviso = [`⚠️ Faltam ${brl(d.faltaNaConta.v)} na conta em ${ddmm(d.faltaNaConta.d)} (${d.faltaNaConta.desc || "contas previstas"})`, VERMELHO];
  else if (d.atrasados) aviso = [`⚠️ ${d.atrasados} conta(s) fixa(s) vencida(s) sem confirmar`, VERMELHO];
  else if (d.vencimentos && d.vencimentos.length) aviso = ["📅 " + d.vencimentos.slice(0, 2).map(v => `${ddmm(v.d)} ${v.desc} ${brl(v.v)}`).join(" · "), texto];
  else if (d.faturas && d.faturas.length) aviso = ["💳 " + d.faturas.map(f => `${f.cartao} ${brl(f.total)} (${ddmm(f.venc)})`).join(" · "), texto];
  if (aviso) txt(w, aviso[0], 11, { color: aviso[1] });

  w.addSpacer();
  txt(w, rodape(d), 8, { color: suave });
}

// "atualizado" é a hora em que o widget buscou os dados; se o app não salva há mais de 3 h, avisa
function rodape(d) {
  const quando = d.consultadoEm || d.atualizadoEm;
  const velho = d.atualizadoEm && Date.now() - new Date(d.atualizadoEm).getTime() > 3 * 3600 * 1000;
  return `${d._offline ? "sem internet · " : ""}atualizado ${hora(quando)}${velho ? ` · app aberto em ${diaHora(d.atualizadoEm)}` : ""}`;
}

function erro(w, msg) {
  if (!config.runsInAccessoryWidget) { w.backgroundColor = fundo; w.setPadding(12, 12, 12, 12); }
  txt(w, "💸 Finanças", 12, { bold: true });
  txt(w, msg, 10, { lines: config.runsInAccessoryWidget ? 3 : 6 });
}

// ───────── atualização automática do próprio código ─────────
// Baixa a versão mais nova do GitHub e se regrava, mantendo o seu URL e código secreto.
// Vale a partir da próxima vez que o widget rodar; assim correções futuras não exigem colar nada.
async function autoAtualizar() {
  try {
    let f = FileManager.local(), p = f.joinPath(f.documentsDirectory(), Script.name() + ".js");
    try { const ic = FileManager.iCloud(), pi = ic.joinPath(ic.documentsDirectory(), Script.name() + ".js"); if (ic.fileExists(pi)) { f = ic; p = pi; } } catch (e) {}
    if (!f.fileExists(p)) return;
    const req = new Request("https://raw.githubusercontent.com/eujoseo/financas/main/extras/widget-scriptable.js?t=" + Date.now());
    req.timeoutInterval = 10;
    let novo = await req.loadString();
    if (!novo.includes("Finanças do José — widget para o Scriptable") || !novo.includes("Script.setWidget")) return;
    novo = novo.replace(/const URL_API = "[^"]*";/, () => `const URL_API = "${URL_API}";`)
               .replace(/const TOKEN = "[^"]*";/, () => `const TOKEN = "${TOKEN}";`);
    if (novo !== f.readString(p)) f.writeString(p, novo);
  } catch (e) {}
}

// ───────── montar ─────────
await autoAtualizar();
const d = await carregar();
const w = new ListWidget();
w.url = SITE;
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
const fam = config.widgetFamily || "medium";

if (!d.ok) erro(w, d.msg);
else if (fam === "accessoryRectangular") lockRetangular(w, d);
else if (fam === "accessoryInline") lockInline(w, d);
else if (fam === "accessoryCircular") lockCircular(w, d);
else if (fam === "small") pequeno(w, d);
else medio(w, d);

if (config.runsInWidget || config.runsInAccessoryWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
