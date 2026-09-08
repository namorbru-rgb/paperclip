import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Agent, CompactIssue } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { Link } from "@/lib/router";
import { queryKeys } from "../lib/queryKeys";
import type { CompanyUserProfile } from "../lib/company-members";
import { timeAgo } from "../lib/timeAgo";
import { StatusIcon } from "./StatusIcon";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const PAGE_SIZE = 8;
const views = [
  { key: "open", label: "Offen", status: "backlog,todo,in_progress,in_review,blocked" },
  { key: "running", label: "In Arbeit", status: "in_progress" },
  { key: "blocked", label: "Blockiert", status: "blocked" },
  { key: "review", label: "Prüfung", status: "in_review" },
  { key: "done", label: "Erledigt", status: "done" },
] as const;

const statusLabels: Record<CompactIssue["status"], string> = {
  backlog: "Geplant", todo: "Bereit", in_progress: "In Arbeit", in_review: "In Prüfung",
  blocked: "Blockiert", done: "Als erledigt gemeldet", cancelled: "Abgebrochen",
};

interface WorkOverviewProps {
  companyId: string;
  agents?: Agent[];
  agentsError?: Error | null;
  userProfiles: Map<string, CompanyUserProfile>;
  onNewTask: () => void;
  initialView?: string;
}

export function WorkOverview({ companyId, agents, agentsError, userProfiles, onNewTask, initialView = "open" }: WorkOverviewProps) {
  const [viewKey, setViewKey] = useState<string>(initialView);
  const [bundleRoutines, setBundleRoutines] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const view = views.find((item) => item.key === viewKey) ?? views[0];
  const tasksQuery = useInfiniteQuery({
    queryKey: [...queryKeys.issues.list(companyId), "work-overview", view.key, query],
    queryFn: ({ pageParam, signal }) => issuesApi.listCompact(companyId, {
      status: view.status,
      q: query || undefined,
      includeRoutineExecutions: true,
      limit: PAGE_SIZE,
      offset: pageParam,
      ...(view.key === "done" ? { sortField: "updated" as const, sortDir: "desc" as const } : {}),
    }, { signal }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, offset) => lastPage.length === PAGE_SIZE ? offset + PAGE_SIZE : undefined,
    refetchInterval: 30_000,
  });
  const tasks = useMemo(() => {
    if (tasksQuery.isError) return [];
    const unique = new Map<string, CompactIssue>();
    for (const page of tasksQuery.data?.pages ?? []) {
      for (const task of page) unique.set(task.id, task);
    }
    return [...unique.values()];
  }, [tasksQuery.data, tasksQuery.isError]);
  const agentMap = useMemo(() => new Map((agents ?? []).map((item) => [item.id, item])), [agents]);
  const failedAgents = (agents ?? []).filter((item) => item.status === "error");

  const groups = useMemo(() => {
    const result = new Map<string, CompactIssue[]>();
    for (const task of tasks) {
      const key = bundleRoutines && task.originKind === "routine_execution" && task.originId
        ? JSON.stringify([task.originId, task.title, task.status, task.assigneeAgentId, task.assigneeUserId])
        : task.id;
      const group = result.get(key) ?? [];
      group.push(task);
      result.set(key, group);
    }
    return [...result.values()];
  }, [tasks, bundleRoutines]);
  const renderTask = (task: CompactIssue) => {
                const owner = task.assigneeAgentId
                  ? agentMap.get(task.assigneeAgentId)?.name ?? "Zugewiesener Agent"
                  : task.assigneeUserId
                    ? userProfiles.get(task.assigneeUserId)?.label ?? "Zugewiesene Person"
                    : null;
                return (
                  <Link key={task.id} to={`/issues/${task.identifier ?? task.id}`} className="block px-4 py-3 no-underline text-inherit hover:bg-accent/50 transition-colors">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0"><StatusIcon status={task.status} blockerAttention={task.blockerAttention} /></span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="line-clamp-2 text-sm font-medium">{task.title}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-mono">{task.identifier ?? task.id.slice(0, 8)}</span>
                          <span>{statusLabels[task.status]}</span>
                          <span className={owner ? undefined : "text-destructive"}>{owner ?? "Verantwortung fehlt"}</span>
                          <span>{timeAgo(task.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
  };
  return (
    <section className="min-w-0 space-y-3" aria-label="Arbeitsübersicht">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Arbeitsübersicht</h2>
          <p className="text-sm text-muted-foreground">Auftrag öffnen, Verlauf prüfen, Ergebnis sehen.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/skills" className="text-sm underline underline-offset-2">Skills</Link>
          <Link to="/approvals" className="text-sm underline underline-offset-2">Freigaben</Link>
          <Button onClick={onNewTask}>Neuer Auftrag</Button>
        </div>
      </div>

      <Button variant="outline" size="sm" aria-pressed={bundleRoutines} onClick={() => setBundleRoutines(value => !value)}>Routinen bündeln: {bundleRoutines ? "Ein" : "Aus"}</Button>
      <Input aria-label="Aufgaben durchsuchen" placeholder="Aufgaben in Paperclip suchen…" value={search} onChange={(event) => setSearch(event.target.value)} />

      {agentsError ? (
        <p role="alert" className="text-sm text-destructive">Agentenstatus konnte nicht geladen werden. Bitte aktualisieren.</p>
      ) : failedAgents.length > 0 ? (
        <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>Agenten mit Fehler:</span>
          {failedAgents.map((item) => (
            <Link key={item.id} to={`/agents/${item.id}`} className="underline underline-offset-2">{item.name}</Link>
          ))}
        </div>
      ) : null}

      <Tabs value={view.key} onValueChange={setViewKey}>
        <div className="overflow-x-auto">
          <TabsList aria-label="Aufgabenstatus">
            {views.map((item) => <TabsTrigger key={item.key} value={item.key}>{item.label}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value={view.key} className="space-y-3">
          {view.key === "done" && (
            <p className="text-sm text-muted-foreground">Zuletzt aktualisierte erledigte Aufträge. Ergebnis und Abnahme im jeweiligen Auftrag prüfen.</p>
          )}
          {tasksQuery.isError && (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
              <span>Aufgaben konnten nicht aktualisiert werden. Vorhandene Angaben können veraltet sein.</span>
              <Button variant="outline" size="sm" disabled={tasksQuery.isFetching} onClick={() => void tasksQuery.refetch()}>Erneut laden</Button>
            </div>
          )}
          {tasksQuery.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">Aufgaben werden geladen…</p>
          ) : tasks.length === 0 && !tasksQuery.isError ? (
            <p className="text-sm text-muted-foreground">Keine Aufgaben in dieser Ansicht.</p>
          ) : tasks.length > 0 ? (
            <Card className="block py-0 divide-y divide-border overflow-hidden">
              {groups.map(group => group.length === 1 ? renderTask(group[0]) : (
                <details key={group[0].id} className="px-4 py-3">
                  <summary className="cursor-pointer text-base font-medium">{group[0].title} · {group.length} geladene Vorgänge · {statusLabels[group[0].status]}</summary>
                  <div className="divide-y divide-border">{group.map(renderTask)}</div>
                </details>
              ))}
            </Card>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" size="sm" disabled={tasksQuery.isFetching} onClick={() => void tasksQuery.refetch()}>Aufgaben aktualisieren</Button>
            {tasksQuery.hasNextPage && (
              <Button variant="outline" size="sm" disabled={tasksQuery.isFetching} onClick={() => void tasksQuery.fetchNextPage()}>
                {tasksQuery.isFetchingNextPage ? "Wird geladen…" : "Weitere Aufgaben"}
              </Button>
            )}
            <Link to="/issues" className="text-sm underline underline-offset-2">Alle Aufgaben und Filter</Link>
          </div>
          {tasksQuery.dataUpdatedAt > 0 && <p className="text-sm text-muted-foreground">Aufgaben geladen um {new Date(tasksQuery.dataUpdatedAt).toLocaleTimeString("de-CH")}. Die Liste lädt weitere Seiten nach; sie ist keine Gesamtzählung.</p>}
        </TabsContent>
      </Tabs>
    </section>
  );
}
