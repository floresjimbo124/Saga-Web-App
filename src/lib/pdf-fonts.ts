import robotoBold from '../assets/fonts/Roboto-Bold.ttf?inline'
import robotoRegular from '../assets/fonts/Roboto-Regular.ttf?inline'
import type { jsPDF } from 'jspdf'

function fontBase64(dataUrl: string) {
  const separator = dataUrl.indexOf(',')
  if (separator < 0) throw new Error('Could not load the embedded Roboto font.')
  return dataUrl.slice(separator + 1)
}

export function registerRobotoFonts(pdf: jsPDF) {
  pdf.addFileToVFS('Roboto-Regular.ttf', fontBase64(robotoRegular))
  pdf.addFont('Roboto-Regular.ttf', 'Roboto', 'normal')
  pdf.addFileToVFS('Roboto-Bold.ttf', fontBase64(robotoBold))
  pdf.addFont('Roboto-Bold.ttf', 'Roboto', 'bold')
}