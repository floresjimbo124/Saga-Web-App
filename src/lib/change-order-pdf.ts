import sagactLogo from '../assets/sagact-logo.png?inline'
import type { ProjectChangeOrderItem } from '../data/portfolio'

export type ChangeOrderPdfDetails = {
  projectName: string
  clientName: string
  location: string
  changeOrderNumber: string
  title: string
  description: string
  amount: number
  items: ProjectChangeOrderItem[]
  contractTimeAdjustmentDays: number
  issuedAt: string
}

const amountFormat = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const money = (amount: number) => amountFormat.format(amount)
const dateFormat = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

function formatDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date)
}

function timeAdjustmentText(days: number) {
  if (days === 0) return 'No adjustment'
  return `${Math.abs(days)} calendar day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'added' : 'deducted'}`
}

export async function createChangeOrderPdf(details: ChangeOrderPdfDetails) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ format: 'a4', unit: 'mm' })
  const { registerRobotoFonts } = await import('./pdf-fonts')
  registerRobotoFonts(pdf)
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 20
  const widths = [35, 43, 62, pageWidth - margin * 2 - 140]
  const x = [margin, margin + widths[0], margin + widths[0] + widths[1], margin + widths[0] + widths[1] + widths[2]]
  const headers = ['Item', 'Description', 'Remarks', 'Cost']
  const rowLineHeight = 4.5
  let cursorY = 0

  const drawColumnHeader = (top: number) => {
    pdf.setFillColor(65, 65, 65)
    pdf.rect(margin, top, pageWidth - margin * 2, 9, 'F')
    pdf.setTextColor(255, 255, 255)
    pdf.setFont('Roboto', 'bold')
    pdf.setFontSize(9)
    headers.forEach((header, index) => {
      const center = x[index] + widths[index] / 2
      pdf.text(header, center, top + 6, { align: 'center' })
    })
    cursorY = top + 9
  }

  const drawPageHeading = (continued: boolean) => {
    pdf.setFillColor(237, 234, 233)
    pdf.rect(0, 0, pageWidth, 32, 'F')
    pdf.addImage(sagactLogo, 'PNG', margin - 8.24, -3.72, 40, 40)
    pdf.setTextColor(36, 43, 39)
    pdf.setFont('Roboto', 'bold')
    pdf.setFontSize(15)
    pdf.text('CHANGE ORDER', pageWidth / 2, 48, { align: 'center' })
    pdf.setFontSize(10)
    pdf.setTextColor(32, 67, 54)
    if (continued) {
      pdf.text(`CHANGE ORDER #${details.changeOrderNumber}`, margin, 61)
      pdf.setTextColor(82, 91, 85)
      pdf.setFontSize(9)
      pdf.text('CONTINUED', pageWidth - margin, 61, { align: 'right' })
      pdf.setDrawColor(218, 224, 220)
      pdf.line(margin, 69, pageWidth - margin, 69)
      drawColumnHeader(76)
      return
    }

    pdf.setFont('Roboto', 'normal')
    pdf.text(`CHANGE ORDER #${details.changeOrderNumber}`, margin, 61)
    pdf.setTextColor(70, 78, 74)
    pdf.text(`Issued: ${formatDate(details.issuedAt)}`, margin, 69)
    pdf.setDrawColor(218, 224, 220)
    pdf.line(margin, 78, pageWidth - margin, 78)
    pdf.setTextColor(107, 117, 110)
    pdf.setFont('Roboto', 'bold')
    pdf.setFontSize(9)
    pdf.text('CLIENT', margin, 89)
    pdf.text('PROJECT', pageWidth / 2, 89)
    pdf.setTextColor(36, 43, 39)
    pdf.setFont('Roboto', 'normal')
    pdf.setFontSize(11)
    pdf.text(pdf.splitTextToSize(details.clientName, 72), margin, 97)
    pdf.text(pdf.splitTextToSize(details.projectName, 72), pageWidth / 2, 97)
    pdf.setFontSize(9)
    pdf.setTextColor(90, 99, 93)
    pdf.text(pdf.splitTextToSize(details.location, 72), pageWidth / 2, 104)
    pdf.setDrawColor(218, 224, 220)
    pdf.line(margin, 112, pageWidth - margin, 112)
    drawColumnHeader(120)
  }

  drawPageHeading(false)

  for (const item of details.items) {
    pdf.setFont('Roboto', 'normal')
    pdf.setFontSize(9)
    const cellLines = [
      pdf.splitTextToSize(item.item, widths[0] - 4),
      pdf.splitTextToSize(item.description || '—', widths[1] - 4),
      pdf.splitTextToSize(item.remarks || '—', widths[2] - 4),
      [money(item.cost)],
    ]
    const maxLines = Math.max(...cellLines.map((lines) => lines.length))
    let lineOffset = 0
    while (lineOffset < maxLines) {
      if (cursorY > 244) {
        pdf.addPage()
        drawPageHeading(true)
      }
      const linesThatFit = Math.max(1, Math.floor((244 - cursorY - 3) / rowLineHeight))
      const linesInChunk = Math.min(linesThatFit, maxLines - lineOffset)
      const rowHeight = Math.max(9, linesInChunk * rowLineHeight + 4)
      const rowTop = cursorY
      const rowBottom = rowTop + rowHeight
      pdf.setDrawColor(190, 190, 190)
      pdf.setLineWidth(0.25)
      x.forEach((left, index) => pdf.rect(left, rowTop, widths[index], rowHeight))
      cellLines.slice(0, 3).forEach((lines, index) => {
        const chunk = lines.slice(lineOffset, lineOffset + linesInChunk)
        if (lineOffset > 0 && index === 0 && chunk.length) chunk[0] = `… ${chunk[0]}`
        if (chunk.length) {
          pdf.setTextColor(36, 43, 39)
          pdf.setFont('Roboto', 'normal')
          pdf.setFontSize(9)
          pdf.text(chunk, x[index] + 2, rowTop + 5)
        }
      })
      if (lineOffset === 0) {
        pdf.setTextColor(36, 43, 39)
        pdf.setFont('Roboto', 'normal')
        pdf.setFontSize(9)
        pdf.text(cellLines[3][0], x[3] + widths[3] - 2, rowTop + 5, { align: 'right' })
      }
      cursorY = rowBottom
      lineOffset += linesInChunk
    }
  }

  if (cursorY + 18 > 244) {
    pdf.addPage()
    drawPageHeading(true)
  }
  const totalRowHeight = 8
  pdf.setDrawColor(65, 65, 65)
  pdf.setLineWidth(0.6)
  pdf.line(margin, cursorY, pageWidth - margin, cursorY)
  pdf.setFont('Roboto', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(36, 43, 39)
  pdf.text('Total:', x[2] + 2, cursorY + 5.5)
  pdf.text(money(details.amount), x[3] + widths[3] - 2, cursorY + 5.5, { align: 'right' })
  cursorY += totalRowHeight
  pdf.setDrawColor(190, 190, 190)
  pdf.setLineWidth(0.25)
  pdf.rect(margin, cursorY, pageWidth - margin * 2, 10)
  pdf.setFont('Roboto', 'bold')
  pdf.setFontSize(9)
  pdf.text('CONTRACT TIME ADJUSTMENT', margin + 2, cursorY + 6.5)
  pdf.setFont('Roboto', 'normal')
  pdf.text(timeAdjustmentText(details.contractTimeAdjustmentDays), margin + 72, cursorY + 6.5)

  const signatureY = pageHeight - 25
  pdf.setDrawColor(140, 148, 142)
  pdf.line(margin + 5, signatureY, margin + 68, signatureY)
  pdf.line(pageWidth - margin - 68, signatureY, pageWidth - margin - 5, signatureY)
  pdf.setTextColor(107, 117, 110)
  pdf.setFont('Roboto', 'normal')
  pdf.setFontSize(8)
  pdf.text('Authorized representative', margin + 36.5, signatureY + 5, { align: 'center' })
  pdf.text('Client signature', pageWidth - margin - 36.5, signatureY + 5, { align: 'center' })
  pdf.text('Generated by SAGACT project workspace', margin, pageHeight - 5)

  return pdf
}
