/* TOLVAR · Sistema de gestión
 * Todo corre en el navegador (sin servidor). Los datos se guardan en localStorage
 * y se pueden respaldar/restaurar en JSON o exportar a Excel desde el botón superior.
 */
(() => {
'use strict';

/* ═══════════════ Utilidades ═══════════════ */
const KEY = 'tolvar_gestion_v1';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => Number(v) || 0;
const fmtMoney = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = n => fmtMoney.format(num(n));
const pct = n => (num(n) * 100).toFixed(1).replace('.', ',') + ' %';
const cls = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 10); };
const todayISO = () => iso(new Date());
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const fdate = s => (s ? s.split('-').reverse().join('/') : '');
const fmonth = s => (s ? s.split('-').reverse().join('/') : '');
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Rango [desde, hasta] (inclusive) de un período alrededor de una fecha. Semana: lunes a domingo. */
function range(p, ref) {
    if (p === 'dia') return [ref, ref];
    if (p === 'semana') { const off = (parse(ref).getDay() + 6) % 7; const a = addDays(ref, -off); return [a, addDays(a, 6)]; }
    if (p === 'mes') { const d = parse(ref); return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))]; }
    return ['0000-01-01', '9999-12-31'];
}
const lastMonths = (ref, n) => { const d = parse(ref); const o = []; for (let i = n - 1; i >= 0; i--) o.push(iso(new Date(d.getFullYear(), d.getMonth() - i, 1))); return o; };
const lastWeeks = (ref, n) => { const a = range('semana', ref)[0]; const o = []; for (let i = n - 1; i >= 0; i--) o.push(addDays(a, -7 * i)); return o; };

/* ═══════════════ Datos ═══════════════ */
const EMPTY = () => ({ empleados: [], horas: [], herramientas: [], agenda: [], clientes: [], proveedores: [], presupuestos: [], trabajos: [], movimientos: [], vencimientos: [] });
const COLS = Object.keys(EMPTY());
const CFG = window.TOLVAR_CONFIG || {};
const WANT_REMOTE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const REMOTE = WANT_REMOTE && !!(window.supabase && window.supabase.createClient);
const total = o => Object.values(o).reduce((a, v) => a + v.length, 0);
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
let S = REMOTE ? EMPTY() : load();
let sb = null, snap = {}, inflight = 0, queue = Promise.resolve(), booted = false;

/* Modo local: localStorage */
function load() {
    try { const r = localStorage.getItem(KEY); return r ? Object.assign(EMPTY(), JSON.parse(r)) : EMPTY(); } catch (e) { return EMPTY(); }
}
function localSave() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('No se pudo guardar en este navegador. Hacé un respaldo.'); }
}

/* Modo nube: Supabase. save() envía solo lo que cambió respecto de la última foto (snap). */
function save() {
    if (!REMOTE) return localSave();
    inflight++;
    queue = queue.then(syncNow).catch(() => {}).finally(() => { inflight--; });
}
function takeSnap() { snap = {}; COLS.forEach(k => { snap[k] = new Map(S[k].map(x => [x.id, JSON.stringify(x)])); }); }
async function syncNow() {
    setStatus('saving');
    try {
        for (const k of COLS) {
            const cur = new Map(S[k].map(x => [x.id, JSON.stringify(x)])), old = snap[k] || new Map();
            const up = [], del = [];
            cur.forEach((v, id) => { if (old.get(id) !== v) up.push({ id, data: JSON.parse(v) }); });
            old.forEach((v, id) => { if (!cur.has(id)) del.push(id); });
            for (const part of chunk(up, 400)) { const { error } = await sb.from('tolvar_' + k).upsert(part); if (error) throw error; }
            for (const part of chunk(del, 200)) { const { error } = await sb.from('tolvar_' + k).delete().in('id', part); if (error) throw error; }
            snap[k] = cur;
        }
        setStatus('ok');
    } catch (e) {
        console.error(e); setStatus('error');
        toast('No se pudo guardar en la nube. Revisá la conexión y volvé a intentar.');
        throw e;
    }
}
async function fetchAll() {
    const D = EMPTY();
    for (const k of COLS) {
        for (let from = 0; ; from += 1000) {
            const { data, error } = await sb.from('tolvar_' + k).select('data').order('id').range(from, from + 999);
            if (error) throw error;
            data.forEach(r => D[k].push(r.data));
            if (data.length < 1000) break;
        }
    }
    return D;
}
const STATUS = { local: '💾 Modo local', loading: '… Cargando', saving: '… Guardando', ok: '☁ Sincronizado', error: '⚠ Sin conexión', '': '' };
function setStatus(st) {
    const b = $('#sync'); if (!b) return;
    b.textContent = STATUS[st] || ''; b.className = 'btn btn-ghost ' + st; b.hidden = !st;
    b.title = st === 'local' ? 'Los datos se guardan solo en este navegador. Configurá Supabase en config.js.' : 'Actualizar datos desde la nube';
}
function showLogin(msg) {
    let el = $('#login');
    if (!el) {
        el = document.createElement('div'); el.id = 'login';
        el.innerHTML = '<form class="login-card" id="loginForm"><img src="../logo.png" width="56" height="56" alt=""><h2>Sistema de gestión</h2><p>Ingresá con tu usuario.</p>'
            + '<input type="email" name="email" placeholder="Email" required autocomplete="username"><input type="password" name="password" placeholder="Contraseña" required autocomplete="current-password">'
            + '<div class="login-err" id="loginErr" role="alert"></div><button class="btn btn-primary" type="submit">Ingresar</button></form>';
        document.body.appendChild(el);
        $('#loginForm').addEventListener('submit', doLogin);
    }
    el.hidden = false; $('#loginErr').textContent = msg || ''; $('#btnLogout').hidden = true; setStatus('');
}
async function doLogin(ev) {
    ev.preventDefault();
    const f = ev.target, b = f.querySelector('button');
    b.disabled = true; $('#loginErr').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: f.elements.email.value.trim(), password: f.elements.password.value });
    b.disabled = false;
    if (error) { $('#loginErr').textContent = 'Email o contraseña incorrectos.'; return; }
    f.elements.password.value = '';
    await bootRemote();
}
async function bootRemote() {
    setStatus('loading');
    try {
        const { data: ok, error: e0 } = await sb.rpc('tolvar_autorizado');
        if (e0) throw e0;
        if (!ok) { await sb.auth.signOut(); showLogin('Tu usuario no está autorizado para usar el sistema.'); return; }
        S = await fetchAll(); takeSnap();
        migrarLocal();
        const l = $('#login'); if (l) l.hidden = true;
        $('#btnLogout').hidden = false; booted = true; setStatus('ok'); render();
    } catch (e) {
        console.error(e); setStatus('error');
        showLogin('No se pudo conectar con la base de datos: ' + (e.message || e));
    }
}
function migrarLocal() {
    if (total(S) > 0 || localStorage.getItem(KEY + '_nomigrar')) return;
    const L = load(), n = total(L);
    if (!n) return;
    if (confirm(`Hay ${n} registros guardados en este navegador (de antes de usar la base de datos). ¿Subirlos a la nube?`)) { S = L; save(); }
    else localStorage.setItem(KEY + '_nomigrar', '1');
}
async function refresh(manual) {
    if (!REMOTE || !booted) return;
    if (inflight > 0 || $('#dlg').open) { if (manual) toast('Hay cambios guardándose; probá de nuevo en un momento.'); return; }
    try {
        setStatus('loading');
        const D = await fetchAll();
        if (inflight > 0) { setStatus('saving'); return; }
        const cambio = JSON.stringify(D) !== JSON.stringify(S);
        if (cambio) { S = D; takeSnap(); render(); }
        setStatus('ok');
        if (manual) toast(cambio ? 'Datos actualizados' : 'Ya tenés lo último');
    } catch (e) { console.error(e); setStatus('error'); if (manual) toast('No se pudo actualizar.'); }
}
async function init() {
    ui.view = location.hash.slice(1) || 'resumen';
    if (WANT_REMOTE && !REMOTE) { $('#main').innerHTML = '<div class="panel"><h2>No se pudo cargar la librería de Supabase</h2><p class="hint">Revisá que exista <code>gestion/vendor/supabase.js</code>.</p></div>'; return; }
    if (!REMOTE) { setStatus('local'); render(); return; }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    setStatus('loading');
    try {
        const { data } = await sb.auth.getSession();
        if (data && data.session) await bootRemote(); else showLogin();
    } catch (e) { console.error(e); showLogin('No se pudo conectar con la base de datos.'); }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(() => { if (!document.hidden) refresh(); }, 60000);
}
const byId = (col, id) => S[col].find(x => x.id === id);
const nm = (col, id) => { const x = id && byId(col, id); return x ? LBL[col](x) : ''; };
const LBL = {
    clientes: c => c.nombre,
    empleados: e => e.nombre,
    proveedores: p => p.nombre,
    trabajos: t => `${nm('clientes', t.clienteId)} · ${t.descripcion}`,
    presupuestos: p => `${fdate(p.fecha)} · ${nm('clientes', p.clienteId)} · ${p.descripcion}`,
};

/* ═══════════════ Cálculos de caja ═══════════════ */
const CATS = { Ingreso: ['Cobro de trabajos', 'Otros ingresos'], Egreso: ['Pagos empleados', 'Pago deuda', 'Proveedores y compras', 'Facturas recibidas', 'Otros egresos'] };
const tipoDe = c => (CATS.Ingreso.includes(c) ? 'Ingreso' : 'Egreso');
const signed = m => (m.tipo === 'Ingreso' ? num(m.monto) : -num(m.monto));
const cmpMov = (a, b) => a.fecha.localeCompare(b.fecha);

function totals(from, to) {
    let i = 0, e = 0;
    S.movimientos.forEach(m => { if (m.fecha >= from && m.fecha <= to) { if (m.tipo === 'Ingreso') i += num(m.monto); else e += num(m.monto); } });
    return { i, e, b: i - e };
}
const saldoAntes = d => S.movimientos.reduce((a, m) => (m.fecha < d ? a + signed(m) : a), 0);
const saldoTotal = () => S.movimientos.reduce((a, m) => a + signed(m), 0);

const cobradoTr = id => S.movimientos.filter(m => m.tipo === 'Ingreso' && m.trabajoId === id).reduce((a, m) => a + num(m.monto), 0);
const saldoTrabajo = t => num(t.monto) - cobradoTr(t.id);
const facturadoCli = id => S.trabajos.filter(t => t.clienteId === id && t.estado !== 'Cancelado').reduce((a, t) => a + num(t.monto), 0);
const cobradoCli = id => S.movimientos.filter(m => m.tipo === 'Ingreso' && m.clienteId === id).reduce((a, m) => a + num(m.monto), 0);

function rentab(t) {
    const mo = S.horas.filter(h => h.trabajoId === t.id).reduce((a, h) => a + num(h.horas) * num((byId('empleados', h.empleadoId) || {}).valorHora), 0);
    const compras = S.movimientos.filter(m => m.tipo === 'Egreso' && m.trabajoId === t.id && m.categoria !== 'Pagos empleados').reduce((a, m) => a + num(m.monto), 0);
    const monto = num(t.monto), costo = mo + compras, rent = monto - costo;
    return { monto, cobrado: cobradoTr(t.id), compras, mo, costo, rent, margen: monto ? rent / monto : 0 };
}

function metricasEmpleados(ref) {
    const [a, b] = range('mes', ref);
    return S.empleados.map(e => {
        const hs = S.horas.filter(h => h.empleadoId === e.id && h.fecha >= a && h.fecha <= b);
        const horas = hs.reduce((x, h) => x + num(h.horas), 0);
        const costo = horas * num(e.valorHora);
        const trabajos = new Set(hs.map(h => h.trabajoId).filter(Boolean)).size;
        const pagado = S.movimientos.filter(m => m.categoria === 'Pagos empleados' && m.empleadoId === e.id && m.fecha >= a && m.fecha <= b).reduce((x, m) => x + num(m.monto), 0);
        return { e, horas, costo, trabajos, pagado, pendiente: costo - pagado };
    });
}

/* Monotributo y alertas */
function monoVence() {
    const [y, m] = todayISO().split('-').map(Number);
    return { y, m };
}
function monoEstado(e) {
    if (!e.monoCat && !num(e.monoMonto)) return null;
    const t = todayISO(), ym = t.slice(0, 7);
    if ((e.monoPagado || '') >= ym) return { txt: 'Al día', cls: 'ok' };
    const { y, m } = monoVence();
    const dia = Math.min(num(e.monoDia) || 20, new Date(y, m, 0).getDate());
    const v = `${y}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const dd = diffDays(t, v);
    if (dd < 0) return { txt: `Vencido hace ${-dd} d`, cls: 'bad', lvl: 'red', v };
    if (dd <= 7) return { txt: dd === 0 ? 'Vence hoy' : `Vence en ${dd} d`, cls: 'warn', lvl: 'amber', v };
    return { txt: `Vence el ${fdate(v)}`, cls: '', v };
}
function alertas() {
    const out = [], hoy = todayISO();
    S.empleados.forEach(e => { const s = monoEstado(e); if (s && s.lvl) out.push({ lvl: s.lvl, txt: `Monotributo de ${e.nombre}: ${s.txt.toLowerCase()}`, f: s.v }); });
    S.vencimientos.filter(v => !v.pagado).forEach(v => {
        const dd = diffDays(hoy, v.fecha);
        if (dd < 0) out.push({ lvl: 'red', txt: `${v.concepto}: vencido hace ${-dd} d (${money(v.monto)})`, f: v.fecha });
        else if (dd <= 7) out.push({ lvl: 'amber', txt: `${v.concepto}: vence ${dd === 0 ? 'hoy' : 'en ' + dd + ' d'} (${money(v.monto)})`, f: v.fecha });
    });
    S.trabajos.filter(t => t.estado === 'Finalizado').forEach(t => { const s = saldoTrabajo(t); if (s > 0.5) out.push({ lvl: 'info', txt: `Cobro pendiente: ${LBL.trabajos(t)} — ${money(s)}`, f: t.fecha }); });
    const o = { red: 0, amber: 1, info: 2 };
    return out.sort((a, b) => o[a.lvl] - o[b.lvl] || (a.f || '').localeCompare(b.f || ''));
}

/* ═══════════════ Definición de entidades ═══════════════ */
const ESTADOS = { Aprobado: 'ok', Finalizado: 'ok', Disponible: 'ok', Pendiente: 'warn', 'En curso': 'info', 'En uso': 'info', Rechazado: 'bad', Cancelado: 'bad', 'En reparación': 'warn', Perdida: 'bad' };
const MEDIOS = ['', 'Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Cheque', 'Otro'];

const ENT = {
    empleados: {
        singular: 'empleado', plural: 'empleados', sort: (a, b) => a.nombre.localeCompare(b.nombre),
        fields: [
            { k: 'nombre', l: 'Nombre', t: 'text', req: 1, list: 1 },
            { k: 'rol', l: 'Rol', t: 'text', list: 1 },
            { k: 'horario', l: 'Horario habitual', t: 'text', ph: 'Lun a Vie 8 a 17', list: 1 },
            { k: 'valorHora', l: 'Valor hora ($)', t: 'number', money: 1, list: 1 },
            { k: 'monoCat', l: 'Monotributo: categoría', t: 'select', opts: ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'], list: 1 },
            { k: 'monoMonto', l: 'Monotributo: cuota mensual ($)', t: 'number', money: 1, list: 1 },
            { k: 'monoDia', l: 'Monotributo: día de vencimiento', t: 'number', def: 20 },
            { k: 'monoPagado', l: 'Monotributo pagado hasta (mes)', t: 'month' },
        ],
        extra: [{ l: 'Estado monotributo', f: e => { const s = monoEstado(e); return s ? `<span class="badge ${s.cls}">${esc(s.txt)}</span>` : ''; } }],
        actions: [
            { l: 'Marcar monotributo pagado', show: e => !!monoEstado(e) && (e.monoPagado || '') < todayISO().slice(0, 7), run: e => { e.monoPagado = todayISO().slice(0, 7); } },
            { l: 'Registrar pago', run: e => openForm('movimientos', null, { categoria: 'Pagos empleados', empleadoId: e.id, concepto: `Pago a ${e.nombre}` }), noSave: 1 },
        ],
    },
    horas: {
        singular: 'registro de horas', plural: 'registros de horas',
        fields: [
            { k: 'fecha', l: 'Fecha', t: 'date', def: 'hoy', req: 1, list: 1 },
            { k: 'empleadoId', l: 'Empleado', t: 'select', ref: 'empleados', req: 1, list: 1 },
            { k: 'trabajoId', l: 'Trabajo', t: 'select', ref: 'trabajos', list: 1 },
            { k: 'horas', l: 'Horas', t: 'number', req: 1, list: 1 },
            { k: 'nota', l: 'Nota', t: 'text', full: 1, list: 1 },
        ],
        extra: [{ l: 'Costo', n: 1, f: h => money(num(h.horas) * num((byId('empleados', h.empleadoId) || {}).valorHora)) }],
    },
    herramientas: {
        singular: 'herramienta', plural: 'herramientas', sort: (a, b) => a.nombre.localeCompare(b.nombre),
        fields: [
            { k: 'nombre', l: 'Herramienta', t: 'text', req: 1, list: 1 },
            { k: 'estado', l: 'Estado', t: 'select', opts: ['Disponible', 'En uso', 'En reparación', 'Perdida'], badge: 1, list: 1 },
            { k: 'asignadoA', l: 'Asignada a', t: 'select', ref: 'empleados', list: 1 },
            { k: 'notas', l: 'Notas', t: 'text', full: 1, list: 1 },
        ],
    },
    agenda: {
        singular: 'turno / tarea', plural: 'turnos o tareas', sort: (a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')),
        fields: [
            { k: 'fecha', l: 'Fecha', t: 'date', def: 'hoy', req: 1, list: 1 },
            { k: 'hora', l: 'Hora', t: 'time', list: 1 },
            { k: 'titulo', l: 'Tarea / visita', t: 'text', req: 1, full: 1, list: 1 },
            { k: 'clienteId', l: 'Cliente', t: 'select', ref: 'clientes', list: 1 },
            { k: 'trabajoId', l: 'Trabajo', t: 'select', ref: 'trabajos' },
            { k: 'hecho', l: 'Realizada', t: 'checkbox', list: 1 },
        ],
        actions: [{ l: 'Marcar hecha', show: a => !a.hecho, run: a => { a.hecho = true; } }],
    },
    clientes: {
        singular: 'cliente', plural: 'clientes', sort: (a, b) => a.nombre.localeCompare(b.nombre),
        fields: [
            { k: 'nombre', l: 'Nombre', t: 'text', req: 1, full: 1, list: 1 },
            { k: 'tel', l: 'Teléfono', t: 'text', list: 1 },
            { k: 'email', l: 'Email', t: 'text' },
            { k: 'dir', l: 'Dirección', t: 'text', full: 1, list: 1 },
        ],
    },
    proveedores: {
        singular: 'proveedor', plural: 'proveedores', sort: (a, b) => a.nombre.localeCompare(b.nombre),
        fields: [
            { k: 'nombre', l: 'Proveedor', t: 'text', req: 1, list: 1 },
            { k: 'rubro', l: 'Rubro', t: 'text', ph: 'Ej: Gas, Eléctrico, Sanitarios', list: 1 },
            { k: 'tel', l: 'Teléfono', t: 'text', list: 1 },
        ],
    },
    presupuestos: {
        singular: 'presupuesto', plural: 'presupuestos',
        fields: [
            { k: 'fecha', l: 'Fecha', t: 'date', def: 'hoy', req: 1, list: 1 },
            { k: 'clienteId', l: 'Cliente', t: 'select', ref: 'clientes', req: 1, list: 1 },
            { k: 'descripcion', l: 'Descripción', t: 'text', req: 1, full: 1, list: 1 },
            { k: 'monto', l: 'Monto ($)', t: 'number', money: 1, req: 1, list: 1 },
            { k: 'estado', l: 'Estado', t: 'select', opts: ['Pendiente', 'Aprobado', 'Rechazado'], badge: 1, list: 1 },
        ],
        extra: [{ l: 'Trabajo', f: p => (p.trabajoId && byId('trabajos', p.trabajoId) ? '<span class="badge ok">Convertido</span>' : '') }],
        actions: [
            { l: 'Aprobar', show: p => p.estado === 'Pendiente', run: p => { p.estado = 'Aprobado'; } },
            {
                l: 'Convertir en trabajo', show: p => p.estado === 'Aprobado' && !(p.trabajoId && byId('trabajos', p.trabajoId)),
                run: p => { const t = { id: uid(), fecha: todayISO(), clienteId: p.clienteId, descripcion: p.descripcion, monto: p.monto, estado: 'En curso', presupuestoId: p.id }; S.trabajos.push(t); p.trabajoId = t.id; toast('Trabajo creado a partir del presupuesto'); },
            },
        ],
    },
    trabajos: {
        singular: 'trabajo', plural: 'trabajos',
        fields: [
            { k: 'fecha', l: 'Fecha de inicio', t: 'date', def: 'hoy', req: 1, list: 1 },
            { k: 'clienteId', l: 'Cliente', t: 'select', ref: 'clientes', req: 1, list: 1 },
            { k: 'descripcion', l: 'Descripción', t: 'text', req: 1, full: 1, list: 1 },
            { k: 'monto', l: 'Monto acordado ($)', t: 'number', money: 1, req: 1, list: 1 },
            { k: 'estado', l: 'Estado', t: 'select', opts: ['En curso', 'Finalizado', 'Cancelado'], badge: 1, list: 1 },
        ],
        extra: [
            { l: 'Cobrado', n: 1, f: t => money(cobradoTr(t.id)) },
            { l: 'Saldo', n: 1, f: t => { const s = saldoTrabajo(t); return `<span class="${s > 0.5 ? 'neg' : 'pos'}">${money(s)}</span>`; } },
        ],
        actions: [
            { l: 'Registrar cobro', show: t => t.estado !== 'Cancelado', noSave: 1, run: t => openForm('movimientos', null, { categoria: 'Cobro de trabajos', trabajoId: t.id, clienteId: t.clienteId, concepto: `Cobro: ${t.descripcion}`, monto: Math.max(0, saldoTrabajo(t)) || '' }) },
            { l: 'Finalizar', show: t => t.estado === 'En curso', run: t => { t.estado = 'Finalizado'; } },
        ],
    },
    movimientos: {
        singular: 'movimiento', plural: 'movimientos',
        fields: [
            { k: 'fecha', l: 'Fecha', t: 'date', def: 'hoy', req: 1 },
            { k: 'categoria', l: 'Categoría', t: 'select', groups: { Ingresos: CATS.Ingreso, Egresos: CATS.Egreso }, req: 1 },
            { k: 'concepto', l: 'Concepto', t: 'text', req: 1, full: 1 },
            { k: 'monto', l: 'Importe ($)', t: 'number', money: 1, req: 1 },
            { k: 'medio', l: 'Medio de pago', t: 'select', opts: MEDIOS },
            { k: 'trabajoId', l: 'Trabajo', t: 'select', ref: 'trabajos' },
            { k: 'clienteId', l: 'Cliente', t: 'select', ref: 'clientes' },
            { k: 'proveedorId', l: 'Proveedor', t: 'select', ref: 'proveedores' },
            { k: 'empleadoId', l: 'Empleado', t: 'select', ref: 'empleados' },
            { k: 'rubro', l: 'Rubro', t: 'text', ph: 'Ej: Gas, Materiales, Combustible' },
            { k: 'nroFactura', l: 'Nº de factura', t: 'text' },
        ],
        before(m) {
            m.tipo = tipoDe(m.categoria);
            if (m.trabajoId && !m.clienteId) { const t = byId('trabajos', m.trabajoId); if (t) m.clienteId = t.clienteId; }
        },
    },
    vencimientos: {
        singular: 'vencimiento', plural: 'vencimientos', sort: (a, b) => a.fecha.localeCompare(b.fecha),
        fields: [
            { k: 'fecha', l: 'Vence', t: 'date', def: 'hoy', req: 1, list: 1 },
            { k: 'concepto', l: 'Concepto', t: 'text', req: 1, full: 1, list: 1, ph: 'Ej: Matrícula, Seguro, Alquiler, Cuota' },
            { k: 'monto', l: 'Importe ($)', t: 'number', money: 1, list: 1 },
            { k: 'pagado', l: 'Pagado', t: 'checkbox', list: 1 },
        ],
        actions: [{ l: 'Marcar pagado', show: v => !v.pagado, run: v => { v.pagado = true; } }],
    },
};

/* ═══════════════ Interfaz: piezas comunes ═══════════════ */
const NAV = [
    { g: 'Dirección General', items: [['resumen', 'Resumen y balances']] },
    { g: 'Gestor de Operaciones', items: [['empleados', 'Empleados y monotributo'], ['horas', 'Horas de trabajo'], ['herramientas', 'Herramientas'], ['agenda', 'Agenda y horarios']] },
    { g: 'Gestor Comercial', items: [['clientes', 'Clientes'], ['presupuestos', 'Presupuestos'], ['trabajos', 'Trabajos'], ['cuentas', 'Estado de cuenta']] },
    { g: 'Centro Operativo y Caja', items: [['libro', 'Libro de caja'], ['proveedores', 'Proveedores y compras']] },
    { g: 'Reporte y Métricas', items: [['rentabilidad', 'Rentabilidad por trabajo'], ['flujo', 'Flujo de caja'], ['metricas', 'Métricas de empleados'], ['alertas', 'Alertas y vencimientos']] },
    { g: 'Sistema', items: [['datos', 'Respaldo y datos']] },
];
const ui = { view: 'resumen', ref: todayISO(), periodo: 'mes', cuenta: '' };

const head = (t, sub, actions = '') => `<div class="page-head"><div><h1>${t}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="head-actions">${actions}</div></div>`;
const btn = (label, attrs, c = 'btn-primary') => `<button class="btn ${c}" ${attrs}>${label}</button>`;
const newBtn = (ent, label, def, c) => btn(label, `data-a="new" data-ent="${ent}"${def ? ` data-def='${esc(JSON.stringify(def))}'` : ''}`, c);
const toolbar = (extra = '') => `<div class="toolbar"><label>Fecha de referencia <input type="date" id="ref" value="${ui.ref}"></label><button class="btn btn-ghost" data-a="hoy">Hoy</button>${extra}</div>`;
const rowBtns = (ent, id, extra = '') => `${extra}<button class="mini" data-a="edit" data-ent="${ent}" data-id="${id}">Editar</button><button class="mini del" data-a="del" data-ent="${ent}" data-id="${id}">Borrar</button>`;
const badge = (txt, c) => `<span class="badge ${c || ''}">${esc(txt)}</span>`;
const empty = msg => `<div class="table-wrap"><div class="empty">${msg}</div></div>`;

function cell(f, it) {
    const v = it[f.k];
    if (f.t === 'select' && f.ref) return esc(nm(f.ref, v));
    if (f.badge) return v ? badge(v, ESTADOS[v]) : '';
    if (f.money) return v === '' || v == null ? '' : money(v);
    if (f.t === 'date') return fdate(v);
    if (f.t === 'month') return fmonth(v);
    if (f.t === 'checkbox') return v ? '✔' : '';
    return esc(v);
}

function entTable(name, rows) {
    const E = ENT[name];
    const items = (rows || S[name]).slice().sort(E.sort || ((a, b) => (b.fecha || '').localeCompare(a.fecha || '')));
    if (!items.length) return empty(`Todavía no hay ${E.plural}. Usá el botón “+ Nuevo” para cargar el primero.`);
    const cols = E.fields.filter(f => f.list), extra = E.extra || [];
    const isN = f => f.money || f.t === 'number';
    const th = cols.map(f => `<th class="${isN(f) ? 'n' : ''}">${f.l}</th>`).join('') + extra.map(x => `<th class="${x.n ? 'n' : ''}">${x.l}</th>`).join('') + '<th></th>';
    const tr = items.map(it => {
        const acts = (E.actions || []).map((a, i) => (!a.show || a.show(it) ? `<button class="mini" data-a="act" data-ent="${name}" data-id="${it.id}" data-i="${i}">${a.l}</button>` : '')).join('');
        return `<tr>${cols.map(f => `<td class="${isN(f) ? 'n' : ''}">${cell(f, it)}</td>`).join('')}${extra.map(x => `<td class="${x.n ? 'n' : ''}">${x.f(it)}</td>`).join('')}<td>${rowBtns(name, it.id, acts)}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}
const vEntity = (name, title, sub) => head(title, sub, newBtn(name, '+ Nuevo')) + entTable(name);

/* ═══════════════ Gráficos ═══════════════ */
const C = { ing: '#15803d', egr: '#b91c1c', navy: '#1F3A5F', blue: '#2563EB' };
const PALETTE = ['#1F3A5F', '#2563EB', '#0e7490', '#b45309', '#7c3aed', '#be185d', '#4d7c0f', '#6B7280'];
const charts = {}, pending = [];
const chartBox = (id, fn, h) => { pending.push([id, fn]); return `<div class="chartbox"${h ? ` style="height:${h}px"` : ''}><canvas id="${id}"></canvas></div>`; };
function flushCharts() {
    pending.splice(0).forEach(([id, fn]) => { const el = document.getElementById(id); if (el && typeof Chart !== 'undefined') charts[id] = new Chart(el, fn()); });
}
const axisMoney = v => '$' + Number(v).toLocaleString('es-AR');
function baseOpts(title, noScales) {
    const o = { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: title, font: { size: 13 } }, legend: { position: 'bottom' } } };
    if (!noScales) o.scales = { y: { ticks: { callback: axisMoney } } };
    return o;
}
function cfgDiario(ref) {
    const [a, b] = range('mes', ref), days = [];
    for (let d = a; d <= b; d = addDays(d, 1)) days.push(d);
    const t = days.map(d => totals(d, d));
    const m = parse(ref);
    return { type: 'bar', data: { labels: days.map(d => d.slice(8)), datasets: [{ label: 'Ingresos', data: t.map(x => x.i), backgroundColor: C.ing }, { label: 'Egresos', data: t.map(x => x.e), backgroundColor: C.egr }] }, options: baseOpts(`Ingresos y egresos por día — ${MESES[m.getMonth()]} ${m.getFullYear()}`) };
}
function cfgCategorias(ref) {
    const [a, b] = range('mes', ref);
    const data = CATS.Egreso.map(c => S.movimientos.filter(m => m.categoria === c && m.fecha >= a && m.fecha <= b).reduce((x, m) => x + num(m.monto), 0));
    return { type: 'doughnut', data: { labels: CATS.Egreso, datasets: [{ data, backgroundColor: PALETTE }] }, options: baseOpts('Egresos del mes por categoría', true) };
}
function flujoRows(ref, n = 6) {
    return lastMonths(ref, n).map(m => { const [a, b] = range('mes', m); const t = totals(a, b); return { m, a, b, ...t, saldo: saldoAntes(addDays(b, 1)) }; });
}
function cfgFlujo(ref) {
    const r = flujoRows(ref);
    const lab = r.map(x => `${MESES[parse(x.m).getMonth()].slice(0, 3)} ${x.m.slice(2, 4)}`);
    return {
        type: 'bar',
        data: { labels: lab, datasets: [{ type: 'bar', label: 'Ingresos', data: r.map(x => x.i), backgroundColor: C.ing }, { type: 'bar', label: 'Egresos', data: r.map(x => x.e), backgroundColor: C.egr }, { type: 'line', label: 'Saldo acumulado', data: r.map(x => x.saldo), borderColor: C.navy, backgroundColor: C.navy, tension: .25 }] },
        options: baseOpts('Flujo de caja — últimos 6 meses'),
    };
}
function cfgRentab() {
    const ts = S.trabajos.filter(t => t.estado !== 'Cancelado');
    const short = s => (s.length > 22 ? s.slice(0, 21) + '…' : s);
    return { type: 'bar', data: { labels: ts.map(t => short(LBL.trabajos(t))), datasets: [{ label: 'Rentabilidad ($)', data: ts.map(t => rentab(t).rent), backgroundColor: ts.map(t => (rentab(t).rent >= 0 ? C.ing : C.egr)) }] }, options: { ...baseOpts('Rentabilidad por trabajo'), plugins: { title: { display: true, text: 'Rentabilidad por trabajo' }, legend: { display: false } } } };
}
function cfgHoras(ref) {
    const r = metricasEmpleados(ref);
    return { type: 'bar', data: { labels: r.map(x => x.e.nombre), datasets: [{ label: 'Horas del mes', data: r.map(x => x.horas), backgroundColor: C.blue }] }, options: { ...baseOpts('Horas trabajadas en el mes'), scales: { y: { beginAtZero: true } }, plugins: { title: { display: true, text: 'Horas trabajadas en el mes' }, legend: { display: false } } } };
}

/* ═══════════════ Vistas ═══════════════ */
function alertList(list) {
    if (!list.length) return '<p class="hint">Sin alertas por ahora. ✔</p>';
    const ic = { red: '⛔', amber: '⚠️', info: 'ℹ️' };
    return `<ul class="alerts">${list.map(a => `<li class="${a.lvl}"><span>${ic[a.lvl]}</span><span>${esc(a.txt)}</span><small>${fdate(a.f)}</small></li>`).join('')}</ul>`;
}

function vResumen() {
    const r = ui.ref;
    const card = (label, p) => {
        const [a, b] = range(p, r), t = totals(a, b);
        return `<div class="card"><div class="label">${label}</div><div class="big ${cls(t.b)}">${money(t.b)}</div><div class="sub"><span>Ingresos ${money(t.i)}</span><span>Egresos ${money(t.e)}</span></div><div class="sub" style="margin-top:3px"><span>${a === b ? fdate(a) : fdate(a) + ' al ' + fdate(b)}</span></div></div>`;
    };
    const al = alertas();
    return head('Resumen y balances', 'Dirección General — caja del día, la semana y el mes.', newBtn('movimientos', '+ Ingreso', { categoria: 'Cobro de trabajos' }) + newBtn('movimientos', '+ Egreso', { categoria: 'Proveedores y compras' }, 'btn-ghost'))
        + toolbar()
        + `<div class="grid grid-4">${card('Balance del día', 'dia')}${card('Balance de la semana', 'semana')}${card('Balance del mes', 'mes')}
            <div class="card"><div class="label">Saldo total en caja</div><div class="big ${cls(saldoTotal())}">${money(saldoTotal())}</div><div class="sub"><span>Acumulado de todos los movimientos</span></div></div></div>`
        + `<div class="grid grid-2"><div class="panel">${chartBox('c_diario', () => cfgDiario(r))}</div><div class="panel">${chartBox('c_cat', () => cfgCategorias(r))}</div></div>`
        + `<div class="panel"><h2>Alertas</h2>${alertList(al.slice(0, 5))}${al.length > 5 ? `<p class="hint"><a href="#alertas">Ver las ${al.length} alertas →</a></p>` : ''}</div>`;
}

function detalleMov(m) {
    const p = [m.trabajoId ? nm('trabajos', m.trabajoId) : nm('clientes', m.clienteId), nm('proveedores', m.proveedorId), nm('empleados', m.empleadoId), m.rubro, m.nroFactura ? 'Fact. ' + m.nroFactura : '', m.medio];
    return p.filter(Boolean).join(' · ');
}

function vLibro() {
    const [a, b] = range(ui.periodo, ui.ref);
    const items = S.movimientos.filter(m => m.fecha >= a && m.fecha <= b).sort(cmpMov);
    const ini = ui.periodo === 'todo' ? 0 : saldoAntes(a);
    let saldo = ini, ti = 0, te = 0;
    const rows = items.map(m => {
        const ing = m.tipo === 'Ingreso', v = num(m.monto);
        saldo += ing ? v : -v; if (ing) ti += v; else te += v;
        return `<tr><td>${fdate(m.fecha)}</td><td>${esc(m.concepto)}</td><td>${badge(m.categoria, ing ? 'ok' : 'bad')}</td><td>${esc(detalleMov(m))}</td><td class="n pos">${ing ? money(v) : ''}</td><td class="n neg">${ing ? '' : money(v)}</td><td class="n ${cls(saldo)}">${money(saldo)}</td><td>${rowBtns('movimientos', m.id)}</td></tr>`;
    }).join('');
    const per = { dia: 'Día', semana: 'Semana (lunes a domingo)', mes: 'Mes', todo: 'Todo el historial' };
    const sel = `<label>Período <select id="periodo">${Object.entries(per).map(([k, v]) => `<option value="${k}"${k === ui.periodo ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`;
    const table = `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Detalle</th><th class="n">Entrada</th><th class="n">Salida</th><th class="n">Saldo</th><th></th></tr></thead><tbody>
        ${ui.periodo !== 'todo' ? `<tr><td colspan="6"><i>Saldo inicial (arrastrado)</i></td><td class="n">${money(ini)}</td><td></td></tr>` : ''}${rows || `<tr><td colspan="8" class="empty">No hay movimientos en este período.</td></tr>`}</tbody>
        <tfoot><tr><td colspan="4">Totales del período</td><td class="n pos">${money(ti)}</td><td class="n neg">${money(te)}</td><td class="n">${money(saldo)}</td><td></td></tr></tfoot></table></div>`;
    return head('Libro de caja', `${per[ui.periodo]}: ${ui.periodo === 'todo' ? 'todos los movimientos' : a === b ? fdate(a) : fdate(a) + ' al ' + fdate(b)} — Balance del período: <b class="${cls(ti - te)}">${money(ti - te)}</b>`,
        newBtn('movimientos', '+ Ingreso', { categoria: 'Cobro de trabajos' }) + newBtn('movimientos', '+ Egreso', { categoria: 'Proveedores y compras' }, 'btn-ghost'))
        + toolbar(sel) + table
        + '<p class="hint">Cobros de trabajos, pagos a empleados, pago de deudas, compras a proveedores y facturas recibidas se cargan acá, cada uno con su categoría.</p>';
}

function vProveedores() {
    const compras = S.movimientos.filter(m => m.categoria === 'Proveedores y compras' || m.categoria === 'Facturas recibidas').sort((a, b) => b.fecha.localeCompare(a.fecha));
    const porRubro = {};
    compras.forEach(m => { const k = m.rubro || (byId('proveedores', m.proveedorId) || {}).rubro || 'Sin rubro'; porRubro[k] = (porRubro[k] || 0) + num(m.monto); });
    const rub = Object.entries(porRubro).sort((a, b) => b[1] - a[1]);
    const tr = compras.map(m => `<tr><td>${fdate(m.fecha)}</td><td>${esc(nm('proveedores', m.proveedorId))}</td><td>${esc(m.rubro || '')}</td><td>${esc(m.nroFactura || '')}</td><td>${esc(m.concepto)}</td><td class="n">${money(m.monto)}</td><td>${rowBtns('movimientos', m.id)}</td></tr>`).join('');
    return head('Proveedores y compras', 'Listado de proveedores, compras y facturas recibidas por rubro.', newBtn('proveedores', '+ Proveedor', null, 'btn-ghost') + newBtn('movimientos', '+ Compra / factura', { categoria: 'Proveedores y compras' }))
        + entTable('proveedores')
        + `<div class="panel" style="margin-top:1rem"><h2>Compras y facturas recibidas</h2>${compras.length ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Rubro</th><th>Factura</th><th>Concepto</th><th class="n">Importe</th><th></th></tr></thead><tbody>${tr}</tbody></table></div>` : '<p class="hint">Todavía no hay compras cargadas.</p>'}</div>`
        + (rub.length ? `<div class="panel"><h2>Total por rubro</h2><div class="table-wrap"><table><thead><tr><th>Rubro</th><th class="n">Total</th></tr></thead><tbody>${rub.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${money(v)}</td></tr>`).join('')}</tbody></table></div></div>` : '');
}

function vCuentas() {
    if (!S.clientes.length) return head('Estado de cuenta', 'Saldos de cada cliente.') + empty('Primero cargá clientes y trabajos.');
    const rows = S.clientes.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(c => {
        const f = facturadoCli(c.id), co = cobradoCli(c.id), s = f - co;
        return `<tr><td>${esc(c.nombre)}</td><td class="n">${money(f)}</td><td class="n">${money(co)}</td><td class="n ${s > 0.5 ? 'neg' : 'pos'}">${money(s)}</td><td><button class="mini" data-a="cuenta" data-id="${c.id}">Ver detalle</button></td></tr>`;
    }).join('');
    const tot = S.clientes.reduce((a, c) => a + facturadoCli(c.id) - cobradoCli(c.id), 0);
    let det = '';
    const cl = ui.cuenta && byId('clientes', ui.cuenta);
    if (cl) {
        const ev = [];
        S.trabajos.filter(t => t.clienteId === cl.id && t.estado !== 'Cancelado').forEach(t => ev.push({ f: t.fecha, c: `Trabajo: ${t.descripcion}`, d: num(t.monto), h: 0 }));
        S.movimientos.filter(m => m.tipo === 'Ingreso' && m.clienteId === cl.id).forEach(m => ev.push({ f: m.fecha, c: `Cobro: ${m.concepto}`, d: 0, h: num(m.monto) }));
        ev.sort((x, y) => x.f.localeCompare(y.f));
        let s = 0;
        det = `<div class="panel" style="margin-top:1rem"><h2>Detalle — ${esc(cl.nombre)}</h2><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th class="n">Debe (trabajos)</th><th class="n">Haber (cobros)</th><th class="n">Saldo</th></tr></thead><tbody>${ev.map(x => { s += x.d - x.h; return `<tr><td>${fdate(x.f)}</td><td>${esc(x.c)}</td><td class="n">${x.d ? money(x.d) : ''}</td><td class="n">${x.h ? money(x.h) : ''}</td><td class="n">${money(s)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Sin movimientos.</td></tr>'}</tbody></table></div></div>`;
    }
    return head('Estado de cuenta', 'Lo facturado (trabajos), lo cobrado y el saldo que debe cada cliente.')
        + `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th class="n">Facturado</th><th class="n">Cobrado</th><th class="n">Saldo a cobrar</th><th></th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3">Total a cobrar</td><td class="n">${money(tot)}</td><td></td></tr></tfoot></table></div>` + det;
}

function vRentab() {
    const ts = S.trabajos.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
    if (!ts.length) return head('Rentabilidad por trabajo') + empty('Cargá trabajos para ver su rentabilidad.');
    const tot = { monto: 0, cobrado: 0, compras: 0, mo: 0, costo: 0, rent: 0 };
    const rows = ts.map(t => {
        const r = rentab(t); if (t.estado !== 'Cancelado') Object.keys(tot).forEach(k => { tot[k] += r[k]; });
        return `<tr><td>${esc(LBL.trabajos(t))}</td><td>${badge(t.estado, ESTADOS[t.estado])}</td><td class="n">${money(r.monto)}</td><td class="n">${money(r.cobrado)}</td><td class="n">${money(r.compras)}</td><td class="n">${money(r.mo)}</td><td class="n">${money(r.costo)}</td><td class="n ${cls(r.rent)}">${money(r.rent)}</td><td class="n">${pct(r.margen)}</td></tr>`;
    }).join('');
    return head('Rentabilidad por trabajo', 'Monto acordado menos costos (compras + horas del personal).')
        + `<div class="table-wrap"><table><thead><tr><th>Trabajo</th><th>Estado</th><th class="n">Monto</th><th class="n">Cobrado</th><th class="n">Compras</th><th class="n">Mano de obra</th><th class="n">Costo total</th><th class="n">Rentabilidad</th><th class="n">Margen</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">Total (sin cancelados)</td><td class="n">${money(tot.monto)}</td><td class="n">${money(tot.cobrado)}</td><td class="n">${money(tot.compras)}</td><td class="n">${money(tot.mo)}</td><td class="n">${money(tot.costo)}</td><td class="n">${money(tot.rent)}</td><td class="n">${tot.monto ? pct(tot.rent / tot.monto) : ''}</td></tr></tfoot></table></div>`
        + `<div class="panel" style="margin-top:1rem">${chartBox('c_rent', cfgRentab)}</div>`
        + '<p class="hint">Compras = egresos asignados al trabajo (sin “Pagos empleados”, para no contar dos veces). Mano de obra = horas cargadas × valor hora del empleado.</p>';
}

function vFlujo() {
    const r = flujoRows(ui.ref);
    return head('Flujo de caja', 'Ingresos, egresos y saldo acumulado de los últimos 6 meses.') + toolbar()
        + `<div class="panel">${chartBox('c_flujo', () => cfgFlujo(ui.ref))}</div>`
        + `<div class="table-wrap"><table><thead><tr><th>Mes</th><th class="n">Ingresos</th><th class="n">Egresos</th><th class="n">Balance</th><th class="n">Saldo al cierre</th></tr></thead><tbody>${r.map(x => `<tr><td>${MESES[parse(x.m).getMonth()]} ${x.m.slice(0, 4)}</td><td class="n">${money(x.i)}</td><td class="n">${money(x.e)}</td><td class="n ${cls(x.b)}">${money(x.b)}</td><td class="n">${money(x.saldo)}</td></tr>`).join('')}</tbody></table></div>`;
}

function vMetricas() {
    const r = metricasEmpleados(ui.ref), m = parse(ui.ref);
    if (!r.length) return head('Métricas de empleados') + empty('Cargá empleados y sus horas para ver métricas.');
    return head('Métricas de empleados', `${MESES[m.getMonth()]} ${m.getFullYear()} — horas, costo y pagos.`) + toolbar()
        + `<div class="panel">${chartBox('c_horas', () => cfgHoras(ui.ref), 240)}</div>`
        + `<div class="table-wrap"><table><thead><tr><th>Empleado</th><th class="n">Horas</th><th class="n">Costo de horas</th><th class="n">Trabajos</th><th class="n">Pagado en el mes</th><th class="n">Pendiente</th></tr></thead><tbody>${r.map(x => `<tr><td>${esc(x.e.nombre)}</td><td class="n">${x.horas}</td><td class="n">${money(x.costo)}</td><td class="n">${x.trabajos}</td><td class="n">${money(x.pagado)}</td><td class="n ${x.pendiente > 0.5 ? 'neg' : ''}">${money(x.pendiente)}</td></tr>`).join('')}</tbody></table></div>`;
}

function vAlertas() {
    return head('Alertas y vencimientos', 'Monotributo, pagos próximos y cobros pendientes.', newBtn('vencimientos', '+ Vencimiento'))
        + `<div class="panel"><h2>Alertas activas</h2>${alertList(alertas())}</div>` + entTable('vencimientos');
}

function vDatos() {
    const n = total(S);
    const info = REMOTE
        ? `Los datos se guardan en tu base de datos <b>Supabase</b> y se ven desde cualquier navegador al iniciar sesión (hoy: <b>${n}</b> registros). Igual conviene bajar un <b>respaldo</b> de vez en cuando y usar <b>Exportar a Excel</b> para el libro contable.`
        : `Estás en <b>modo local</b>: lo que cargues queda guardado solo en este navegador (hoy: <b>${n}</b> registros) y se pierde si se borran los datos del navegador. Para verlo desde cualquier dispositivo, completá <code>gestion/config.js</code> con los datos de Supabase (ver <code>LEEME.md</code>).`;
    return head('Respaldo y datos', REMOTE ? 'Conectado a Supabase.' : 'Modo local (sin base de datos).')
        + `<div class="panel"><h2>Dónde están los datos</h2><p style="font-size:.9rem;line-height:1.55">${info}</p></div>`
        + `<div class="panel"><h2>Acciones</h2><div class="head-actions">${btn('⬇ Descargar respaldo (JSON)', 'data-a="jsonexp"')}${btn('⬆ Restaurar respaldo', 'data-a="jsonimp"', 'btn-ghost')}${btn('Cargar datos de ejemplo', 'data-a="demo"', 'btn-ghost')}${btn('Borrar todo', 'data-a="wipe"', 'btn-danger')}</div><input type="file" id="fileImport" accept=".json,application/json" hidden></div>`;
}

const VIEWS = {
    resumen: vResumen,
    empleados: () => vEntity('empleados', 'Empleados y monotributo', 'Gestor de Operaciones — personal, valor hora, horarios y vencimiento de monotributo.'),
    horas: () => vEntity('horas', 'Horas de trabajo', 'Horas por empleado y por trabajo; alimentan costos y rentabilidad.'),
    herramientas: () => vEntity('herramientas', 'Herramientas', 'Gestión de herramientas: estado y a quién están asignadas.'),
    agenda: () => vEntity('agenda', 'Agenda y horarios', 'Visitas, turnos y tareas programadas.'),
    clientes: () => vEntity('clientes', 'Clientes', 'Gestor Comercial — base de datos de clientes.'),
    presupuestos: () => vEntity('presupuestos', 'Presupuestos', 'Pendiente → Aprobado → conversión a trabajo.'),
    trabajos: () => vEntity('trabajos', 'Trabajos', 'Historial de trabajos con lo cobrado y el saldo.'),
    cuentas: vCuentas, libro: vLibro, proveedores: vProveedores,
    rentabilidad: vRentab, flujo: vFlujo, metricas: vMetricas, alertas: vAlertas, datos: vDatos,
};

function render() {
    Object.values(charts).forEach(c => c.destroy());
    Object.keys(charts).forEach(k => delete charts[k]);
    pending.length = 0;
    if (!VIEWS[ui.view]) ui.view = 'resumen';
    $('#side').innerHTML = NAV.map(g => `<div class="nav-group">${g.g}</div>` + g.items.map(([k, l]) => `<a href="#${k}" class="${k === ui.view ? 'active' : ''}">${l}</a>`).join('')).join('');
    $('#main').innerHTML = VIEWS[ui.view]();
    flushCharts();
}

/* ═══════════════ Formularios ═══════════════ */
let ctx = null;
function inputHTML(f, v) {
    let val = v;
    if (val === undefined || val === null) val = f.def === 'hoy' ? todayISO() : (f.def ?? '');
    const req = f.req ? ' required' : '';
    if (f.t === 'select') {
        let o;
        if (f.ref) o = '<option value="">—</option>' + S[f.ref].map(x => `<option value="${x.id}"${x.id === val ? ' selected' : ''}>${esc(LBL[f.ref](x))}</option>`).join('');
        else if (f.groups) o = Object.entries(f.groups).map(([g, l]) => `<optgroup label="${g}">${l.map(c => `<option${c === val ? ' selected' : ''}>${esc(c)}</option>`).join('')}</optgroup>`).join('');
        else o = f.opts.map(c => `<option${c === val ? ' selected' : ''}>${esc(c)}</option>`).join('');
        return `<select name="${f.k}"${req}>${o}</select>`;
    }
    if (f.t === 'checkbox') return `<input type="checkbox" name="${f.k}"${val ? ' checked' : ''}>`;
    const type = { text: 'text', number: 'number', date: 'date', time: 'time', month: 'month' }[f.t] || 'text';
    return `<input type="${type}" name="${f.k}" value="${esc(val)}"${f.t === 'number' ? ' step="any" min="0"' : ''}${req}${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}>`;
}
function openForm(name, id, def = {}) {
    const E = ENT[name], it = id ? byId(name, id) : null, data = it || def || {};
    ctx = { name, id };
    $('#dlgTitle').textContent = `${id ? 'Editar' : 'Nuevo'} ${E.singular}`;
    $('#dlgBody').innerHTML = E.fields.map(f => `<div class="${f.full ? 'full' : ''}"><label>${f.l}${f.req ? ' *' : ''}</label>${inputHTML(f, data[f.k])}</div>`).join('');
    $('#dlg').showModal();
}
function submitForm(ev) {
    ev.preventDefault();
    const { name, id } = ctx, E = ENT[name], fd = new FormData($('#dlgForm'));
    const item = id ? byId(name, id) : { id: uid() };
    for (const f of E.fields) {
        let v;
        if (f.t === 'checkbox') v = fd.has(f.k);
        else { v = fd.get(f.k); v = f.t === 'number' ? (v === '' || v === null ? '' : Number(v)) : String(v ?? '').trim(); }
        item[f.k] = v;
    }
    if (E.before) E.before(item);
    if (!id) S[name].push(item);
    save(); $('#dlg').close(); render(); toast('Guardado');
}

/* ═══════════════ Eventos ═══════════════ */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-a]');
    if (!b) return;
    const { a, ent, id, i } = b.dataset;
    if (a === 'new') openForm(ent, null, b.dataset.def ? JSON.parse(b.dataset.def) : {});
    else if (a === 'edit') openForm(ent, id);
    else if (a === 'del') { if (confirm('¿Eliminar este registro? No se puede deshacer.')) { S[ent] = S[ent].filter(x => x.id !== id); save(); render(); } }
    else if (a === 'act') { const act = ENT[ent].actions[Number(i)], it = byId(ent, id); act.run(it); if (!act.noSave) { save(); render(); } }
    else if (a === 'cuenta') { ui.cuenta = id; render(); }
    else if (a === 'hoy') { ui.ref = todayISO(); render(); }
    else if (a === 'jsonexp') download(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }), `tolvar-respaldo-${todayISO()}.json`);
    else if (a === 'jsonimp') $('#fileImport').click();
    else if (a === 'demo') {
        if (REMOTE && total(S) > 0) { toast('Los datos de ejemplo solo se cargan con la base vacía.'); return; }
        if (!REMOTE && S.movimientos.length && !confirm('Esto reemplaza los datos actuales por datos de ejemplo. ¿Seguir?')) return;
        S = demo(); save(); render(); toast('Datos de ejemplo cargados');
    }
    else if (a === 'wipe') {
        const ok = REMOTE ? (prompt('Esto borra TODOS los datos de la nube para todos los usuarios.\nEscribí BORRAR para confirmar:') || '').trim() === 'BORRAR' : confirm('¿Borrar TODOS los datos de este navegador? Descargá un respaldo antes si lo necesitás.');
        if (ok) { S = EMPTY(); save(); render(); toast('Datos borrados'); }
    }
    else if (a === 'refresh') refresh(true);
    else if (a === 'logout') { if (REMOTE) sb.auth.signOut().then(() => { S = EMPTY(); snap = {}; booted = false; $('#main').innerHTML = ''; showLogin(); }); }
});
document.addEventListener('change', ev => {
    const t = ev.target;
    if (t.id === 'ref') { ui.ref = t.value || todayISO(); render(); }
    else if (t.id === 'periodo') { ui.periodo = t.value; render(); }
    else if (t.id === 'fileImport' && t.files[0]) {
        const rd = new FileReader();
        rd.onload = () => {
            try {
                const o = JSON.parse(rd.result), n = EMPTY();
                if (!o || typeof o !== 'object') throw new Error();
                Object.keys(n).forEach(k => { if (Array.isArray(o[k])) n[k] = o[k]; });
                if (confirm(REMOTE ? 'Esto reemplaza los datos de la NUBE por los del respaldo, para todos los usuarios. ¿Seguir?' : 'Esto reemplaza los datos actuales por los del respaldo. ¿Seguir?')) { S = n; save(); render(); toast('Respaldo restaurado'); }
            } catch (e) { toast('El archivo no es un respaldo válido'); }
        };
        rd.readAsText(t.files[0]); t.value = '';
    }
});
$('#dlgForm').addEventListener('submit', submitForm);
$('#dlgCancel').addEventListener('click', () => $('#dlg').close());
$('#btnExcel').addEventListener('click', () => exportExcel().catch(e => { console.error(e); toast('No se pudo generar el Excel'); }));
$('#btnMenu').addEventListener('click', () => $('#side').classList.toggle('open'));
$('#side').addEventListener('click', ev => { if (ev.target.closest('a')) $('#side').classList.remove('open'); });
window.addEventListener('hashchange', () => { ui.view = location.hash.slice(1) || 'resumen'; render(); window.scrollTo(0, 0); });

/* ═══════════════ Exportación a Excel ═══════════════ */
function chartPNG(cfg, w = 900, h = 380) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const bg = { id: 'bg', beforeDraw(c) { const x = c.ctx; x.save(); x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.restore(); } };
    const ch = new Chart(cv, { ...cfg, options: { ...cfg.options, responsive: false, animation: false, devicePixelRatio: 1 }, plugins: [bg] });
    const url = cv.toDataURL('image/png'); ch.destroy(); return url;
}

async function exportExcel() {
    if (typeof ExcelJS === 'undefined' || typeof Chart === 'undefined') { toast('No se cargaron las librerías de Excel/gráficos'); return; }
    toast('Generando Excel…');
    const ref = ui.ref, wb = new ExcelJS.Workbook();
    wb.creator = 'TOLVAR · Sistema de gestión'; wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };
    const MONEY = '"$"#,##0.00;[Red]-"$"#,##0.00', DATE = 'dd/mm/yyyy', PCT = '0.0%';
    const xd = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
    const fx = (formula, result) => ({ formula, result });

    const title = (ws, t, sub) => { ws.getCell('A1').value = t; ws.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FF1F3A5F' } }; if (sub) { ws.getCell('A2').value = sub; ws.getCell('A2').font = { italic: true, color: { argb: 'FF6B7280' } }; } };
    const headerRow = (ws, r, heads) => { const row = ws.getRow(r); heads.forEach((h, i) => { const c = row.getCell(i + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } }; c.alignment = { vertical: 'middle', wrapText: true }; }); row.height = 22; };
    const widths = (ws, w) => w.forEach((x, i) => { ws.getColumn(i + 1).width = x; });
    const fmtCol = (ws, col, from, to, f) => { for (let r = from; r <= to; r++) ws.getRow(r).getCell(col).numFmt = f; };
    const image = (ws, url, row, w = 620, h = 262) => { const id = wb.addImage({ base64: url, extension: 'png' }); ws.addImage(id, { tl: { col: 0, row }, ext: { width: w, height: h } }); };
    const [mA, mB] = range('mes', ref);

    /* — Libro de caja (se arma primero: otras hojas lo referencian) — */
    const movs = S.movimientos.slice().sort(cmpMov);
    const L0 = 5, L1 = Math.max(L0, L0 + movs.length - 1);
    const LN = "'Libro de caja'";
    const rngL = c => `${LN}!$${c}$${L0}:$${c}$${L1}`;
    const sumIf = (col, from, to) => `SUMIFS(${rngL(col)},${rngL('A')},">="&${from},${rngL('A')},"<="&${to})`;

    /* — Resumen — */
    const wsR = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
    title(wsR, 'TOLVAR — Sistema de gestión', `Balance a la fecha de referencia · generado el ${fdate(todayISO())}`);
    wsR.getCell('A3').value = 'Fecha de referencia'; wsR.getCell('B3').value = xd(ref); wsR.getCell('B3').numFmt = DATE; wsR.getCell('A3').font = { bold: true };
    headerRow(wsR, 5, ['Período', 'Desde', 'Hasta', 'Ingresos', 'Egresos', 'Balance']);
    [['Día', 'dia'], ['Semana (lun–dom)', 'semana'], ['Mes', 'mes']].forEach(([l, p], k) => {
        const r = 6 + k, [a, b] = range(p, ref), t = totals(a, b);
        wsR.getCell(`A${r}`).value = l; wsR.getCell(`B${r}`).value = xd(a); wsR.getCell(`C${r}`).value = xd(b);
        wsR.getCell(`D${r}`).value = fx(sumIf('E', `B${r}`, `C${r}`), t.i); wsR.getCell(`E${r}`).value = fx(sumIf('F', `B${r}`, `C${r}`), t.e); wsR.getCell(`F${r}`).value = fx(`D${r}-E${r}`, t.b);
    });
    fmtCol(wsR, 2, 6, 8, DATE); fmtCol(wsR, 3, 6, 8, DATE); [4, 5, 6].forEach(c => fmtCol(wsR, c, 6, 9, MONEY));
    wsR.getCell('A9').value = 'Saldo total en caja'; wsR.getCell('A9').font = { bold: true };
    wsR.getCell('F9').value = fx(`SUM(${rngL('E')})-SUM(${rngL('F')})`, saldoTotal()); wsR.getCell('F9').font = { bold: true };
    widths(wsR, [24, 14, 14, 16, 16, 16]);
    wsR.getCell('A11').value = 'Gráficos'; wsR.getCell('A11').font = { bold: true, size: 12, color: { argb: 'FF1F3A5F' } };
    image(wsR, chartPNG(cfgDiario(ref)), 11); image(wsR, chartPNG(cfgCategorias(ref), 700, 380), 26, 480, 262); image(wsR, chartPNG(cfgFlujo(ref)), 41);

    /* — Libro de caja — */
    const wsL = wb.addWorksheet('Libro de caja', { views: [{ state: 'frozen', ySplit: 4 }] });
    title(wsL, 'Libro de caja', 'Todos los movimientos en orden cronológico, con saldo acumulado.');
    headerRow(wsL, 4, ['Fecha', 'Concepto', 'Categoría', 'Detalle', 'Entrada (ingreso)', 'Salida (egreso)', 'Saldo']);
    let run = 0;
    movs.forEach((m, k) => {
        const r = L0 + k, ing = m.tipo === 'Ingreso', v = num(m.monto); run += ing ? v : -v;
        wsL.getCell(`A${r}`).value = xd(m.fecha); wsL.getCell(`B${r}`).value = m.concepto; wsL.getCell(`C${r}`).value = m.categoria; wsL.getCell(`D${r}`).value = detalleMov(m);
        wsL.getCell(`E${r}`).value = ing ? v : null; wsL.getCell(`F${r}`).value = ing ? null : v;
        wsL.getCell(`G${r}`).value = fx(k === 0 ? `N(E${r})-N(F${r})` : `G${r - 1}+N(E${r})-N(F${r})`, run);
    });
    fmtCol(wsL, 1, L0, L1, DATE); [5, 6, 7].forEach(c => fmtCol(wsL, c, L0, L1 + 1, MONEY));
    const tr = L1 + 1;
    wsL.getCell(`A${tr}`).value = 'TOTAL'; wsL.getCell(`E${tr}`).value = fx(`SUM(E${L0}:E${L1})`, movs.filter(m => m.tipo === 'Ingreso').reduce((a, m) => a + num(m.monto), 0));
    wsL.getCell(`F${tr}`).value = fx(`SUM(F${L0}:F${L1})`, movs.filter(m => m.tipo !== 'Ingreso').reduce((a, m) => a + num(m.monto), 0)); wsL.getCell(`G${tr}`).value = fx(`E${tr}-F${tr}`, saldoTotal());
    wsL.getRow(tr).font = { bold: true };
    widths(wsL, [12, 38, 24, 44, 18, 18, 18]);
    if (movs.length) wsL.autoFilter = { from: 'A4', to: `G${L1}` };

    /* — Balances día / semana / mes — */
    const wsB = wb.addWorksheet('Balances');
    title(wsB, 'Balances por día, semana y mes', 'Calculados con fórmulas sobre la hoja “Libro de caja”.');
    let r = 4;
    const block = (name, periods) => {
        wsB.getCell(`A${r}`).value = name; wsB.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: 'FF1F3A5F' } }; r++;
        headerRow(wsB, r, ['Desde', 'Hasta', 'Ingresos', 'Egresos', 'Balance', 'Acumulado']); r++;
        const first = r; let acc = 0;
        periods.forEach(([a, b]) => {
            const t = totals(a, b); acc += t.b;
            wsB.getCell(`A${r}`).value = xd(a); wsB.getCell(`B${r}`).value = xd(b);
            wsB.getCell(`C${r}`).value = fx(sumIf('E', `A${r}`, `B${r}`), t.i); wsB.getCell(`D${r}`).value = fx(sumIf('F', `A${r}`, `B${r}`), t.e);
            wsB.getCell(`E${r}`).value = fx(`C${r}-D${r}`, t.b); wsB.getCell(`F${r}`).value = fx(r === first ? `E${r}` : `F${r - 1}+E${r}`, acc);
            wsB.getCell(`A${r}`).numFmt = DATE; wsB.getCell(`B${r}`).numFmt = DATE; [3, 4, 5, 6].forEach(c => { wsB.getRow(r).getCell(c).numFmt = MONEY; });
            r++;
        });
        r += 2;
    };
    const days = []; for (let d = mA; d <= mB; d = addDays(d, 1)) days.push([d, d]);
    block(`Por día — ${MESES[parse(ref).getMonth()]} ${parse(ref).getFullYear()}`, days);
    block('Por semana — últimas 8 (lunes a domingo)', lastWeeks(ref, 8).map(a => [a, addDays(a, 6)]));
    block('Por mes — últimos 12', lastMonths(ref, 12).map(m => range('mes', m)));
    widths(wsB, [14, 14, 18, 18, 18, 18]);

    /* — Rentabilidad — */
    const wsT = wb.addWorksheet('Rentabilidad');
    title(wsT, 'Rentabilidad por trabajo', 'Costo = compras asignadas al trabajo + horas × valor hora.');
    headerRow(wsT, 4, ['Trabajo', 'Estado', 'Monto acordado', 'Cobrado', 'Compras', 'Mano de obra', 'Costo total', 'Rentabilidad', 'Margen']);
    const ts = S.trabajos.slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
    ts.forEach((t, k) => {
        const q = 5 + k, x = rentab(t);
        wsT.getCell(`A${q}`).value = LBL.trabajos(t); wsT.getCell(`B${q}`).value = t.estado; wsT.getCell(`C${q}`).value = x.monto; wsT.getCell(`D${q}`).value = x.cobrado; wsT.getCell(`E${q}`).value = x.compras; wsT.getCell(`F${q}`).value = x.mo;
        wsT.getCell(`G${q}`).value = fx(`E${q}+F${q}`, x.costo); wsT.getCell(`H${q}`).value = fx(`C${q}-G${q}`, x.rent); wsT.getCell(`I${q}`).value = fx(`IF(C${q}=0,0,H${q}/C${q})`, x.margen);
        for (let c = 3; c <= 8; c++) wsT.getRow(q).getCell(c).numFmt = MONEY; wsT.getCell(`I${q}`).numFmt = PCT;
    });
    widths(wsT, [44, 14, 18, 16, 16, 16, 16, 16, 10]);
    if (ts.some(t => t.estado !== 'Cancelado')) image(wsT, chartPNG(cfgRentab()), 6 + ts.length);

    /* — Métricas de empleados — */
    const wsM = wb.addWorksheet('Métricas empleados');
    title(wsM, 'Métricas de empleados', `${MESES[parse(ref).getMonth()]} ${parse(ref).getFullYear()}`);
    headerRow(wsM, 4, ['Empleado', 'Horas', 'Costo de horas', 'Trabajos', 'Pagado en el mes', 'Pendiente']);
    const me = metricasEmpleados(ref);
    me.forEach((x, k) => {
        const q = 5 + k;
        wsM.getCell(`A${q}`).value = x.e.nombre; wsM.getCell(`B${q}`).value = x.horas; wsM.getCell(`C${q}`).value = x.costo; wsM.getCell(`D${q}`).value = x.trabajos; wsM.getCell(`E${q}`).value = x.pagado; wsM.getCell(`F${q}`).value = fx(`C${q}-E${q}`, x.pendiente);
        [3, 5, 6].forEach(c => { wsM.getRow(q).getCell(c).numFmt = MONEY; });
    });
    widths(wsM, [28, 10, 18, 10, 18, 18]);
    if (me.length) image(wsM, chartPNG(cfgHoras(ref)), 6 + me.length);

    /* — Hojas por entidad — */
    const cellVal = (f, v) => {
        if (v === undefined || v === null || v === '') return null;
        if (f.t === 'date') return xd(v);
        if (f.t === 'select' && f.ref) return nm(f.ref, v);
        if (f.t === 'checkbox') return v ? 'Sí' : 'No';
        if (f.t === 'month') return fmonth(v);
        return v;
    };
    const entSheet = (sheet, name, extraHeads = [], extraVals = () => []) => {
        const E = ENT[name], ws = wb.addWorksheet(sheet);
        title(ws, sheet);
        headerRow(ws, 4, [...E.fields.map(f => f.l), ...extraHeads]);
        const items = S[name].slice().sort(E.sort || ((a, b) => (a.fecha || '').localeCompare(b.fecha || '')));
        items.forEach((it, k) => {
            const q = 5 + k, row = ws.getRow(q);
            E.fields.forEach((f, i) => { const c = row.getCell(i + 1); c.value = cellVal(f, it[f.k]); if (f.t === 'date') c.numFmt = DATE; if (f.money) c.numFmt = MONEY; });
            extraVals(it).forEach((v, j) => { const c = row.getCell(E.fields.length + j + 1); c.value = v; c.numFmt = MONEY; });
        });
        ws.columns.forEach(c => { c.width = 18; });
        E.fields.forEach((f, i) => { if (f.full || f.k === 'concepto' || f.k === 'nombre') ws.getColumn(i + 1).width = 34; });
        if (items.length) ws.autoFilter = { from: 'A4', to: `${String.fromCharCode(64 + E.fields.length + extraHeads.length)}${4 + items.length}` };
    };
    entSheet('Clientes', 'clientes', ['Facturado', 'Cobrado', 'Saldo a cobrar'], c => [facturadoCli(c.id), cobradoCli(c.id), facturadoCli(c.id) - cobradoCli(c.id)]);
    entSheet('Presupuestos', 'presupuestos');
    entSheet('Trabajos', 'trabajos', ['Cobrado', 'Saldo'], t => [cobradoTr(t.id), saldoTrabajo(t)]);
    entSheet('Empleados', 'empleados');
    entSheet('Horas', 'horas', ['Costo'], h => [num(h.horas) * num((byId('empleados', h.empleadoId) || {}).valorHora)]);
    entSheet('Herramientas', 'herramientas');
    entSheet('Agenda', 'agenda');
    entSheet('Proveedores', 'proveedores');
    entSheet('Vencimientos', 'vencimientos');

    const buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Tolvar_Gestion_${ref}.xlsx`);
    toast('Excel descargado');
}

/* ═══════════════ Datos de ejemplo ═══════════════ */
function demo() {
    const D = EMPTY(), d = n => addDays(todayISO(), -n), ym = todayISO().slice(0, 7);
    const prevYM = iso(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)).slice(0, 7);
    const cl = [['Familia Rodríguez', '351 555-0101', 'Av. Colón 1234, Córdoba'], ['Estudio Arq. Pérez', '351 555-0102', 'Bv. San Juan 450, Córdoba'], ['Constructora Del Sur', '351 555-0103', 'Cañada 220, Córdoba'], ['Marta Gómez', '351 555-0104', 'Los Aromos 88, Villa Allende']];
    D.clientes = cl.map(x => ({ id: uid(), nombre: x[0], tel: x[1], dir: x[2] }));
    const emp = [['Juan Pérez', 'Gasista matriculado', 'Lun a Vie 8 a 17', 4500, 'E', 38000, prevYM], ['Carlos Díaz', 'Electricista matriculado', 'Lun a Vie 8 a 17', 4200, 'D', 31000, ym], ['Nicolás Ruiz', 'Ayudante', 'Lun a Sáb 8 a 13', 2800, 'B', 19000, prevYM]];
    D.empleados = emp.map(x => ({ id: uid(), nombre: x[0], rol: x[1], horario: x[2], valorHora: x[3], monoCat: x[4], monoMonto: x[5], monoDia: 20, monoPagado: x[6] }));
    D.proveedores = [['Gasfitter Córdoba', 'Gas', '351 555-0201'], ['Eléctrica Central', 'Eléctrico', '351 555-0202'], ['Sanitarios del Centro', 'Sanitarios', '351 555-0203']].map(x => ({ id: uid(), nombre: x[0], rubro: x[1], tel: x[2] }));
    const [c1, c2, c3, c4] = D.clientes.map(x => x.id), [e1, e2, e3] = D.empleados.map(x => x.id), [p1, p2, p3] = D.proveedores.map(x => x.id);
    const tr = (f, c, de, m, es) => ({ id: uid(), fecha: d(f), clienteId: c, descripcion: de, monto: m, estado: es });
    D.trabajos = [tr(34, c1, 'Instalación de gas — casa nueva', 850000, 'Finalizado'), tr(26, c2, 'Instalación eléctrica — oficinas', 1200000, 'En curso'), tr(18, c3, 'Sanitarias — 6 departamentos', 2400000, 'En curso'), tr(8, c4, 'Cambio de termotanque y cañerías', 260000, 'En curso')];
    const [t1, t2, t3, t4] = D.trabajos.map(x => x.id);
    D.presupuestos = [
        { id: uid(), fecha: d(40), clienteId: c1, descripcion: 'Instalación de gas — casa nueva', monto: 850000, estado: 'Aprobado', trabajoId: t1 },
        { id: uid(), fecha: d(30), clienteId: c2, descripcion: 'Instalación eléctrica — oficinas', monto: 1200000, estado: 'Aprobado', trabajoId: t2 },
        { id: uid(), fecha: d(4), clienteId: c3, descripcion: 'Ampliación red de agua — planta baja', monto: 540000, estado: 'Aprobado' },
        { id: uid(), fecha: d(3), clienteId: c4, descripcion: 'Revisión de instalación de gas', monto: 90000, estado: 'Pendiente' },
        { id: uid(), fecha: d(15), clienteId: c1, descripcion: 'Aire acondicionado — preinstalación', monto: 310000, estado: 'Rechazado' },
    ];
    const mv = (f, cat, con, m, x = {}) => D.movimientos.push({ id: uid(), fecha: d(f), categoria: cat, tipo: tipoDe(cat), concepto: con, monto: m, ...x });
    mv(33, 'Cobro de trabajos', 'Anticipo 50% gas casa nueva', 425000, { trabajoId: t1, clienteId: c1, medio: 'Transferencia' });
    mv(32, 'Proveedores y compras', 'Cañerías y accesorios de gas', 168000, { trabajoId: t1, proveedorId: p1, rubro: 'Gas', nroFactura: 'A-0012-00031', medio: 'Transferencia' });
    mv(28, 'Pagos empleados', 'Quincena — Juan Pérez', 280000, { empleadoId: e1, medio: 'Efectivo' });
    mv(28, 'Pagos empleados', 'Quincena — Nicolás Ruiz', 150000, { empleadoId: e3, medio: 'Efectivo' });
    mv(25, 'Cobro de trabajos', 'Anticipo 40% eléctrica oficinas', 480000, { trabajoId: t2, clienteId: c2, medio: 'Transferencia' });
    mv(24, 'Proveedores y compras', 'Cables y tableros', 215000, { trabajoId: t2, proveedorId: p2, rubro: 'Eléctrico', nroFactura: 'A-0003-00118', medio: 'Débito' });
    mv(22, 'Facturas recibidas', 'Combustible de la camioneta', 38000, { rubro: 'Combustible', nroFactura: 'B-0007-00544', medio: 'Débito' });
    mv(20, 'Cobro de trabajos', 'Saldo gas casa nueva', 425000, { trabajoId: t1, clienteId: c1, medio: 'Transferencia' });
    mv(17, 'Pago deuda', 'Cuota préstamo herramientas', 62000, { medio: 'Débito' });
    mv(16, 'Pagos empleados', 'Quincena — Carlos Díaz', 260000, { empleadoId: e2, medio: 'Efectivo' });
    mv(15, 'Proveedores y compras', 'Sanitarios y grifería', 390000, { trabajoId: t3, proveedorId: p3, rubro: 'Sanitarios', nroFactura: 'A-0021-00907', medio: 'Transferencia' });
    mv(14, 'Cobro de trabajos', 'Anticipo 30% sanitarias departamentos', 720000, { trabajoId: t3, clienteId: c3, medio: 'Transferencia' });
    mv(13, 'Pagos empleados', 'Quincena — Juan Pérez', 285000, { empleadoId: e1, medio: 'Efectivo' });
    mv(13, 'Pagos empleados', 'Quincena — Nicolás Ruiz', 150000, { empleadoId: e3, medio: 'Efectivo' });
    mv(10, 'Facturas recibidas', 'Herramientas: amoladora y taladro', 145000, { rubro: 'Herramientas', nroFactura: 'A-0001-00456', medio: 'Crédito' });
    mv(9, 'Cobro de trabajos', 'Segunda cuota eléctrica oficinas', 360000, { trabajoId: t2, clienteId: c2, medio: 'Transferencia' });
    mv(7, 'Proveedores y compras', 'Termotanque y conexiones', 118000, { trabajoId: t4, proveedorId: p3, rubro: 'Sanitarios', nroFactura: 'A-0021-00955', medio: 'Débito' });
    mv(6, 'Pagos empleados', 'Quincena — Carlos Díaz', 260000, { empleadoId: e2, medio: 'Efectivo' });
    mv(5, 'Otros ingresos', 'Venta de material sobrante', 24000, { medio: 'Efectivo' });
    mv(4, 'Cobro de trabajos', 'Anticipo 50% termotanque', 130000, { trabajoId: t4, clienteId: c4, medio: 'Efectivo' });
    mv(3, 'Pago deuda', 'Cuota préstamo herramientas', 62000, { medio: 'Débito' });
    mv(2, 'Proveedores y compras', 'Caños y conexiones', 76000, { trabajoId: t3, proveedorId: p1, rubro: 'Gas', nroFactura: 'A-0012-00077', medio: 'Débito' });
    mv(1, 'Cobro de trabajos', 'Segunda cuota sanitarias', 480000, { trabajoId: t3, clienteId: c3, medio: 'Transferencia' });
    mv(0, 'Facturas recibidas', 'Combustible de la camioneta', 41000, { rubro: 'Combustible', nroFactura: 'B-0007-00601', medio: 'Débito' });
    const hs = (f, e, t, h) => D.horas.push({ id: uid(), fecha: d(f), empleadoId: e, trabajoId: t, horas: h, nota: '' });
    [[30, e1, t1, 8], [29, e1, t1, 8], [28, e3, t1, 6], [24, e2, t2, 8], [23, e2, t2, 8], [22, e3, t2, 6], [17, e1, t3, 8], [16, e1, t3, 8], [15, e3, t3, 7], [12, e2, t2, 8], [9, e1, t3, 8], [8, e3, t3, 7], [6, e1, t4, 5], [5, e3, t4, 5], [2, e2, t2, 8], [1, e1, t3, 8]].forEach(x => hs(...x));
    D.herramientas = [['Soldadora para termofusión', 'En uso', e1], ['Taladro percutor', 'Disponible', ''], ['Amoladora', 'Disponible', ''], ['Medidor de gas (manómetro)', 'En reparación', '']].map(x => ({ id: uid(), nombre: x[0], estado: x[1], asignadoA: x[2], notas: '' }));
    D.agenda = [
        { id: uid(), fecha: d(-1), hora: '09:00', titulo: 'Visita técnica — relevamiento', clienteId: c3, trabajoId: t3, hecho: false },
        { id: uid(), fecha: d(-2), hora: '14:30', titulo: 'Entrega de presupuesto', clienteId: c4, trabajoId: '', hecho: false },
        { id: uid(), fecha: d(0), hora: '08:00', titulo: 'Prueba de hermeticidad', clienteId: c2, trabajoId: t2, hecho: true },
    ];
    D.vencimientos = [
        { id: uid(), fecha: addDays(todayISO(), 3), concepto: 'Seguro de la camioneta', monto: 54000, pagado: false },
        { id: uid(), fecha: addDays(todayISO(), 21), concepto: 'Renovación de matrícula', monto: 70000, pagado: false },
    ];
    return D;
}

/* ═══════════════ Inicio ═══════════════ */
init();
})();
