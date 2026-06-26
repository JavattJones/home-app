/* secure-token.js — cifrado del token de GitHub en reposo (WebCrypto).
   El token deja de guardarse en claro en localStorage: se cifra con AES-GCM usando
   una clave derivada (PBKDF2) de una contraseña que el usuario introduce. Así, otra
   página del mismo origen (github.io) solo vería un blob cifrado inservible.

   Expone window.SecureToken:
     encrypt(token, pass)  -> { v, salt, iv, data }   (objeto serializable)
     decrypt(blob, pass)   -> token (string)          (lanza si la contraseña es incorrecta)
     askPassphrase()       -> Promise<string|null>    (modal: desbloquear)
     askNewPassphrase()    -> Promise<string|null>    (modal: crear, con confirmación)
*/
(function () {
  "use strict";

  const ITERATIONS = 210000;
  const te = new TextEncoder();
  const td = new TextDecoder();

  const b64enc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const b64dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encrypt(token, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(token));
    return { v: 1, salt: b64enc(salt), iv: b64enc(iv), data: b64enc(ct) };
  }

  async function decrypt(blob, pass) {
    const key = await deriveKey(pass, b64dec(blob.salt));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64dec(blob.iv) }, key, b64dec(blob.data));
    return td.decode(pt); // si la contraseña es incorrecta, decrypt() lanza antes de llegar aquí
  }

  // ---------- modal de contraseña (estilo terminal) ----------
  function buildModal({ title, hint, confirmar }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "st-overlay";
      overlay.innerHTML = `
        <div class="st-modal" role="dialog" aria-modal="true">
          <div class="st-title">${title}</div>
          <p class="st-hint">${hint}</p>
          <input type="password" class="st-input" id="st-p1" autocomplete="off"
                 placeholder="contraseña" inputmode="text">
          ${confirmar ? `<input type="password" class="st-input" id="st-p2" autocomplete="off" placeholder="repite la contraseña">` : ""}
          <p class="st-msg" id="st-msg"></p>
          <div class="st-row">
            <button class="btn" id="st-cancel">Cancelar</button>
            <button class="btn primary" id="st-ok">${confirmar ? "Cifrar" : "Desbloquear"}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);

      const p1 = overlay.querySelector("#st-p1");
      const p2 = overlay.querySelector("#st-p2");
      const msg = overlay.querySelector("#st-msg");
      setTimeout(() => p1.focus(), 30);

      const close = (val) => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
      const submit = () => {
        const v1 = p1.value;
        if (!v1) { msg.textContent = "Introduce una contraseña."; return; }
        if (confirmar) {
          if (v1.length < 6) { msg.textContent = "Usa al menos 6 caracteres."; return; }
          if (v1 !== p2.value) { msg.textContent = "Las contraseñas no coinciden."; return; }
        }
        close(v1);
      };
      const onKey = (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.key === "Escape") { e.preventDefault(); close(null); }
      };
      document.addEventListener("keydown", onKey);
      overlay.querySelector("#st-ok").addEventListener("click", submit);
      overlay.querySelector("#st-cancel").addEventListener("click", () => close(null));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
    });
  }

  const askPassphrase = () =>
    buildModal({
      title: "🔒 Desbloquear token",
      hint: "Introduce tu contraseña para descifrar el token y sincronizar con GitHub.",
      confirmar: false,
    });

  const askNewPassphrase = () =>
    buildModal({
      title: "🔒 Cifrar token",
      hint: "Elige una contraseña para proteger tu token. Si la olvidas no pierdes datos: " +
            "solo tendrías que regenerar el token en GitHub.",
      confirmar: true,
    });

  window.SecureToken = { encrypt, decrypt, askPassphrase, askNewPassphrase };
})();
