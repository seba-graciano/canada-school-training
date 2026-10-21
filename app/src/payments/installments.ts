export type Installment = {
  id: number
  alumno_id: number
  concepto: string | null
  mes: number
  anio: number
  monto: number | null
  recargo: number | null
  descuento: number | null
  estado: string | null
  fecha_vencimiento: string | null
  pagos: { monto_abonado: number }[] | null
}

export const money = (value: number) => new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', minimumFractionDigits: 2,
}).format(value)

export function installmentTotal(item: Installment) {
  // Match cobrar_cuota exactly; dashboard late fees are a separate report.
  const parts = [item.monto, item.recargo, item.descuento]
  if (!parts.every(value => Number.isSafeInteger(value) && Number(value) >= 0)) return null
  const total = Number(item.monto) + Number(item.recargo) - Number(item.descuento)
  return Number.isSafeInteger(total) && total > 0 ? total : null
}

export function paymentState(item: Installment) {
  if (!['Pagada', 'Pendiente', 'Vencida'].includes(item.estado ?? '')) return 'invalid'
  const total = installmentTotal(item)
  const paid = (item.pagos ?? []).reduce((sum, payment) => sum + Number(payment.monto_abonado), 0)
  const settled = item.estado === 'Pagada' || (total !== null && paid >= total)
  if (settled) return 'paid'
  if (total === null || !Number.isSafeInteger(paid) || paid < 0) return 'invalid'
  if (paid > 0) return 'partial'
  return 'pending'
}

export function installmentLabel(item: Installment) {
  if (item.mes >= 1 && item.mes <= 12 && Number.isInteger(item.anio)) {
    const month = new Intl.DateTimeFormat('es-AR', { month: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(item.anio, item.mes - 1, 1)))
    return `${month[0].toUpperCase()}${month.slice(1)} ${item.anio}`
  }
  return item.concepto || `Cuota ${item.id}`
}
