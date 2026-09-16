import type { Report } from "../types";
import { createId } from "./format";

export const SAMPLE_REPORT_SEED: Omit<
  Report,
  "id" | "createdAt" | "updatedAt" | "slides" | "status"
> = {
  templateType: "weekly",
  title: "周工作总结",
  department: "软件研发",
  date: "2026-09-11",
  author: "",
  projects: [
    {
      id: "sample-p1",
      name: "智能设备管理系统",
      status: "launched",
      bullets: [
        "代理商库存系统：功能讲解与演示、试用以及问题讨论。",
        "功能优化：新 UDI 码集成测试，小程序增加退出登录、允许其他手机号登录，基础数据补充更多字段等。",
        "压力测试与性能调优：调优后系统 100 并发下性能良好，预计可支持当前代理商正常使用。",
        "生产部署和调试。",
      ],
    },
    {
      id: "sample-p2",
      name: "形态学鉴定APP",
      status: "in_progress",
      bullets: [
        "APP-II：线上程序监控和问题支持；目前注册用户 2170、有 400+ 人使用过鉴定功能，鉴定图片总数 1600+。",
        "APP 大用户量并发改造：新版 APP 已上架 TestFlight，研发内部集成测试。",
        "部署架构优化、域名配置；功能优化与问题修复，包括收藏、微信绑定、交流区域优化、会员管理定向发菌币等。",
      ],
    },
    {
      id: "sample-p3",
      name: "数据回传",
      status: "support",
      bullets: [
        "科瑞迪唐山市人民医院支持；客服计划下周北京再安装两家。",
        "分子一体机数据回传功能开发：协议制定、上位机软件改造、后台服务开发等。",
      ],
    },
    {
      id: "sample-p4",
      name: "分子一体机",
      status: "in_progress",
      bullets: [
        "现有功能优化和问题修复：用户权限调整（普通用户可查询项目列表、标曲列表、仪器控制、版本信息；管理员可查看日志、MCU 升级、算法版本）。",
        "软件版本调整；溶解曲线截图问题；项目列表、标曲列表功能调整等。",
        "新增需求功能讨论与工作整理、排期。",
      ],
    },
    {
      id: "sample-p5",
      name: "AI阅片机",
      status: "in_progress",
      bullets: [
        "数据集整理与标注：两周标注 900+，目前还剩余 1300+。",
        "已完成 G+ 单球、双球、短链、四联、八叠标注。",
        "模型开发与训练。",
      ],
    },
    {
      id: "sample-p6",
      name: "信息系统",
      status: "support",
      bullets: [
        "DMS 系统：系统合规验证开展，验收报告。",
        "ERP 系统：新版 UDI 码上线。",
        "日常维护和问题解决，包括 ERP / OA / CRM / 邮箱等；Zabbix 监控 23 台服务器运行状态；群晖 NAS 云盘备份。",
        "新建园区弱电增项规划；高频审批流程梳理修改，已完成销售合同审批和研发采购申请流程。",
      ],
    },
    {
      id: "sample-p7",
      name: "其他",
      bullets: [
        "药敏分析仪：注册资料编写与支持；权限功能完善，仪器信息界面调整。",
        "AI 系统平台：多模态 demo 功能完善，如流式输出、思维链、会话持久化和上下文记忆。",
      ],
    },
  ],
  issues: { empty: true, items: [] },
  nextWeek: [
    {
      id: "sample-n1",
      projectName: "智慧仪器管理系统",
      items: ["推广相关的支持", "检测数据管理"],
    },
    {
      id: "sample-n2",
      projectName: "形态学鉴定APP",
      items: ["集成测试与问题修复", "内测"],
    },
    {
      id: "sample-n3",
      projectName: "AI阅片上位机软件",
      items: ["革兰模型清洗标注", "蓝澈相关改造支持"],
    },
    {
      id: "sample-n4",
      projectName: "分子一体机",
      items: ["数传相关的集成测试", "标曲相关功能开发"],
    },
    {
      id: "sample-n5",
      projectName: "数据回传",
      items: ["市场推广安装支持，包括科瑞迪、科来思、G5 等"],
    },
    {
      id: "sample-n6",
      projectName: "科来思",
      items: ["测试用例梳理", "测试相关支持"],
    },
    {
      id: "sample-n7",
      projectName: "AI相关",
      items: ["AI 平台以及相关模型预研"],
    },
    {
      id: "sample-n8",
      projectName: "其他",
      items: ["凯实相关支持"],
    },
  ],
};

export const SAMPLE_SPLIT_TEXT = `一、智能设备管理系统
代理商库存系统：
①功能讲解&演示，试用以及问题讨论；
②功能优化，包括新UDI码集成测试，小程序增加退出登录，允许其他手机号登录，基础数据补充更多字段等；
③压力测试&性能调优，调优后系统100并发下性能良好；
④生产部署和调试；

二、形态学鉴定APP
工作：
APP-II：①线上程序监控和问题支持；②目前注册用户2170、有400+人使用过鉴定功能。
APP大用户量并发改造：①新版APP已上架Testflight；②部署架构优化；③功能优化&问题修复。

三、数据回传
①科瑞迪唐山市人民医院支持，客服计划下周北京再安装两家。
②分子一体机数据回传功能开发, 包括：协议制定，上位机软件改造，后台服务开发等。`;

export function cloneSampleProjects() {
  return SAMPLE_REPORT_SEED.projects.map((p) => ({
    ...p,
    id: createId(),
    bullets: [...p.bullets],
  }));
}

export function cloneSampleNextWeek() {
  return SAMPLE_REPORT_SEED.nextWeek.map((row) => ({
    ...row,
    id: createId(),
    items: [...row.items],
  }));
}
