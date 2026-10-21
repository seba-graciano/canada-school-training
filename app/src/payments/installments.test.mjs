import assert from 'node:assert/strict'
import test from 'node:test'
import { paymentState } from './installments.ts'

const item={id:1,alumno_id:1,concepto:null,mes:2,anio:2026,monto:10000,
  recargo:0,descuento:0,fecha_vencimiento:null,pagos:[]}

test('installment classification accepts only canonical state labels', () => {
  assert.equal(paymentState({...item,estado:'Pagada'}),'paid')
  for(const estado of ['Pendiente','Vencida']) {
    assert.equal(paymentState({...item,estado}),'pending')
    assert.equal(paymentState({...item,estado,pagos:[{monto_abonado:3000}]}),'partial')
    assert.equal(paymentState({...item,estado,pagos:[{monto_abonado:10000}]}),'paid')
  }
  for(const estado of ['pagado','pagada','pendiente','vencida','PAGO','ok',' Pagada ',null,'unknown']) {
    assert.equal(paymentState({...item,estado}),'invalid')
    assert.equal(paymentState({...item,estado,pagos:[{monto_abonado:10000}]}),'invalid')
  }
})
