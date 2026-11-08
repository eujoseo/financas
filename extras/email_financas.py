#!/usr/bin/env python3
"""Monta os e-mails de acompanhamento do app Finanças do José (diário, semanal e mensal).

Uso:
  python3 email_financas.py MODO dados.json                      -> imprime o contexto (fatos) para escrever a reflexão
  python3 email_financas.py MODO dados.json --reflexao "texto" [--acao "texto"] --saida email
      -> grava email.html, email.txt e email.json (assunto) e imprime o assunto

MODO: diario | semanal | mensal. Só usa a biblioteca padrão.
O arquivo de dados é o "Finanças do José - dados.json" do Drive (JSON puro, já decodificado).
"""
import argparse, html, json, sys
from datetime import date, datetime, timedelta
try:
    from zoneinfo import ZoneInfo
    HOJE = datetime.now(ZoneInfo("America/Fortaleza")).date()
except Exception:
    HOJE = (datetime.utcnow() - timedelta(hours=3)).date()

SITE = "https://eujoseo.github.io/financas/"
MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
DSEM = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]

# paleta do app
INK, INK2, MUTED, LINE, BG, CARD = "#11201c", "#4a5a55", "#7b8984", "#e3e9e7", "#f3f6f5", "#ffffff"
ACC, ACCW, GOOD, WARN, BAD = "#0f5c63", "#e1eff0", "#006b2e", "#8a5d00", "#c42f2f"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


# ───────── formatação ─────────
def brl(v):
    v = float(v or 0)
    s = f"{abs(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("−R$\u00a0" if v < 0 else "R$\u00a0") + s

def pct(v):
    return "–" if v is None else f"{v:.1f}".replace(".", ",").replace(",0", "") + "%"

def d_iso(s):
    return date.fromisoformat(s[:10])

def ddmm(s):
    return d_iso(s).strftime("%d/%m")

def mes_nome(ym):
    return MES[int(ym[5:7]) - 1]

def limpa(desc):
    d = str(desc or "").strip().lstrip("|").strip()
    if d and d == d.lower():
        d = d[0].upper() + d[1:]
    return d or "Lançamento"

e = lambda s: html.escape(str(s), quote=True)


# ───────── blocos de HTML (tabelas e estilos inline, para o Gmail) ─────────
def secao(titulo, corpo):
    return (f'<tr><td style="padding:22px 24px 0">'
            f'<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:{MUTED};font-weight:600;margin-bottom:10px">{e(titulo)}</div>'
            f'{corpo}</td></tr>')

def linha(esq, dir_, sub=None, cor=INK, forte=False):
    s = f'<div style="font-size:12px;color:{MUTED};margin-top:1px">{sub}</div>' if sub else ""
    w = "600" if forte else "400"
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>'
            f'<td style="padding:7px 0;border-bottom:1px solid {LINE};font-size:14px;color:{INK}">{esq}{s}</td>'
            f'<td align="right" style="padding:7px 0;border-bottom:1px solid {LINE};font-size:14px;color:{cor};font-weight:{w};white-space:nowrap;vertical-align:top">{dir_}</td>'
            f'</tr></table>')

def barra(p, cor=ACC, marca=None):
    p = max(0.0, min(1.0, p or 0))
    w = round(p * 100)
    cells = (f'<td width="{w}%" style="background:{cor};height:6px;font-size:0;line-height:0">&nbsp;</td>' if w > 0 else "")
    cells += (f'<td width="{100 - w}%" style="background:{ACCW};height:6px;font-size:0;line-height:0">&nbsp;</td>' if w < 100 else "")
    out = (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:3px;overflow:hidden;margin:6px 0 4px"><tr>{cells}</tr></table>')
    if marca is not None:
        m = max(0, min(100, round(marca * 100)))
        out += (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:-2px"><tr>'
                f'<td width="{m}%" style="font-size:0;line-height:0">&nbsp;</td>'
                f'<td style="font-size:10px;line-height:10px;color:{INK2}">▲</td></tr></table>')
    return out

def cor_uso(p, alerta=0.8):
    return BAD if p > 1 else WARN if p >= alerta else ACC

def kpis(itens):
    """itens: lista de (rótulo, valor, cor). Até 4, em grade de 2 colunas."""
    cel = []
    for it in itens:
        rot, val, cor = it[:3]
        sub = f'<div style="font-size:11px;color:{MUTED};margin-top:1px">{it[3]}</div>' if len(it) > 3 else ""
        cel.append(f'<td width="50%" style="padding:10px 12px;background:{BG};border-radius:8px;vertical-align:top">'
                   f'<div style="font-size:11px;color:{MUTED}">{e(rot)}</div>'
                   f'<div style="font-size:16px;font-weight:600;color:{cor or INK};margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{val}</div>{sub}</td>')
    linhas = []
    for i in range(0, len(cel), 2):
        par = cel[i:i + 2] + ([f'<td width="50%"></td>'] if len(cel[i:i + 2]) == 1 else [])
        linhas.append(f'<tr>{par[0]}{par[1]}</tr>')
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate">{"".join(linhas)}</table>'

def nota(txt, cor=INK2):
    return f'<p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:{cor}">{txt}</p>'

def documento(preheader, saudacao, data_txt, aviso, hero, secoes, reflexao, acao=None):
    av = (f'<tr><td style="padding:14px 24px 0"><div style="background:#fdf1d6;color:{WARN};font-size:13px;padding:9px 12px;border-radius:8px">{aviso}</div></td></tr>' if aviso else "")
    ref = ""
    if reflexao:
        ref = secao("Reflexão", f'<p style="margin:0;font-size:14px;line-height:1.6;color:{INK2}">{e(reflexao)}</p>')
    if acao:
        ref += secao("Para esta semana", f'<p style="margin:0;font-size:14px;line-height:1.6;color:{INK}">{e(acao)}</p>')
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Finanças do José</title></head>
<body style="margin:0;padding:0;background:{BG};font-family:{FONT};color:{INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{BG}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:{CARD};border:1px solid {LINE};border-radius:14px;border-collapse:separate">
<tr><td style="padding:22px 24px 0">
  <div style="font-size:12px;color:{MUTED}">{e(data_txt)}</div>
  <div style="font-size:20px;font-weight:700;color:{INK};margin-top:2px">{e(saudacao)}</div>
</td></tr>
{av}
<tr><td style="padding:18px 24px 4px">{hero}</td></tr>
{''.join(secoes)}
{ref}
<tr><td style="padding:24px 24px 24px"><a href="{SITE}" style="display:inline-block;background:{ACC};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Abrir o app</a></td></tr>
</table>
<div style="font-size:11px;color:{MUTED};padding:14px 0 0">Finanças do José</div>
</td></tr></table></body></html>"""

def hero_html(rotulo, valor, cor, sub):
    return (f'<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:{MUTED};font-weight:600">{e(rotulo)}</div>'
            f'<div style="font-size:34px;font-weight:700;letter-spacing:-.02em;color:{cor};margin:4px 0 2px;white-space:nowrap">{valor}</div>'
            f'<div style="font-size:13px;color:{INK2}">{sub}</div>')


# ───────── dados ─────────
def carregar(caminho):
    with open(caminho, encoding="utf-8") as f:
        dados = json.load(f)
    r = dados.get("resumo")
    if not r:
        sys.exit("O arquivo não tem o campo 'resumo' (o app ainda não gerou o resumo).")
    return dados, r

def aviso_atualizacao(r):
    h = d_iso(r["hoje"])
    dias = (HOJE - h).days
    if dias <= 0:
        return None, dias
    msg = f"Números de {ddmm(r['hoje'])}, a última vez que o app foi aberto."
    if dias >= 2:
        msg += " Abra o app para atualizar."
    return msg, dias

def cor_saldo(v, faixas):
    if v < 0: return BAD
    if v < (faixas or {}).get("ok", 1000): return WARN
    return GOOD

def atencao_diario(m, alerta):
    out = []
    for cat, o in (m or {}).get("gastosPorCategoria", {}).items():
        orc = o.get("orcamento")
        if orc and o.get("diario", 0) / orc >= alerta:
            p = o["diario"] / orc
            out.append((cat, o["diario"], orc, p))
    return sorted(out, key=lambda x: -x[3])

def patrimonio_liquido(dados):
    pat = dados.get("patrimonio") or {}
    contas, valores = pat.get("contas") or [], pat.get("valores") or {}
    meses = sorted(k for k, v in valores.items() if v)
    if not meses:
        return None
    def val(ym, cid):
        v = 0
        for k in sorted(valores):
            if k > ym: break
            x = (valores.get(k) or {}).get(cid)
            if x is not None: v = float(x)
        return v
    def pl(ym):
        bruto = sum(val(ym, c["id"]) for c in contas if c.get("g") != "divida")
        div = sum(val(ym, c["id"]) for c in contas if c.get("g") == "divida")
        return bruto - div
    ult = meses[-1]
    ant = (date(int(ult[:4]), int(ult[5:7]), 1) - timedelta(days=1)).strftime("%Y-%m")
    return {"mes": ult, "pl": pl(ult), "delta": pl(ult) - pl(ant) if ant >= meses[0] else None}


# ───────── e-mails ─────────
def email_diario(dados, r, reflexao):
    cfg = dados.get("config") or {}
    alerta = float(cfg.get("alertaDiario") or 0.8)
    m = r.get("mes") or {}
    h = d_iso(r["hoje"])
    aviso, _ = aviso_atualizacao(r)
    saldo, fim = r.get("saldoEmContaHoje", 0), m.get("fimDoMesPrevisto")
    orc, dia = m.get("orcamentoDiarioDoMes") or 0, m.get("diario") or 0
    import calendar
    nd = calendar.monthrange(h.year, h.month)[1]
    ritmo = orc * h.day / nd if orc else 0
    hero = hero_html("Saldo em conta", brl(saldo), cor_saldo(saldo, cfg.get("faixas")),
                     f"Fim de {mes_nome(m['mes'])}, previsto: <b>{brl(fim)}</b>" if fim is not None else "")
    secs = []
    # diário do mês
    if orc:
        dif = dia - ritmo
        sit = (f'<span style="color:{BAD}">{brl(dif)} acima do ritmo</span>' if dif > 0.5
               else f'<span style="color:{GOOD}">{brl(-dif)} abaixo do ritmo</span>' if dif < -0.5 else "no ritmo")
        corpo = (f'<div style="font-size:16px;font-weight:600;white-space:nowrap">{brl(dia)} <span style="font-size:13px;font-weight:400;color:{MUTED}">de {brl(orc)}</span></div>'
                 + barra(dia / orc, cor_uso(dia / orc, alerta), ritmo / orc)
                 + f'<div style="font-size:12px;color:{MUTED}">▲ esperado até hoje {brl(ritmo)} · {sit}</div>')
        secs.append(secao(f"Diário de {mes_nome(m['mes'])}", corpo))
    # hoje e últimos 7 dias
    hoje_its = [i for i in r.get("lancamentosDeHoje") or [] if i.get("d") == r["hoje"]]
    sete = r.get("diarioUltimos7Dias") or []
    tot7 = sum(x.get("total", 0) for x in sete)
    caro = max(sete, key=lambda x: x.get("total", 0)) if sete else None
    corpo = "".join(linha(e(limpa(i["desc"])), brl(i["v"]), e(i.get("cat") or "")) for i in hoje_its[:6])
    if not hoje_its:
        corpo = f'<p style="margin:0;font-size:14px;color:{INK2}">{"Nada lançado hoje ainda." if not aviso else "Sem lançamentos no dia dos números."}</p>'
    if sete:
        corpo += nota(f"Últimos 7 dias: <b>{brl(tot7)}</b>" + (f" · dia mais caro {DSEM[d_iso(caro['d']).weekday()]} {ddmm(caro['d'])} ({brl(caro['total'])})" if caro and caro.get('total') else ""), MUTED)
    secs.append(secao("Hoje", corpo))
    # atenção
    att = []
    for cat, u, o, p in atencao_diario(m, alerta):
        att.append(linha(e(cat), f"{brl(u)} / {brl(o)}", "estourou o orçamento" if p > 1 else f"{pct(p * 100)} do orçamento", BAD if p > 1 else WARN, True))
    for f in r.get("fixosVencidosSemConfirmar") or []:
        att.append(linha(e(limpa(f["desc"])), brl(f["v"]), f"venceu {ddmm(f['d'])}, falta confirmar", WARN))
    lim3 = h + timedelta(days=3)
    for f in r.get("vencimentosProximos7Dias") or []:
        if d_iso(f["d"]) <= lim3:
            att.append(linha(e(limpa(f["desc"])), brl(f["v"]), f"vence {ddmm(f['d'])}"))
    if att:
        secs.append(secao("Atenção", "".join(att)))
    assunto = f"Diário financeiro · {DSEM[HOJE.weekday()][:3]} {HOJE.strftime('%d/%m')}"
    pre = f"Saldo {brl(saldo)} · diário {brl(dia)} de {brl(orc)}"
    doc = documento(pre, "Boa noite, José", f"{DSEM[HOJE.weekday()].capitalize()}, {HOJE.day} de {MES[HOJE.month - 1]}", aviso, hero, secs, reflexao)
    ctx = {"saldo": saldo, "fimPrevisto": fim, "diario": dia, "orcamento": orc, "ritmoAteHoje": round(ritmo, 2),
           "ultimos7": round(tot7, 2), "hoje": [{"desc": limpa(i["desc"]), "v": i["v"], "cat": i.get("cat")} for i in hoje_its],
           "categoriasNoLimite": [{"cat": c, "usado": u, "orc": o} for c, u, o, _ in atencao_diario(m, alerta)], "numerosDe": r["hoje"]}
    return assunto, doc, ctx

def email_semanal(dados, r, reflexao, acao):
    cfg = dados.get("config") or {}
    m = r.get("mes") or {}
    h = d_iso(r["hoje"])
    aviso, _ = aviso_atualizacao(r)
    import calendar
    nd = calendar.monthrange(h.year, h.month)[1]
    orc = m.get("orcamentoDiarioDoMes") or 0
    ritmo7 = orc / nd * 7 if orc else 0
    sete = r.get("diarioUltimos7Dias") or []
    tot7 = sum(x.get("total", 0) for x in sete)
    cats = {}
    for d in sete:
        for i in d.get("itens") or []:
            c = i.get("cat") or "Outros"
            cats[c] = cats.get(c, 0) + float(i.get("v") or 0)
    sub = (f'Ritmo do orçamento para 7 dias: {brl(ritmo7)} · ' + (f'<span style="color:{BAD}">{brl(tot7 - ritmo7)} acima</span>' if tot7 > ritmo7 else f'<span style="color:{GOOD}">{brl(ritmo7 - tot7)} abaixo</span>')) if orc else ""
    hero = hero_html("Diário da semana", brl(tot7), INK, sub)
    secs = []
    if cats:
        mx = max(cats.values()) or 1
        corpo = ""
        for c, v in sorted(cats.items(), key=lambda x: -x[1])[:5]:
            corpo += (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px"><tr>'
                      f'<td style="font-size:13px">{e(c)}</td><td align="right" style="font-size:13px;white-space:nowrap">{brl(v)}</td></tr></table>'
                      + barra(v / mx).replace("margin:6px 0 4px", "margin:-4px 0 10px"))
        secs.append(secao("Por categoria", corpo))
    eco, meta = m.get("economiaPct"), m.get("metaEconomiaPct")
    secs.append(secao(f"{mes_nome(m.get('mes', h.strftime('%Y-%m'))).capitalize()} até agora", kpis([
        ("Entradas", brl(m.get("entradas")), GOOD), ("Saídas", brl(m.get("saidas")), None),
        ("Diário", brl(m.get("diario")), None), ("Investido", brl(m.get("investido")), None)])
        + nota(f"Economia {pct(eco)} (meta {pct(meta)}) · saldo hoje {brl(r.get('saldoEmContaHoje'))} · fim previsto {brl(m.get('fimDoMesPrevisto'))}", MUTED)))
    res, metas = r.get("reserva") or {}, r.get("metas") or []
    corpo = ""
    if res.get("mesesCobertos") is not None:
        mc = res["mesesCobertos"]
        corpo += (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:14px">Reserva de emergência</td>'
                  f'<td align="right" style="font-size:13px;color:{MUTED}">{str(mc).replace(".", ",")} de 6 meses</td></tr></table>'
                  + barra(mc / 6, BAD if mc < 3 else WARN if mc < 6 else GOOD)
                  + (f'<div style="font-size:12px;color:{MUTED};margin-bottom:12px">faltam {brl(res.get("faltaPara6Meses"))}</div>' if res.get("faltaPara6Meses") else ""))
    for mt in metas[:3]:
        alvo, atual = mt.get("alvo") or 0, mt.get("atual") or 0
        corpo += (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:14px">{e(mt.get("nome"))}</td>'
                  f'<td align="right" style="font-size:13px;color:{MUTED}">{e(mt.get("status") or "")}</td></tr></table>'
                  + barra(atual / alvo if alvo else 0)
                  + f'<div style="font-size:12px;color:{MUTED};margin-bottom:12px">faltam {brl(mt.get("falta"))} · {brl(mt.get("guardarPorMes"))}/mês</div>')
    if corpo:
        secs.append(secao("Reserva e metas", corpo))
    prox = [(x["d"], limpa(x["desc"]), x["v"]) for x in r.get("vencimentosProximos7Dias") or []]
    for f in r.get("faturas") or []:
        if not f.get("paga") and f.get("vencimento") and 0 <= (d_iso(f["vencimento"]) - h).days <= 7:
            prox.append((f["vencimento"], f"Fatura {f['cartao']}", f["total"]))
    if prox:
        secs.append(secao("Próximos 7 dias", "".join(linha(e(d), brl(v), f"vence {ddmm(dt)}") for dt, d, v in sorted(prox))))
    ini = HOJE - timedelta(days=6)
    assunto = f"Finanças da semana · {ini.strftime('%d/%m')} a {HOJE.strftime('%d/%m')}"
    doc = documento(f"Diário da semana {brl(tot7)}", "Sua semana em finanças", f"{ini.strftime('%d/%m')} a {HOJE.strftime('%d/%m')}", aviso, hero, secs, reflexao, acao)
    ctx = {"diarioSemana": round(tot7, 2), "ritmo7dias": round(ritmo7, 2), "porCategoria": {k: round(v, 2) for k, v in sorted(cats.items(), key=lambda x: -x[1])},
           "porDia": [{"d": x["d"], "total": x["total"]} for x in sete], "mes": {k: m.get(k) for k in ("entradas", "saidas", "diario", "investido", "economiaPct", "metaEconomiaPct", "fimDoMesPrevisto")},
           "saldoHoje": r.get("saldoEmContaHoje"), "reservaMeses": res.get("mesesCobertos"), "metas": metas, "gastosPorCategoriaMes": m.get("gastosPorCategoria"), "numerosDe": r["hoje"]}
    return assunto, doc, ctx

def email_mensal(dados, r, reflexao):
    h = d_iso(r["hoje"])
    # o mês que fechou é o anterior a HOJE; se o app não foi aberto no mês novo, ele ainda está em resumo.mes
    alvo = (HOJE.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    ma = r.get("mesAnterior") or {}
    if (r.get("mes") or {}).get("mes") == alvo:
        x = r["mes"]
        ma = {"mes": alvo, "entradas": x.get("entradas"), "gastos": round((x.get("saidas") or 0) - (x.get("investido") or 0) + (x.get("diario") or 0), 2),
              "investido": x.get("investido"), "resultado": round((x.get("entradas") or 0) - (x.get("saidas") or 0) - (x.get("diario") or 0), 2),
              "economiaPct": x.get("economiaPct"),
              "maiorCategoria": next(({"nome": k, "total": v["total"]} for k, v in (x.get("gastosPorCategoria") or {}).items()), None)}
    aviso, _ = aviso_atualizacao(r)
    nome = mes_nome(alvo)
    meta = (r.get("mes") or {}).get("metaEconomiaPct")
    res_m = ma.get("resultado")
    eco = ma.get("economiaPct")
    hero = hero_html(f"Resultado de {nome}", brl(res_m) if res_m is not None else "–", GOOD if (res_m or 0) >= 0 else BAD,
                     f"Economia {pct(eco)}" + (f" · meta {pct(meta)}" if meta is not None else ""))
    secs = []
    if ma:
        k = [("Entradas", brl(ma.get("entradas")), GOOD), ("Gastos", brl(ma.get("gastos")), None), ("Investido", brl(ma.get("investido")), None)]
        mc = ma.get("maiorCategoria")
        if mc: k.append(("Maior categoria", e(mc["nome"]), None, brl(mc["total"])))
        corpo = kpis(k)
        hist = [x for x in r.get("historico6Meses") or [] if x["mes"] < alvo]
        if hist:
            p = hist[-1]
            g_ant = (p.get("saidas") or 0) - (p.get("investido") or 0) + (p.get("diario") or 0)
            dif = (ma.get("gastos") or 0) - g_ant
            corpo += nota(f"Gastos {'acima' if dif > 0 else 'abaixo'} de {mes_nome(p['mes'])} em {brl(abs(dif))}.", MUTED)
        secs.append(secao(f"Como foi {nome}", corpo))
    pl = patrimonio_liquido(dados)
    if pl:
        corpo = linha("Patrimônio líquido", brl(pl["pl"]), f"valores de {mes_nome(pl['mes'])}", INK, True)
        if pl["delta"] is not None:
            corpo += linha("Variação no mês", ("+" if pl["delta"] >= 0 else "") + brl(pl["delta"]), None, GOOD if pl["delta"] >= 0 else BAD)
        if pl["mes"] < alvo:
            corpo += nota(f"{nome.capitalize()} ainda sem saldos no Patrimônio. Hora de atualizar.", WARN)
        secs.append(secao("Patrimônio", corpo))
    res, metas = r.get("reserva") or {}, r.get("metas") or []
    corpo = ""
    if res.get("mesesCobertos") is not None:
        mcv = res["mesesCobertos"]
        corpo += linha("Reserva de emergência", f"{str(mcv).replace('.', ',')} de 6 meses", f"{brl(res.get('valor'))} guardados" + (f" · faltam {brl(res.get('faltaPara6Meses'))}" if res.get("faltaPara6Meses") else ""))
    for mt in metas[:3]:
        corpo += linha(e(mt.get("nome")), e(mt.get("status") or ""), f"faltam {brl(mt.get('falta'))} · {brl(mt.get('guardarPorMes'))}/mês")
    if corpo:
        secs.append(secao("Reserva e metas", corpo))
    fin = r.get("financiamento")
    if fin:
        corpo = linha("Saldo devedor", brl(fin.get("saldoDevedor")), f"termina em {mes_nome(fin['terminaEm'])} de {fin['terminaEm'][:4]} · juros restantes {brl(fin.get('jurosRestantes'))}" if fin.get("terminaEm") else None)
        if (res_m or 0) > 0:
            corpo += nota("O mês fechou com sobra. Vale simular uma amortização na aba Apartamento.", MUTED)
        secs.append(secao("Financiamento", corpo))
    chk = ["Atualizar os saldos no Patrimônio", "Concluir o fechamento na Visão geral", "Confirmar fixos pendentes", "Conferir e pagar a fatura", "Revisar as metas"]
    if HOJE.month == 1: chk.append("Revisar o orçamento do diário e as metas do ano")
    if HOJE.month == 12: chk.append("Planejar o 13º e os gastos de fim de ano")
    secs.append(secao("Para fechar o mês", "".join(f'<div style="font-size:14px;color:{INK};padding:5px 0">☐&nbsp; {e(c)}</div>' for c in chk)))
    assunto = f"Fechamento de {nome}"
    doc = documento(f"Resultado de {nome}: {brl(res_m)}", "Bom dia, José", f"Começou {MES[HOJE.month - 1]}", aviso, hero, secs, reflexao)
    ctx = {"mesQueFechou": alvo, "mes": ma, "metaEconomiaPct": meta, "patrimonio": pl, "reserva": res, "metas": metas, "financiamento": fin,
           "historico": r.get("historico6Meses"), "numerosDe": r["hoje"]}
    return assunto, doc, ctx


def para_texto(doc):
    """Versão em texto puro (alternativa do e-mail)."""
    import re
    t = re.sub(r'<head>.*?</head>|<div style="display:none.*?</div>', "", doc, flags=re.S)
    t = re.sub(r"<(br|/tr|/p|/div|div)\b[^>]*>", "\n", t)
    t = re.sub(r"</td>", "  ", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t).replace("\xa0", " ")
    linhas = [l.strip() for l in t.splitlines()]
    out, vazio = [], False
    for l in linhas:
        if l == "▲":
            continue
        if not l:
            if not vazio and out: out.append("")
            vazio = True
        else:
            out.append(re.sub(r"\s{2,}", "  ", l)); vazio = False
    return "\n".join(out).strip() + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("modo", choices=["diario", "semanal", "mensal"])
    ap.add_argument("dados")
    ap.add_argument("--reflexao", default=None)
    ap.add_argument("--acao", default=None)
    ap.add_argument("--saida", default=None)
    a = ap.parse_args()
    dados, r = carregar(a.dados)
    if a.modo == "diario": assunto, doc, ctx = email_diario(dados, r, a.reflexao)
    elif a.modo == "semanal": assunto, doc, ctx = email_semanal(dados, r, a.reflexao, a.acao)
    else: assunto, doc, ctx = email_mensal(dados, r, a.reflexao)
    if not a.saida:
        print(json.dumps({"assunto": assunto, "contexto": ctx}, ensure_ascii=False, indent=1, default=str))
        return
    open(a.saida + ".html", "w", encoding="utf-8").write(doc)
    open(a.saida + ".txt", "w", encoding="utf-8").write(para_texto(doc))
    open(a.saida + ".json", "w", encoding="utf-8").write(json.dumps({"assunto": assunto}, ensure_ascii=False))
    print(assunto)

if __name__ == "__main__":
    main()
