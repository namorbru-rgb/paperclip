import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, CirclePause, ShieldCheck, CircleCheck, RefreshCw } from "lucide-react";
import { Link } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useDialogActions } from "../context/DialogContext";
import { dashboardApi } from "../api/dashboard";
import { agentsApi } from "../api/agents";
import { accessApi } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import { buildCompanyUserProfileMap } from "../lib/company-members";
import { WorkOverview } from "../components/WorkOverview";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";

const agentLabels: Record<string, string> = {
  running: "Arbeitet", idle: "Bereit", active: "Bereit", paused: "Pausiert",
  error: "Fehler gemeldet", terminated: "Beendet", pending_approval: "Wartet auf Freigabe",
};

/** Native board route: session, company authorization and mutations stay in Paperclip. */
export function PaperclipKlar() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "Paperclip Klar" }]); }, [setBreadcrumbs]);
  return selectedCompanyId
    ? <CompanyKlar key={selectedCompanyId} companyId={selectedCompanyId} />
    : <p role="status">Bitte zuerst eine Firma auswählen.</p>;
}

function CompanyKlar({ companyId }: { companyId: string }) {
  const { selectedCompany } = useCompany();
  const { openNewIssue } = useDialogActions();
  const [tab, setTab] = useState("overview");
  const [taskView, setTaskView] = useState("open");
  const summary = useQuery({
    queryKey: queryKeys.dashboard(companyId), queryFn: () => dashboardApi.summary(companyId),
    refetchInterval: 30_000, refetchOnWindowFocus: "always",
  });
  const agents = useQuery({
    queryKey: queryKeys.agents.list(companyId), queryFn: () => agentsApi.list(companyId),
    refetchInterval: 30_000, refetchOnWindowFocus: "always",
  });
  const directory = useQuery({
    queryKey: queryKeys.access.companyUserDirectory(companyId),
    queryFn: () => accessApi.listUserDirectory(companyId),
  });
  const profiles = useMemo(() => buildCompanyUserProfileMap(directory.data?.users), [directory.data]);
  const selectTasks = (view: string) => { setTaskView(view); setTab("overview"); };
  const refresh = () => { void summary.refetch(); void agents.refetch(); };
  const counts = summary.isError ? undefined : summary.data;
  const team = agents.isError ? [] : agents.data ?? [];
  const metrics = [
    { label: "In Arbeit", value: counts?.tasks.inProgress, hint: "Bearbeitung eingetragen", Icon: Clock3, view: "running" },
    { label: "Blockiert", value: counts?.tasks.blocked, hint: "Ein Hindernis hält auf", Icon: CirclePause, view: "blocked" },
    { label: "Offene Freigaben", value: counts?.pendingApprovals, hint: "Eine Freigabe steht aus", Icon: ShieldCheck, to: "/approvals" },
    { label: "Erledigt gemeldet", value: counts?.tasks.done, hint: "Ergebnis im Auftrag prüfen", Icon: CircleCheck, view: "done" },
  ];
  return <div className="space-y-6 min-w-0">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2"><p className="text-sm text-muted-foreground">{selectedCompany?.name} · Paperclip Klar</p><h1 className="text-3xl font-semibold tracking-tight">Dein KI-Büro im Überblick</h1><p className="text-base text-muted-foreground">Was läuft, wo es hängt und wer sich darum kümmert.</p></div>
      <Button variant="outline" disabled={summary.isFetching || agents.isFetching} onClick={refresh}><RefreshCw className="size-4" />Übersicht aktualisieren</Button>
    </header>
    <p className="text-sm text-muted-foreground" role="status">Direkt aus Paperclip · Aktualisierung alle 30 Sekunden bei geöffneter Ansicht.{summary.dataUpdatedAt > 0 && !summary.isError ? ` Firmenzahlen geladen um ${new Date(summary.dataUpdatedAt).toLocaleTimeString("de-CH")}.` : ""}</p>
    {summary.isError && <p role="alert" className="text-sm text-destructive">Firmenzahlen konnten nicht geladen werden. Bitte erneut aktualisieren; bei abgelaufener Sitzung neu anmelden.</p>}
    <Card className="grid grid-cols-2 lg:grid-cols-4 gap-0 py-0 overflow-hidden">
      {metrics.map(({label, value, hint, Icon, view, to}) => {
        const inner = <><span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">{label}<Icon className="size-4 shrink-0" /></span><strong className="text-3xl font-semibold tabular-nums">{value ?? "—"}</strong><span className="text-sm text-muted-foreground">{hint}</span></>;
        const cls = "flex flex-col gap-3 p-5 text-left hover:bg-accent/50 no-underline text-inherit";
        return to ? <Link key={label} to={to} className={cls}>{inner}</Link> : <button key={label} className={cls} onClick={() => selectTasks(view!)}>{inner}</button>;
      })}
    </Card>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label="Paperclip Klar Ansichten"><TabsTrigger value="overview">Aufgaben</TabsTrigger><TabsTrigger value="team">KI-Team</TabsTrigger><TabsTrigger value="help">Einfach erklärt</TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-4">
        {directory.isError && <p className="text-sm text-muted-foreground">Personennamen konnten nicht geladen werden. Zugewiesene Personen bleiben als solche gekennzeichnet.</p>}
        <WorkOverview key={taskView} initialView={taskView} companyId={companyId} agents={agents.isError ? undefined : agents.data} agentsError={agents.error} userProfiles={profiles} onNewTask={() => openNewIssue()} />
      </TabsContent>
      <TabsContent value="team" className="space-y-4">
        <p className="text-base text-muted-foreground">„Bereit“ bedeutet: gerade kein Arbeitslauf. Die zugeteilte Aufgabe kann trotzdem als „in Arbeit“ eingetragen sein.</p>
        {agents.isPending && <p role="status">Das Team wird geladen…</p>}
        {agents.isError && <p role="alert" className="text-destructive">Das Team konnte nicht geladen werden. Bitte die Übersicht aktualisieren.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{team.map(agent => <Link key={agent.id} to={`/agents/${agent.id}`} className="no-underline text-inherit"><Card className="h-full p-5 gap-3 hover:bg-accent/50"><div className="flex flex-wrap justify-between gap-2"><h2 className="text-base font-semibold">{agent.name}</h2><span className={agent.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{agentLabels[agent.status] ?? "Status unbekannt"}</span></div><p className="text-base text-muted-foreground">{agent.title || "Rolle nicht hinterlegt"}</p><span className="text-sm underline">Aufgaben, Verlauf und Skills öffnen</span></Card></Link>)}</div>
        {!agents.isPending && !agents.isError && team.length === 0 && <p>Für diese Firma sind keine Assistenten vorhanden.</p>}
      </TabsContent>
      <TabsContent value="help" className="space-y-4">
        <Card className="p-5 space-y-3"><h2 className="text-lg font-semibold">Vom Auftrag zum Ergebnis</h2><p>Öffne eine Aufgabe: Dort findest du aktuelle Kommentare, hinterlegte Ergebnisse und die nächsten Schritte. Änderungen erfolgen in der ursprünglichen Aufgabe und bleiben für alle sichtbar.</p><p>„Blockiert“ bedeutet, dass ein Hindernis vorliegt. Es bedeutet nicht automatisch, dass du selbst handeln musst.</p><p>„Erledigt gemeldet“ ist der Status in Paperclip. Ob das Ziel erreicht wurde, zeigen Ergebnisbeleg und Abnahme.</p></Card>
        <div className="flex flex-wrap gap-4"><Button asChild variant="outline"><Link to="/skills">Gemeinsame Skills öffnen</Link></Button><Button asChild variant="outline"><Link to="/approvals">Freigaben prüfen</Link></Button><Button asChild variant="outline"><Link to="/artifacts">Ergebnisse öffnen</Link></Button></div>
      </TabsContent>
    </Tabs>
  </div>;
}
