import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import _ from "lodash";
import * as Icons from "react-icons/fa";
import { useApp } from "./AppContext";

const PAGE_SIZE = 50;

export default function AdminDashboard() {
  const [alumnos, setAlumnos] = useState<any>([]);
  const [alumnosFiltrados, setAlumnosFiltrados] = useState<any>([]);
  const [cuotas, setCuotas] = useState<any>([]);
  const [tutores, setTutores] = useState<any>([]);
  const [pagos, setPagos] = useState<any>([]);
  const [loading, setLoading] = useState(true);
  const { user, userRole, logout, setFiltro } = useApp();
  const [contador, setContador] = useState(0);
  const [detalle, setDetalle] = useState<any>(null);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoApellido, setNuevoApellido] = useState("");
  const [nuevoDni, setNuevoDni] = useState("");
  const [nuevoArancel, setNuevoArancel] = useState("");
  const [nuevoTutorId, setNuevoTutorId] = useState<number | null>(null);
  const [nuevoNivel, setNuevoNivel] = useState("Primario");
  const [nuevoCurso, setNuevoCurso] = useState("1º Primaria");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [toasts, setToasts] = useState<
    Array<{ id: number; message: string; type: "success" | "error" | "info" }>
  >([]);

  const showToast = (
    message: string,
    type: "success" | "error" | "info" = "info",
  ) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      3000,
    );
  };

  const cursosPorNivel: Record<string, string[]> = {
    Inicial: ["Inicial"],
    Primario: [
      "1º Primaria",
      "2º Primaria",
      "3º Primaria",
      "4º Primaria",
      "5º Primaria",
      "6º Primaria",
    ],
    Secundario: [
      "1º Secundaria",
      "2º Secundaria",
      "3º Secundaria",
      "4º Secundaria",
      "5º Secundaria",
      "6º Secundaria",
    ],
  };

  const validCursos = cursosPorNivel[nuevoNivel] ?? [];

  const isAdmin = userRole === "admin";
  const isSecretaria = userRole === "secretaria";
  const canManageCuotas = isAdmin || isSecretaria;
  const canCreateAlumno = isAdmin || isSecretaria;

  useEffect(() => {
    cargar();

    const channel = supabase
      .channel("pagos-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pagos" },
        (p: any) => {
          console.log("nuevo pago", p);
          cargar();
        },
      )
      .subscribe();

    const intervalId = setInterval(() => {
      setContador((c) => c + 1);
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(intervalId);
    };
  }, []);

  async function cargar() {
    setLoading(true);
    try {
      const res = await supabase.from("alumnos").select("*");
      const data: any = res.data;
      const tut = await supabase.from("tutores").select("*");
      const pag = await supabase.from("pagos").select("*");

      const alumnoIds = data.map((a: any) => a.id);
      const cuotasRes = await supabase
        .from("cuotas")
        .select("*")
        .in("alumno_id", alumnoIds);
      const todasLasCuotas = cuotasRes.data || [];

      setAlumnos(data);
      setAlumnosFiltrados(data);
      setCuotas(todasLasCuotas);
      setTutores(tut.data);
      setPagos(pag.data);
      setCurrentPage(1);
      setTotalPages(Math.ceil(data.length / PAGE_SIZE));
      setLoading(false);
    } catch (e) {
      setLoading(false);
    }
  }

  async function buscar(texto: string) {
    setSearchQuery(texto);
    setFiltro(texto);
    setCurrentPage(1);

    if (texto.length === 0) {
      setAlumnosFiltrados(alumnos);
      setTotalPages(Math.ceil(alumnos.length / PAGE_SIZE));
      return;
    }

    try {
      const res = await supabase.rpc("buscar_alumnos", { q: texto });
      const encontrados = (res.data as unknown as any[]) || [];
      setAlumnosFiltrados(encontrados);
      setTotalPages(Math.ceil(encontrados.length / PAGE_SIZE));
    } catch (e) {
      setAlumnosFiltrados([]);
      setTotalPages(1);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    buscar(searchQuery);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      buscar(searchQuery);
    }
  }

  function goToPage(page: number) {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  }

  function previousPage() {
    goToPage(currentPage - 1);
  }

  function nextPage() {
    goToPage(currentPage + 1);
  }

  function getPaginatedAlumnos() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return _.orderBy(alumnosFiltrados, ["apellido"], ["asc"]).slice(start, end);
  }

  function verContacto(al: any) {
    const t = tutores.find((x: any) => x.id == al.tutor_id);
    const email = t?.email?.toLowerCase() ?? "sin email registrado";
    setDetalle({ nombre: al.nombre + " " + al.apellido, email: email });
  }

  function pagadoDe(cuota: any) {
    let s = 0;
    for (let i = 0; i < pagos.length; i++) {
      if (pagos[i].cuota_id == cuota.id) s = s + pagos[i].monto_abonado;
    }
    return s;
  }

  function estaSaldada(cuota: any) {
    return pagadoDe(cuota) >= cuota.monto;
  }

  function estaPagada(cuota: any) {
    const normalized = cuota.estado?.toLowerCase();
    const estadosPagados = ["pagado", "pago", "ok"];
    return estadosPagados.includes(normalized) || estaSaldada(cuota);
  }

  function saldadasDe(al: any) {
    let n = 0;
    for (let i = 0; i < cuotas.length; i++) {
      if (cuotas[i].alumno_id == al.id && estaSaldada(cuotas[i])) n++;
    }
    return n;
  }

  function deudaDe(al: any) {
    let total = 0;
    for (let i = 0; i < cuotas.length; i++) {
      if (cuotas[i].alumno_id == al.id) {
        if (!estaPagada(cuotas[i])) {
          total =
            total + cuotas[i].monto + cuotas[i].recargo - cuotas[i].descuento;
        }
      }
    }
    return total;
  }

  function hermanos(al: any) {
    if (al.tutor_id == null) return 1;
    let n = 0;
    for (let i = 0; i < alumnos.length; i++) {
      if (alumnos[i].tutor_id == al.tutor_id) n++;
    }
    return n;
  }

  function descuentoHermano(al: any) {
    const h = hermanos(al);
    if (h == 2) return 0.1;
    if (h >= 3) return 0.2;
    return 0;
  }

  function calcularMora(cuota: any) {
    const venc2 = cuota.fecha_vencimiento_2
      ? new Date(cuota.fecha_vencimiento_2).getTime()
      : new Date(cuota.fecha_vencimiento).getTime();
    const hoy = new Date().getTime();
    const dias = Math.floor((hoy - venc2) / (1000 * 60 * 60 * 24));
    if (dias > 0) return dias * 5000;
    return 0;
  }

  function moraDe(al: any) {
    let total = 0;
    for (let i = 0; i < cuotas.length; i++) {
      if (cuotas[i].alumno_id == al.id) total = total + calcularMora(cuotas[i]);
    }
    return total;
  }

  async function aumentarCuotas() {
    for (let i = 0; i < cuotas.length; i++) {
      await supabase
        .from("cuotas")
        .update({ monto: Math.round((cuotas[i].monto * 115) / 100) })
        .eq("id", cuotas[i].id);
    }
    showToast("Aumento aplicado", "success");
    cargar();
  }

  async function cobrar(cuota: any) {
    const { data, error } = await supabase.rpc("cobrar_cuota", {
      p_cuota_id: cuota.id,
    });

    if (error) {
      showToast("Error de conexión: " + error.message, "error");
      return;
    }

    const result = data as {
      success: boolean;
      error?: string;
      code?: string;
      message?: string;
    };

    if (!result.success) {
      if (result.code === "ALREADY_PAID") {
        showToast("Esta cuota ya está pagada", "error");
      } else {
        showToast(result.error ?? "Error al registrar el pago", "error");
      }
      return;
    }

    showToast(result.message ?? "Pago registrado", "success");
    cargar();
  }

  async function crearAlumno() {
    if (!nuevoTutorId) {
      showToast("Debe seleccionar un tutor", "error");
      return;
    }
    if (!validCursos.includes(nuevoCurso)) {
      showToast("Curso inválido para el nivel seleccionado", "error");
      return;
    }
    const nuevo: any = {
      nombre: nuevoNombre,
      apellido: nuevoApellido,
      dni: nuevoDni,
      nivel: nuevoNivel,
      curso: nuevoCurso,
      tutor_id: nuevoTutorId,
      arancel_base: Math.round(Number(nuevoArancel) * 100),
      activo: true,
    };
    try {
      const { error } = await supabase
        .from("alumnos")
        .insert(nuevo)
        .select()
        .single();
      if (error) throw error;
      setNuevoNombre("");
      setNuevoApellido("");
      setNuevoDni("");
      setNuevoArancel("");
      setNuevoTutorId(null);
      setNuevoNivel("Primario");
      setNuevoCurso("1º Primaria");
      showToast("Alumno creado", "success");
      cargar();
    } catch (e: any) {
      showToast("Error al crear alumno: " + e.message, "error");
    }
  }

  if (loading) {
    return <div className="spin">Cargando alumnos...</div>;
  }

  const paginatedAlumnos = getPaginatedAlumnos();
  const totalRecords = alumnosFiltrados.length;
  const startRecord = totalRecords > 0 ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const endRecord = Math.min(currentPage * PAGE_SIZE, totalRecords);
  const roleLabel =
    userRole === "admin"
      ? "Administrador"
      : userRole === "secretaria"
        ? "Secretaría"
        : "Tutor";

  return (
    <div style={{ padding: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 15,
        }}
      >
        <div style={{ fontSize: 22, color: "#c0142c", fontWeight: "bold" }}>
          <Icons.FaSchool style={{ verticalAlign: "middle", marginRight: 8 }} />
          Canada School - Panel {roleLabel}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
          <div style={{ fontSize: 12, color: "#999" }}>
            {user?.email}{" "}
            <span style={{ marginLeft: 8, color: "#c0142c" }}>●</span>
          </div>
          <button
            className="btn"
            style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={logout}
          >
            Salir
          </button>
          <div style={{ fontSize: 12, color: "#999" }}>refresh #{contador}</div>
        </div>
      </div>

      <div style={{ marginBottom: 15 }}>
        <form
          onSubmit={handleSearchSubmit}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            placeholder="Buscar alumno..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ padding: 8, width: 260 }}
          />
          <button type="submit" className="btn">
            Buscar
          </button>
          {canManageCuotas && (
            <button
              className="btn"
              style={{ marginLeft: 10 }}
              onClick={aumentarCuotas}
            >
              Aplicar aumento 15%
            </button>
          )}
        </form>
      </div>

      {detalle && (
        <div style={{ marginBottom: 15, background: "#eef", padding: 10 }}>
          <b>Contacto de {detalle.nombre}:</b> {detalle.email}
          <button
            className="btn"
            style={{ marginLeft: 10 }}
            onClick={() => setDetalle(null)}
          >
            Cerrar
          </button>
        </div>
      )}

      {canCreateAlumno && (
        <div style={{ marginBottom: 15, background: "#fff", padding: 10 }}>
          <b>Nuevo alumno:</b>
          <input
            placeholder="Nombre"
            value={nuevoNombre}
            onChange={(e) => setNuevoNombre(e.target.value)}
            style={{ marginLeft: 8 }}
          />
          <input
            placeholder="Apellido"
            value={nuevoApellido}
            onChange={(e) => setNuevoApellido(e.target.value)}
            style={{ marginLeft: 8 }}
          />
          <input
            placeholder="DNI"
            value={nuevoDni}
            onChange={(e) => setNuevoDni(e.target.value)}
            style={{ marginLeft: 8 }}
          />
          <input
            placeholder="Arancel"
            value={nuevoArancel}
            onChange={(e) => setNuevoArancel(e.target.value)}
            style={{ marginLeft: 8, width: 90 }}
          />
          <select
            value={nuevoNivel}
            onChange={(e) => {
              setNuevoNivel(e.target.value);
              setNuevoCurso(cursosPorNivel[e.target.value][0]);
            }}
            style={{ marginLeft: 8, width: 140 }}
          >
            <option value="Inicial">Inicial</option>
            <option value="Primario">Primario</option>
            <option value="Secundario">Secundario</option>
          </select>
          <select
            value={nuevoCurso}
            onChange={(e) => setNuevoCurso(e.target.value)}
            style={{ marginLeft: 8, width: 160 }}
          >
            {validCursos.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={nuevoTutorId ?? ""}
            onChange={(e) =>
              setNuevoTutorId(e.target.value ? Number(e.target.value) : null)
            }
            style={{ marginLeft: 8, width: 200 }}
          >
            <option value="">Seleccionar tutor...</option>
            {tutores.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.nombre} {t.apellido}
              </option>
            ))}
          </select>
          <button
            className="btn"
            style={{ marginLeft: 8 }}
            onClick={crearAlumno}
          >
            Crear
          </button>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>DNI</th>
            <th>Nivel</th>
            <th>Curso</th>
            <th>Hermanos</th>
            <th>Desc.</th>
            <th>Arancel</th>
            <th>Saldadas</th>
            <th>Mora</th>
            <th>Deuda</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          {paginatedAlumnos.map((a: any) => (
            <tr key={a.id}>
              <td>
                <a
                  onClick={() => verContacto(a)}
                  style={{ cursor: "pointer", color: "#0645ad" }}
                >
                  {a.nombre} {a.apellido}
                </a>
              </td>
              <td>{a.dni}</td>
              <td>{a.nivel}</td>
              <td>{a.curso}</td>
              <td>{hermanos(a)}</td>
              <td>{descuentoHermano(a) * 100}%</td>
              <td>${(a.arancel_base / 100).toFixed(2)}</td>
              <td>{saldadasDe(a)}</td>
              <td style={{ color: moraDe(a) > 0 ? "#c0142c" : "#999" }}>
                ${(moraDe(a) / 100).toFixed(2)}
              </td>
              <td style={{ color: deudaDe(a) > 0 ? "red" : "green" }}>
                ${(deudaDe(a) / 100).toFixed(2)}
              </td>
              <td>
                {canManageCuotas &&
                  cuotas
                    .filter((c: any) => c.alumno_id == a.id && !estaPagada(c))
                    .map((c: any) => (
                      <button
                        key={c.id}
                        className="btn"
                        style={{
                          marginRight: 4,
                          fontSize: 11,
                          padding: "3px 6px",
                        }}
                        onClick={() => cobrar(c)}
                      >
                        Cobrar {c.mes}/{c.anio}
                      </button>
                    ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalRecords > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 15,
            padding: 10,
          }}
        >
          <div style={{ fontSize: 14, color: "#666" }}>
            Mostrando {startRecord} - {endRecord} de {totalRecords} alumnos (
            {totalPages} página{totalPages !== 1 ? "s" : ""})
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn"
              onClick={previousPage}
              disabled={currentPage === 1}
              style={{ display: currentPage === 1 ? "none" : "inline-block" }}
            >
              Anterior
            </button>
            <span style={{ minWidth: 60, textAlign: "center" }}>
              Página {currentPage} de {totalPages}
            </span>
            <button
              className="btn"
              onClick={nextPage}
              disabled={currentPage === totalPages}
              style={{
                display: currentPage === totalPages ? "none" : "inline-block",
              }}
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: "12px 16px",
              borderRadius: 4,
              background:
                t.type === "error"
                  ? "#c0142c"
                  : t.type === "success"
                    ? "#2e7d32"
                    : "#1565c0",
              color: "#fff",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              minWidth: 200,
              maxWidth: 350,
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
