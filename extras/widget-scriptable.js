// Finanças do José — widget para o Scriptable (tela bloqueada e tela inicial)
// Cole aqui o URL do App da Web (termina em /exec) e o código secreto:
const URL_API = "https://script.google.com/macros/s/AKfycbyW6oHv1zqTp838QP8LEnJzT3K_VTs6tbC1JQ700byMYLZ61mCHF8GPt2OU4391cxM9/exec";
const TOKEN = "COLE_AQUI_O_CODIGO";
const SITE = "https://eujoseo.github.io/financas/";

// ───────── dados (com cópia guardada para quando estiver sem internet) ─────────
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "financas-widget.json");

async function carregar() {
  try {
    const req = new Request(`${URL_API}?token=${encodeURIComponent(TOKEN)}`);
    req.timeoutInterval = 20;
    const j = await req.loadJSON();
    if (!j.ok) throw new Error(j.msg || "Erro no Apps Script");
    j._offline = false;
    fm.writeString(CACHE, JSON.stringify(j));
    return j;
  } catch (e) {
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
  const sobra = d.sobraHoje;
  const linha1 = w.addStack(); linha1.centerAlignContent();
  txt(linha1, "💸 ", 12);
  txt(linha1, sobra == null ? "Sem orçamento" : sobra >= 0 ? `Pode gastar ${brl(sobra)}` : `Passou ${brl(-sobra)}`, 14, { bold: true });
  txt(w, `Hoje ${brl(d.gastoHoje)} · ${d.porDia == null ? "" : `${brl(d.porDia)}/dia`}`, 12);
  const v = d.vencimentos && d.vencimentos[0];
  if (d.atrasados) txt(w, `⚠️ ${d.atrasados} conta(s) atrasada(s)`, 12);
  else if (v) txt(w, `📅 ${ddmm(v.d)} ${v.desc} ${brl(v.v)}`, 12);
  else if (d.mes) txt(w, `Mês: ${d.mes.usoPct}% do diário`, 12);
}

function lockInline(w, d) {
  const s = d.sobraHoje;
  txt(w, s == null ? `💸 Hoje ${brl(d.gastoHoje)}` : `💸 ${s >= 0 ? "Pode" : "Passou"} ${brl(Math.abs(s))} · hoje ${brl(d.gastoHoje)}`, 12);
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
  txt(w, "PODE GASTAR HOJE", 10, { semi: true, color: suave });
  w.addSpacer(2);
  const s = d.sobraHoje;
  txt(w, s == null ? "–" : brl(Math.abs(s)), 28, { bold: true, color: s != null && s < 0 ? VERMELHO : texto });
  if (s != null && s < 0) txt(w, "acima do previsto hoje", 10, { color: VERMELHO });
  w.addSpacer();
  txt(w, `Gasto hoje ${brl(d.gastoHoje)}`, 12, { color: texto });
  txt(w, `Saldo ${brl(d.saldoConta)}`, 12, { color: texto });
  w.addSpacer(6);
  if (d.mes) {
    w.addImage(barra(d.mes.usoPct, 260, 8, corUso(d.mes.usoPct))).imageSize = new Size(130, 6);
    w.addSpacer(3);
    txt(w, `${d.mes.usoPct}% do diário do mês`, 9, { color: suave });
  }
}

function medio(w, d) {
  w.backgroundColor = fundo; w.setPadding(14, 16, 12, 16);
  const topo = w.addStack(); topo.layoutHorizontally();

  const esq = topo.addStack(); esq.layoutVertically();
  txt(esq, "PODE GASTAR HOJE", 10, { semi: true, color: suave });
  const s = d.sobraHoje;
  txt(esq, s == null ? "–" : brl(Math.abs(s)), 30, { bold: true, color: s != null && s < 0 ? VERMELHO : texto });
  txt(esq, s != null && s < 0 ? "acima do previsto hoje" : `${brl(d.porDia)}/dia até o fim do mês`, 10, { color: s != null && s < 0 ? VERMELHO : suave });

  topo.addSpacer();

  const dir = topo.addStack(); dir.layoutVertically();
  const linha = (rot, val, cor) => { const l = dir.addStack(); l.addSpacer(); txt(l, rot + " ", 11, { color: suave }); txt(l, val, 11, { semi: true, color: cor || texto }); };
  linha("Hoje", brl(d.gastoHoje));
  linha("Saldo", brl(d.saldoConta));
  if (d.mes) linha("Fim do mês", brl(d.mes.fimPrevisto), d.mes.fimPrevisto < 0 ? VERMELHO : null);
  if (d.reservaMeses != null) linha("Reserva", `${String(d.reservaMeses).replace(".", ",")} m`);

  w.addSpacer(8);
  if (d.mes) {
    w.addImage(barra(d.mes.usoPct, 640, 10, corUso(d.mes.usoPct))).imageSize = new Size(320, 7);
    w.addSpacer(3);
    txt(w, `Diário: ${brl(d.mes.gastoDiario)} de ${brl(d.mes.orcamentoDiario)} (${d.mes.usoPct}%) · faltam ${d.diasRestantes} dias`, 10, { color: suave });
  }
  w.addSpacer(6);

  let aviso = null;
  if (d.atrasados) aviso = [`⚠️ ${d.atrasados} conta(s) fixa(s) vencida(s) sem confirmar`, VERMELHO];
  else if (d.vencimentos && d.vencimentos.length) aviso = ["📅 " + d.vencimentos.slice(0, 2).map(v => `${ddmm(v.d)} ${v.desc} ${brl(v.v)}`).join(" · "), texto];
  else if (d.faturas && d.faturas.length) aviso = ["💳 " + d.faturas.map(f => `${f.cartao} ${brl(f.total)} (${ddmm(f.venc)})`).join(" · "), texto];
  if (aviso) txt(w, aviso[0], 11, { color: aviso[1] });

  w.addSpacer();
  txt(w, `${d._offline ? "sem internet · " : ""}atualizado ${hora(d.atualizadoEm)}`, 8, { color: suave });
}

function erro(w, msg) {
  if (!config.runsInAccessoryWidget) { w.backgroundColor = fundo; w.setPadding(12, 12, 12, 12); }
  txt(w, "💸 Finanças", 12, { bold: true });
  txt(w, msg, 10, { lines: 3 });
}

// ───────── montar ─────────
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
