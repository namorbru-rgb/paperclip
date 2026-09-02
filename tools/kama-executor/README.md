# MERC zum Executor: Umbau der KAMA Energie

Stand 02.09.2026. Grundlage: Paperclip-Snapshot (500 Tickets), KAMA-net Agent-API-Log, Dashboard.

## Befund in einem Satz

478 Produkt-Tickets, 0 live geliefert. 330 davon sind Routine-Check-ins, 198 handeln von Paperclip selbst,
alle 478 sind "critical", 74 Prozent haengen an PUK, und der Host-Wake-Executor quittiert Wakes ohne
Sessions zu starten (KAMAA-6747). Die Firma kontrolliert sich, statt zu arbeiten.

## Zielbild

| Vorher | Nachher |
|---|---|
| Host-Wake-Executor auf 172.20.0.1:8086, acked nur | MERC laeuft als `claude_local` oder `codex_local` direkt auf dem Paperclip-Host |
| MERC = Fachagent "on demand von NEO geweckt", 4 Tickets | MERC = Executor, bekommt alle Fachtickets, ein Heartbeat = ein Ergebnis |
| 3 Routinen erzeugen 330 Tickets | Routinen laufen nur bei externer Aktivitaet, Prio low, kein Parallel-Lauf |
| 478 x critical | 5 x critical, Rest medium |
| 67 blocked, 0 mit blockedBy | 46 Infra-Blocker unter einem Epic (Prio low, 7-Tage-Regel), 21 fachliche auf high |
| AEGIS-Abnahme, Readback, Remediation 1/2/3 | Executor-Vertrag verbietet Folgetickets dieser Art |

## Warum lokaler Adapter statt HTTP-Executor

Der `http`-Adapter ist fire-and-forget: Paperclip schickt einen POST, der Host-Dienst antwortet 200 und
muss dann selbst eine Session starten und sich per API zurueckmelden. Genau dieser zweite Schritt fehlt seit
Wochen (KAMAA-6747, 6737, 6354, 6356, 6773, 6797, 6799). `claude_local` und `codex_local` starten den
Agenten als Kindprozess des Paperclip-Servers: Session-Persistenz, Skills-Injection, Run-Log und
PAPERCLIP_API_KEY kommen von Paperclip selbst. Es gibt keinen Wake-Ack mehr, der verloren gehen kann.

Voraussetzung auf dem Paperclip-Host (srv1448003):

- `claude` CLI installiert und eingeloggt (Subscription) oder `ANTHROPIC_API_KEY` in der Adapter-Env,
  alternativ `codex` CLI mit `~/.codex/auth.json` (KAMAA-6460 zeigt, dass Codex dort schon laeuft;
  bwrap/User-Namespace-Problem beachten, notfalls `dangerouslyBypassApprovalsAndSandbox`).
- Arbeitsverzeichnis, Standard `/srv/paperclip/executor`, mit Checkout von `business-app` und Zugang zu
  KAMA-net Agent-API-Key (als Secret-Ref in `adapterConfig.env`, nicht im Prompt).

## Durchsatz: 100 bis 200 Tickets pro Tag

Ein Agent bearbeitet in Paperclip einen Run nach dem anderen. Bei 10 Minuten pro Ticket sind das
maximal 144 pro Tag bei Dauerbetrieb, real eher 60 bis 80. Deshalb:

1. `--clones 3` legt MERC-2, MERC-3, MERC-4 mit identischer Konfiguration an. Vier Executor schaffen
   rechnerisch 250 bis 350 Tickets pro Tag.
2. NEO verteilt Tickets round-robin auf MERC bis MERC-4. Kein Ticket mehr an PUK ausser Postfach-Routinen.
3. Tickets muessen heartbeat-gross sein: ein Ergebnis, ein Work Product. Der Executor-Vertrag zwingt
   grosse Tickets in maximal 3 Kinder, wovon das erste sofort bearbeitet wird.
4. Zaehlen, was zaehlt: nicht "done", sondern "done mit Work Product". Der Outcome-Cockpit-Snapshot in
   Supabase (`app_paperclip_snapshot`) zeigt heute 0 von 478. Das ist die Kennzahl fuer die naechsten Wochen.

## Ausfuehrung

```sh
export PAPERCLIP_API_URL=https://paperclip-2yhw.srv1448003.hstgr.cloud
export PAPERCLIP_API_KEY=<Board-API-Key>
python3 tools/kama-executor/apply.py                        # Dry-Run
python3 tools/kama-executor/apply.py --apply --adapter claude_local --cwd /srv/paperclip/executor --clones 3
```

Das Skript ist idempotent: mehrfaches Ausfuehren aendert nichts Zusaetzliches. Jede Phase laesst sich mit
`--only <phase>` einzeln fahren. Ein Agent-Key reicht nicht, weil Agenten keine Adapter-Konfiguration anderer
Agenten aendern duerfen (`assertNoAgentAdapterConfigMutation` in `server/src/routes/agents.ts`). Es braucht
einen Board-Key.

## Nach dem Umbau, von Hand im Board

1. Bei MERC "Test Environment" klicken. Muss gruen sein, bevor das erste Ticket laeuft.
2. Die Agenten VPS-Ops, ORBIT und AEGIS pausieren, bis das Epic abgearbeitet ist. Sie erzeugen sonst
   weiter Abnahme- und Cutover-Tickets.
3. NEO-Instruktionen um zwei Saetze ergaenzen: "Fachtickets gehen an MERC bis MERC-4. Keine Tickets ueber
   Paperclip, Host, Executor oder Abnahmen ohne Freigabe von Roman."
4. Nach 7 Tagen: `python3 tools/kama-executor/apply.py --only blockers` erneut, dann die Kinder des Epics,
   die noch ohne blockedByIssueIds sind, im Board auf cancelled setzen.
