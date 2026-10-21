import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import DesignIcon from '../ui/DesignIcon'
import { installmentLabel, installmentTotal, money, paymentState } from './installments'
import type { Installment } from './installments'

export type Student = {
  id: number; nombre: string; apellido: string; dni: string; nivel: string; curso: string
  hermanos: number; descuento_hermano: number; arancel_base: number; cuotas_saldadas: number
  mora: number; deuda: number; tutor_email?: string
}

type Props = {
  student: Student; canCollect: boolean; onBack: () => void
  onRefresh: () => void; onBusy: (busy: boolean) => void
}

function remainingAmount(item: Installment) {
  const total = installmentTotal(item)
  if (total === null) return null
  const paid = (item.pagos ?? []).reduce((sum, payment) => sum + Number(payment.monto_abonado), 0)
  const remaining = total - paid
  return Number.isSafeInteger(remaining) && remaining > 0 ? remaining : null
}

export default function PaymentScreen({ student, canCollect, onBack, onRefresh, onBusy }: Props) {
  const [items, setItems] = useState<Installment[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [reviewed, setReviewed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const mounted = useRef(false)
  const submitting = useRef(false)
  const request = useRef(0)

  const readItems = useCallback(async () => {
    const { data, error } = await supabase.from('cuotas')
      .select('id,alumno_id,concepto,mes,anio,monto,recargo,descuento,estado,fecha_vencimiento,pagos(monto_abonado)')
      .eq('alumno_id', student.id).order('anio').order('mes').order('id')
    if (error) throw error
    return (data ?? []) as Installment[]
  }, [student.id])

  async function load() {
    const current = ++request.current
    setLoading(true)
    setLoadFailed(false)
    setError('')
    try {
      const rows = await readItems()
      if (!mounted.current || current !== request.current) return
      setItems(rows)
      setSelected([])
      setReviewed(false)
    } catch {
      if (mounted.current && current === request.current) {
        setLoadFailed(true)
        setError('No se pudieron consultar las cuotas. Reintentá antes de cobrar.')
      }
    } finally {
      if (mounted.current && current === request.current) setLoading(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    const current = ++request.current
    // Initial loading is already true. Commit state only after the async read.
    void readItems().then(rows => {
      if (mounted.current && current === request.current) setItems(rows)
    }).catch(() => {
      if (mounted.current && current === request.current) {
        setLoadFailed(true)
        setError('No se pudieron consultar las cuotas. Reintentá antes de cobrar.')
      }
    }).finally(() => {
      if (mounted.current && current === request.current) setLoading(false)
    })
    const channel = supabase.channel(`student-payments-${student.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos' }, () => { void load() })
      .subscribe()
    return () => {
      mounted.current = false
      request.current += 1
      void supabase.removeChannel(channel)
    }
  }, [readItems])

  const chosen = items.filter(item => selected.includes(item.id) && paymentState(item) === 'pending')
  const total = chosen.reduce((sum, item) => sum + (remainingAmount(item) ?? 0), 0)
  const principal = chosen.reduce((sum, item) => sum + Number(item.monto) - Number(item.descuento), 0)
  const surcharge = chosen.reduce((sum, item) => sum + Number(item.recargo), 0)
  const pending = items.filter(item => paymentState(item) === 'pending')

  function toggle(id: number) {
    if (submitting.current) return
    setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])
    setReviewed(false)
    setMessage('')
    setError('')
  }

  async function confirm() {
    if (!canCollect || submitting.current || !reviewed || !chosen.length || loadFailed) return
    submitting.current = true
    setSaving(true)
    onBusy(true)
    setError('')
    setMessage('')
    let completed = 0
    let actualAmount = 0
    let failure = ''
    let selectionWasRefreshed = false
    try {
      const currentItems = await readItems()
      if (!mounted.current) return
      const unchanged = chosen.every(item => {
        const current = currentItems.find(value => value.id === item.id)
        return current && paymentState(current) === 'pending' && remainingAmount(current) === remainingAmount(item)
      })
      if (!unchanged) {
        setItems(currentItems)
        setSelected([])
        setReviewed(false)
        setError('Las cuotas cambiaron desde la selección. Revisá los importes y seleccioná nuevamente.')
        selectionWasRefreshed = true
        return
      }
      // Each existing RPC is its own transaction. Stop on the first failure;
      // completed installments remain paid and are never silently retried.
      for (const item of chosen) {
        if (!mounted.current) break
        const expectedAmount = remainingAmount(item)
        if (expectedAmount === null) {
          failure = `${installmentLabel(item)} tiene un saldo inválido. Revisá su estado antes de reintentar.`
          break
        }
        const { data, error } = await supabase.rpc('cobrar_cuota_confirmada', {
          p_cuota_id: item.id, p_monto_esperado: expectedAmount,
        })
        if (error || !data?.success) {
          failure = data?.code === 'ALREADY_PAID'
            ? `${installmentLabel(item)} ya fue cobrada. Se actualizó el listado.`
            : data?.code === 'AMOUNT_CHANGED'
              ? `El importe de ${installmentLabel(item)} cambió desde la revisión. Revisá el listado antes de volver a confirmar.`
              : `No se pudo confirmar ${installmentLabel(item)}. Revisá su estado antes de reintentar.`
          break
        }
        completed += 1
        actualAmount += Number(data.monto_pagado ?? expectedAmount)
      }
    } catch {
      failure = 'No se pudo confirmar el cobro. Revisá el estado de las cuotas antes de reintentar.'
    } finally {
      if (mounted.current) {
        if (!selectionWasRefreshed) await load()
        if (mounted.current) {
          if (completed) {
            setMessage(`${completed} ${completed === 1 ? 'cuota cobrada' : 'cuotas cobradas'}. Total registrado: ${money(actualAmount / 100)}.`)
            onRefresh()
          }
          if (failure) setError(`${completed ? 'El cobro quedó registrado solo para las cuotas confirmadas. ' : ''}${failure}`)
          setSaving(false)
        }
      }
      submitting.current = false
      onBusy(false)
    }
  }

  const name = `${student.apellido}, ${student.nombre}`
  return <>
    <button type="button" className="btn-link back-link" onClick={onBack} disabled={saving}><DesignIcon name="back" />Volver a alumnos</button>
    <div className="page-heading"><div><h1>{canCollect ? 'Registrar cobro' : 'Ficha del alumno'}</h1><p>{canCollect ? 'Seleccioná las cuotas y revisá el desglose antes de confirmar.' : 'Consultá la situación de las cuotas y los datos del alumno.'}</p></div></div>
    <section className="panel panel-padding student-summary" aria-label="Ficha del alumno">
      <div className="student-summary-heading"><div className="student-identity"><span className="student-initials" aria-hidden="true">{student.nombre?.[0]}{student.apellido?.[0]}</span><div><h2>{name}</h2><p>DNI {student.dni} · {student.nivel} · {student.curso}</p></div></div><span className={`badge ${Number(student.deuda) > 0 ? 'badge-warning' : 'badge-success'}`}>{Number(student.deuda) > 0 ? 'Con deuda' : 'Sin deuda'}</span></div>
      <dl className="student-facts">
        <div><dt>Hermanos</dt><dd>{student.hermanos}</dd></div>
        <div><dt>Descuento informado</dt><dd>{(Number(student.descuento_hermano) * 100).toFixed(0)} %</dd></div>
        <div><dt>Arancel informado</dt><dd>{money(Number(student.arancel_base))}</dd></div>
        <div><dt>Cuotas saldadas</dt><dd>{student.cuotas_saldadas}</dd></div>
        <div><dt>Mora informada</dt><dd>{money(Number(student.mora))}</dd></div>
        <div><dt>Deuda informada</dt><dd>{money(Number(student.deuda))}</dd></div>
      </dl>
      <p className="student-contact">Contacto del tutor: {student.tutor_email || 'Sin correo registrado'}</p>
    </section>
    {message && <div role="status" className="success-message">{message}</div>}
    {error && <div role="alert" className="error-message">{error}</div>}
    <div className={canCollect ? 'collection-layout' : ''}>
      <section className="panel installments-panel" aria-labelledby="installments-title" aria-busy={loading}>
        <div className="panel-header"><h2 id="installments-title">{canCollect ? '1. Seleccioná las cuotas' : 'Cuotas del alumno'}</h2><small>{canCollect ? `${chosen.length} ${chosen.length === 1 ? 'seleccionada' : 'seleccionadas'}` : `${items.length} cuotas`}</small></div>
        {loading ? <p className="spin">Consultando cuotas...</p> : loadFailed ? <div className="panel-padding"><button type="button" className="btn btn-secondary" onClick={load}>Reintentar consulta</button></div> : !items.length ? <div className="empty-state"><h3>No hay cuotas registradas</h3><p>Este alumno todavía no tiene cuotas para consultar.</p></div> : <>
          {canCollect && <div className="installment-tools"><button type="button" className="btn-link" disabled={saving || !pending.length} onClick={() => { setSelected(selected.length ? [] : pending.map(item => item.id)); setReviewed(false) }}>{selected.length ? 'Limpiar selección' : 'Seleccionar todas las pendientes'}</button></div>}
          <div className="installment-columns" aria-hidden="true"><span>Cuota</span><span>Capital neto</span><span>Recargo</span><span>Total</span></div>
          {items.map(item => {
            const state = paymentState(item)
            const amount = installmentTotal(item)
            const label = installmentLabel(item)
            const status = state === 'paid' ? 'Saldada' : state === 'partial' ? 'Pago parcial: requiere revisión' : state === 'invalid' ? 'Importe a revisar' : 'Pendiente'
            return <div className={`installment-row ${state === 'paid' ? 'settled' : ''}`} key={item.id}>
              <label className="installment-name">
                {canCollect && <span className="check-target"><input type="checkbox" aria-label={label} checked={selected.includes(item.id)} disabled={state !== 'pending' || saving} onChange={() => toggle(item.id)} /></span>}
                <span><strong>{label}</strong><small>{item.fecha_vencimiento ? `Vencimiento ${item.fecha_vencimiento.split('T')[0].split('-').reverse().join('/')}` : item.concepto || 'Sin vencimiento informado'}</small><span className={`badge ${state === 'paid' ? 'badge-success' : 'badge-warning'}`}>{status}</span></span>
              </label>
              <div className="installment-amount"><span>Capital neto</span>{amount === null ? '—' : money((Number(item.monto) - Number(item.descuento)) / 100)}</div>
              <div className="installment-amount"><span>Recargo</span>{amount === null ? '—' : money(Number(item.recargo) / 100)}</div>
              <div className="installment-amount installment-total"><span>Total de la cuota</span><strong>{amount === null ? '—' : money(amount / 100)}</strong></div>
            </div>
          })}
        </>}
      </section>
      {canCollect && <section className="panel panel-padding collection-review" aria-labelledby="review-title">
        <h2 id="review-title">2. Revisá y confirmá</h2>
        <p className="muted">{name} · DNI {student.dni}<br />{chosen.length} {chosen.length === 1 ? 'cuota seleccionada' : 'cuotas seleccionadas'}</p>
        <dl className="review-amounts"><div><dt>Capital con descuentos</dt><dd>{money(principal / 100)}</dd></div><div><dt>Recargos registrados</dt><dd>{money(surcharge / 100)}</dd></div></dl>
        <div className="collection-total"><p>Total a cobrar · ARS</p><strong data-testid="collection-total">{money(total / 100)}</strong></div>
        <div className="notice"><DesignIcon name="info" /><p>Se cobran los importes registrados de las cuotas. La mora informada en la ficha no se agrega automáticamente al cobro.</p></div>
        <label className="review-check"><span className="check-target"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} disabled={saving || !chosen.length || loadFailed} /></span><span>Revisé el alumno, las cuotas y el importe.</span></label>
        <button type="button" className="btn" onClick={confirm} disabled={!chosen.length || !reviewed || saving || loading || loadFailed}>{saving ? 'Registrando cobro...' : <><DesignIcon name="check" />Confirmar cobro</>}</button>
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={onBack}>Cancelar y volver</button>
        <small className="muted">Cada cuota se registra por separado. Si alguna falla, las anteriores confirmadas permanecen cobradas.</small>
      </section>}
    </div>
  </>
}
