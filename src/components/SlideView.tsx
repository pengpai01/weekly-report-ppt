import type { PartPayload, ProjectPayload, Slide } from "../types";

function as<T>(payload: Slide["payload"]): T {
  return payload as T;
}

export function slideTitle(slide: Slide, index: number): string {
  switch (slide.type) {
    case "cover":
      return "封面";
    case "toc":
      return "目录";
    case "part":
      return `章节 ${as<PartPayload>(slide.payload).partNo}`;
    case "project": {
      const project = as<ProjectPayload>(slide.payload);
      return `${project.ordinal}、${project.name}${project.continued ? "（续）" : ""}`;
    }
    case "issues":
      return "问题与建议";
    case "plan":
      return "下周计划";
    case "closing":
      return "结束页";
    default:
      return `第 ${index + 1} 页`;
  }
}
