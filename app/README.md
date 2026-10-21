# Canada School — Sistema de Gestión (Proyecto de Rescate)

Aplicación de gestión de alumnos, cuotas y cobranzas del **Canada School** (Caballito, CABA).
Este código fue **heredado del vendor anterior** y llega a Bewise en estado crítico: inestable,
lento y con fallas de cálculo financiero. Tu trabajo es auditarlo, entenderlo y profesionalizarlo.

## Stack

React + TypeScript + Vite + Supabase (PostgreSQL / Auth / RLS) + Tailwind CSS.

## Puesta en marcha

```bash
npm install
# el .env con las claves de Supabase te lo entrega el mentor
npm run dev
```

> Si el server no levanta por `HTTP 431 (request header fields too large)`, arrancá con:
> `NODE_OPTIONS=--max-http-header-size=65536 npm run dev`

El formulario de acceso comienza vacío. Use una cuenta del proyecto autorizado;
el seed no crea identidades Auth. Las correcciones actuales y sus pruebas se
describen en [la guía de auditoría](../docs/audit-findings.md).

## Qué se espera de vos

El sistema "anda" en la demo feliz, pero está lleno de malas prácticas y defectos que sólo
emergen bajo ciertas condiciones o a escala. **No hay comentarios que marquen los errores**:
tenés que encontrarlos leyendo el código y razonando las reglas del negocio (aranceles, mora,
grupos familiares, cierres contables).

El proyecto tiene **dos fases**:
1. **Endurecer el código** de tu track: encontrar y corregir los defectos (muchos sólo se
   manifiestan bajo condiciones específicas: datos nulos, timing, escala, entrada maliciosa).
2. **Darle arquitectura** al sistema: ver `ARQUITECTURA.md` (refactor a Clean Architecture).

Trabajás sobre tu track asignado. El mentor te comparte el reclamo del cliente y tu track; el
resto es tu criterio.

## Reglas de oro (uso de IA)

1. La IA **alucina soluciones ingenuas**: si le pedís "arreglá el aumento", puede proponerte un
   `UPDATE` que pisa recibos históricos. Vos ponés las reglas del negocio.
2. **Validá la seguridad real**: la IA suele generar políticas RLS permisivas (`true`) o
   recomendar `service_role`. Verificá en PostgreSQL.
3. **Prompteá con contexto**: alimentá a la IA con las reglas del Canada School, no con
   fragmentos sueltos.

## Cómo se evalúa

El mentor corre un **harness de aceptación** (SQL + Playwright + chequeos estáticos) que detecta
la presencia de cada defecto. Un problema se considera resuelto cuando su verificador cambia de
estado **sin romper** el resto y con `npm run build` en verde. Cuidá las regresiones.
