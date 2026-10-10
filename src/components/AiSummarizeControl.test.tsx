/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  IssueAiButton,
  IssuePartitionAiButton,
  NextWeekAiButton,
  NextWeekPartitionAiButton,
  ProjectAiButton,
} from "./AiSummarizeControl";
import type { IssueItem, NextWeekRow, Project } from "../types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project = (): Project => ({ id: "p1", name: "设备管理", bullets: ["联调原文"], status: "in_progress" });
const issue = (): IssueItem => ({ id: "i1", title: "【设备】登录失败", text: "【设备】账号锁定策略过严" });
const plan = (): NextWeekRow => ({ id: "n1", projectName: "【形态学】下周", items: ["【形态学】补充监控"] });

describe("summarize buttons", () => {
  it("renders a project action without a page scope picker or a key field", () => {
    const html = renderToStaticMarkup(
      <ProjectAiButton project={project()} onApply={() => undefined} />,
    );
    expect(html).toContain("一键总结");
    expect(html).not.toContain("总结范围");
    expect(html).not.toContain("整页");
    expect(html).not.toContain("apiKey");
    expect(html).not.toContain("DEEPSEEK_API_KEY");
    expect(html).not.toContain("VITE_");
    expect(html).not.toContain("确认写入");
  });
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function ProjectHost({ onApply }: { onApply: (id: string, bullets: string[]) => void }) {
  const [value] = useState(project);
  return <ProjectAiButton project={value} onApply={onApply} />;
}

async function mountProject(onApply: (id: string, bullets: string[]) => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<ProjectHost onApply={onApply} />);
  });
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

function button() {
  return document.querySelector('button[aria-label="一键总结 设备管理"]') as HTMLButtonElement;
}

describe("project summarize confirm", () => {
  it("disables the button while the request is in flight", async () => {
    let release: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const applied: string[][] = [];
    await mountProject((_id, bullets) => applied.push(bullets));

    await act(async () => {
      button().click();
    });
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("正在总结…");
    await act(async () => {
      button().click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(
        new Response(
          JSON.stringify({
            scope: "project",
            materials: {
              projects: [{ id: "p1", name: "改名", bullets: ["压缩后"] }],
              issues: { empty: true, items: [] },
              nextWeek: [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    expect(document.body.textContent).toContain("确认写入");
    expect(applied).toEqual([]);
    expect(button().disabled).toBe(false);
  });

  it("undo leaves the original bullets and confirm writes only those bullets", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.scope).toBe("project");
      expect(body.projectId).toBe("p1");
      expect(body.materials.projects).toEqual([project()]);
      expect(body.materials.issues).toEqual({ empty: true, items: [] });
      expect(body.materials.nextWeek).toEqual([]);
      expect(body.apiKey).toBeUndefined();
      return new Response(
        JSON.stringify({
          scope: "project",
          materials: {
            projects: [{ id: "p1", name: "改名", bullets: ["压缩后"] }],
            issues: { empty: true, items: [] },
            nextWeek: [],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const applied: { id: string; bullets: string[] }[] = [];
    await mountProject((id, bullets) => applied.push({ id, bullets }));

    await act(async () => {
      button().click();
    });
    expect(document.body.textContent).toContain("联调原文");
    expect(document.body.textContent).toContain("压缩后");
    const undo = [...document.querySelectorAll("button")].find((node) => node.textContent === "撤销") as HTMLButtonElement;
    await act(async () => {
      undo.click();
    });
    expect(document.body.textContent).not.toContain("确认写入");
    expect(applied).toEqual([]);

    await act(async () => {
      button().click();
    });
    const confirm = [...document.querySelectorAll("button")].find((node) => node.textContent === "确认写入") as HTMLButtonElement;
    await act(async () => {
      confirm.click();
    });
    expect(applied).toEqual([{ id: "p1", bullets: ["压缩后"] }]);
  });

  it("keeps the original text when the key is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "未配置 DEEPSEEK_API_KEY。原文未改动。",
            code: "ai.not_configured",
            status: "ai.not_configured",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const applied: unknown[] = [];
    await mountProject((id, bullets) => applied.push({ id, bullets }));
    await act(async () => {
      button().click();
    });
    expect(document.body.textContent).toContain("DEEPSEEK_API_KEY");
    expect(document.body.textContent).toContain("原文未改动");
    expect(document.body.textContent).not.toContain("确认写入");
    expect(applied).toEqual([]);
    expect(button().textContent).toBe("一键总结");
    expect(button().disabled).toBe(false);
  });
});

describe("issue and next-week item buttons", () => {
  it("requests only that item", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        if (body.scope === "issueItem") {
          return new Response(
            JSON.stringify({
              scope: "issueItem",
              materials: {
                projects: [],
                issues: { empty: false, items: [{ id: "i1", title: "【设备】登录失败", text: "【设备】账号被锁定" }] },
                nextWeek: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            scope: "nextWeekItem",
            materials: {
              projects: [],
              issues: { empty: true, items: [] },
              nextWeek: [{ id: "n1", projectName: "【形态学】下周", items: ["【形态学】完成压测"] }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const issueApplies: string[] = [];
    const planApplies: string[][] = [];
    await act(async () => {
      root!.render(
        <>
          <IssueAiButton item={issue()} onApply={(_id, text) => issueApplies.push(text)} />
          <NextWeekAiButton item={plan()} onApply={(_id, items) => planApplies.push(items)} />
        </>,
      );
    });
    await act(async () => {
      (document.querySelector('button[aria-label="一键总结 【设备】账号锁定策略过严"]') as HTMLButtonElement).click();
    });
    expect(bodies[0]).toMatchObject({
      scope: "issueItem",
      itemId: "i1",
      materials: { projects: [], nextWeek: [] },
    });
    expect(document.body.textContent).toContain("【设备】账号被锁定");
    expect(issueApplies).toEqual([]);
    await act(async () => {
      (document.querySelector('button[aria-label="一键总结 【形态学】下周"]') as HTMLButtonElement).click();
    });
    expect(bodies[1]).toMatchObject({ scope: "nextWeekItem", itemId: "n1", materials: { projects: [] } });
    expect(planApplies).toEqual([]);
  });
});

describe("partition summarize buttons", () => {
  it("confirms partition bodies and undo writes nothing", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        bodies.push(body);
        expect(body.apiKey).toBeUndefined();
        expect(body.projectId).toBeUndefined();
        expect(body.itemId).toBeUndefined();
        if (body.scope === "issuePartition") {
          return new Response(
            JSON.stringify({
              scope: "issuePartition",
              materials: {
                projects: [{ id: "p-should-not-apply", name: "不该写", bullets: ["不该写"] }],
                issues: {
                  empty: false,
                  items: [{ id: "i1", title: "不该改标题", text: "【设备】账号被锁定" }],
                },
                nextWeek: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            scope: "nextWeekPartition",
            materials: {
              projects: [],
              issues: { empty: true, items: [] },
              nextWeek: [{ id: "n1", projectName: "不该改名", items: ["【形态学】完成压测"] }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const issueApplies: { id: string; text: string }[][] = [];
    const planApplies: { id: string; items: string[] }[][] = [];
    await act(async () => {
      root!.render(
        <>
          <IssuePartitionAiButton
            tag="设备"
            items={[issue()]}
            onApply={(updates) => issueApplies.push(updates)}
          />
          <NextWeekPartitionAiButton
            tag="形态学"
            items={[plan()]}
            onApply={(updates) => planApplies.push(updates)}
          />
        </>,
      );
    });
    await act(async () => {
      (document.querySelector('button[aria-label="一键总结问题分区 设备"]') as HTMLButtonElement).click();
    });
    expect(bodies[0]).toMatchObject({
      scope: "issuePartition",
      materials: { projects: [], nextWeek: [] },
    });
    expect(document.body.textContent).toContain("【设备】账号被锁定");
    const undo = [...document.querySelectorAll("button")].find((node) => node.textContent === "撤销") as HTMLButtonElement;
    await act(async () => {
      undo.click();
    });
    expect(issueApplies).toEqual([]);
    await act(async () => {
      (document.querySelector('button[aria-label="一键总结问题分区 设备"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      ([...document.querySelectorAll("button")].find((node) => node.textContent === "确认写入") as HTMLButtonElement).click();
    });
    expect(issueApplies).toEqual([[{ id: "i1", text: "【设备】账号被锁定" }]]);
    await act(async () => {
      (document.querySelector('button[aria-label="一键总结下周分区 形态学"]') as HTMLButtonElement).click();
    });
    expect(bodies[2]).toMatchObject({ scope: "nextWeekPartition", materials: { projects: [] } });
    expect(planApplies).toEqual([]);
    await act(async () => {
      ([...document.querySelectorAll("button")].find((node) => node.textContent === "确认写入") as HTMLButtonElement).click();
    });
    expect(planApplies).toEqual([[{ id: "n1", items: ["【形态学】完成压测"] }]]);
  });
});
