/* =============================================================================
   Cafetería Origen — lógica del panel de administración
   Los datos del servidor se agregan al DOM con textContent / createElement.
   Las peticiones que cambian algo llevan el token anti-CSRF.
   ============================================================================= */
(function () {
  'use strict';

  var API = '/api';
  var usuario = null;
  var productosCache = {};
  var tokenCsrf = null;

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function money(valor) {
    return Number(valor || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
  }

  /* ------------------------------------------------------------- helpers DOM */
  function crear(tag, clase, texto) {
    var el = document.createElement(tag);
    if (clase) el.className = clase;
    if (texto !== undefined && texto !== null) el.textContent = String(texto);
    return el;
  }

  function vaciar(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function mensajeVacio(el, texto) {
    vaciar(el);
    el.appendChild(crear('p', 'empty', texto));
  }

  // Arma una tabla: encabezados + filas (cada fila es un array de celdas,
  // una celda puede ser texto o un elemento ya creado)
  function llenarTabla(tabla, encabezados, filas) {
    vaciar(tabla);
    var thead = crear('thead');
    var trHead = crear('tr');
    encabezados.forEach(function (h) {
      var th = crear('th', h.clase || '', h.texto);
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    tabla.appendChild(thead);

    var tbody = crear('tbody');
    filas.forEach(function (fila) {
      var tr = crear('tr');
      fila.forEach(function (celda, i) {
        var td = crear('td', encabezados[i] && encabezados[i].clase ? encabezados[i].clase : '');
        if (celda instanceof Node) td.appendChild(celda);
        else td.textContent = celda == null ? '' : String(celda);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tabla.appendChild(tbody);
  }

  function crearSelect(clase, atributo, id, opciones, seleccionada) {
    var select = crear('select', clase);
    select.setAttribute(atributo, String(id));
    opciones.forEach(function (op) {
      var option = crear('option', '', op);
      option.value = op;
      if (op === seleccionada) option.selected = true;
      select.appendChild(option);
    });
    return select;
  }

  function renderKpis(contenedor, kpis) {
    vaciar(contenedor);
    kpis.forEach(function (k) {
      var div = crear('div', 'kpi');
      div.appendChild(crear('div', 'kpi-label', k.label));
      div.appendChild(crear('div', 'kpi-value', k.value));
      contenedor.appendChild(div);
    });
  }

  function feedback(el, mensaje, ok) {
    el.className = 'form-feedback ' + (ok ? 'is-ok' : 'is-error');
    el.textContent = mensaje;
  }

  /* -------------------------------------------------------------------- API */
  // Se guarda la promesa y no el token: si dos formularios lo piden a la vez
  // se usa el mismo pedido y no se pisan las cookies
  function obtenerTokenCsrf() {
    if (!tokenCsrf) {
      tokenCsrf = fetch(API + '/csrf-token', { credentials: 'same-origin' })
        .then(function (res) { return res.json(); })
        .then(function (data) { return data.token; })
        .catch(function (err) {
          tokenCsrf = null;
          throw err;
        });
    }
    return tokenCsrf;
  }

  function api(url, opciones) {
    return fetch(API + url, opciones).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  // Petición que cambia estado: agrega el token CSRF
  function enviar(metodo, url, cuerpo) {
    return obtenerTokenCsrf().then(function (token) {
      var opciones = {
        method: metodo,
        headers: { 'X-CSRF-Token': token },
      };
      if (cuerpo !== undefined) {
        opciones.headers['Content-Type'] = 'application/json';
        opciones.body = JSON.stringify(cuerpo);
      }
      return api(url, opciones);
    });
  }

  function postJSON(url, cuerpo) { return enviar('POST', url, cuerpo || {}); }
  function putJSON(url, cuerpo) { return enviar('PUT', url, cuerpo || {}); }
  function patchJSON(url, cuerpo) { return enviar('PATCH', url, cuerpo || {}); }

  /* ------------------------------------------------------------------ login */
  function iniciarSesion(evento) {
    evento.preventDefault();
    var caja = $('#login-feedback');
    caja.className = 'form-feedback';

    postJSON('/auth/login', {
      username: $('#login-usuario').value,
      password: $('#login-password').value,
    }).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'No pudimos iniciar sesión: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      usuario = resp.data.usuario;
      mostrarPanel();
    });
  }

  function cerrarSesion() {
    postJSON('/auth/logout', {}).then(function () {
      usuario = null;
      $('#vista-login').hidden = false;
      $('#vista-panel').hidden = true;
      vaciar($('#admin-user'));
    });
  }

  function mostrarPanel() {
    $('#vista-login').hidden = true;
    $('#vista-panel').hidden = false;

    var caja = $('#admin-user');
    vaciar(caja);
    caja.appendChild(document.createTextNode('Sesión de '));
    caja.appendChild(crear('strong', '', usuario.nombre));
    caja.appendChild(document.createTextNode(' · rol: '));
    caja.appendChild(crear('strong', '', usuario.rol));

    $('#panel-bienvenida').textContent = 'Hola, ' + usuario.nombre;
    cargarTodo();
  }

  function cargarTodo() {
    cargarResumen();
    cargarPedidos();
    cargarProductos();
    cargarReportes();
    cargarUsuarios();
  }

  /* ---------------------------------------------------------------- resumen */
  function cargarResumen() {
    api('/reportes/facturacion').then(function (f) {
      api('/reportes/mas-vendido').then(function (m) {
        api('/reportes/cantidad-vendida').then(function (c) {
          var mas = m.data.producto;
          var porTipo = c.data.cantidadVendida || {};
          renderKpis($('#kpis'), [
            { label: 'Facturación total', value: money(f.data.facturado) },
            { label: 'Pedidos registrados', value: f.data.pedidos },
            { label: 'Producto más vendido', value: mas ? mas.nombre : '—' },
            {
              label: 'Unidades por tipo',
              value: Object.keys(porTipo)
                .map(function (k) { return k + ': ' + porTipo[k]; })
                .join(' · ') || '—',
            },
          ]);
        });
      });
    });
  }

  /* --------------------------------------------------------------- pedidos */
  var ESTADOS = ['abierto', 'preparando', 'listo', 'entregado'];

  function tablaPedidos(tabla, filas, conAcciones) {
    if (!filas || filas.length === 0) {
      mensajeVacio(tabla, 'No hay pedidos.');
      return;
    }

    var encabezados = [
      { texto: '#' }, { texto: 'Mesa' }, { texto: 'Cliente' }, { texto: 'Estado' },
      { texto: 'Total', clase: 'num' }, { texto: 'Fecha' },
    ];
    if (conAcciones) encabezados.push({ texto: 'Acciones' });

    var datos = filas.map(function (p) {
      var estadoValido = ESTADOS.indexOf(p.estado) >= 0 ? p.estado : 'otro';
      var fila = [
        p.id,
        p.mesa,
        p.cliente,
        crear('span', 'badge badge-' + estadoValido, p.estado),
        money(p.total),
        new Date(p.creado_en).toLocaleString('es-AR'),
      ];
      if (conAcciones) fila.push(crearSelect('sel-estado', 'data-pedido', p.id, ESTADOS, p.estado));
      return fila;
    });

    llenarTabla(tabla, encabezados, datos);
  }

  function cargarPedidos() {
    api('/pedidos').then(function (resp) {
      var pedidos = resp.data.pedidos || [];
      tablaPedidos($('#tabla-pedidos'), pedidos, true);
      tablaPedidos($('#tabla-ultimos'), pedidos.slice(0, 5), false);
    });
  }

  function cambiarEstado(evento) {
    var select = evento.target.closest('.sel-estado');
    if (!select) return;
    var id = select.getAttribute('data-pedido');
    patchJSON('/pedidos/' + encodeURIComponent(id) + '/estado', { estado: select.value }).then(function (resp) {
      if (!resp.ok) {
        alert('No se pudo cambiar el estado: ' + (resp.data.error || 'error'));
      }
      cargarPedidos();
    });
  }

  /* ------------------------------------------------------------- productos */
  function cargarProductos() {
    api('/productos').then(function (resp) {
      var productos = resp.data.productos || [];
      productosCache = {};

      var datos = productos.map(function (p) {
        productosCache[p.id] = p;
        var boton = crear('button', 'link-danger', 'Borrar');
        boton.setAttribute('data-borrar', String(p.id));
        return [p.id, p.nombre, p.tipo, p.variedad || '—', money(p.precio), boton];
      });

      llenarTabla($('#tabla-productos'), [
        { texto: '#' }, { texto: 'Nombre' }, { texto: 'Tipo' }, { texto: 'Origen' },
        { texto: 'Precio', clase: 'num' }, { texto: 'Acciones' },
      ], datos);
    });
  }

  function guardarProducto(evento) {
    evento.preventDefault();
    var caja = $('#producto-feedback');
    var id = $('#producto-id').value;

    var cuerpo = {
      nombre: $('#p-nombre').value,
      tipo: $('#p-tipo').value,
      variedad: $('#p-variedad').value || null,
      tamano: $('#p-tamano').value || null,
      gramos: $('#p-gramos').value ? Number($('#p-gramos').value) : null,
      precio_base: Number($('#p-precio-base').value || 0),
      precio_por_gramo: Number($('#p-precio-gramo').value || 0),
      descripcion: $('#p-descripcion').value,
    };

    var peticion = id
      ? putJSON('/admin/productos/' + encodeURIComponent(id), cuerpo)
      : postJSON('/admin/productos', cuerpo);

    peticion.then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'No se pudo guardar: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      feedback(caja, 'Producto guardado correctamente.', true);
      $('#form-producto').reset();
      $('#producto-id').value = '';
      cargarProductos();
    });
  }

  function borrarProducto(evento) {
    var btn = evento.target.closest('[data-borrar]');
    if (!btn) return;
    var id = btn.getAttribute('data-borrar');
    if (!confirm('¿Borrar el producto #' + id + '?')) return;

    enviar('DELETE', '/admin/productos/' + encodeURIComponent(id)).then(function (resp) {
      if (!resp.ok) alert('No se pudo borrar: ' + (resp.data.error || 'error'));
      cargarProductos();
    });
  }

  function limpiarFormularioProducto() {
    $('#form-producto').reset();
    $('#producto-id').value = '';
  }

  /* ---------------------------------------------------------------- upload */
  function subirArchivo(evento) {
    evento.preventDefault();
    var caja = $('#upload-feedback');
    var input = $('#archivo-subida');
    if (!input.files || !input.files[0]) {
      feedback(caja, 'Elegí un archivo primero.', false);
      return;
    }

    var archivo = input.files[0];
    if (archivo.size > 2 * 1024 * 1024) {
      feedback(caja, 'El archivo tiene que pesar menos de 2 MB.', false);
      return;
    }

    var lector = new FileReader();
    lector.onload = function () {
      var base64 = String(lector.result).split(',')[1] || '';
      postJSON('/admin/subir-archivo', {
        nombre: archivo.name,
        contenidoBase64: base64,
      }).then(function (resp) {
        if (!resp.ok) {
          feedback(caja, 'No se pudo subir: ' + (resp.data.error || 'error desconocido'), false);
          return;
        }
        feedback(caja, 'Archivo subido a ' + resp.data.url, true);
      });
    };

    lector.readAsDataURL(archivo);
  }

  /* -------------------------------------------------------------- reportes */
  function cargarReportes() {
    api('/reportes/facturacion').then(function (f) {
      api('/reportes/ticket-promedio').then(function (t) {
        api('/reportes/mas-vendido').then(function (m) {
          var mas = m.data.producto;
          renderKpis($('#kpis-reportes'), [
            { label: 'Facturación', value: money(f.data.facturado) },
            { label: 'Pedidos', value: f.data.pedidos },
            { label: 'Ticket promedio', value: money(t.data.promedio) },
            { label: 'Más vendido', value: mas ? mas.nombre + ' (' + mas.unidades + ')' : '—' },
          ]);
        });
      });
    });
  }

  function consultarVentas() {
    var caja = $('#reporte-feedback');
    var variedad = $('#reporte-variedad').value;
    var tabla = $('#tabla-ventas');

    api('/reportes/ventas-por-variedad?variedad=' + encodeURIComponent(variedad)).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'Error: ' + (resp.data.error || 'desconocido'), false);
        vaciar(tabla);
        return;
      }
      var ventas = resp.data.ventas || [];
      llenarTabla(tabla, [
        { texto: 'Origen' }, { texto: 'Producto' },
        { texto: 'Unidades', clase: 'num' }, { texto: 'Total', clase: 'num' },
      ], ventas.map(function (v) {
        return [v.variedad, v.nombre, v.unidades, money(v.total)];
      }));
      feedback(caja, 'Consulta realizada.', true);
    });
  }

  /* -------------------------------------------------------------- usuarios */
  var ROLES = ['cliente', 'mozo', 'barista', 'admin'];

  function cargarUsuarios() {
    api('/admin/usuarios').then(function (resp) {
      var usuarios = resp.data.usuarios || [];
      var datos = usuarios.map(function (u) {
        return [
          u.id,
          u.username,
          u.nombre,
          crear('span', 'badge' + (u.rol === 'admin' ? ' badge-admin' : ''), u.rol),
          crearSelect('sel-rol', 'data-usuario', u.id, ROLES, u.rol),
        ];
      });
      llenarTabla($('#tabla-usuarios'), [
        { texto: '#' }, { texto: 'Usuario' }, { texto: 'Nombre' }, { texto: 'Rol' }, { texto: 'Acciones' },
      ], datos);
    });
  }

  function cambiarRol(evento) {
    var select = evento.target.closest('.sel-rol');
    if (!select) return;
    var id = select.getAttribute('data-usuario');

    putJSON('/admin/usuarios/' + encodeURIComponent(id), { rol: select.value }).then(function (resp) {
      if (!resp.ok) alert('No se pudo actualizar: ' + (resp.data.error || 'error'));
      cargarUsuarios();
    });
  }

  function cambiarPassword(evento) {
    evento.preventDefault();
    var caja = $('#password-feedback');
    postJSON('/admin/cambiar-contrasena', {
      actual: $('#actual-password').value,
      nueva: $('#nueva-password').value,
    }).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'No se pudo cambiar: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      feedback(caja, 'Contraseña actualizada.', true);
      $('#actual-password').value = '';
      $('#nueva-password').value = '';
    });
  }

  /* ----------------------------------------------------------- herramientas */
  function probarConexion(evento) {
    evento.preventDefault();
    var salida = $('#salida-conexion');
    salida.textContent = 'Probando…';

    postJSON('/admin/probar-conexion', { host: $('#conexion-host').value.trim() }).then(function (resp) {
      if (!resp.ok) {
        salida.textContent = 'Error: ' + (resp.data.error || 'desconocido');
        return;
      }
      salida.textContent =
        '$ ' + resp.data.comando + '\n\n' +
        (resp.data.salida || '') +
        (resp.data.error ? '\n[stderr]\n' + resp.data.error : '');
    });
  }

  function verDiagnostico() {
    var salida = $('#salida-diagnostico');
    salida.textContent = 'Cargando…';
    api('/_diagnostico').then(function (resp) {
      salida.textContent = JSON.stringify(resp.data, null, 2);
    });
  }

  /* ------------------------------------------------------------------ tabs */
  function activarTab(evento) {
    var tab = evento.target.closest('.tab');
    if (!tab) return;
    var vista = tab.getAttribute('data-vista');
    $$('.tab').forEach(function (t) { t.classList.remove('is-active'); });
    tab.classList.add('is-active');
    $$('.tab-panel').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-panel') === vista);
    });
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    // El parámetro ?vista= de la URL solo se acepta si es el nombre de una de
    // las pestañas del panel, y se muestra como texto, no como HTML (antes con
    // admin.html?vista=<img src=x onerror=...> se ejecutaba código).
    var VISTAS = ['resumen', 'pedidos', 'productos', 'reportes', 'usuarios', 'herramientas'];
    var params = new URLSearchParams(window.location.search);
    var objetivo = params.get('vista');
    if (objetivo && VISTAS.indexOf(objetivo) >= 0) {
      $('#panel-bienvenida').textContent = 'Panel ' + objetivo;
    }

    $('#form-login').addEventListener('submit', iniciarSesion);
    $('#btn-logout').addEventListener('click', cerrarSesion);
    $('#btn-refrescar').addEventListener('click', cargarTodo);
    $('#tabs').addEventListener('click', activarTab);
    $('#tabla-pedidos').addEventListener('change', cambiarEstado);
    $('#tabla-productos').addEventListener('click', borrarProducto);
    $('#form-producto').addEventListener('submit', guardarProducto);
    $('#btn-limpiar-producto').addEventListener('click', limpiarFormularioProducto);
    $('#form-upload').addEventListener('submit', subirArchivo);
    $('#form-password').addEventListener('submit', cambiarPassword);
    $('#btn-reporte-variedad').addEventListener('click', consultarVentas);
    $('#tabla-usuarios').addEventListener('change', cambiarRol);
    $('#form-conexion').addEventListener('submit', probarConexion);
    $('#btn-diagnostico').addEventListener('click', verDiagnostico);

    // ¿Ya hay sesión?
    api('/auth/yo').then(function (resp) {
      if (resp.ok) {
        usuario = resp.data.usuario;
        mostrarPanel();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
