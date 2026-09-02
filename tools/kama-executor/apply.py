#!/usr/bin/env python3
"""
KAMA Energie: MERC zum Executor umbauen und das Board entruempeln.

Laeuft mit Python 3 Standardbibliothek, keine Abhaengigkeiten.

    export PAPERCLIP_API_URL=https://paperclip-2yhw.srv1448003.hstgr.cloud
    export PAPERCLIP_API_KEY=<Board-API-Key>      # nie in Chat/Commit/Log einfuegen
    python3 tools/kama-executor/apply.py                 # Dry-Run: zeigt nur, was passieren wuerde
    python3 tools/kama-executor/apply.py --apply         # fuehrt aus
    python3 tools/kama-executor/apply.py --apply --adapter codex_local --cwd /srv/executor
    python3 tools/kama-executor/apply.py --apply --clones 3   # MERC-2..MERC-4 als weitere Executor

Phasen (jede einzeln per --only <phase> ausfuehrbar):
  executor   MERC -> Executor (Rolle, Adapter, Prompt-Vertrag, Konzernstruktur)
  routines   Die drei Ticket-Fabriken (Postfach, Inbox/Journal, IRIS-Nacht) entschaerfen
  priority   Prioritaeten zuruecksetzen: max. 5 critical, Rest medium
  blockers   Meta-Blocker (Paperclip/Host/Executor/AEGIS) unter ein Epic haengen, Prio low
  dispatch   Die Fachtickets an den Executor geben und starten
  clones     Weitere Executor-Agenten aus der MERC-Konfiguration erzeugen (--clones N)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("PAPERCLIP_API_URL", "").rstrip("/")
KEY = os.environ.get("PAPERCLIP_API_KEY", "")

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

EXECUTOR_NAME_MATCH = re.compile(r"^\s*MERC\b", re.I)

# Fachtickets, die als erstes durch den Executor laufen (Identifier).
DISPATCH_FIRST = [
    "KAMAA-6839",  # Fehr Holzbau / Mathias Jans nachfuehren (revenue)
    "KAMAA-6715",  # Bestellte Batteriesysteme in KAMA-net erfassen
    "KAMAA-6255",  # Roth vZEV-Regelkreis
    "KAMAA-6432",  # VNB Tarife 2027
    "KAMAA-6893",  # Speditionsantworten / 5-Punkte-Vergleich
]

# Diese bleiben critical. Alles andere Offene wird medium.
KEEP_CRITICAL = set(DISPATCH_FIRST)

# Ticket-Fabriken: Routinen, die pro Lauf ein Ticket erzeugen.
NOISY_ROUTINE_TITLES = [
    re.compile(r"Service-, System- und Buchhaltungspostfach", re.I),
    re.compile(r"KAMA-net Inbox-/Journalbetrieb", re.I),
    re.compile(r"IRIS BMS-PDO Flotten-Nachtanalyse", re.I),
]

# Meta-/Selbstbezug: Tickets ueber die Maschine statt ueber das Geschaeft.
META_TITLE = re.compile(
    r"paperclip|executor|host-?wake|wake-?sink|\bhost\b|\bvps\b|openclaw|plugin|codex|built-in|"
    r"snapshot|\bcron\b|telegram|zustell|\bmcp\b|runtime|aegis|abnahme|selbstverbesser|incident|"
    r"\bw1\b|operator-key|sandbox|bwrap|fehlerkreislauf|statuswiderspruch|lost-work|blind-wake|"
    r"stale|revalid|readback|fail-closed",
    re.I,
)

EPIC_TITLE = "[EPIC] Paperclip-Infrastruktur: Executor-Wechsel auf MERC"
EPIC_DESCRIPTION = """Sammel-Epic fuer alle Infrastruktur-Blocker (Host-Wake-Executor, VPS-Ops, AEGIS-Abnahmen, Plugin-Drift).

Entscheidung Roman 02.09.2026: Der Host-Wake-Executor (srv1448003, 172.20.0.1:8086) wird nicht weiter repariert.
MERC wird zum Executor und laeuft direkt auf dem Paperclip-Host (lokaler Adapter). Damit entfallen Wake-Ack,
Hostsession und Cutover-Ketten.

Regeln fuer Kinder dieses Epics:
- Prioritaet low. Kein neues Kind ohne Freigabe von Roman.
- Keine Folge-Tickets (Abnahme, Re-Abnahme, Remediation 2/3). Ein Ticket = ein Ergebnis.
- Was nach 7 Tagen ohne blockedByIssueIds und ohne neue Evidenz noch blocked ist, wird cancelled.
"""

EXECUTOR_TITLE = "Executor"
EXECUTOR_ROLE = "engineer"
EXECUTOR_CAPABILITIES = (
    "Executor der KAMA Energie: fuehrt zugewiesene Fachtickets in einem Heartbeat vollstaendig aus "
    "(KAMA-net-Daten, Offerten, Bestellungen, Rechnungen via Bexio, Dokumente, Code in business-app). "
    "Liefert pro Ticket ein pruefbares Work Product (Datensatz-ID, PR, Datei, Rechnung). "
    "Erzeugt keine Abnahme-, Readback- oder Remediation-Folgetickets. Kommerzielle Freigaben bleiben bei Roman."
)

EXECUTOR_PROMPT = """Du bist MERC, der Executor der KAMA Energie ({{company.name}}). Agent {{agentId}}, Run {{runId}}.

Dein einziger Zweck: zugewiesene Tickets ERLEDIGEN. Nicht planen, nicht pruefen lassen, nicht weiterreichen.

Vertrag pro Heartbeat:
1. Inbox holen (GET /api/agents/me/inbox-lite). Reihenfolge: in_progress, dann todo nach Prioritaet. Blocked ueberspringen.
2. Ticket auschecken und SOFORT mit der Arbeit anfangen. Ein Heartbeat = mindestens ein fertiges Ticket.
3. Ergebnis = Work Product am Ticket: KAMA-net-Datensatz (ID + Readback), Bexio-Beleg, Datei-Upload, PR oder Commit.
   Ein Kommentar ohne Work Product ist kein Ergebnis.
4. Status am Ende IMMER setzen: done (mit Work Product) oder blocked (mit blockedByIssueIds ODER unblockDescriptor:
   wer muss was tun). in_progress nur, wenn ein Folge-Run schon geplant ist.
5. Verboten: neue Tickets vom Typ Abnahme, Re-Abnahme, Readback, Remediation, Selbstverbesserung, Executor, Host, VPS,
   AEGIS. Verboten: ein Ticket an einen anderen Agenten zurueckgeben, weil "unabhaengig geprueft" werden muesse.
6. Wenn etwas fachlich unklar ist: die wahrscheinlichste Annahme treffen, sie im Kommentar nennen, weitermachen.
   Nur bei Geld-Zusagen, Aussenkommunikation an Kunden/Lieferanten oder Loeschungen: blocked mit unblockDescriptor
   owner=board, action=konkrete Frage an Roman.
7. Prioritaet nie hochsetzen. Keine Tickets als critical anlegen.
8. Wenn ein Ticket zu gross fuer einen Heartbeat ist: max. 3 Kindtickets mit klaren Ergebnissen anlegen,
   das erste davon SOFORT selbst bearbeiten.

Ziel der Firma: 100 bis 200 erledigte Tickets pro Tag, jedes mit Work Product. Du bist der Engpass. Arbeite.
"""

# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def api(method: str, path: str, body: dict | None = None, apply: bool = True):
    """Ruft die Paperclip-API auf. Bei apply=False werden Schreibzugriffe nur geloggt."""
    if not BASE or not KEY:
        sys.exit("PAPERCLIP_API_URL und PAPERCLIP_API_KEY muessen gesetzt sein.")
    url = f"{BASE}/api{path}"
    if method != "GET" and not apply:
        print(f"  [dry] {method} {path} {json.dumps(body, ensure_ascii=False)[:300]}")
        return None
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:500]
        print(f"  !! {method} {path} -> {e.code}: {detail}")
        return None


def unwrap(result, *keys):
    """Listen-Endpunkte liefern mal ein Array, mal {issues:[...]} oder {items:[...]}."""
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        for k in keys:
            if isinstance(result.get(k), list):
                return result[k]
    return []


def list_issues(company_id: str, statuses: list[str]):
    out = []
    offset = 0
    while True:
        qs = urllib.parse.urlencode(
            {"status": ",".join(statuses), "limit": 200, "offset": offset, "includeBlockedBy": "true"}
        )
        page = unwrap(api("GET", f"/companies/{company_id}/issues?{qs}"), "issues", "items", "data")
        out.extend(page)
        if len(page) < 200:
            return out
        offset += 200


# ---------------------------------------------------------------------------
# Phasen
# ---------------------------------------------------------------------------


def resolve_company(args) -> str:
    if args.company:
        return args.company
    companies = unwrap(api("GET", "/companies"), "companies", "items", "data")
    if len(companies) == 1:
        return companies[0]["id"]
    for c in companies:
        if "kama" in (c.get("name") or "").lower():
            return c["id"]
    sys.exit("Company nicht eindeutig, bitte --company <id> angeben: " + ", ".join(f"{c['name']}={c['id']}" for c in companies))


def find_executor(agents):
    hits = [a for a in agents if EXECUTOR_NAME_MATCH.search(a.get("name") or "")]
    if not hits:
        sys.exit("Agent MERC nicht gefunden. Vorhandene Agenten: " + ", ".join(a.get("name", "?") for a in agents))
    return hits[0]


def executor_adapter_config(args) -> dict:
    cfg = {
        "cwd": args.cwd,
        "promptTemplate": EXECUTOR_PROMPT,
        "timeoutSec": 1500,
        "graceSec": 30,
    }
    if args.model:
        cfg["model"] = args.model
    if args.adapter == "claude_local":
        cfg["maxTurnsPerRun"] = 300
        cfg["dangerouslySkipPermissions"] = True
    if args.adapter == "codex_local":
        cfg["dangerouslyBypassApprovalsAndSandbox"] = True
    return cfg


def phase_executor(args, company_id, agents):
    merc = find_executor(agents)
    neo = next((a for a in agents if (a.get("name") or "").strip().upper() == "NEO"), None)
    print(f"# executor: {merc['name']} ({merc['id']}), aktuell adapter={merc.get('adapterType')} status={merc.get('status')}")
    patch = {
        "title": EXECUTOR_TITLE,
        "role": EXECUTOR_ROLE,
        "capabilities": EXECUTOR_CAPABILITIES,
        "adapterType": args.adapter,
        "adapterConfig": executor_adapter_config(args),
        "replaceAdapterConfig": True,
        "status": "active",
    }
    if neo:
        patch["reportsTo"] = neo["id"]
    api("PATCH", f"/agents/{merc['id']}", patch, apply=args.apply)
    return merc


def phase_routines(args, company_id, agents):
    routines = unwrap(api("GET", f"/companies/{company_id}/routines"), "routines", "items", "data")
    print(f"# routines: {len(routines)} gesamt")
    for r in routines:
        title = r.get("title") or ""
        if not any(p.search(title) for p in NOISY_ROUTINE_TITLES):
            continue
        print(f"  entschaerfen: {title} (status={r.get('status')}, prio={r.get('priority')})")
        api(
            "PATCH",
            f"/routines/{r['id']}",
            {
                "priority": "low",
                "concurrencyPolicy": "skip_if_active",
                "catchUpPolicy": "skip_missed",
                "activityGatePolicy": "require_external_activity",
                "activityGateScope": "company",
            },
            apply=args.apply,
        )


def phase_priority(args, company_id, agents):
    open_issues = list_issues(company_id, ["backlog", "todo", "in_progress", "in_review", "blocked"])
    crit = [i for i in open_issues if i.get("priority") == "critical" and i.get("identifier") not in KEEP_CRITICAL]
    print(f"# priority: {len(open_issues)} offen, {len(crit)} critical -> medium, {len(KEEP_CRITICAL)} bleiben critical")
    for i in crit:
        api("PATCH", f"/issues/{i['id']}", {"priority": "medium"}, apply=args.apply)
    for i in open_issues:
        if i.get("identifier") in KEEP_CRITICAL and i.get("priority") != "critical":
            api("PATCH", f"/issues/{i['id']}", {"priority": "critical"}, apply=args.apply)


def phase_blockers(args, company_id, agents, executor):
    blocked = list_issues(company_id, ["blocked"])
    meta = [i for i in blocked if META_TITLE.search(i.get("title") or "")]
    fach = [i for i in blocked if i not in meta]
    print(f"# blockers: {len(blocked)} blocked, davon {len(meta)} Infrastruktur -> Epic, {len(fach)} fachlich bleiben")

    existing = [i for i in list_issues(company_id, ["todo", "in_progress", "blocked", "backlog"]) if i.get("title") == EPIC_TITLE]
    if existing:
        epic = existing[0]
    else:
        epic = api(
            "POST",
            f"/companies/{company_id}/issues",
            {
                "title": EPIC_TITLE,
                "description": EPIC_DESCRIPTION,
                "status": "todo",
                "priority": "low",
                "assigneeAgentId": executor["id"],
                "allowDuplicate": True,
            },
            apply=args.apply,
        ) or {"id": "<epic-dry-run>"}
    for i in meta:
        print(f"  -> Epic: {i.get('identifier')} {i.get('title', '')[:80]}")
        api(
            "PATCH",
            f"/issues/{i['id']}",
            {
                "parentId": epic["id"],
                "priority": "low",
                "comment": (
                    "Unter das Executor-Epic verschoben (Entscheid Roman 02.09.2026). Der Host-Wake-Executor wird nicht "
                    "weiter repariert; MERC uebernimmt als Executor. Ohne blockedByIssueIds und neue Evidenz wird dieses "
                    "Ticket in 7 Tagen cancelled."
                ),
            },
            apply=args.apply,
        )
    for i in fach:
        if i.get("priority") == "low":
            continue
        api("PATCH", f"/issues/{i['id']}", {"priority": "high"}, apply=args.apply)


def phase_dispatch(args, company_id, agents, executor):
    open_issues = list_issues(company_id, ["backlog", "todo", "in_progress", "blocked"])
    by_ident = {i.get("identifier"): i for i in open_issues}
    print(f"# dispatch: {len(DISPATCH_FIRST)} Fachtickets an {executor['name']}")
    for ident in DISPATCH_FIRST:
        i = by_ident.get(ident)
        if not i:
            print(f"  {ident}: nicht offen / nicht gefunden, uebersprungen")
            continue
        patch = {
            "assigneeAgentId": executor["id"],
            "priority": "critical",
            "comment": (
                f"An den Executor ({executor['name']}) uebergeben. Auftrag: in einem Heartbeat fertigstellen, "
                "Work Product anhaengen, Status done. Bei Rueckfrage an Roman: blocked mit unblockDescriptor."
            ),
        }
        if i.get("status") == "blocked":
            patch["status"] = "todo"
        print(f"  {ident} [{i.get('status')}] {i.get('title', '')[:70]}")
        api("PATCH", f"/issues/{i['id']}", patch, apply=args.apply)


def phase_clones(args, company_id, agents, executor):
    if args.clones <= 0:
        return
    existing = {(a.get("name") or "").strip().upper() for a in agents}
    print(f"# clones: {args.clones} weitere Executor")
    for n in range(2, args.clones + 2):
        name = f"MERC-{n}"
        if name.upper() in existing:
            print(f"  {name} existiert schon")
            continue
        api(
            "POST",
            f"/companies/{company_id}/agents",
            {
                "name": name,
                "role": EXECUTOR_ROLE,
                "title": EXECUTOR_TITLE,
                "reportsTo": executor.get("reportsTo"),
                "capabilities": EXECUTOR_CAPABILITIES,
                "adapterType": args.adapter,
                "adapterConfig": executor_adapter_config(args),
                "budgetMonthlyCents": args.budget_cents,
            },
            apply=args.apply,
        )


# ---------------------------------------------------------------------------


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="wirklich schreiben (sonst Dry-Run)")
    p.add_argument("--company", help="Company-ID (sonst automatisch)")
    p.add_argument("--adapter", default="claude_local", choices=["claude_local", "codex_local"])
    p.add_argument("--model", default=None, help="Modell fuer den Executor (optional)")
    p.add_argument("--cwd", default="/srv/paperclip/executor", help="Arbeitsverzeichnis auf dem Paperclip-Host")
    p.add_argument("--clones", type=int, default=0, help="zusaetzliche Executor-Agenten MERC-2..N")
    p.add_argument("--budget-cents", type=int, default=20000, help="Monatsbudget je Klon in Cent")
    p.add_argument("--only", choices=["executor", "routines", "priority", "blockers", "dispatch", "clones"])
    args = p.parse_args()

    print("Modus:", "APPLY" if args.apply else "DRY-RUN (nichts wird geschrieben)")
    company_id = resolve_company(args)
    agents = unwrap(api("GET", f"/companies/{company_id}/agents"), "agents", "items", "data")
    print(f"Company {company_id}, {len(agents)} Agenten")

    run = lambda name: args.only in (None, name)  # noqa: E731
    executor = find_executor(agents)
    if run("executor"):
        executor = phase_executor(args, company_id, agents) or executor
    if run("routines"):
        phase_routines(args, company_id, agents)
    if run("priority"):
        phase_priority(args, company_id, agents)
    if run("blockers"):
        phase_blockers(args, company_id, agents, executor)
    if run("dispatch"):
        phase_dispatch(args, company_id, agents, executor)
    if run("clones"):
        phase_clones(args, company_id, agents, executor)
    print("Fertig.")


if __name__ == "__main__":
    main()
