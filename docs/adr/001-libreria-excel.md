# ADR 001: Librería de Excel para Inscripciones 2027

Estado: aceptado · Fecha: 24/11/2026

## Contexto

Para la importación tenía que leer los Excel que sube la secretaría, o sea archivos que vienen de afuera y que no se pueden tomar como confiables. Además tenía que generar la plantilla con listas desplegables en Nivel y Curso (R-02) y el reporte de errores. Del lado de la exportación también hay que escribir el padrón, con montos que se puedan sumar (R-15) y los DNI como texto (R-16).

## Opciones

Básicamente tenía 4 opciones principales para elegir la librería del Excel.

La primera es xlsx (SheetJS) de npm, la cual descarté porque la versión de npm quedó congelada en 2022 (las nuevas solo se publican en la web de SheetJS) y encima tiene una vulnerabilidad grave al leer archivos (CVE-2023-30533). Como nosotros justamente leemos archivos que suben los usuarios, esa falla nos afecta directamente, así que ni la probé.

La segunda es SheetJS desde su web, pero decidí no usarla porque se instala desde una URL y no desde npm, entonces el npm audit no la revisa y las actualizaciones de seguridad hay que seguirlas a mano.

La tercera opción fue read-excel-file + write-excel-file, la cual era una buena opción ya que no tiene vulnerabilidades, es moderna y pesa muy poco. Pero para las listas desplegables necesitaba un plugin que salió hace menos de 6 meses y es de un autor sin trayectoria, y no me pareció bueno depender de eso para algo que pide el cliente.

Y la cuarta, que es la que decidí usar, fue exceljs 4.4.0. Tiene listas desplegables propias, formatos de número y celdas de texto, así que puede hacer todo sola sin depender de plugins. Junto con la opción anterior fueron las únicas que leyeron bien el archivo de ejemplo del cliente: la fecha de la fila 27 la lee como fecha, el 185000.555 como número y el =HYPERLINK(...) como texto, no como fórmula.

## Decisión

Usamos exceljs 4.4.0, con la versión fija.

## Consecuencias

- npm audit muestra 2 vulnerabilidades moderadas, pero están en una dependencia (uuid), en las versiones v3/v5/v6 cuando se le pasa un buffer. exceljs solo usa la v4, así que nunca llegamos a ese código. Ojo: no hay que correr `npm audit fix --force`, porque baja exceljs a una versión vieja.
- Pesa 256 KB comprimida. Para que no afecte, se carga con import dinámico solo cuando alguien entra a Inscripciones, así no pesa en la carga inicial de la app.
- No tiene releases desde 2023. Si se abandona, se puede reemplazar cambiando los 2 adaptadores de `app/src/infrastructure/excel/` y listo, porque el resto del código no conoce la librería: habla con los puertos `LectorPlanilla` y `EscritorPlanilla`.
