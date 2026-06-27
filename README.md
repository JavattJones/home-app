# 🏠 Home

PWA para llevar el seguimiento de la compra de **vuestra casa** (una vivienda cooperativa): el **precio actual** y sus revisiones, cuánto habéis **aportado** entre los dos, cuánto **queda por aportar** (≈ hipoteca estimada) y **quién debe a quién** para cuadrar el reparto pactado.

- El código de este repo es público pero **no contiene ningún dato**.
- Los datos viven en un **repo privado** (`home-data`) y viajan directamente entre cada dispositivo y GitHub por HTTPS.
- Funciona sin servidor propio. Los colaboradores comparten el mismo repo de datos: cada uno conecta su propio token.

---

## Configuración inicial (una sola vez por dispositivo)

### 1. Crear el token de GitHub

1. GitHub → **Settings → Developer settings → Fine-grained personal access tokens → Generate new token**
2. **Token name:** cualquiera · **Expiration:** 1 año (o el máximo)
3. **Repository access:** *Only select repositories* → elige el repo `home-data`
4. **Permissions → Repository permissions → Contents: Read and write**
5. Generate token → copia el `github_pat_…`

> Cada colaborador/a necesita ser **colaborador/a** del repo `home-data` (Settings → Collaborators) y generar **su propio** token con sus permisos.

### 2. Conectar la app

En la app → **Ajustes → Sincronización (GitHub)**:

| Campo | Valor |
|---|---|
| Usuario | el dueño del repo de datos (tu usuario de GitHub) |
| Repositorio | `home-data` |
| Token | el `github_pat_…` copiado |

Pulsa **Guardar y probar**. El token se cifra con una contraseña y se guarda solo en ese dispositivo (hay que repetir este paso en cada dispositivo).

---

## Uso

- **Resumen** → el **precio de la casa** y su desviación, % financiado y lo que falta por aportar; una gráfica única que combina el **precio** (con su desviación) y lo **aportado**; debajo, en secundario, **quién debe a quién** y el reparto real vs. objetivo; KPIs y gráficas (aportaciones mes a mes, por categoría).
- **Añadir** → registra cada movimiento:
  - **Aportación a la casa**: dinero que pone uno (entrada, cuota de la cooperativa, derrama, notaría…).
  - **Liquidación**: cuando uno paga al otro para cuadrar el balance.
- **Movimientos** → todos, con filtros por persona y categoría; editar o eliminar.
- **Hipoteca** → estima la **cuota mensual** (sistema francés) y el **gasto mensual total** de la vivienda (hipoteca + comunidad + seguros + IBI), repartido entre los dos. Parámetros configurables: entrada/ahorro, tipo de interés (TIN), años, comunidad, seguros e IBI.
- **Ajustes** → los nombres (configurables), reparto objetivo (50/50 por defecto), el **precio de la casa** (con su historial de revisiones, editables), categorías, sincronización y copia de seguridad.

> **Reutilizable**: el código no está atado a ningún nombre. Cualquiera puede hacer **fork**, crear su propio repo de datos privado y desplegar su instancia; los nombres de las dos personas se configuran en Ajustes.

## Cómo se calcula el balance

A cada uno le corresponde su parte del reparto (50/50 por defecto) del **total aportado**. El balance de cada persona es:

```
aportado por la persona − lo que le corresponde + lo que ha pagado en liquidaciones − lo que ha recibido en liquidaciones
```

Si sale **positivo**, ha puesto de más y el otro le debe esa cantidad. Cuando uno salda esa diferencia, se registra como **liquidación** y el balance vuelve a cero.

## Diseño

Interfaz cálida y editorial, pensada para móvil: fondo crema, tipografías Instrument Serif (números y títulos) y Hanken Grotesk (UI), tarjetas redondeadas y microinteracciones suaves (bottom-sheet, toasts). Cada persona tiene su color: la primera verde pino, la segunda terracota. Gráficas con Chart.js; iconografía Phosphor.

## Copia de seguridad

Además del historial que guarda Git en el repo de datos (cada cambio es un commit), puedes exportar/importar el JSON desde **Ajustes**.

---

> Hermana de la app **Patrimonio**: mismo patrón (UI pública + datos privados en GitHub), distinto propósito.
> Al desplegar cambios en los assets, **sube el número de `CACHE` en `sw.js`** o el dispositivo seguirá sirviendo la versión vieja.
