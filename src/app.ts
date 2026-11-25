import path from 'path';
import express from 'express';
import helmet from 'helmet';

import config from './config';
import { rutaNoEncontrada, manejadorErrores } from './middleware/errores';
import { entregarTokenCsrf, verificarCsrf } from './middleware/csrf';
import authRoutes from './routes/auth.routes';
import productosRoutes from './routes/productos.routes';
import pedidosRoutes from './routes/pedidos.routes';
import reportesRoutes from './routes/reportes.routes';
import comentariosRoutes from './routes/comentarios.routes';
import adminRoutes from './routes/admin.routes';
import debugRoutes from './routes/debug.routes';

const app = express();

// Cabeceras de seguridad (CSP, nosniff, X-Frame-Options, Referrer-Policy...)
// El sitio no usa scripts ni estilos inline, asi que la CSP puede ser estricta.
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
        // en local se usa http, si se fuerza https la pagina no carga
        upgradeInsecureRequests: null,
      },
    },
  })
);

// La subida de imagenes viene en base64, necesita un limite mas grande.
// Para el resto alcanza con 100kb.
app.use('/api/admin/subir-archivo', express.json({ limit: '3mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// Archivos subidos por el panel (solo imagenes, ver admin.routes.ts)
app.use('/uploads', express.static(config.uploadsDir, { dotfiles: 'deny', index: false }));

// Sitio web estático
app.use(express.static(path.join(__dirname, 'public')));

// --- API --------------------------------------------------------------------
app.get('/api/salud', (req, res) => {
  res.json({ ok: true, servicio: 'cafeteria-origen', hora: new Date().toISOString() });
});

// Token anti-CSRF y verificacion en todo lo que cambia estado
app.get('/api/csrf-token', entregarTokenCsrf);
app.use('/api', verificarCsrf);

app.use('/api/auth', authRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/comentarios', comentariosRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/_diagnostico', debugRoutes);

app.use('/api', rutaNoEncontrada);

app.use(manejadorErrores);

export default app;
