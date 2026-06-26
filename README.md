# 🏠 Home

PWA para llevar la cuenta del dinero que cada uno aporta a **la casa** (cooperativa) y saber, en todo momento, **quién debe a quién** para cuadrar el reparto pactado.

- El código de este repo es público pero **no contiene ningún dato**.
- Los datos viven en un **repo privado** (`home-data`) y viajan directamente entre cada dispositivo y GitHub por HTTPS.
- Funciona sin servidor propio. La pareja comparte el mismo repo de datos: cada uno conecta su propio token.

---

## Configuración inicial (una sola vez por dispositivo)

### 1. Crear el token de GitHub

1. GitHub → **Settings → Developer settings → Fine-grained personal access tokens → Generate new token**
2. **Token name:** cualquiera · **Expiration:** 1 año (o el máximo)
3. **Repository access:** *Only select repositories* → elige el repo `home-data`
4. **Permissions → Repository permissions → Contents: Read and write**
5. Generate token → copia el `github_pat_…`

> La pareja necesita ser **colaboradora** del repo `home-data` (Settings → Collaborators) y generar **su propio** token con sus permisos.

### 2. Conectar la app

En la app → **Ajustes → Sincronización (GitHub)**:

| Campo | Valor |
|---|---|
| Usuario | el dueño del repo de datos (p. ej. `JavattJones`) |
| Repositorio | `home-data` |
| Token | el `github_pat_…` copiado |

Pulsa **Guardar y probar**. El token se cifra con una contraseña y se guarda solo en ese dispositivo (hay que repetir este paso en cada dispositivo).

---

## Uso

- **Añadir** → registra cada movimiento:
  - **Aportación a la casa**: dinero que uno de los dos pone (entrada, cuota de la cooperativa, derrama, notaría…).
  - **Liquidación**: cuando uno os paga al otro para cuadrar el balance.
- **Resumen** → total aportado, **quién debe a quién**, reparto real vs. objetivo, gráficas por mes y por categoría.
- **Movim.** → todos los movimientos, con filtros por persona y categoría; editar o eliminar.
- **Ajustes** → vuestros nombres, reparto objetivo (50/50 por defecto), categorías, sincronización y copia de seguridad.

## Cómo se calcula el balance

A cada uno le corresponde su parte del reparto (50/50 por defecto) del **total aportado**. El balance de cada persona es:

```
aportado por la persona − lo que le corresponde + lo que ha pagado en liquidaciones − lo que ha recibido en liquidaciones
```

Si sale **positivo**, ha puesto de más y el otro le debe esa cantidad. Cuando uno salda esa diferencia, se registra como **liquidación** y el balance vuelve a cero.

## Diseño

Interfaz retro estilo terminal CRT: tipografía monoespaciada, ámbar/cian sobre negro, scanlines y pestañas [F1]–[F4]. Cada persona tiene su color (ámbar / cian).

## Copia de seguridad

Además del historial que guarda Git en el repo de datos (cada cambio es un commit), puedes exportar/importar el JSON desde **Ajustes**.

---

> Hermana de la app **Patrimonio**: mismo patrón (UI pública + datos privados en GitHub), distinto propósito.
> Al desplegar cambios en los assets, **sube el número de `CACHE` en `sw.js`** o el dispositivo seguirá sirviendo la versión vieja.
