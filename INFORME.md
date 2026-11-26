# TP4 - Cafetería Origen - Informe de correcciones

Estado final:

| Comando | Resultado |
|---|---|
| `npm test` | 28/28 en verde |
| `npm run test:seguridad` | 29/29 en verde |
| `npm run check:security` | 37/37 controles críticos |

Para levantarlo desde cero:

```
docker compose down -v
docker compose up -d --build
docker compose exec app npm run test:todo
docker compose exec app npm run check:security
```

Las contraseñas de los usuarios de prueba cambiaron, están en el README.

### Quién resolvió cada falla

| Parte | Fallas | Adicionales |
|---|---|---|
| Parte 1 - Robles Joaquin | 1, 2, 3, 4, 9, 11 y 24 | 1, 2 y 3 |
| Parte 2 - Garcia Amado Juan Manuel | 8, 12, 13, 14, 15, 16, 17, 22 y 23 | - |
| Parte 3 - Bamberger Carrasco Owen Braggi | 5, 6, 7, 10, 18, 19, 20 y 21 | 4, 5, 6 y 7 |

---

## Las 24 fallas que hay que encontrar

### 1. Inyección SQL en el login

**Qué es y por qué importa:** el usuario y la contraseña del login se pegaban
dentro del texto SQL. Con un usuario armado a propósito se entra al panel sin
saber ninguna contraseña, y como el primer usuario de la tabla es el admin, se
entra como administrador.

**Dónde está:** `services/usuarios.service.ts:42`

```ts
const sql = `SELECT * FROM usuarios WHERE username = '${username}' AND password = '${password}'`;
```

**Cómo se observa:**

1. Abrir `http://localhost:8080/admin.html`.
2. Usuario: `' OR 1=1 --`, contraseña: cualquier cosa.
3. Variante: usuario `admin'--` y cualquier contraseña.

**Evidencia:** en los dos casos el panel abre con la sesión del admin.

**Por qué ocurre:** la comilla del atacante cierra la cadena que abrió el
código. Lo que sigue (`OR 1=1`) pasa a ser parte de la condición, y `--`
comenta el resto de la consulta, incluida la comparación de la contraseña.
La base no puede distinguir qué parte escribió el programador y qué parte
escribió el usuario.

**Cómo se corrige:** consulta parametrizada y comparación con bcrypt
(`services/usuarios.service.ts:32-54`). El valor viaja aparte del SQL, así que
nunca se interpreta como código.

```ts
export async function buscarPorUsername(username: string): Promise<Usuario | null> {
  const { rows } = await db.query<Usuario>(
    'SELECT * FROM usuarios WHERE username = $1',
    [username]
  );
  return rows[0] || null;
}

export async function autenticar(username: string, password: string): Promise<Usuario | null> {
  if (typeof username !== 'string' || typeof password !== 'string') return null;

  const usuario = await buscarPorUsername(username);
  const hash = usuario && esHash(usuario.password) ? usuario.password : HASH_FALSO;
  const coincide = await bcrypt.compare(password, hash);

  if (!usuario || !coincide || hash === HASH_FALSO) return null;
  ...
}
```

**Cómo se verifica:** tests `el login NO acepta el bypass con payload SQL` y
`el login NO acepta el payload que comenta la contraseña`
(`tests/seguridad-login.test.ts`); controles SQLI-01 y SQLI-02. Repitiendo los
pasos, el login responde `Usuario o contrasena incorrectos.`

### 2. Inyección SQL en los filtros del catálogo

**Qué es y por qué importa:** los filtros del menú (tipo, origen y búsqueda)
se concatenaban en la consulta. Se podía ampliar el resultado o, con la
consulta adecuada, leer otras tablas.

**Dónde está:** `services/catalogo.service.ts:40` (tipo), `:41` (variedad) y
`:43` (búsqueda). El id del producto tiene el mismo problema en
`services/catalogo.service.ts:55`.

```ts
if (tipo) sql += ` AND tipo = '${tipo}'`;
if (variedad) sql += ` AND variedad = '${variedad}'`;
sql += ` AND (nombre ILIKE '%${q}%' OR descripcion ILIKE '%${q}%')`;
```

**Cómo se observa:**

1. En el buscador del menú escribir `' OR '1'='1`.
2. O pedir `GET /api/productos?variedad=Colombia' OR '1'='1`.

**Evidencia:** vuelve el catálogo completo en lugar de los productos que
coinciden con la búsqueda.

**Por qué ocurre:** igual que en el login, el texto del usuario se mete
dentro de la cadena SQL y la comilla cambia la estructura de la consulta.

**Cómo se corrige:** lista blanca para `tipo` y `variedad`, y parámetros para
todo (`services/catalogo.service.ts:28-54`). En la búsqueda también se
escapan `%` y `_` para que se busquen como texto. El id del producto también
va como parámetro (`services/catalogo.service.ts:61`):
`'SELECT * FROM productos WHERE id = $1', [id]`.

```ts
if (tipo && !enLista(tipo, TIPOS_PERMITIDOS)) return [];
if (variedad && !enLista(variedad, VARIEDADES_PERMITIDAS)) return [];

const params: unknown[] = [];
let sql = 'SELECT * FROM productos WHERE activo = true';

if (tipo) {
  params.push(tipo);
  sql += ' AND tipo = $' + params.length;
}
if (variedad) {
  params.push(variedad);
  sql += ' AND variedad = $' + params.length;
}
if (q && typeof q === 'string') {
  const busqueda = q.slice(0, 50).replace(/[\\%_]/g, '\\$&');
  params.push('%' + busqueda + '%');
  sql += ' AND (nombre ILIKE $' + params.length + ' OR descripcion ILIKE $' + params.length + ')';
}
```

**Cómo se verifica:** tests `la búsqueda del catálogo NO se puede ampliar con
SQL` y `el filtro por origen NO se puede ampliar con SQL`
(`tests/seguridad.test.ts`); controles SQLI-01 y SQLI-02. Repitiendo los
pasos, la búsqueda no encuentra nada y el filtro por origen devuelve una lista
vacía.

### 3. Inyección SQL en el filtro por mesa

**Qué es y por qué importa:** el filtro de pedidos por mesa se concatenaba en
la consulta. Con él se veían los pedidos y los nombres de los clientes de
todas las mesas.

**Dónde está:** `services/pedidos.service.ts:95`

```ts
if (mesa) sql += ` WHERE mesa = '${mesa}'`;
```

**Cómo se observa:** pedir `GET /api/pedidos?mesa=' OR '1'='1`.

**Evidencia:** vuelven los pedidos de todas las mesas, no solo los de una.

**Por qué ocurre:** el valor de la query string entra tal cual en el SQL.

**Cómo se corrige:** parámetro y control de tipo y largo
(`services/pedidos.service.ts:117-128`).

```ts
export async function listar(mesa?: unknown): Promise<Pedido[]> {
  if (mesa !== undefined && mesa !== '') {
    if (typeof mesa !== 'string' || mesa.length > 10) return [];
    const { rows } = await db.query<Pedido>(
      'SELECT * FROM pedidos WHERE mesa = $1 ORDER BY id DESC',
      [mesa]
    );
    return rows;
  }
  ...
}
```

**Cómo se verifica:** test `el filtro por mesa NO se puede ampliar con SQL`
(`tests/seguridad.test.ts`); controles SQLI-01 y SQLI-02. Repitiendo el paso,
la respuesta es una lista vacía.

### 4. Inyección SQL en el reporte por origen

**Qué es y por qué importa:** es la más grave de las cuatro, porque con un
`UNION` se leían otras tablas. En particular, se podían ver los usuarios y sus
contraseñas, que además estaban en texto plano (falla 11).

**Dónde está:** `services/reportes.service.ts:88` (la consulta empieza en la
línea 82).

```ts
HAVING pr.variedad = '${variedad}'`;
```

**Cómo se observa:**

1. Panel → Reportes → "Ventas por origen".
2. Escribir `Brasil' UNION SELECT username, password, 1, 1 FROM usuarios--`.

**Evidencia:** la tabla del reporte muestra los nombres de usuario y las
contraseñas.

**Por qué ocurre:** el origen se concatena al final de la consulta. El
`UNION` agrega una segunda consulta con la misma cantidad de columnas, y la
base devuelve los dos resultados juntos.

**Cómo se corrige:** lista blanca de orígenes y parámetro
(`services/reportes.service.ts:70-83`).

```ts
export async function ventasPorVariedad(variedad: string): Promise<VentaPorVariedad[]> {
  if (!enLista(variedad, VARIEDADES_PERMITIDAS)) return [];

  const { rows } = await db.query<VentaPorVariedad>(
    `SELECT pr.variedad, pr.nombre, SUM(pi.cantidad) AS unidades,
            SUM(pi.cantidad * pi.precio_unitario) AS total
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
      WHERE pr.variedad = $1
      GROUP BY pr.variedad, pr.nombre`,
    [variedad]
  );
  return rows;
}
```

**Cómo se verifica:** test `el reporte por origen NO filtra otras tablas con
UNION` (`tests/seguridad.test.ts`); controles SQLI-01 y SQLI-02. Repitiendo
los pasos, el reporte queda vacío.

### 5. XSS reflejado en el buscador y en los mensajes de error

**Qué es y por qué importa:** el texto buscado volvía del servidor y se
metía en la página con `innerHTML`. Lo mismo pasaba con algunos mensajes de
error, que repetían lo que había mandado el cliente. Un enlace armado ejecuta
código en el navegador de quien lo abre.

**Dónde está:**

- Buscador: `public/js/app.js:130`.

  ```js
  el.innerHTML = 'Resultados para <strong>' + filtros.q + '</strong> — ' + total + ' producto(s)';
  ```

- Mensajes de error que repiten la entrada: `routes/productos.routes.ts:58`
  (el id del producto) y `routes/auth.routes.ts:39` (el usuario del login).

  ```ts
  .json({ error: `No existe el producto "${req.params.id}".` });
  ```

- Donde el cliente pinta esos mensajes: `public/js/app.js:233` y `:288`, y
  `public/js/admin.js:63`.

**Cómo se observa:**

1. En el buscador del menú escribir `<img src=x onerror=alert('XSS')>`.
2. Abrir `http://localhost:8080/api/productos/<script>alert(1)</script>`.
3. En el login del panel, escribir como usuario `<img src=x onerror=alert(1)>`
   y cualquier contraseña.

**Evidencia:** en el primer paso aparece el `alert`. En el segundo, el JSON
de error trae el `<script>` tal cual. En el tercero, el mensaje
`El usuario "..." no existe en el sistema.` se pinta con `innerHTML` y salta
el `alert`.

**Por qué ocurre:** `innerHTML` interpreta el texto como HTML, y el
navegador no puede saber que esa etiqueta la escribió un usuario y no el
programador. Del lado del servidor, los mensajes se armaban concatenando la
entrada.

**Cómo se corrige:** en `app.js` y `admin.js` todo se arma con
`document.createElement` y `textContent`, así el texto se muestra como texto.
Se agregó una función `crear` para eso (`public/js/app.js:28-33`) y se sacaron
todos los `innerHTML`. El resultado de la búsqueda queda así
(`public/js/app.js:151-160`):

```js
function crear(tag, clase, texto) {
  var el = document.createElement(tag);
  if (clase) el.className = clase;
  if (texto !== undefined && texto !== null) el.textContent = String(texto);
  return el;
}
...
el.appendChild(document.createTextNode('Resultados para '));
el.appendChild(crear('strong', '', filtros.q));
el.appendChild(document.createTextNode(' — ' + total + ' producto(s)'));
```

En el servidor, el id se valida como entero y el mensaje es genérico
(`routes/productos.routes.ts:49-54`). El login ya responde siempre lo mismo
(falla 17), y en el cliente los mensajes se muestran con `textContent`
(`public/js/app.js:274` y `:329`).

```ts
router.get('/:id', async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    const producto = id ? await catalogo.obtener(id) : null;
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
```

**Cómo se verifica:** tests `el cliente NO inserta datos con innerHTML`, `el
servidor NO devuelve HTML sin escapar en los errores` y `el login NO devuelve
HTML sin escapar en el mensaje de error` (`tests/seguridad.test.ts`);
controles XSS-01 y XSS-02. Repitiendo los pasos, el texto
`<img src=x onerror=alert('XSS')>` aparece escrito en la página y no salta
ningún `alert`, la API responde `Producto no encontrado.` y el login muestra
`Usuario o contrasena incorrectos.`

### 6. XSS almacenado en las reseñas

**Qué es y por qué importa:** es el de mayor impacto. El texto de la reseña
se guardaba tal cual y se metía con `innerHTML` en cada visita, así que el
script se ejecutaba en el navegador de todos los que abrían la página,
incluidos los administradores (el "cartel" del enunciado).

**Dónde está:** `public/js/app.js:259`

```js
cont.innerHTML = resp.data.comentarios.map(function (c) { ... }).join('');
```

**Cómo se observa:**

1. Publicar una reseña con `<img src=x onerror=alert('XSS almacenado')>` en el
   texto.
2. Recargar la página.
3. Abrir el sitio desde otro navegador.

**Evidencia:** el `alert` salta solo al cargar la página, también en el otro
navegador. Con `<script>alert(...)</script>`, como propone la guía, no salta:
los navegadores no ejecutan las etiquetas `<script>` insertadas con
`innerHTML`, pero sí los atributos como `onerror`. La falla es la misma.

**Por qué ocurre:** lo que viene de la base se trató como HTML de confianza,
y no había ningún límite ni control al guardar la reseña (falla 9).

**Cómo se corrige:** las reseñas se arman con `crear` y `textContent`
(`public/js/app.js:291-311`). Del lado del servidor se limita el largo
(falla 9), y la CSP (falla 23) es la capa extra.

```js
resp.data.comentarios.forEach(function (c) {
  var cantidad = Math.max(0, Math.min(5, Number(c.calificacion) || 0));
  var estrellas = new Array(cantidad + 1).join('★');

  var review = crear('article', 'review');
  var head = crear('div', 'review-head');
  head.appendChild(crear('span', 'review-author', c.autor));
  head.appendChild(crear('span', 'review-stars', estrellas));
  review.appendChild(head);
  review.appendChild(crear('p', 'review-text', c.texto));

  cont.appendChild(review);
});
```

**Cómo se verifica:** test `el cliente NO inserta datos con innerHTML`
(`tests/seguridad.test.ts`); controles XSS-01 y XSS-03. Repitiendo los pasos,
la reseña muestra el texto de la etiqueta y no salta nada.

### 7. XSS de DOM en el panel

**Qué es y por qué importa:** el panel leía el parámetro `?vista=` de la URL
y lo metía con `innerHTML`. Mandándole a un admin un enlace armado, se
ejecutaba código con su sesión.

**Dónde está:** `public/js/admin.js:427`

```js
$('#panel-bienvenida').innerHTML = 'Panel ' + objetivo;
```

**Cómo se observa:** abrir `admin.html?vista=<img src=x onerror=alert('DOM')>`.

**Evidencia:** aparece el `alert`.

**Por qué ocurre:** el dato nunca pasa por el servidor; lo toma el propio
JavaScript de la URL y lo inserta como HTML.

**Cómo se corrige:** el valor solo se acepta si es el nombre de una de las
pestañas del panel, y se muestra con `textContent`
(`public/js/admin.js:495-500`). En el resto de `admin.js` también se sacaron
todos los `innerHTML`.

```js
var VISTAS = ['resumen', 'pedidos', 'productos', 'reportes', 'usuarios', 'herramientas'];
var params = new URLSearchParams(window.location.search);
var objetivo = params.get('vista');
if (objetivo && VISTAS.indexOf(objetivo) >= 0) {
  $('#panel-bienvenida').textContent = 'Panel ' + objetivo;
}
```

**Cómo se verifica:** test `el cliente NO inserta datos con innerHTML`
(`tests/seguridad.test.ts`); control XSS-01. Repitiendo el paso, el título del
panel no cambia y no salta nada. Con `admin.html?vista=pedidos` el título
muestra `Panel pedidos`.

### 8. CSRF en todos los formularios que cambian estado

**Qué es y por qué importa:** cualquier página de otro sitio podía hacer que
el navegador de un usuario logueado mandara un POST (crear un pedido, borrar
un producto, cambiar la contraseña). El servidor lo aceptaba porque la cookie
de sesión viajaba sola.

**Dónde está:** todas las rutas que cambian estado, sin ningún token:
`routes/pedidos.routes.ts:18`, `routes/comentarios.routes.ts:24` y
`routes/admin.routes.ts:69`, `:83`, `:101` y `:119`. Además, la cookie se
emitía sin `SameSite` (`middleware/sesion.ts:62`).

**Cómo se observa:**

1. Crear un `ataque.html` en la máquina:

   ```html
   <form method="POST" action="http://localhost:8080/api/pedidos">
     <input name="mesa" value="99">
     <input name="cliente" value="Atacante">
     <input name="items[0][productoId]" value="4">
     <input name="items[0][cantidad]" value="1">
   </form>
   <script>document.forms[0].submit();</script>
   ```

2. Con el panel abierto y la sesión iniciada, abrir `ataque.html` en otra
   pestaña.
3. Repetir con un formulario que apunte a `/api/admin/cambiar-contrasena`
   con un campo `nueva`. Como la cookie no tiene `SameSite`, Chrome la trata
   como `Lax` y solo la manda en este POST durante los 2 minutos siguientes
   al login; en Firefox se ve sin esa restricción.

**Evidencia:** el pedido de la mesa 99 aparece en el panel sin que nadie lo
haya cargado, y la contraseña del admin cambia.

**Por qué ocurre:** el navegador manda las cookies del dominio en cualquier
petición, venga de donde venga. Si el servidor solo mira la cookie, no puede
saber si la petición la armó su propio sitio o una página ajena.

**Cómo se corrige:** patrón "double submit cookie" en `middleware/csrf.ts`.
`GET /api/csrf-token` genera un token aleatorio, lo guarda en una cookie y lo
devuelve en el JSON. Todo POST/PUT/PATCH/DELETE tiene que mandar el mismo token
en la cabecera `X-CSRF-Token`. Otro sitio puede hacer que se mande la cookie,
pero no puede leer el token. También se revisa la cabecera `Origin`, y la
cookie de sesión tiene `SameSite`. El login queda afuera porque todavía no hay
sesión y ya tiene rate limiting.

```ts
// middleware/csrf.ts:54-69
export function verificarCsrf(req: Request, res: Response, next: NextFunction) {
  if (METODOS_SEGUROS.includes(req.method)) return next();
  if (RUTAS_EXCLUIDAS.includes(req.originalUrl.split('?')[0])) return next();

  if (!origenValido(req)) {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }

  const tokenCookie = leerCookies(req).csrf;
  const enviado = req.get('x-csrf-token') || (req.body && req.body._csrf) || req.query._csrf;

  if (!tokenCookie || typeof enviado !== 'string' || !sonIguales(tokenCookie, enviado)) {
    return res.status(403).json({ error: 'Token CSRF invalido o ausente.' });
  }
  next();
}
```

```ts
// app.ts:56-57
app.get('/api/csrf-token', entregarTokenCsrf);
app.use('/api', verificarCsrf);
```

Del lado del cliente, `app.js` y `admin.js` piden el token una vez y lo
mandan en cada petición que cambia algo (`public/js/app.js:50-78` y
`public/js/admin.js:95-125`). Sin esta parte el servidor rechaza con 403 todo
lo que hace el propio sitio.

```js
// public/js/app.js:72-77
return obtenerTokenCsrf().then(function (token) {
  return api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    body: JSON.stringify(cuerpo || {}),
  });
});
```

**Cómo se verifica:** test `existe un token anti-CSRF y las peticiones sin
token se rechazan` (`tests/seguridad.test.ts`); controles CSRF-01 y CSRF-02.
Repitiendo los pasos, `ataque.html` recibe 403 y el pedido no se crea. Desde el
sitio, en la pestaña Network del devtools se ve la cabecera `X-CSRF-Token` en
cada POST y la respuesta 201.

### 9. Validación débil: cantidades negativas, sin límites

**Qué es y por qué importa:** el servidor aceptaba cualquier cosa en el
cuerpo del pedido y de las reseñas. Con una cantidad negativa el total
quedaba negativo (la cafetería le "debía" plata a la mesa). Con un texto, el total quedaba en
`NaN`, y eso rompía todos los reportes de facturación. En las reseñas no
había límite de largo ni de calificación: se podía publicar un texto de 50.000
caracteres o una calificación de 999, y era además el camino del XSS
almacenado (falla 6).

**Dónde está:**

- Pedidos: `services/pedidos.service.ts:43-64` (función `crear`; el
  recorrido de los items empieza en la línea 49 y el total se calcula en la
  61).
- Reseñas: `routes/comentarios.routes.ts:24-35`, que pasa el cuerpo directo a
  `services/comentarios.service.ts:40`.

**Cómo se observa:**

1. Mandar `POST /api/pedidos` con
   `{"mesa":"1","items":[{"productoId":4,"cantidad":-5}]}`.
2. En el formulario de pedido, con el devtools (F12), cambiar `type="number"`
   por `type="text"` en la cantidad y mandar `abc`.
3. Publicar una reseña con un texto de 50.000 caracteres.

**Evidencia:** el primer pedido se guarda con total negativo. El segundo se
guarda con total `NaN`, y después la facturación del panel también muestra
`NaN`. La reseña larga se publica tal cual (la API responde 201).

**Por qué ocurre:** los tipos de TypeScript (`NuevoPedido`) no existen en
ejecución: el cuerpo llega como `any` y nadie lo revisa. La validación del
HTML (`type="number"`, `min`) solo vive en el navegador y se saltea con el
devtools.

**Cómo se corrige:** validación en el servidor de tipo, rango y largo de cada
campo (`services/pedidos.service.ts:43-66`), con las funciones de
`validacion.ts`.

```ts
function validarPedido(datos: Partial<NuevoPedido>) {
  const mesa = validarTexto(datos.mesa, 'mesa', 10);
  const cliente = validarTexto(datos.cliente, 'cliente', 60, false);
  const items = datos.items;

  if (!Array.isArray(items) || items.length === 0) {
    throw errorValidacion('El pedido tiene que tener al menos un producto.');
  }
  if (items.length > MAX_ITEMS_PEDIDO) {
    throw errorValidacion('El pedido tiene demasiados productos.');
  }

  const itemsValidos = items.map((item) => {
    const productoId = validarId(item && item.productoId);
    const cantidad = validarEntero(item && item.cantidad, 1, MAX_CANTIDAD_ITEM);
    if (!productoId) throw errorValidacion('Hay un producto invalido en el pedido.');
    if (!cantidad) {
      throw errorValidacion('La cantidad tiene que ser un entero entre 1 y ' + MAX_CANTIDAD_ITEM + '.');
    }
    return { productoId, cantidad };
  });

  return { mesa, cliente, items: itemsValidos };
}
```

Además, si un producto no existe se responde con un error de validación
(`services/pedidos.service.ts:78`) en vez de dejar que el código reviente.

En las reseñas se limita el largo de autor y texto, y la calificación tiene
que ser un entero entre 1 y 5 (`services/comentarios.service.ts:32-38`):

```ts
const autor = validarTexto(datos.autor, 'autor', MAX_LONGITUD_AUTOR);   // 40
const texto = validarTexto(datos.texto, 'texto', MAX_LONGITUD_TEXTO);   // 500
const calificacion = validarEntero(datos.calificacion, 1, 5);
if (!calificacion) {
  throw errorValidacion('La calificacion tiene que ser un numero del 1 al 5.');
}
```

**Cómo se verifica:** tests `no se aceptan cantidades negativas`, `no se
aceptan cantidades no numéricas` y `no se aceptan reseñas sin límite de
longitud` (`tests/seguridad.test.ts`); controles VAL-01, VAL-02 y VAL-03.
Repitiendo los pasos, la API responde 400 y no se guarda ni el pedido ni la
reseña.

### 10. Subida de archivos sin restricciones

**Qué es y por qué importa:** se podía subir cualquier archivo, de cualquier
tamaño y con el nombre que mandaba el cliente. Un `.html` con scripts se servía
desde el mismo dominio del sitio, y con un nombre como `../../algo` se escribía
fuera de la carpeta `uploads`.

**Dónde está:** `routes/admin.routes.ts:180-204`

```ts
const buffer = Buffer.from(contenidoBase64, 'base64');
const destino = path.join(config.uploadsDir, nombre);
fs.writeFileSync(destino, buffer);
```

**Cómo se observa:**

1. Panel → Productos → subir un archivo `prueba.html` con
   `<script>alert(1)</script>`.
2. Abrir la URL que devuelve (`/uploads/prueba.html`).

**Evidencia:** el script se ejecuta en `localhost:8080`, el dominio de la
cafetería.

**Por qué ocurre:** no se validaba extensión, tipo real ni tamaño, y el
nombre del archivo lo decidía el cliente.

**Cómo se corrige:** solo PNG, JPG, GIF y WEBP (lista blanca de
extensiones). Se revisan los primeros bytes para confirmar que es de verdad
una imagen, el máximo es 2 MB, y el nombre lo genera el servidor con
`crypto.randomBytes`; del nombre original solo se usa la extensión
(`routes/admin.routes.ts:329-386`).

```ts
const extension = path.extname(nombre).toLowerCase();
const mimeEsperado = EXTENSIONES_PERMITIDAS[extension];
if (!mimeEsperado) {
  return res.status(400).json({ error: 'Solo se permiten imágenes PNG, JPG, GIF o WEBP.' });
}

const buffer = Buffer.from(contenidoBase64, 'base64');
if (buffer.length === 0 || buffer.length > TAMANO_MAX) {
  return res.status(400).json({ error: 'El archivo tiene que pesar menos de 2 MB.' });
}

if (detectarMime(buffer) !== mimeEsperado) {
  return res.status(400).json({ error: 'El contenido del archivo no coincide con su extensión.' });
}

const nombreFinal = crypto.randomBytes(16).toString('hex') + extension;
fs.writeFileSync(path.join(config.uploadsDir, nombreFinal), buffer, { flag: 'wx' });
```

**Cómo se verifica:** test `no se aceptan archivos ejecutables ni se escribe
fuera de uploads` (`tests/seguridad.test.ts`); controles VAL-04 y VAL-05.
Repitiendo el paso, el panel muestra `Solo se permiten imágenes PNG, JPG, GIF o
WEBP.` y el archivo no se guarda.

### 11. Contraseñas en texto plano

**Qué es y por qué importa:** las contraseñas se guardaban tal cual en la
base. Cualquier filtración (la inyección de la falla 4, un backup, un dump)
dejaba expuestas todas las cuentas al instante.

**Dónde está:** `inicializar.ts:56-63` (la carga inicial inserta la
contraseña sin hashear) y `services/usuarios.service.ts:42` (el login compara
en texto plano dentro del SQL).

**Cómo se observa:**

```
docker compose exec db psql -U postgres -d origen -c "SELECT username, password FROM usuarios;"
```

**Evidencia:** se leen `admin | admin`, `valentina | origen2024`, etc.

**Por qué ocurre:** no se usaba ninguna función de hash, aunque `bcryptjs` ya
estaba en el `package.json`.

**Cómo se corrige:** las contraseñas se guardan con `bcrypt.hash` (con salt)
y se comparan con `bcrypt.compare` (falla 1). La carga inicial hashea antes de
insertar (`inicializar.ts:59-64`):

```ts
await db.query(
  `INSERT INTO usuarios (username, password, rol, nombre)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (username) DO NOTHING`,
  [usuario.username, await bcrypt.hash(usuario.password, RONDAS_BCRYPT), usuario.rol, usuario.nombre]
);
```

Si la base ya tenía claves en texto plano, `migrarPasswordsEnTextoPlano`
(`inicializar.ts:95`) las convierte al arrancar. Cuando el usuario no existe
igual se compara contra un hash falso, para que la respuesta tarde lo mismo.
El listado de usuarios ya no devuelve la columna `password`
(`services/usuarios.service.ts:18`).

**Cómo se verifica:** test `las contraseñas NO se guardan en texto plano`
(`tests/seguridad.test.ts`); controles AUTH-01, AUTH-02 y AUTH-03. Repitiendo
la consulta, la columna muestra hashes que empiezan con `$2a$`/`$2b$`.

### 12. Sin protección contra fuerza bruta

**Qué es y por qué importa:** el login permitía intentos ilimitados, sin
bloqueo ni demora. Con tiempo, cualquier contraseña débil termina cayendo.

**Dónde está:** `routes/auth.routes.ts:18` (el endpoint no tenía ningún
límite).

**Cómo se observa:** en el panel, probar a mano varias contraseñas
incorrectas seguidas para el mismo usuario.

**Evidencia:** todas responden igual y se puede seguir probando sin límite.

**Por qué ocurre:** nadie limitaba la cantidad de intentos, aunque
`express-rate-limit` ya estaba instalado.

**Cómo se corrige:** dos límites sobre `/api/auth/login`: 5 intentos fallidos
cada 15 minutos por IP + usuario, y 30 por IP en general (para el que prueba
muchos usuarios). Los logins correctos no cuentan. Al pasarse responde 429
(`routes/auth.routes.ts:14-42`).

```ts
const limitePorCuenta = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const username = req.body && typeof req.body.username === 'string' ? req.body.username : '';
    return req.ip + '|' + username.toLowerCase();
  },
  message: { error: MENSAJE_BLOQUEO },
});
...
router.post('/login', limitePorIp, limitePorCuenta, async (req, res, next) => {
```

**Cómo se verifica:** tests `el login bloquea o limita los intentos
repetidos` y `el login correcto sigue funcionando después de un bloqueo`
(`tests/seguridad-fuerza-bruta.test.ts`); control AUTH-04. Repitiendo el paso,
al sexto intento fallido el panel muestra `Demasiados intentos fallidos...`.

### 13. Cookie de sesión sin HttpOnly, Secure ni SameSite

**Qué es y por qué importa:** sin `HttpOnly`, cualquier XSS podía leer la
cookie con `document.cookie` y robar la sesión. Sin `Secure`, viaja en texto
plano por HTTP. Sin `SameSite`, el navegador la manda desde otros sitios, lo
que facilita el CSRF.

**Dónde está:** `middleware/sesion.ts:62`

```ts
res.cookie('sid', id, { path: '/' });
```

**Cómo se observa:** iniciar sesión en el panel y abrir devtools →
Application → Cookies.

**Evidencia:** la cookie `sid` no tiene marcadas las columnas `HttpOnly`,
`Secure` ni `SameSite`. En la consola, `document.cookie` muestra el `sid`.

**Por qué ocurre:** se usaron las opciones por defecto de `res.cookie`.

**Cómo se corrige:** opciones explícitas para la cookie
(`middleware/sesion.ts:25-30` y `:66`). `secure` se activa solo en
producción, porque en local se usa http y el navegador no guardaría la
cookie.

```ts
const opcionesCookie = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
};
...
res.cookie('sid', id, { ...opcionesCookie, maxAge: TTL_SESION });
```

**Cómo se verifica:** test `la cookie de sesión lleva HttpOnly, Secure y
SameSite` (`tests/seguridad.test.ts`); controles AUTH-05 y AUTH-06. Repitiendo
el paso, la cookie aparece con `HttpOnly` y `SameSite=Lax`, y `document.cookie`
ya no la muestra.

### 14. ID de sesión predecible

**Qué es y por qué importa:** el id de sesión era un contador (`sesion_1`,
`sesion_2`...). Cambiando el número en la cookie se entraba en la sesión de
otra persona.

**Dónde está:** `middleware/sesion.ts:30`, `:49` y `:52`

```ts
let contadorSesiones = 0;
...
contadorSesiones += 1;
const id = `sesion_${contadorSesiones}`;
```

**Cómo se observa:** iniciar sesión dos veces (en dos navegadores) y
comparar el valor de la cookie `sid`.

**Evidencia:** los valores son consecutivos.

**Por qué ocurre:** un contador sirve para numerar, no para identificar algo
secreto. Además, el id no se regeneraba al hacer login.

**Cómo se corrige:** el id sale de `crypto.randomBytes(32)` (64 caracteres
hex) y al loguearse se descarta la sesión anterior para que el id cambie
(`middleware/sesion.ts:52-56`).

```ts
export function crearSesion(req: Request, res: Response, usuario: UsuarioSesion): string {
  // si ya venia con una sesion se descarta, asi el id cambia despues del login
  destruirSesion(req);

  const id = crypto.randomBytes(32).toString('hex');
```

**Cómo se verifica:** test `el identificador de sesión es aleatorio y no
predecible` (`tests/seguridad.test.ts`); controles AUTH-07 y AUTH-08.
Repitiendo el paso, los dos valores son largos, distintos y sin relación entre
sí.

### 15. Sesiones que nunca expiran

**Qué es y por qué importa:** una sesión abierta quedaba viva para siempre.
Si alguien se quedaba con la cookie (una computadora compartida), el acceso no
caducaba nunca.

**Dónde está:** `middleware/sesion.ts:58`

```ts
expiraEn: null,
```

**Cómo se observa:** iniciar sesión, dejar el panel abierto sin usarlo un
buen rato y volver a usarlo.

**Evidencia:** la sesión sigue activa sin importar el tiempo que pase.

**Por qué ocurre:** no había ningún vencimiento ni control de inactividad.

**Cómo se corrige:** la sesión vence a las 8 horas o a los 30 minutos sin uso
(`middleware/sesion.ts:22-23` y `:80-83`). Además, cada 10 minutos se limpian
las vencidas del `Map`.

```ts
const TTL_SESION = 8 * 60 * 60 * 1000;
const TTL_INACTIVIDAD = 30 * 60 * 1000;
...
if (ahora > sesion.expiraEn || ahora - sesion.ultimoUso > TTL_INACTIVIDAD) {
  sesiones.delete(id);
  return null;
}
```

**Cómo se verifica:** controles AUTH-09 y AUTH-10 (no hay test de la batería
para esta falla, porque habría que esperar 30 minutos). Repitiendo el paso,
después de 30 minutos sin uso el panel vuelve a pedir el login.

### 16. Logout que no invalida la sesión en el servidor

**Qué es y por qué importa:** el logout solo borraba la cookie del
navegador; la sesión seguía viva en el servidor. Si alguien se había copiado
la cookie, "cerrar sesión" no le sacaba el acceso.

**Dónde está:** `routes/auth.routes.ts:69-72`

```ts
router.post('/logout', (req, res) => {
  res.clearCookie('sid', { path: '/' });
  res.json({ mensaje: 'Sesión cerrada.' });
});
```

**Cómo se observa:**

1. Iniciar sesión y copiar el valor de la cookie `sid`.
2. Cerrar sesión desde el panel.
3. Volver a poner la cookie copiada (devtools → Application → Cookies) y
   recargar.

**Evidencia:** el panel vuelve a abrir con la sesión "cerrada".

**Por qué ocurre:** la sesión vive en el `Map` del servidor y el logout
nunca la borraba de ahí.

**Cómo se corrige:** el logout borra la sesión del servidor y también la
cookie (`routes/auth.routes.ts:73-77`).

```ts
router.post('/logout', (req, res) => {
  destruirSesion(req);
  borrarCookieSesion(res);
  res.json({ mensaje: 'Sesion cerrada.' });
});
```

**Cómo se verifica:** test `el logout invalida la sesión en el servidor`
(`tests/seguridad.test.ts`); control AUTH-11. Repitiendo los pasos, con la
cookie copiada el panel pide el login de nuevo.

### 17. Enumeración de usuarios en el login

**Qué es y por qué importa:** el login respondía distinto si el usuario no
existía o si la contraseña estaba mal. Así se podía averiguar qué cuentas
había antes de atacarlas. Además, el mensaje repetía lo que se escribía, lo
que se combinaba con el XSS reflejado (falla 5).

**Dónde está:** `routes/auth.routes.ts:33-39`

```ts
if (existe) {
  return res.status(401).json({ error: 'La contraseña es incorrecta.' });
}
return res.status(401).json({ error: `El usuario "${username}" no existe en el sistema.` });
```

**Cómo se observa:** en el login, probar con `fantasma` (no existe) y después
con `valentina` y una contraseña incorrecta.

**Evidencia:** los dos mensajes son distintos.

**Por qué ocurre:** se quiso dar un mensaje "útil" sin pensar que también le
sirve al atacante.

**Cómo se corrige:** un único mensaje para los dos casos
(`routes/auth.routes.ts:9` y `:53-56`).

```ts
const MENSAJE_LOGIN_FALLIDO = 'Usuario o contrasena incorrectos.';
...
const usuario = await usuarios.autenticar(username, password);
if (!usuario) {
  return res.status(401).json({ error: MENSAJE_LOGIN_FALLIDO });
}
```

**Cómo se verifica:** test `los mensajes de login son genéricos (sin
enumeración de usuarios)` (`tests/seguridad-login.test.ts`); control AUTH-12.
Repitiendo el paso, los dos casos muestran el mismo mensaje.

### 18. Autorización ausente: cualquier usuario entra al panel

**Qué es y por qué importa:** el panel solo pedía estar logueado. Un usuario
con rol `cliente` podía borrar productos, cambiar contraseñas y ejecutar
comandos en el servidor. Las reseñas también las podía borrar cualquiera.

**Dónde está:** `routes/admin.routes.ts:31` (`requiereRol` estaba importado
pero no se usaba) y `routes/comentarios.routes.ts:39-41` (el DELETE de reseñas
no pedía rol).

```ts
router.use(requiereSesion);
```

**Cómo se observa:** entrar al panel con `cliente` / `cliente`.

**Evidencia:** el panel carga completo, con todas las pestañas y acciones.

**Por qué ocurre:** se confundió autenticación (quién sos) con autorización
(qué podés hacer). El middleware `requiereRol` existía
(`middleware/auth.ts:27`), pero nunca se aplicó.

**Cómo se corrige:** todo el router del panel exige sesión y rol admin
(`routes/admin.routes.ts:33`), y borrar reseñas también
(`routes/comentarios.routes.ts:33`).

```ts
router.use(requiereSesion, requiereRol('admin'));
```

```ts
router.delete('/:id', requiereSesion, requiereRol('admin'), async (req, res, next) => {
```

**Cómo se verifica:** test `un usuario sin rol admin NO puede entrar al
panel` (`tests/seguridad.test.ts`); control AUTH-14. Repitiendo el paso con el
usuario `cliente`, la API del panel responde 403.

### 19. Escalada de privilegios: cualquiera se cambia el rol a admin

**Qué es y por qué importa:** el PUT de usuarios copiaba cualquier campo que
llegara, incluido el `rol`. Un usuario `cliente` podía hacer
`PUT /api/admin/usuarios/<su id>` con `{"rol":"admin"}` y quedaba de
administrador.

**Dónde está:** `routes/admin.routes.ts:49-56` (la asignación del rol está en
la línea 55).

```ts
if (rol !== undefined) cambios.rol = rol;
```

**Cómo se observa:** con la sesión del usuario `cliente`, en la pestaña
Usuarios cambiarse el propio rol a `admin`.

**Evidencia:** después de recargar, el panel lo trata como administrador.

**Por qué ocurre:** asignación masiva: se confió en que el cuerpo de la
petición solo traería lo que muestra el formulario.

**Cómo se corrige:** el PUT solo toma campos conocidos y valida cada uno. El
rol tiene que estar en la lista de roles válidos, se vuelve a chequear que
quien lo pide sea admin, y un admin no se puede sacar el rol a sí mismo
(`routes/admin.routes.ts:80-88`).

```ts
if (rol !== undefined) {
  if (!req.usuario || req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'No tenés permisos para cambiar roles.' });
  }
  if (!enLista(rol, ROLES_PERMITIDOS)) throw errorValidacion('Rol inválido.');
  if (id === req.usuario.id && rol !== 'admin') {
    throw errorValidacion('No te podés sacar el rol de admin a vos mismo.');
  }
  cambios.rol = rol;
}
```

**Cómo se verifica:** test `un usuario NO puede cambiar su propio rol a
admin` (`tests/seguridad.test.ts`); control AUTH-15. Repitiendo el paso, la
API responde 403 y el rol no cambia.

### 20. Inyección de comandos en "probar conexión"

**Qué es y por qué importa:** la herramienta "Probar conexión con el
proveedor" metía el host dentro de un comando de shell. Con eso se ejecutaba
cualquier comando en el servidor y la salida se mostraba en la página.

**Dónde está:** `routes/admin.routes.ts:149-160` (el comando se arma en la
línea 153 y se ejecuta en la 155).

```ts
const comando = `ping -c 3 ${host}`;
exec(comando, (error, stdout, stderr) => {
```

**Cómo se observa:** Panel → Herramientas → "Probar conexión con el
proveedor", escribir `127.0.0.1; cat /etc/hostname`.

**Evidencia:** después de la salida del `ping` aparece el contenido de
`/etc/hostname`.

**Por qué ocurre:** `exec` pasa el texto a `/bin/sh`, que interpreta `;`,
`&&`, `|` y `$(...)` como operadores. El `;` cierra el `ping` y empieza otro
comando.

**Cómo se corrige:** el host tiene que estar en una lista blanca, que el
panel ofrece en un selector. Si no está, el error no dice cuáles son los
permitidos y el intento queda en el log. El comando se ejecuta con `spawn` y
`shell: false`: aunque el host trajera `;` o `&&`, sería un solo argumento
(`routes/admin.routes.ts:287-303`).

```ts
const HOSTS_PERMITIDOS = ['proveedor.origen.com', 'localhost'];

router.post('/probar-conexion', (req, res) => {
  const { host } = req.body || {};

  if (!enLista(host, HOSTS_PERMITIDOS)) {
    console.warn(
      '[probar-conexion] host rechazado:',
      JSON.stringify(String(host).slice(0, 100)),
      'usuario:',
      req.usuario!.username
    );
    return res.status(400).json({ error: 'Host no permitido.' });
  }

  const proceso = spawn('ping', ['-c', '3', '-W', '2', host], { shell: false, timeout: 10000 });
```

**Cómo se verifica:** tests `el endpoint de conexión NO ejecuta el comando
inyectado` y `el endpoint de conexión NO ejecuta un segundo comando
encadenado` (`tests/seguridad.test.ts`); controles CMD-01, CMD-02 y CMD-03.
Repitiendo el paso con `curl` (el panel ya no deja escribir el host), la API
responde `Host no permitido.` y no ejecuta nada.

### 21. Exposición de secretos por /api/_diagnostico

**Qué es y por qué importa:** el endpoint devolvía `process.env` entero, con
la clave de la base, y no pedía login. Cualquiera que conociera la URL se
llevaba las credenciales.

**Dónde está:** `routes/debug.routes.ts:17-28`, montado sin autenticación en
`app.ts:46`.

```ts
entorno: process.env,
...
password: process.env.DB_PASSWORD,
```

**Cómo se observa:** sin iniciar sesión, abrir
`http://localhost:8080/api/_diagnostico`.

**Evidencia:** el JSON muestra `DB_PASSWORD`, `DB_USER`, la versión de Node,
la memoria y el resto de las variables de entorno.

**Por qué ocurre:** una herramienta de depuración quedó publicada en la
aplicación, sin protección.

**Cómo se corrige:** pide sesión de admin y solo devuelve estado, uptime y
hora (`routes/debug.routes.ts:14-21`).

```ts
router.get('/', requiereSesion, requiereRol('admin'), (req, res) => {
  res.json({
    mensaje: 'Diagnóstico del servidor',
    estado: 'ok',
    uptimeSegundos: Math.round(process.uptime()),
    hora: new Date().toISOString(),
  });
});
```

**Cómo se verifica:** test `el endpoint de diagnóstico NO expone secretos`
(`tests/seguridad.test.ts`); controles CFG-03 y CFG-04. Repitiendo el paso sin
sesión, responde 401; con sesión de admin, solo muestra estado, uptime y hora.

### 22. Stack traces al cliente

**Qué es y por qué importa:** ante cualquier error, la API devolvía el
mensaje original y el stack trace: rutas del servidor, nombres de tablas y
partes del SQL. Es información que le sirve al atacante para armar el
siguiente paso.

**Dónde está:** `middleware/errores.ts:28-31`

```ts
res.status(err.status || 500).json({
  error: err.message,
  stack: err.stack,
});
```

**Cómo se observa:** pedir un producto con un id raro:
`http://localhost:8080/api/productos/abc`.

**Evidencia:** la respuesta JSON trae el error de PostgreSQL y el campo
`stack` con las rutas de los archivos del servidor.

**Por qué ocurre:** el manejador de errores mandaba al cliente lo mismo que
debería ir solo al log.

**Cómo se corrige:** el detalle queda en el log y al cliente le llega un
mensaje genérico. Solo se muestran los mensajes de validación que armamos
nosotros (`err.publico`) (`middleware/errores.ts:21-31`).

```ts
export function manejadorErrores(err: ErrorHttp, req: Request, res: Response, next: NextFunction): void {
  const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;

  if (status === 500) {
    console.error('[error]', req.method, req.originalUrl, err);
    res.status(500).json({ error: 'Error interno del servidor.' });
    return;
  }

  res.status(status).json({ error: err.publico ? err.message : 'Solicitud invalida.' });
}
```

**Cómo se verifica:** test `la API NO devuelve stack traces al cliente`
(`tests/seguridad.test.ts`); control VAL-06. Repitiendo el paso, la respuesta
es `Producto no encontrado.` sin ningún stack.

### 23. Sin cabeceras de seguridad

**Qué es y por qué importa:** sin Content Security Policy, si un XSS logra
colarse el navegador lo ejecuta sin ninguna barrera extra. Sin
`X-Frame-Options` ni `X-Content-Type-Options`, el sitio queda expuesto a
clickjacking y a que el navegador interprete mal los archivos.

**Dónde está:** `app.ts:16-27` (no se usaba `helmet`; el comentario de la
falla está en las líneas 16-25 y los middlewares empiezan en la 26).

**Cómo se observa:** abrir el sitio con el devtools en la pestaña Network y
mirar las cabeceras de la respuesta de `/`.

**Evidencia:** no aparecen `Content-Security-Policy`, `X-Frame-Options` ni
`X-Content-Type-Options`.

**Por qué ocurre:** Express no agrega cabeceras de seguridad por su cuenta, y
`helmet`, aunque estaba instalado, no se usaba.

**Cómo se corrige:** `helmet` con una CSP estricta (`app.ts:20-36`). Como el
sitio no tiene scripts inline, aunque se cuele un `<script>` el navegador no lo
ejecuta.

```ts
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  })
);
```

**Cómo se verifica:** test `el sitio envía cabeceras de seguridad`
(`tests/seguridad.test.ts`); controles XSS-03 y CFG-01. Repitiendo el paso,
aparecen `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options` y `Referrer-Policy`.

### 24. Base de datos sin contraseña y con el superusuario

**Qué es y por qué importa:** la base aceptaba conexiones sin contraseña y
la aplicación se conectaba como superusuario (`postgres`). Cualquier
inyección SQL podía borrar tablas, crear usuarios o tirar la base entera.

**Dónde está:** `docker-compose.yml:29` (`POSTGRES_HOST_AUTH_METHOD: trust`),
`docker-compose.yml:60-61` (la app usa `postgres`/`postgres`) y
`config.ts:27-28`, donde un comentario `FALLA` ya avisa que la app se conecta
con el superusuario.

**Cómo se observa:** desde el contenedor de la app, conectarse a la base
como `postgres` sin pasar ninguna contraseña:

```
docker compose exec app node -e "const {Client}=require('pg');const c=new Client({host:'db',user:'postgres',database:'origen'});c.connect().then(()=>c.query('SELECT current_user, usesuper FROM pg_user WHERE usename = current_user')).then(r=>{console.log(r.rows);c.end()})"
```

**Evidencia:** la conexión se acepta y muestra
`[ { current_user: 'postgres', usesuper: true } ]`: cualquier proceso de la
red de Docker entra como superusuario sin clave.

**Por qué ocurre:** se usó la configuración más cómoda para desarrollo y se
ignoró el principio de mínimos privilegios. El usuario `origen_app`, con
permisos reducidos, ya existía en `docker/initdb/02-usuario-aplicacion.sql`
pero no se usaba.

**Cómo se corrige:** se sacó `trust`, la clave del superusuario sale del
`.env` y la app se conecta con `origen_app`, que solo puede leer y escribir
datos (`docker-compose.yml:25-27` y `:54-57`).

```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-Origen_Db_Admin_2024}
...
DB_USER: origen_app
DB_PASSWORD: ${DB_PASSWORD:-origen_app_2024}
```

**Cómo se verifica:** test `la aplicación NO se conecta con un superusuario
de la base` (`tests/seguridad.test.ts`); controles SQLI-03 y SQLI-05.
Repitiendo el comando, la conexión se rechaza porque falta la contraseña.

---

## Fallas adicionales

Estas fallas no están en la tabla "Las fallas que hay que encontrar". Las encontramos revisando el
código y los comentarios `FALLA`, y llevan su propia numeración.

### Adicional 1. Credenciales por defecto

**Qué es y por qué importa:** las cuentas de ejemplo tenían contraseñas
triviales (`admin/admin`, `cliente/cliente`, `barista/cafe123`). Una cuenta
admin con clave conocida es la puerta de entrada más común, y fue la del
incidente del enunciado.

**Dónde está:** `inicializar.ts:21-51` (usuarios iniciales) y
`config.ts:36-39` (`credencialesPorDefecto`).

**Cómo se observa:** entrar al panel con `admin` / `admin`.

**Evidencia:** el panel abre como administrador.

**Por qué ocurre:** se dejaron las claves de prueba como claves reales y
nadie las cambió.

**Cómo se corrige:** claves nuevas y largas en `inicializar.ts:21-52` (están
en el README), y se borró `credencialesPorDefecto` de `config.ts`.

```ts
{
  username: 'admin',
  password: 'Admin_Origen_24!',
  rol: 'admin',
  nombre: 'Administración',
},
```

**Cómo se verifica:** control AUTH-13. Repitiendo el paso, `admin` / `admin`
responde `Usuario o contrasena incorrectos.`

### Adicional 2. Secretos escritos en el código

**Qué es y por qué importa:** la contraseña de la base y un secreto de
sesión estaban escritos en el código, así que quedaban en el repositorio
para cualquiera que lo leyera.

**Dónde está:** `config.ts:28` (`password: process.env.DB_PASSWORD || 'postgres'`)
y `config.ts:33` (`sessionSecret: 'origen-cafe-2024'`).

**Cómo se observa:** abrir `src/config.ts` en el repositorio.

**Evidencia:** las claves se leen directamente en el archivo.

**Por qué ocurre:** se pusieron valores "por defecto" para que la app
arrancara sin configurar nada.

**Cómo se corrige:** todo sale de variables de entorno (`config.ts:10-23`) y
hay un `.env.example` para copiar. El `.env` no se sube al repositorio.

```ts
db: {
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'origen',
  user: process.env.DB_USER || 'origen_app',
  password: process.env.DB_PASSWORD,
},
```

**Cómo se verifica:** control CFG-02.

### Adicional 3. Contenedor de la app corriendo como root

**Qué es y por qué importa:** el proceso de Node corría como root dentro del
contenedor. Combinado con la inyección de comandos (falla 20), el atacante
ejecutaba comandos con todos los permisos del contenedor.

**Dónde está:** `Dockerfile` (no tenía ninguna instrucción `USER`).

**Cómo se observa:** `docker compose exec app whoami`.

**Evidencia:** responde `root`.

**Por qué ocurre:** la imagen de Node corre como root si no se indica otro
usuario.

**Cómo se corrige:** se usa el usuario `node` que trae la imagen
(`Dockerfile:28-31`).

```dockerfile
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
```

**Cómo se verifica:** control CFG-05. Repitiendo el paso, `whoami` responde
`node`.

### Adicional 4. Estado de pedido sin validar

**Qué es y por qué importa:** el cambio de estado de un pedido aceptaba
cualquier texto. Un pedido podía quedar en un estado que no existe, y el
panel y los reportes dejaban de reconocerlo.

**Dónde está:** `routes/pedidos.routes.ts:64-66`, señalado por un comentario
`FALLA`.

```ts
// FALLA: no se valida el valor de `estado` (cualquier texto se acepta)
const pedido = await pedidos.cambiarEstado(req.params.id, estado);
```

**Cómo se observa:** con el id de un pedido existente, mandar
`PATCH /api/pedidos/<id>/estado` con `{"estado":"cualquier cosa"}`.

**Evidencia:** la API responde 200 y el pedido queda con el estado
`cualquier cosa`.

**Por qué ocurre:** la columna `estado` de la base es `TEXT` sin restricción
(`docker/initdb/01-esquema.sql:32`) y la ruta no controla el valor.

**Cómo se corrige:** lista blanca de estados y validación del id
(`routes/pedidos.routes.ts:50-58`, con `ESTADOS_PERMITIDOS` en
`validacion.ts:7`).

```ts
const id = validarId(req.params.id);
if (!id) return res.status(404).json({ error: 'Pedido no encontrado.' });

const { estado } = req.body || {};
if (!enLista(estado, ESTADOS_PERMITIDOS)) {
  return res.status(400).json({ error: 'Estado inválido.' });
}
```

**Cómo se verifica:** no hay test de la batería ni control del checklist
para este caso. Repitiendo el paso, la API responde 400 `Estado inválido.`, y
con `{"estado":"listo"}` sigue funcionando.

### Adicional 5. Cambio de contraseña sin pedir la actual

**Qué es y por qué importa:** para cambiar la contraseña alcanzaba con tener
la sesión abierta. Con una sesión robada (por XSS o una computadora que quedó
abierta), el atacante podía cambiar la clave y dejar afuera al dueño. Tampoco
se controlaba que la contraseña nueva fuera segura.

**Dónde está:** `routes/admin.routes.ts:119-131`. El comentario `FALLA` de
la línea 116 ya avisa que no tiene límite de intentos, y el de la 125, que no
se valida la complejidad.

```ts
const { nueva } = req.body || {};
...
const usuario = await usuarios.cambiarPassword(req.usuario!.id, nueva);
```

**Cómo se observa:** en el panel, cambiar la contraseña a `1`.

**Evidencia:** responde `Contraseña actualizada.` sin pedir la contraseña
actual y aceptando una clave de un carácter.

**Por qué ocurre:** se dio por sentado que quien tiene la sesión es el dueño
de la cuenta.

**Cómo se corrige:** se pide la contraseña actual, que se verifica con
bcrypt. Los intentos fallidos tienen un límite de 5 cada 15 minutos por
usuario. La contraseña nueva tiene que tener al menos 10 caracteres, con
mayúscula, minúscula, número y símbolo, y el mensaje dice qué le falta
(`routes/admin.routes.ts:116-142` y `:230-275`). El panel tiene un campo nuevo,
"Contraseña actual".

```ts
router.post('/cambiar-contrasena', validarCambioPassword, limiteCambioPassword, async (req, res, next) => {
  try {
    const { actual, nueva } = req.body;
    const verificado = await usuarios.autenticar(req.usuario!.username, actual);
    if (!verificado || verificado.id !== req.usuario!.id) {
      return res.status(403).json({ error: 'La contraseña actual no es correcta.' });
    }

    const usuario = await usuarios.cambiarPassword(req.usuario!.id, nueva);
    cerrarSesionesDe(req.usuario!.id, req.sesion);
    res.json({ mensaje: 'Contraseña actualizada.', usuario });
```

**Cómo se verifica:** no hay test de la batería para este caso. Repitiendo
el paso, el panel muestra `La contraseña no cumple los requisitos. Falta: al
menos 10 caracteres, una mayúscula, una minúscula, un símbolo.`; con la
contraseña actual equivocada responde 403, y al sexto intento, 429.

### Adicional 6. Las sesiones conservaban el rol viejo

**Qué es y por qué importa:** la sesión guarda una copia del usuario con su
rol. Si un admin le bajaba el rol a alguien, o le cambiaba la contraseña, esa
persona seguía con la sesión abierta y con los permisos viejos hasta que la
sesión venciera.

**Dónde está:** `routes/admin.routes.ts:49-65` (el PUT de usuarios no tocaba
las sesiones abiertas) y `middleware/sesion.ts:55-59` (la sesión guarda la
copia del usuario).

**Cómo se observa:**

1. Iniciar sesión como admin en un navegador y como otro usuario admin en
   otro navegador.
2. Desde el primero, cambiarle el rol al segundo a `mozo`.
3. En el segundo navegador, seguir usando el panel.

**Evidencia:** el segundo usuario sigue teniendo acceso de admin.

**Por qué ocurre:** los permisos se leen de la copia guardada al hacer
login, no de la base en cada petición.

**Cómo se corrige:** al cambiar el rol, la contraseña o el nombre de usuario
se cierran las sesiones abiertas de esa cuenta. Si el cambio es sobre la
propia cuenta se conserva la sesión actual, para no sacar del panel a quien
lo hizo (`routes/admin.routes.ts:42-46` y `:99-105`).

```ts
function cerrarSesionesDe(idUsuario: number, conservar?: Sesion): void {
  for (const [sid, sesion] of sesiones) {
    if (sesion.usuario.id === idUsuario && sesion !== conservar) sesiones.delete(sid);
  }
}
```

**Cómo se verifica:** no hay test de la batería para este caso. Repitiendo
los pasos, en el segundo navegador el panel vuelve a pedir el login, y al
entrar ya tiene el rol nuevo.

### Adicional 7. Pedidos y reportes sin sesión ni rol (limitación conocida, no corregida)

**Qué es y por qué importa:** `GET /api/pedidos`, `GET /api/pedidos/:id`,
`PATCH /api/pedidos/:id/estado` y las rutas de `/api/reportes` no comprueban
sesión ni rol. Cualquiera puede ver los pedidos de todas las mesas (con el
nombre de los clientes) y la facturación, o cambiar el estado de un pedido.

**Dónde está:** `routes/pedidos.routes.ts:36`, `:48` y `:61`, y todas las
rutas de `routes/reportes.routes.ts`. Los comentarios `FALLA` de
`routes/pedidos.routes.ts:33` y `:46` ya lo señalan.

**Cómo se observa:** sin iniciar sesión, abrir
`http://localhost:8080/api/pedidos`.

**Evidencia:** devuelve la lista completa de pedidos.

**Por qué ocurre:** las rutas se pensaron para el panel, pero nunca se les
pidió autenticación.

**Por qué no se corrigió:** los tests funcionales (`npm test`) llaman a esas
rutas sin iniciar sesión. Comprobar sesión o rol implicaría cambiar los
tests, así que se dejó documentado como limitación conocida. Lo que sí se
corrigió en esas rutas es la validación del id y del estado
(`routes/pedidos.routes.ts:38`, `:52` y `:56`).

**Cómo se corregiría:** agregar `requiereSesion` y `requiereRol(...)` con los
roles que correspondan en esas rutas, y actualizar los tests para que inicien
sesión antes de llamarlas.

---

## Reflexión final: qué cambió en nuestra forma de pensar

Antes de este trabajo pensábamos una web app desde el uso esperado: el
formulario manda lo que muestra, el usuario escribe un número donde dice
cantidad y el panel lo abre quien tiene que abrirlo. Si eso funcionaba, la
aplicación estaba terminada. Ahora la pensamos también desde el uso
malintencionado: cualquier dato que llega desde afuera (un campo, la URL, una
cookie, una cabecera, lo que está guardado en la base) puede traer cualquier
cosa. Por eso de ahora en mas:

- Trasladamos la confianza al servidor aplicando listas blancas en lugar de filtrar caracteres.
- Separamos estrictamente los datos del código para evitar inyecciones.
- Entendimos que la seguridad debe diseñarse de extremo a extremo (del servidor al cliente).
- Dejamos de dar fallas por cerradas hasta confirmar que la revisión de código, los tests automáticos y las pruebas manuales coinciden.