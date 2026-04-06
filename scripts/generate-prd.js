const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat,
} = require("docx");

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cm = { top: 60, bottom: 60, left: 100, right: 100 };
const hdrShade = { fill: "2B5797", type: ShadingType.CLEAR };
const altShade = { fill: "F2F7FB", type: ShadingType.CLEAR };

function hCell(t, w) {
  return new TableCell({ borders, width: { size: w, type: WidthType.DXA }, shading: hdrShade, margins: cm,
    children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: "FFFFFF", font: "Microsoft JhengHei", size: 20 })] })] });
}
function dCell(t, w, ri) {
  return new TableCell({ borders, width: { size: w, type: WidthType.DXA }, shading: ri % 2 === 1 ? altShade : undefined, margins: cm,
    children: [new Paragraph({ children: [new TextRun({ text: t, font: "Microsoft JhengHei", size: 20 })] })] });
}
function tbl(headers, rows, cw) {
  return new Table({ width: { size: cw.reduce((a,b) => a+b, 0), type: WidthType.DXA }, columnWidths: cw,
    rows: [
      new TableRow({ children: headers.map((h, i) => hCell(h, cw[i])) }),
      ...rows.map((r, ri) => new TableRow({ children: r.map((c, ci) => dCell(c, cw[ci], ri)) })),
    ] });
}

const F = "Microsoft JhengHei";
function h1(t) { return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 200 }, children: [new TextRun({ text: t, font: F, size: 32, bold: true, color: "2B5797" })] }); }
function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 160 }, children: [new TextRun({ text: t, font: F, size: 26, bold: true, color: "2B5797" })] }); }
function p(t, o={}) { return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, font: F, size: 20, ...o })] }); }
function code(t) { return new Paragraph({ spacing: { after: 80 }, indent: { left: 400 }, children: [new TextRun({ text: t, font: "Consolas", size: 18, color: "333333" })] }); }
function bl(t) { return new Paragraph({ numbering: { reference: "b", level: 0 }, children: [new TextRun({ text: t, font: F, size: 20 })] }); }
function pb() { return new Paragraph({ children: [new PageBreak()] }); }

const doc = new Document({
  numbering: { config: [{ reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
  styles: {
    default: { document: { run: { font: F, size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, font: F, color: "2B5797" }, paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, font: F, color: "2B5797" }, paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1200, bottom: 1440, left: 1200 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Hi5 對帳結算系統 — 計算規則 PRD v2", font: F, size: 16, color: "999999" })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "第 ", font: F, size: 16, color: "999999" }), new TextRun({ children: [PageNumber.CURRENT], font: F, size: 16, color: "999999" }), new TextRun({ text: " 頁", font: F, size: 16, color: "999999" })] })] }) },
    children: [
      // Title
      new Paragraph({ spacing: { before: 3000 } }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: "Hi5 對帳結算系統", font: F, size: 48, bold: true, color: "2B5797" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: "計算規則 PRD v2", font: F, size: 36, color: "2B5797" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: "基於系統實作的完整計算規則定義", font: F, size: 22, color: "666666" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: "版本 v2.0 | 2026-04-06 | 適用：PM、工程、財務、測試", font: F, size: 20, color: "999999" })] }),
      pb(),

      // 1. 文件目的
      h1("1. 文件目的"),
      p("本文件基於 Hi5 對帳結算系統的實際程式碼審計結果，定義所有計算規則、公式、進位方式與邊界處理邏輯，作為 PM、工程、財務與 QA 的共同依據。"),

      // 2. 系統架構
      h1("2. 系統架構概覽"),
      h2("2.1 資料層級（四層架構）"),
      tbl(["層級", "模型", "說明"], [
        ["L1", "orders", "主訂單（消費者整筆交易）"],
        ["L2", "order_items", "主訂單商品明細（價格、優惠、嗨幣）"],
        ["L3", "sub_orders", "子單（per 商家，結算與履約單位）"],
        ["L4", "sub_order_items", "子單商品明細（嗨幣分攤、退款分攤）"],
      ], [1500, 2500, 5840]),

      h2("2.2 錢包架構（四 Bucket）"),
      tbl(["Bucket", "說明"], [
        ["PENDING", "待結算（鑑賞期中）"],
        ["AVAILABLE", "可提領（已結算）"],
        ["RESERVED", "保留金（爭議凍結、風險準備）"],
        ["IN_TRANSIT", "提領中（銀行處理中）"],
      ], [2500, 7340]),

      h2("2.3 帳務原則"),
      bl("Append-only Ledger：所有帳務異動只增不改不刪"),
      bl("餘額由 Ledger 彙總推導，不可直接修改 balance"),
      bl("所有金額使用 Decimal(18,4) 儲存"),
      pb(),

      // 3. 計算順序
      h1("3. 計算順序（10 步驟）"),
      p("系統依以下固定順序計算，不得任意調換："),
      tbl(["步驟", "動作", "進位方式"], [
        ["1", "取得商品原價", "—"],
        ["2", "比較會員價/活動價，取較低者", "moneyRound (4位小數)"],
        ["3", "套用平台券/商家券（按比例分攤）", "floor（尾差歸最後一件）"],
        ["4", "計算嗨幣上限（券折後 × 50%）", "moneyRound"],
        ["5", "套用嗨幣（按比例分攤至各商品）", "floor（尾差歸金額最高商品）"],
        ["6", "加上運費", "—"],
        ["7", "金流費（商品全額+運費 × 費率）", "ceil（無條件進位到整數）"],
        ["8", "商店抽成+分類抽成（結算基礎×費率）", "ceil（無條件進位到整數）"],
        ["9", "發票費（每子單固定 2 元，不可退）", "—"],
        ["10", "商家應得（最低保護 0）", "moneyRound"],
      ], [800, 5540, 3500]),
      pb(),

      // 4. 公式
      h1("4. 各步驟詳細公式"),
      h2("4.1 最終成交價"),
      code("最終成交價 = MIN(原價, 會員價, 活動價)"),

      h2("4.2 優惠券分攤"),
      p("平台券：影響消費者支付 ✓ | 影響嗨幣上限 ✓ | 不影響抽成基礎 ✗", { bold: true }),
      p("商家券：影響消費者支付 ✓ | 影響嗨幣上限 ✓ | 影響抽成基礎 ✓", { bold: true }),
      code("非最後一件: share = floor(券金額 × 商品金額 / 商品總額)"),
      code("最後一件: share = 剩餘金額（承擔尾差）"),

      h2("4.3 結算基礎"),
      code("結算基礎 = 最終成交價 × 數量 - 商家券分攤金額"),
      p("注意：平台券不下修結算基礎。", { bold: true, color: "CC0000" }),

      h2("4.4 嗨幣規則"),
      bl("1 嗨幣 = 1 元折抵，由平台吸收"),
      bl("不可折抵運費、不影響金流費基礎、不影響抽成基礎"),
      code("嗨幣上限 = (最終成交價 - 平台券 - 商家券) × 50%"),
      code("分攤: 非最高商品 floor，最高商品承擔尾差"),

      h2("4.5 運費"),
      tbl(["模式", "消費者", "商家", "金流費", "抽成"], [
        ["運費外加", "付運費", "收到（全額歸商家）", "參與", "不參與"],
        ["免運", "不付", "運費=0（商店吸收）", "不參與", "不參與"],
      ], [1800, 2000, 2640, 1500, 1900]),

      h2("4.6 金流費"),
      code("金流費 = ceil((商品全額 + 運費) × 金流費率)"),
      p("重要：嗨幣折抵不影響金流費基礎。", { bold: true, color: "CC0000" }),

      h2("4.7 抽成"),
      code("商店抽成 = ceil(結算基礎 × 商店抽成率)"),
      code("分類抽成 = ceil(結算基礎 × 分類抽成率)"),
      bl("兩種抽成可疊加，使用 ceil 確保平台不少收"),

      h2("4.8 發票費"),
      bl("每子單固定 2 元，付款成功即收取，任何情況下不退"),

      h2("4.9 商家應得"),
      code("商家應得 = 結算基礎 - 商店抽成 - 分類抽成 - 金流費 - 發票費 + 運費"),
      p("最低保護：若 < 0，商家應得 = 0，差額為平台吸收。", { bold: true, color: "CC0000" }),
      pb(),

      // 5. 退款
      h1("5. 退款規則"),
      h2("5.1 全額退款"),
      bl("商家扣回全額 merchantReceivableAmount"),
      bl("消費者：台幣原路退回 + 嗨幣退回帳戶"),
      bl("發票費不退"),

      h2("5.2 協商退款 / 平台裁決退款"),
      code("退款比例 = 退款金額 / 子單商品成交總額"),
      code("商家扣回 = round(商家應得 × 退款比例)"),
      code("嗨幣退回 = round(子單嗨幣 × 退款比例)"),
      code("台幣退回 = 退款金額 - 嗨幣退回"),

      h2("5.3 部分退貨"),
      code("商品比例 = 該商品成交價 / 子單商品成交總額"),
      code("商家扣回 = round(商家應得 × 商品比例)"),
      pb(),

      // 6. 進位規則
      h1("6. 進位規則總表"),
      tbl(["計算項目", "方法", "結果", "原因"], [
        ["最終成交價", "moneyRound", "4位小數", "精確計算"],
        ["券分攤（非最後）", "floor", "整數", "尾差歸最後一件"],
        ["嗨幣分攤（非最高）", "floor", "整數", "尾差歸金額最高"],
        ["商店抽成", "ceil", "整數", "平台不少收"],
        ["分類抽成", "ceil", "整數", "平台不少收"],
        ["金流費", "ceil", "整數", "不少收"],
        ["發票費", "固定", "2元", "固定費用"],
        ["商家應得", "moneyRound", "4位小數", "精確計算"],
      ], [2400, 1800, 2000, 3640]),
      pb(),

      // 7. 尾差
      h1("7. 尾差規則"),
      p("範例：嗨幣 200，商品 1400 + 450 = 1850", { bold: true }),
      code("保護殼: floor(200 × 450/1850) = 48"),
      code("耳機: 200 - 48 = 152（承擔尾差）"),
      pb(),

      // 8. 驗算
      h1("8. 驗算範例"),
      h2("範例 1：基礎案例"),
      p("藍芽耳機 原價1500 → 會員價1400，嗨幣200，運費80，商店抽成3%，分類抽成2%，金流費2%"),
      code("結算基礎 = 1400"),
      code("商店抽成 = ceil(1400 × 3%) = 42"),
      code("分類抽成 = ceil(1400 × 2%) = 28"),
      code("金流費 = ceil((1400+80) × 2%) = ceil(29.6) = 30"),
      code("商家應得 = 1400 - 42 - 28 - 30 - 2 + 80 = 1378"),

      h2("範例 2：多商品 + 免運"),
      code("商品: 耳機1400 + 保護殼450 = 1850"),
      code("嗨幣: 200 → 耳機152 + 保護殼48（尾差歸耳機）"),
      code("商家應得 = 1850 - 56 - 37 - 37 - 2 + 0 = 1718"),

      h2("範例 3：商家券影響"),
      code("商品 1400，商家券 -100 → 結算基礎 = 1300"),
      code("商店抽成 = ceil(1300 × 3%) = 39（基於1300）"),

      h2("範例 4：平台券不影響抽成"),
      code("商品 1400，平台券 -100 → 結算基礎 = 1400（不下修）"),
      code("商店抽成 = ceil(1400 × 3%) = 42（基於1400）"),
      pb(),

      // 9. 版本
      h1("9. 版本紀錄"),
      tbl(["日期", "版本", "變更"], [
        ["2026-04-06", "v2.0", "基於系統審計產出完整計算規則 PRD"],
      ], [2000, 1500, 6340]),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  const outputPath = "PRD_計算規則_v2.docx";
  fs.writeFileSync(outputPath, buffer);
  console.log("PRD document created: " + outputPath);
  console.log("File size: " + (buffer.length / 1024).toFixed(1) + " KB");
});
