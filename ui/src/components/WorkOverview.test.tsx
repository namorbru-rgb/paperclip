// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, CompactIssue } from "@paperclipai/shared";
import { WorkOverview } from "./WorkOverview";

const listMock = vi.hoisted(() => vi.fn());
vi.mock("../api/issues", () => ({ issuesApi: { listCompact: (...args: unknown[]) => listMock(...args) } }));
vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function task(id: string, overrides: Partial<CompactIssue> = {}): CompactIssue {
  return {
    id, companyId: "company-a", identifier: `TASK-${id}`, title: `Task ${id}`,
    status: "todo", priority: "high", assigneeAgentId: null, assigneeUserId: null,
    updatedAt: new Date("2026-09-08T10:00:00Z"), ...overrides,
  } as CompactIssue;
}

describe("WorkOverview", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let client: QueryClient;
  const onNewTask = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    listMock.mockReset().mockResolvedValue([]);
    onNewTask.mockReset();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
  async function render(companyId = "company-a", agents: Agent[] = [], agentsError?: Error) {
    await act(async () => root.render(
      <QueryClientProvider client={client}>
        <WorkOverview key={companyId} companyId={companyId} agents={agents} agentsError={agentsError}
          userProfiles={new Map([["user-1", { label: "Alex", image: null }]])} onNewTask={onNewTask} />
      </QueryClientProvider>,
    ));
    await flush();
  }
  async function selectTab(label: string) {
    const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((item) => item.textContent === label)!;
    await act(async () => { tab.focus(); });
    await flush();
  }

  it("requests open work on the server, displays missing ownership and opens the real task", async () => {
    listMock.mockResolvedValue([task("1")]);
    await render();
    expect(listMock).toHaveBeenCalledWith("company-a", expect.objectContaining({
      status: "backlog,todo,in_progress,in_review,blocked", limit: 8, offset: 0,
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.textContent).toContain("Verantwortung fehlt");
    expect(container.querySelector('a[href="/issues/TASK-1"]')).not.toBeNull();
  });

  it("recognizes a human assignee without falsely flagging an owner gap", async () => {
    listMock.mockResolvedValue([task("1", { assigneeUserId: "user-1" })]);
    await render();
    expect(container.textContent).toContain("Alex");
    expect(container.textContent).not.toContain("Verantwortung fehlt");
  });

  it("filters blocked and done work independently and labels completion as reported", async () => {
    listMock.mockImplementation((_company, filters) => Promise.resolve([
      task("1", { status: filters.status === "done" ? "done" : "blocked" }),
    ]));
    await render();
    await selectTab("Blockiert");
    expect(listMock).toHaveBeenLastCalledWith("company-a", expect.objectContaining({ status: "blocked" }), expect.anything());
    await selectTab("Erledigt");
    expect(listMock).toHaveBeenLastCalledWith("company-a", expect.objectContaining({ status: "done", sortField: "updated", sortDir: "desc" }), expect.anything());
    expect(container.textContent).toContain("Als erledigt gemeldet");
    expect(container.textContent).toContain("Ergebnis und Abnahme");
  });

  it("loads additional pages and suppresses duplicate rows when tasks move between pages", async () => {
    listMock.mockImplementation((_company, filters) => Promise.resolve(filters.offset === 0
      ? Array.from({ length: 8 }, (_, i) => task(String(i)))
      : [task("7"), task("8")]));
    await render();
    const more = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Weitere Aufgaben")!;
    await act(async () => more.click());
    await flush();
    expect(listMock).toHaveBeenLastCalledWith("company-a", expect.objectContaining({ offset: 8 }), expect.anything());
    expect(container.querySelectorAll('a[href="/issues/TASK-7"]')).toHaveLength(1);
    expect(container.querySelector('a[href="/issues/TASK-8"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Weitere Aufgaben");
  });

  it("does not show the previous company while a new company is loading", async () => {
    listMock.mockResolvedValueOnce([task("private-a")]);
    await render();
    listMock.mockImplementation(() => new Promise(() => {}));
    await render("company-b");
    expect(container.textContent).not.toContain("private-a");
    expect(container.textContent).toContain("Aufgaben werden geladen");
    expect(listMock).toHaveBeenLastCalledWith("company-b", expect.anything(), expect.anything());
  });

  it("shows failed reads as errors, never as an empty successful queue, and supports retry", async () => {
    listMock.mockRejectedValueOnce(new Error("Read failed"));
    await render();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Keine Aufgaben");
    listMock.mockResolvedValue([task("recovered")]);
    const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Erneut laden")!;
    await act(async () => retry.click());
    await flush();
    expect(container.textContent).toContain("Task recovered");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("links failed agents, offers skills and opens the existing task dialog", async () => {
    await render("company-a", [{ id: "agent-1", name: "Worker", status: "error" } as Agent]);
    expect(container.querySelector('a[href="/agents/agent-1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/skills"]')).not.toBeNull();
    const create = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Neuer Auftrag")!;
    await act(async () => create.click());
    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it("does not present stale agent errors as current when the agent read fails", async () => {
    await render("company-a", [{ id: "agent-1", name: "Old worker", status: "error" } as Agent], new Error("Offline"));
    expect(container.textContent).toContain("Agentenstatus konnte nicht geladen");
    expect(container.querySelector('a[href="/agents/agent-1"]')).toBeNull();
  });
  it("bundles only the same routine, title, status and assignee while preserving every task link", async () => {
    const routine = { title: "Daily review", originKind: "routine_execution" as const, originId: "routine-1" };
    listMock.mockResolvedValue([task("1", routine), task("2", routine), task("3", { ...routine, status: "blocked" }), task("4", { ...routine, assigneeAgentId: "other" })]);
    await render();
    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(container.querySelector("summary")?.textContent).toContain("2 geladene Vorgänge");
    for (const id of ["1", "2", "3", "4"]) expect(container.querySelector(`a[href="/issues/TASK-${id}"]`)).not.toBeNull();
    const toggle = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Routinen bündeln: Ein")!;
    await act(async () => toggle.click());
    expect(container.querySelectorAll("details")).toHaveLength(0);
    expect(container.querySelectorAll('a[href^="/issues/TASK-"]')).toHaveLength(4);
  });

  it("requests routine executions and does not bundle unrelated identical titles", async () => {
    listMock.mockResolvedValue([task("1", { title: "Same title" }), task("2", { title: "Same title" })]);
    await render();
    expect(listMock).toHaveBeenCalledWith("company-a", expect.objectContaining({ includeRoutineExecutions: true }), expect.anything());
    expect(container.querySelectorAll("details")).toHaveLength(0);
  });

});
