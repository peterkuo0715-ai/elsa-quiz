import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { auth } from "@/lib/auth";
import { moneyFormat } from "@/lib/money";
import ExcelJS from "exceljs";

/**
 * GET /api/export/statement/[id]?format=xlsx
 * Export monthly statement as XLSX.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const format = request.nextUrl.searchParams.get("format") || "xlsx";

  const statement = await prisma.monthlyStatement.findUnique({
    where: { id },
    include: {
      merchant: { select: { name: true, taxId: true } },
      items: { orderBy: { date: "asc" } },
    },
  });

  if (!statement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Check merchant access
  if (
    session.user.merchantId &&
    statement.merchantId !== session.user.merchantId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("月度對帳單");

    // Header
    sheet.mergeCells("A1:H1");
    const titleCell = sheet.getCell("A1");
    titleCell.value = `${statement.merchant.name} - ${statement.year}年${statement.month}月 對帳單`;
    titleCell.font = { size: 16, bold: true };

    sheet.mergeCells("A2:H2");
    sheet.getCell("A2").value = `統編: ${statement.merchant.taxId || "-"}`;

    // Summary
    sheet.getCell("A4").value = "期初餘額";
    sheet.getCell("B4").value = moneyFormat(statement.openingBalanceTaxIncl.toString());
    sheet.getCell("C4").value = "期末餘額";
    sheet.getCell("D4").value = moneyFormat(statement.closingBalanceTaxIncl.toString());

    sheet.getCell("A5").value = "本月收入";
    sheet.getCell("B5").value = moneyFormat(statement.totalIncomeTaxIncl.toString());
    sheet.getCell("C5").value = "本月扣款";
    sheet.getCell("D5").value = moneyFormat(statement.totalDeductionsTaxIncl.toString());
    sheet.getCell("E5").value = "本月提領";
    sheet.getCell("F5").value = moneyFormat(statement.totalPayoutsTaxIncl.toString());

    // Detail header
    const headerRow = 7;
    const headers = [
      "日期",
      "說明",
      "類型",
      "含稅金額",
      "未稅金額",
      "稅額",
      "餘額（含稅）",
    ];
    headers.forEach((h, i) => {
      const cell = sheet.getCell(headerRow, i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };
    });

    // Detail rows
    statement.items.forEach((item, index) => {
      const row = headerRow + 1 + index;
      sheet.getCell(row, 1).value = new Date(item.date).toLocaleDateString("zh-TW");
      sheet.getCell(row, 2).value = item.description;
      sheet.getCell(row, 3).value = item.entryType;
      sheet.getCell(row, 4).value = Number(item.amountTaxIncl.toString());
      sheet.getCell(row, 5).value = Number(item.amountTaxExcl.toString());
      sheet.getCell(row, 6).value = Number(item.taxAmount.toString());
      sheet.getCell(row, 7).value = Number(item.balanceAfterTaxIncl.toString());

      // Format number cells
      for (let col = 4; col <= 7; col++) {
        sheet.getCell(row, col).numFmt = "#,##0";
      }
    });

    // Auto column widths
    sheet.columns.forEach((col) => {
      col.width = 18;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `statement_${statement.year}_${String(statement.month).padStart(2, "0")}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
}
